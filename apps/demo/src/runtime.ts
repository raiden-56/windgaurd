/**
 * A minimal stand-in for the Nest HTTP runtime: it instantiates the real API modules
 * (dependency injection from decorator metadata), runs the real AuthGuard, and routes
 * requests to the real controller methods. Only the transport is emulated.
 */
import { HttpException, HttpStatus, RequestMethod } from '@nestjs/common';
import { CUSTOM_ROUTE_ARGS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, RESPONSE_PASSTHROUGH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { EventEmitter } from 'events';
import { intervals } from './shims/schedule';

type Ctor<T = any> = new (...args: any[]) => T;

export interface DemoRequest {
  method: string;
  /** Path including the /api prefix and query string, e.g. /api/attendance/register?siteId=… */
  url: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  /** JSON text, or a file upload. */
  body?: string;
  file?: { field: string; name: string; type: string; data: ArrayBuffer };
}

export interface CookieChange {
  name: string;
  value: string | null;
  maxAge?: number;
}

export interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer | string;
  cookies: CookieChange[];
}

// ───────────── dependency injection ─────────────

export class Container {
  private readonly instances = new Map<unknown, any>();
  readonly controllers: Ctor[] = [];
  private readonly classProviders = new Map<unknown, Ctor>();

  constructor(overrides: [unknown, unknown][]) {
    for (const [token, value] of overrides) this.instances.set(token, value);
  }

  /** Walks @Module metadata (static and dynamic modules) collecting controllers and token providers. */
  load(mod: any, seen = new Set<unknown>()) {
    const cls = mod?.module ?? mod;
    if (!cls || seen.has(mod)) return;
    seen.add(mod);
    const imports = [...(Reflect.getMetadata('imports', cls) ?? []), ...(mod.imports ?? [])];
    for (const i of imports) this.load(i, seen);
    const providers = [...(Reflect.getMetadata('providers', cls) ?? []), ...(mod.providers ?? [])];
    for (const p of providers) if (p && typeof p === 'object' && 'provide' in p && p.useClass) this.classProviders.set(p.provide, p.useClass);
    for (const c of Reflect.getMetadata('controllers', cls) ?? []) if (!this.controllers.includes(c)) this.controllers.push(c);
  }

  get<T>(token: unknown): T {
    if (this.instances.has(token)) return this.instances.get(token);
    const cls = (this.classProviders.get(token) ?? token) as Ctor<T>;
    if (typeof cls !== 'function') throw new Error(`No provider for ${String(token)}`);
    const deps: unknown[] = Reflect.getMetadata('design:paramtypes', cls) ?? [];
    const instance = new cls(...deps.map((d) => this.get(d)));
    this.instances.set(token, instance);
    return instance;
  }

  async init() {
    for (const c of this.controllers) this.get(c);
    for (const instance of new Set(this.instances.values())) {
      if (instance && typeof instance.onModuleInit === 'function') await instance.onModuleInit();
    }
    for (const { target, key, ms } of intervals) {
      const instance = [...this.instances.values()].find((i) => i && Object.getPrototypeOf(i) === target);
      if (instance) setInterval(() => void Promise.resolve(instance[key]()).catch((e) => console.error('[interval]', e)), ms);
    }
  }
}

// ───────────── fake express request/response ─────────────

class FakeResponse extends EventEmitter {
  statusCode = 200;
  writable = true;
  headersSent = false;
  readonly headers: Record<string, string> = {};
  readonly cookies: CookieChange[] = [];
  private readonly chunks: Uint8Array[] = [];
  private text: string | null = null;
  done = false;
  readonly finished: Promise<void>;
  private resolve!: () => void;

  constructor() {
    super();
    this.finished = new Promise((r) => (this.resolve = r));
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }
  header(name: string, value: string) {
    return this.setHeader(name, value);
  }
  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }
  cookie(name: string, value: string, opts: { maxAge?: number } = {}) {
    this.cookies.push({ name, value, maxAge: opts.maxAge });
    return this;
  }
  clearCookie(name: string) {
    this.cookies.push({ name, value: null });
    return this;
  }
  write(chunk: unknown) {
    if (chunk == null) return true;
    this.chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk as ArrayBufferLike));
    return true;
  }
  end(chunk?: unknown) {
    if (chunk != null && typeof chunk !== 'function') this.write(chunk);
    this.finish();
    return this;
  }
  send(body: unknown) {
    if (typeof body === 'string') {
      this.headers['content-type'] ??= 'text/html; charset=utf-8';
      this.text = body;
    } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      this.write(body);
    } else if (body !== undefined) {
      return this.json(body);
    }
    this.finish();
    return this;
  }
  json(body: unknown) {
    this.headers['content-type'] = 'application/json; charset=utf-8';
    this.text = JSON.stringify(body);
    this.finish();
    return this;
  }
  private finish() {
    if (this.done) return;
    this.done = true;
    this.headersSent = true;
    this.emit('finish');
    this.emit('close');
    this.resolve();
  }
  // Stream plumbing used by pdfkit/exceljs when piping into the response.
  cork() {}
  uncork() {}
  destroy() {
    this.finish();
  }
  body(): ArrayBuffer | string {
    if (this.text !== null) return this.text;
    const size = this.chunks.reduce((n, c) => n + c.byteLength, 0);
    const out = new Uint8Array(size);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out.buffer;
  }
}

// ───────────── routing ─────────────

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  cls: Ctor;
  handlerName: string;
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

