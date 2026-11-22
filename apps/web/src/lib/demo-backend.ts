"use client";

/**
 * Client for the in-browser API used by the static (GitHub Pages) build. The real NestJS
 * controllers and services run in a Web Worker against PGlite (PostgreSQL in WebAssembly),
 * persisted in this browser's IndexedDB. Requests and responses are exchanged as plain
 * messages and surfaced to the app as ordinary fetch Responses.
 */
import { withBase } from "./base";

/** busy: another tab owns the demo database; stolen: another tab took it over from this one. */
export type DemoStatus = { phase: string; ready: boolean; error: string | null; busy: boolean; stolen: boolean };
type Status = DemoStatus;
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

const COOKIE_KEY = "wg.demo.cookies";
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let status: Status = { phase: "Starting…", ready: false, error: null, busy: false, stolen: false };
const TAKEOVER_KEY = "wg.demo.takeover";
const listeners = new Set<(s: Status) => void>();
let readyPromise: Promise<void> | null = null;
let heard = false;

function setStatus(s: Partial<Status>) {
  status = { ...status, ...s };
  listeners.forEach((l) => l(status));
}

export function subscribeDemoStatus(fn: (s: Status) => void) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function cookies(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(COOKIE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function applyCookies(changes: { name: string; value: string | null }[]) {
  if (!changes?.length) return;
  const jar = cookies();
  for (const c of changes) {
    if (c.value === null) delete jar[c.name];
    else jar[c.name] = c.value;
  }
  try {
    localStorage.setItem(COOKIE_KEY, JSON.stringify(jar));
  } catch {
    /* storage unavailable: the session lasts for this page only */
  }
}

function start() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise<void>((resolve, reject) => {
    let takeover = false;
    try {
      takeover = sessionStorage.getItem(TAKEOVER_KEY) === "1";
      sessionStorage.removeItem(TAKEOVER_KEY);
    } catch {
      /* storage unavailable */
    }
    worker = new Worker(withBase(`/demo/backend.js${takeover ? "?takeover" : ""}`), { type: "module" });
    worker.onmessage = (e) => {
      heard = true;
      const m = e.data;
      if (m.kind === "status") setStatus({ phase: m.phase, busy: false });
      else if (m.kind === "busy") setStatus({ busy: true });
      else if (m.kind === "stolen") setStatus({ stolen: true });
      else if (m.kind === "ready") {
        setStatus({ ready: true, phase: "Ready" });
        resolve();
      } else if (m.kind === "fatal") {
        setStatus({ error: m.message });
        reject(new Error(m.message));
      } else if (m.kind === "response") {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.response);
      }
    };
    // Fires when the worker script cannot load at all (later errors are handled inside the worker).
    worker.onerror = (e) => {
      if (heard) return;
      setStatus({ error: e.message || "The demo backend failed to start" });
      reject(new Error(e.message));
    };
  });
  return readyPromise;
}

function send<T>(msg: Record<string, unknown>): Promise<T> {
  return start().then(
    () =>
      new Promise<T>((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        worker!.postMessage({ ...msg, id });
      }),
  );
}

/** Moves the demo database to this tab (the other tab is shut down). */
export function takeOverDemo() {
  if (status.stolen) {
    try {
      sessionStorage.setItem(TAKEOVER_KEY, "1");
    } catch {
      /* storage unavailable */
    }
    window.location.reload();
    return;
  }
  setStatus({ busy: false, phase: "Taking over…" });
  worker?.postMessage({ kind: "takeover" });
}

export function bootDemo() {
  return start();
}

/** fetch() replacement for /api URLs. */
export async function demoFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => (headers[k] = v));
  let body: string | undefined;
  let file: { field: string; name: string; type: string; data: ArrayBuffer } | undefined;
  if (init.body instanceof FormData) {
    for (const [field, value] of init.body.entries()) {
      if (value instanceof File) file = { field, name: value.name, type: value.type, data: await value.arrayBuffer() };
    }
  } else if (typeof init.body === "string") {
    body = init.body;
  }
  const r = await send<{ status: number; headers: Record<string, string>; body: ArrayBuffer | string; cookies: { name: string; value: string | null }[] }>({
    kind: "request",
    request: { method: (init.method ?? "GET").toUpperCase(), url: input, headers, cookies: cookies(), body, file },
  });
  applyCookies(r.cookies);
  const nullBody = r.status === 204 || r.status === 304;
  return new Response(nullBody ? null : r.body, { status: r.status, headers: r.headers });
}

/** Regenerates the sample data relative to today (everything changed in this browser is discarded). */
export async function resetDemoData() {
  await send({ kind: "reset" });
  try {
    localStorage.removeItem(COOKIE_KEY);
  } catch {
    /* ignore */
  }
}

export async function demoInfo() {
  return send<{ seededAt: string | null }>({ kind: "info" });
}
