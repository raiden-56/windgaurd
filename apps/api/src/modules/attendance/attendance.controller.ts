import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/context';
import { Perm } from '../../common/permissions';
import { parse, z, zDate, zId } from '../../common/zod';
import { MARKABLE_STATUSES } from './attendance.engine';
import { AttendanceService } from './attendance.service';
import { CorrectionsService } from './corrections.service';
import { SyncService } from './sync.service';

const slotSchema = z.object({ siteId: zId, shiftId: zId, workDate: zDate });
const STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'WEEKLY_OFF', 'HOLIDAY', 'ON_DUTY', 'NOT_SCHEDULED', 'PENDING', 'INCOMPLETE'] as const;

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly svc: AttendanceService,
    private readonly corrections: CorrectionsService,
    private readonly syncSvc: SyncService,
  ) {}

  @Get('current')
  @Perm('attendance.read')
  current(@CurrentUser() user: AuthUser, @Query('siteId') siteId: string) {
    return this.svc.current(user, parse(zId, siteId));
  }

  @Get('register')
  @Perm('attendance.read')
  register(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    return this.svc.getRegister(user, parse(slotSchema, q));
  }

  @Get('records')
  @Perm('attendance.read')
  records(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(
      z.object({
        date: zDate.optional(),
        from: zDate.optional(),
        to: zDate.optional(),
        siteId: z.string().optional(),
        shiftId: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        search: z.string().optional(),
        late: z.coerce.boolean().optional(),
        mode: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
      q,
    );
    return this.svc.list(user, p);
  }

  @Post('mark')
  @HttpCode(200)
  @Perm('attendance.mark')
  mark(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      slotSchema.extend({
        entries: z
          .array(z.object({ employeeId: zId, status: z.enum(MARKABLE_STATUSES), remarks: z.string().max(500).optional().nullable() }))
          .min(1)
          .max(500),
      }),
      body,
    );
    return this.svc.mark(user, p, p.entries);
  }

  @Post('check-in')
  @HttpCode(200)
  @Perm('attendance.mark')
  checkIn(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      slotSchema.extend({ employeeId: zId, time: z.string().optional().nullable(), reason: z.string().max(300).optional().nullable(), remarks: z.string().max(500).optional().nullable() }),
      body,
    );
    return this.svc.checkIn(user, p, p);
  }

  @Post('check-out')
  @HttpCode(200)
  @Perm('attendance.mark')
  checkOut(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      slotSchema.extend({ employeeId: zId, time: z.string().optional().nullable(), reason: z.string().max(300).optional().nullable(), remarks: z.string().max(500).optional().nullable() }),
      body,
    );
    return this.svc.checkOut(user, p, p);
  }

  @Patch(':id/remarks')
  @Perm('attendance.mark')
  remarks(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { remarks } = parse(z.object({ remarks: z.string().max(500).nullable() }), body);
    return this.svc.updateRemarks(user, id, remarks);
  }

  @Get('registers')
  @Perm('attendance.read')
  registers(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    const p = parse(z.object({ status: z.enum(['OPEN', 'SUBMITTED', 'APPROVED', 'LOCKED']).optional(), siteId: z.string().optional(), from: zDate.optional(), to: zDate.optional() }), q);
    return this.svc.registers(user, p);
  }

  @Post('register/submit')
  @HttpCode(200)
  @Perm('attendance.mark')
  submit(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(slotSchema.extend({ note: z.string().max(500).optional().nullable() }), body);
    return this.svc.submit(user, p, p.note);
  }

  @Post('register/:id/:action')
  @HttpCode(200)
  @Perm('attendance.approve')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('action') action: string, @Body() body: unknown) {
    const a = parse(z.enum(['approve', 'reopen', 'lock']), action);
    const { note } = parse(z.object({ note: z.string().max(500).optional().nullable() }), body ?? {});
    return this.svc.decide(user, id, a.toUpperCase() as 'APPROVE' | 'REOPEN' | 'LOCK', note);
  }

  // ───────── corrections ─────────

  @Post(':id/corrections')
  @HttpCode(200)
  @Perm('corrections.request')
  requestCorrection(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const p = parse(
      z.object({
        reason: z.string().trim().min(5, 'Explain the correction (min 5 characters)').max(500),
        proposed: z.object({
          status: z.enum(STATUSES).optional(),
          checkInAt: z.string().nullable().optional(),
          checkOutAt: z.string().nullable().optional(),
          remarks: z.string().max(500).nullable().optional(),
        }),
      }),
      body,
    );
    return this.corrections.request(user, id, p.reason, p.proposed);
  }

  @Get('corrections/list')
  @Perm('attendance.read')
  listCorrections(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.corrections.list(user, status ? parse(z.enum(['PENDING', 'APPROVED', 'REJECTED']), status) : undefined);
  }

  @Post('corrections/:id/:decision')
  @HttpCode(200)
  @Perm('corrections.approve')
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('decision') decision: string, @Body() body: unknown) {
    const d = parse(z.enum(['approve', 'reject']), decision);
    const { note } = parse(z.object({ note: z.string().max(500).optional().nullable() }), body ?? {});
    return this.corrections.review(user, id, d === 'approve' ? 'APPROVED' : 'REJECTED', note);
  }

  // ───────── offline sync ─────────

  @Post('sync')
  @HttpCode(200)
  @Perm('attendance.mark')
  sync(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = parse(
      z.object({
        actions: z
          .array(
            z.object({
              clientId: z.string().min(8).max(80),
              action: z.enum(['MARK', 'CHECK_IN', 'CHECK_OUT']),
              siteId: zId,
              shiftId: zId,
              workDate: zDate,
              employeeId: zId,
              status: z.enum(MARKABLE_STATUSES).optional(),
              time: z.string().nullable().optional(),
              remarks: z.string().max(500).nullable().optional(),
              deviceRecordedAt: z.string(),
              baseVersion: z.number().int().nullable(),
              prevClientId: z.string().nullable().optional(),
            }),
          )
          .max(500),
      }),
      body,
    );
    return this.syncSvc.sync(user, p.actions);
  }

  @Get('sync/history')
  @Perm('attendance.read')
  syncHistory(@CurrentUser() user: AuthUser) {
    return this.syncSvc.history(user);
  }
}