function compile(path: string) {
  const keys: string[] = [];
  const re = path
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { pattern: new RegExp(`^/${re}/?$`), keys };
}

export class Router {
  private readonly routes: Route[] = [];

  constructor(
    private readonly container: Container,
    private readonly guard: { canActivate(ctx: unknown): Promise<boolean> | boolean },
    prefix = 'api',
  ) {
    for (const cls of container.controllers) {
      const base = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, cls) ?? '')[0];
      const proto = cls.prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        for (const p of ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, handler) ?? '')) {
          const { pattern, keys } = compile([prefix, base, p].join('/'));
          this.routes.push({ method: METHOD_NAMES[method], pattern, keys, cls, handlerName: name });
        }
      }
    }
  }

  async handle(r: DemoRequest): Promise<DemoResponse> {
    const res = new FakeResponse();
    const url = new URL(r.url, 'http://demo.local');
    const query: Record<string, string | string[]> = {};
    for (const [k, v] of url.searchParams) {
      const prev = query[k];
      query[k] = prev === undefined ? v : ([] as string[]).concat(prev, v);
    }
    const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v]));
    let body: unknown = {};
    if (r.body) {
      try {
        body = JSON.parse(r.body);
      } catch {
        return this.error(res, new HttpException('Malformed JSON body', HttpStatus.BAD_REQUEST));
      }
    }
    const req: any = {
      method: r.method,
      url: url.pathname + url.search,
      originalUrl: url.pathname + url.search,
      path: url.pathname,
      query,
      params: {},
      body,
      headers,
      cookies: r.cookies,
      ip: '127.0.0.1',
      socket: { remoteAddress: 'browser' },
      header: (name: string) => headers[name.toLowerCase()],
      get: (name: string) => headers[name.toLowerCase()],
      file: r.file
        ? { fieldname: r.file.field, originalname: r.file.name, mimetype: r.file.type, size: r.file.data.byteLength, buffer: Buffer.from(r.file.data) }
        : undefined,
    };

    const route = this.routes.find((x) => (x.method === r.method || x.method === 'ALL') && x.pattern.test(url.pathname));
    if (!route) return this.error(res, new HttpException(`Cannot ${r.method} ${url.pathname}`, HttpStatus.NOT_FOUND));
    const m = route.pattern.exec(url.pathname)!;
    route.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1])));

    const instance: any = this.container.get(route.cls);
    const handler = route.cls.prototype[route.handlerName];
    const ctx = {
      getType: () => 'http',
      getClass: () => route.cls,
      getHandler: () => handler,
      getArgs: () => [req, res],
      getArgByIndex: (i: number) => [req, res][i],
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res, getNext: () => () => undefined }),
    };

    const debug = (globalThis as any).__demoDebug ? (...a: unknown[]) => console.log('[demo api]', r.method, url.pathname, ...a) : () => undefined;
    try {
      debug('guard');
      await this.guard.canActivate(ctx);
      debug('handler', route.handlerName);
      const meta: Record<string, { index: number; data?: any; factory?: (data: unknown, ctx: unknown) => unknown }> =
        Reflect.getMetadata(ROUTE_ARGS_METADATA, route.cls, route.handlerName) ?? {};
      const args: unknown[] = [];
      let handled = false;
      for (const [key, a] of Object.entries(meta)) {
        if (key.includes(CUSTOM_ROUTE_ARGS_METADATA)) {
          args[a.index] = a.factory!(a.data, ctx);
          continue;
        }
        const type = Number(key.split(':')[0]) as RouteParamtypes;
        const pick = (obj: any) => (a.data ? obj?.[a.data] : obj);
        switch (type) {
          case RouteParamtypes.REQUEST:
            args[a.index] = req;
            break;
          case RouteParamtypes.RESPONSE:
            args[a.index] = res;
            if (!Reflect.getMetadata(RESPONSE_PASSTHROUGH_METADATA, route.cls, route.handlerName)) handled = true;
            break;
          case RouteParamtypes.BODY:
            args[a.index] = pick(req.body);
            break;
          case RouteParamtypes.QUERY:
            args[a.index] = pick(req.query);
            break;
          case RouteParamtypes.PARAM:
            args[a.index] = pick(req.params);
            break;
          case RouteParamtypes.HEADERS:
            args[a.index] = pick(req.headers);
            break;
          case RouteParamtypes.FILE:
            args[a.index] = req.file;
            break;
          case RouteParamtypes.IP:
            args[a.index] = req.ip;
            break;
          default:
            args[a.index] = undefined;
        }
      }
      const result = await instance[route.handlerName](...args);
      debug('returned');
      if (handled) {
        await res.finished;
      } else if (!res.done) {
        const code = Reflect.getMetadata(HTTP_CODE_METADATA, handler);
        res.status(code ?? (r.method === 'POST' ? 201 : 200));
        if (result === undefined || result === null) res.end();
        else if (typeof result === 'string') res.send(result);
        else res.json(result);
      }
    } catch (err) {
      return this.error(res, err);
    }
    return { status: res.statusCode, headers: res.headers, body: res.body(), cookies: res.cookies };
  }

  private error(res: FakeResponse, err: unknown): DemoResponse {
    let status = 500;
    let payload: unknown = { statusCode: 500, message: 'Internal server error' };
    if (err instanceof HttpException) {
      status = err.getStatus();
      const r = err.getResponse();
      payload = typeof r === 'string' ? { statusCode: status, message: r } : r;
    } else {
      console.error('[demo api]', err);
    }
    return {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      cookies: res.cookies,
    };
  }
}
