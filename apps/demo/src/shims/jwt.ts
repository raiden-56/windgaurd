// Sessions in the browser demo never leave the visitor's own browser, so the token only needs
// to carry the payload and expiry; there is no server to forge it against.
type Payload = Record<string, unknown> & { exp?: number };

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '');
const unb64 = (s: string) => decodeURIComponent(escape(atob(s)));

function seconds(expiresIn: string | number | undefined) {
  if (expiresIn === undefined) return undefined;
  if (typeof expiresIn === 'number') return expiresIn;
  const m = /^(\d+)\s*([smhd])$/.exec(expiresIn);
  if (!m) return Number(expiresIn);
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

export class JwtService {
  async signAsync(payload: Payload, opts: { expiresIn?: string | number } = {}) {
    const ttl = seconds(opts.expiresIn);
    const body: Payload = { ...payload, iat: Math.floor(Date.now() / 1000) };
    if (ttl) body.exp = body.iat as number + ttl;
    return `demo.${b64(JSON.stringify(body))}`;
  }
  async verifyAsync<T = any>(token: string): Promise<T> {
    const [kind, body] = token.split('.');
    if (kind !== 'demo' || !body) throw new Error('invalid token');
    const p = JSON.parse(unb64(body)) as Payload;
    if (p.exp && p.exp * 1000 < Date.now()) throw new Error('jwt expired');
    return p as T;
  }
}

export class JwtModule {
  static register(_opts: unknown) {
    return { module: JwtModule, providers: [JwtService], exports: [JwtService], global: true };
  }
}
