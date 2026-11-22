export const TZ_DEFAULT = "Asia/Kolkata";

export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LEAVE"
  | "HALF_DAY"
  | "WEEKLY_OFF"
  | "HOLIDAY"
  | "ON_DUTY"
  | "NOT_SCHEDULED"
  | "PENDING"
  | "INCOMPLETE";

export const STATUS: Record<AttendanceStatus, { label: string; short: string; dot: string; badge: string }> = {
  PRESENT: { label: "Present", short: "P", dot: "bg-st-present", badge: "bg-accent-soft text-[color:var(--st-present)] ring-[color:var(--st-present)]/25" },
  ABSENT: { label: "Absent", short: "A", dot: "bg-st-absent", badge: "bg-danger-soft text-danger ring-danger/25" },
  LEAVE: { label: "Leave", short: "L", dot: "bg-st-leave", badge: "bg-[color:var(--st-leave)]/12 text-[color:var(--st-leave)] ring-[color:var(--st-leave)]/25" },
  HALF_DAY: { label: "Half Day", short: "H", dot: "bg-st-half", badge: "bg-warning-soft text-warning ring-warning/25" },
  WEEKLY_OFF: { label: "Weekly Off", short: "WO", dot: "bg-st-off", badge: "bg-sunken text-muted ring-line-strong" },
  HOLIDAY: { label: "Holiday", short: "PH", dot: "bg-st-off", badge: "bg-sunken text-muted ring-line-strong" },
  ON_DUTY: { label: "On Duty", short: "OD", dot: "bg-st-duty", badge: "bg-info-soft text-info ring-info/25" },
  NOT_SCHEDULED: { label: "Not Scheduled", short: "–", dot: "bg-st-off", badge: "bg-sunken text-subtle ring-line" },
  PENDING: { label: "Pending", short: "?", dot: "bg-line-strong", badge: "bg-surface text-muted ring-line-strong ring-dashed" },
  INCOMPLETE: { label: "Incomplete", short: "IC", dot: "bg-st-incomplete", badge: "bg-[color:var(--st-incomplete)]/12 text-[color:var(--st-incomplete)] ring-[color:var(--st-incomplete)]/30" },
};

export const ALL_STATUSES = Object.keys(STATUS) as AttendanceStatus[];

export function fmtTime(iso: string | Date | null | undefined, tz = TZ_DEFAULT) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
}

export function fmtDate(iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }, tz = TZ_DEFAULT) {
  if (!iso) return "";
  const d = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? "UTC" : tz }).format(d);
}

export function fmtDateTime(iso: string | Date | null | undefined, tz = TZ_DEFAULT) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
}

/** Calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function dayIn(iso: string | Date, tz = TZ_DEFAULT) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function todayISO(tz = TZ_DEFAULT) {
  return dayIn(new Date(), tz);
}

export function addDaysISO(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtMinutes(m: number | null | undefined) {
  if (m === null || m === undefined) return "—";
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}

export function fmtHM(m: number | null | undefined) {
  if (m === null || m === undefined) return "—";
  return `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`;
}

export function relTime(iso: string | Date | null | undefined) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(-Math.round(diff / ms), unit);
  return "just now";
}

/** Converts a local date + HH:MM in a timezone to an ISO instant. */
export function localToISO(day: string, hhmm: string, tz = TZ_DEFAULT) {
  const [h, m] = hhmm.split(":").map(Number);
  // Find the UTC offset for that wall time by probing.
  const guess = new Date(`${day}T${hhmm}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = asUtc - guess.getTime();
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h, m) - offset).toISOString();
}

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  COMPANY_ADMIN: "Company Admin",
  SUPERVISOR: "Site Supervisor",
  VIEWER: "Viewer / Auditor",
};

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const num = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
