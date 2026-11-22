"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any,
  ) {
    super(message);
  }
}

const ORG_KEY = "wg.org";

export function getActiveOrg() {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function setActiveOrg(id: string | null) {
  try {
    if (id) localStorage.setItem(ORG_KEY, id);
    else localStorage.removeItem(ORG_KEY);
  } catch {
    /* storage unavailable */
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(query?: Query) {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function headers(json: boolean) {
  const h: Record<string, string> = {};
  if (json) h["content-type"] = "application/json";
  const org = getActiveOrg();
  if (org) h["x-org-id"] = org;
  return h;
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("wg:unauthorized"));
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => null);
  if (!res.ok) {
    const raw = body && typeof body === "object" ? (body.message ?? body.error) : body;
    const msg = Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" && raw ? raw : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`/api${path}${qs(opts.query)}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    credentials: "include",
    headers: headers(opts.body !== undefined),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: "no-store",
  });
  return handle<T>(res);
}

export async function upload<T = any>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: "POST", credentials: "include", headers: headers(false), body: form });
  return handle<T>(res);
}

/** Downloads a file produced by the API (exports, templates, error reports). */
export async function download(path: string, query?: Query, fallbackName = "download") {
  const res = await fetch(`/api${path}${qs(query)}`, { credentials: "include", headers: headers(false) });
  if (!res.ok) await handle(res);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Network unavailable — check your connection.";
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
