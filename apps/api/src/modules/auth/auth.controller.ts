import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { AuditService } from '../../common/audit.service';
import { SESSION_COOKIE } from '../../common/auth.guard';
import { AuthUser, CurrentUser } from '../../common/context';
import { permissionsFor, Public } from '../../common/permissions';
import { PrismaService } from '../../common/prisma.service';
import { parse, z } from '../../common/zod';

const CHALLENGE_COOKIE = 'wg_wa';
const SESSION_DAYS = 7;

const rp = () => ({
  rpID: process.env.RP_ID || 'localhost',
  rpName: process.env.RP_NAME || 'WINDGUARD',
  origin: (process.env.WEB_ORIGIN || 'http://localhost:3100').split(',').map((s) => s.trim()),
});

const secureCookies = () => (process.env.WEB_ORIGIN || '').startsWith('https://');

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── sessions ─────────────

  private async startSession(res: Response, req: Request, userId: string, method: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const token = await this.jwt.signAsync({ sub: user.id, v: user.sessionVersion }, { expiresIn: `${SESSION_DAYS}d` });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies(),
      maxAge: SESSION_DAYS * 86400_000,
      path: '/',
    });
    await this.audit.log(
      {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        orgId: user.organizationId,
        ip: req.socket.remoteAddress,
        userAgent: req.header('user-agent'),
      } as AuthUser,
      { action: 'auth.login', entity: 'User', entityId: user.id, after: { method } },
    );
    return { ok: true, role: user.role };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), body);
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Constant-ish time: always run a bcrypt comparison.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    if (!user || !user.passwordHash || !ok || !user.isActive) throw new UnauthorizedException('Invalid email or password');
    return this.startSession(res, req, user.id, 'password');
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const [dbUser, org, sites, orgs, passkeys] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } }),
      this.prisma.site.findMany({
        where: { organizationId: user.orgId, isActive: true, ...(user.siteIds ? { id: { in: user.siteIds } } : {}) },
        select: { id: true, name: true, code: true, timezone: true, district: true, state: true },
        orderBy: { name: 'asc' },
      }),
      user.role === 'SUPER_ADMIN'
        ? this.prisma.organization.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } })
        : Promise.resolve([]),
      this.prisma.passkeyCredential.count({ where: { userId: user.id } }),
    ]);
    return {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.fullName,
        phone: dbUser.phone,
        role: dbUser.role,
        hasPassword: !!dbUser.passwordHash,
        lastLoginAt: dbUser.lastLoginAt,
      },
      permissions: [...permissionsFor(dbUser.role, dbUser.extraPermissions)],
      organization: { id: org.id, name: org.name, code: org.code, timezone: org.timezone },
      organizations: orgs,
      sites,
      passkeyCount: passkeys,
    };
  }

  @Patch('profile')
  async profile(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parse(z.object({ fullName: z.string().min(2).max(120), phone: z.string().max(20).optional().nullable() }), body);
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, phone: true } });
    const after = await this.prisma.user.update({ where: { id: user.id }, data, select: { fullName: true, phone: true } });
    await this.audit.log(user, { action: 'user.profile.update', entity: 'User', entityId: user.id, before, after });
    return after;
  }

  @Post('password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { current, next } = parse(
      z.object({ current: z.string().optional(), next: z.string().min(10, 'Use at least 10 characters') }),
      body,
    );
    const dbUser = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (dbUser.passwordHash && !(await bcrypt.compare(current ?? '', dbUser.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
    await this.audit.log(user, { action: 'auth.password.change', entity: 'User', entityId: user.id });
    return { ok: true };
  }

  /** Secure alternative access: one-time recovery code issued by an administrator. */
  @Public()
  @Post('recover')
  @HttpCode(200)
  async recover(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, code, newPassword } = parse(
      z.object({ email: z.string().email(), code: z.string().min(6), newPassword: z.string().min(10, 'Use at least 10 characters') }),
      body,
    );
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const valid =
      user?.recoveryCodeHash &&
      user.recoveryExpires &&
      user.recoveryExpires > new Date() &&
      (await bcrypt.compare(code.trim().toUpperCase(), user.recoveryCodeHash));
    if (!user || !valid || !user.isActive) throw new UnauthorizedException('Recovery code is invalid or expired');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        recoveryCodeHash: null,
        recoveryExpires: null,
        sessionVersion: { increment: 1 },
      },
    });
    return this.startSession(res, req, user.id, 'recovery-code');
  }

  // ───────────── passkeys (WebAuthn) ─────────────

  private async saveChallenge(res: Response, challenge: string, purpose: string, userId?: string) {
    await this.prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const row = await this.prisma.webAuthnChallenge.create({
      data: { challenge, purpose, userId, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    res.cookie(CHALLENGE_COOKIE, row.id, { httpOnly: true, sameSite: 'strict', secure: secureCookies(), maxAge: 5 * 60_000, path: '/' });
  }

  private async takeChallenge(req: Request, res: Response, purpose: string) {
    const id = req.cookies?.[CHALLENGE_COOKIE];
    res.clearCookie(CHALLENGE_COOKIE, { path: '/' });
    if (!id) throw new UnauthorizedException('Passkey challenge missing — try again');
    const row = await this.prisma.webAuthnChallenge.findUnique({ where: { id } });
    if (row) await this.prisma.webAuthnChallenge.delete({ where: { id } });
    if (!row || row.purpose !== purpose || row.expiresAt < new Date()) throw new UnauthorizedException('Passkey challenge expired — try again');
    return row;
  }

  @Post('passkey/register/options')
  @HttpCode(200)
  async registerOptions(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const existing = await this.prisma.passkeyCredential.findMany({ where: { userId: user.id } });
    const { rpID, rpName } = rp();
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: user.fullName,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports as any })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await this.saveChallenge(res, options.challenge, 'register', user.id);
    return options;
  }

  @Post('passkey/register/verify')
  @HttpCode(200)
  async registerVerify(@CurrentUser() user: AuthUser, @Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const challenge = await this.takeChallenge(req, res, 'register');
    if (challenge.userId !== user.id) throw new UnauthorizedException('Challenge does not belong to this user');
    const { rpID, origin } = rp();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body?.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (err: any) {
      throw new UnauthorizedException(`Passkey registration failed: ${err.message}`);
    }
    if (!verification.verified || !verification.registrationInfo) throw new UnauthorizedException('Passkey could not be verified');
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const name = String(body?.name || '').trim().slice(0, 60) || guessDeviceName(req.header('user-agent'));
    const saved = await this.prisma.passkeyCredential.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name,
      },
    });
    await this.audit.log(user, { action: 'passkey.register', entity: 'PasskeyCredential', entityId: saved.id, after: { name } });
    return { ok: true, id: saved.id, name };
  }

  @Public()
  @Post('passkey/login/options')
  @HttpCode(200)
  async loginOptions(@Res({ passthrough: true }) res: Response) {
    const { rpID } = rp();
    // Discoverable credentials: the authenticator offers the account, so no email is required.
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
    await this.saveChallenge(res, options.challenge, 'login');
    return options;
  }

  @Public()
  @Post('passkey/login/verify')
  @HttpCode(200)
  async loginVerify(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const challenge = await this.takeChallenge(req, res, 'login');
    const response = body?.response;
    const cred = await this.prisma.passkeyCredential.findUnique({ where: { credentialId: String(response?.id ?? '') }, include: { user: true } });
    if (!cred || !cred.user.isActive) throw new UnauthorizedException('This passkey is not registered with WINDGUARD');
    const { rpID, origin } = rp();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(cred.publicKey),
          counter: Number(cred.counter),
          transports: cred.transports as any,
        },
      });
    } catch (err: any) {
      throw new UnauthorizedException(`Passkey sign-in failed: ${err.message}`);
    }
    if (!verification.verified) throw new UnauthorizedException('Passkey could not be verified');
    await this.prisma.passkeyCredential.update({
      where: { id: cred.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    return this.startSession(res, req, cred.userId, 'passkey');
  }

  @Get('passkeys')
  async listPasskeys(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.passkeyCredential.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      deviceType: r.deviceType,
      backedUp: r.backedUp,
      transports: r.transports,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
    }));
  }

  @Patch('passkeys/:id')
  async renamePasskey(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), body);
    const cred = await this.prisma.passkeyCredential.findFirst({ where: { id, userId: user.id } });
    if (!cred) throw new UnauthorizedException('Passkey not found');
    await this.prisma.passkeyCredential.update({ where: { id }, data: { name } });
    await this.audit.log(user, { action: 'passkey.rename', entity: 'PasskeyCredential', entityId: id, before: { name: cred.name }, after: { name } });
    return { ok: true };
  }

  @Delete('passkeys/:id')
  async revokePasskey(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cred = await this.prisma.passkeyCredential.findFirst({ where: { id, userId: user.id } });
    if (!cred) throw new UnauthorizedException('Passkey not found');
    await this.prisma.passkeyCredential.delete({ where: { id } });
    await this.audit.log(user, { action: 'passkey.revoke', entity: 'PasskeyCredential', entityId: id, before: { name: cred.name } });
    return { ok: true };
  }
}

function guessDeviceName(ua?: string) {
  if (!ua) return 'Passkey';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android device';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Passkey';
}
