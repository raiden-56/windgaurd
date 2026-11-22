"use client";

import { cn } from "@/lib/utils";

/** Shared chart styling: recessive axes/grid, text in ink tokens, marks carry colour. */
export const axisProps = {
  tick: { fill: "var(--fg-subtle)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--line)" },
} as const;

export const gridProps = { stroke: "var(--line)", strokeDasharray: "0", vertical: false } as const;

export const STATUS_SERIES = [
  { key: "present", label: "Present", color: "var(--st-present)" },
  { key: "halfDay", label: "Half day", color: "var(--st-half)" },
  { key: "leave", label: "Leave", color: "var(--st-leave)" },
  { key: "absent", label: "Absent", color: "var(--st-absent)" },
] as const;

export const SHIFT_COLORS = ["var(--sh-1)", "var(--sh-2)", "var(--sh-3)"];

export function ChartTooltip({ active, payload, label, format, labelFormat }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-semibold text-fg">{labelFormat ? labelFormat(label) : label}</div>
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-sm" style={{ background: p.color ?? p.fill ?? p.stroke }} />
              {p.name}
            </span>
            <span className="font-semibold tabular text-fg">{format ? format(p.value, p.dataKey) : (p.value ?? "—")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; value?: React.ReactNode }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          {i.label}
          {i.value !== undefined && <span className="font-semibold tabular text-fg">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal 100% bar with 2px gaps between segments (today's muster composition). */
export function SegmentBar({ segments, className, height = 12 }: { segments: { label: string; value: number; color: string }[]; className?: string; height?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className={cn("flex w-full gap-[2px] overflow-hidden rounded", className)} style={{ height }} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
      {total === 0 ? (
        <div className="h-full w-full bg-sunken" />
      ) : (
        segments
          .filter((s) => s.value > 0)
          .map((s) => <div key={s.label} title={`${s.label}: ${s.value}`} className="h-full transition-[flex-grow] duration-500" style={{ flexGrow: s.value, background: s.color }} />)
      )}
    </div>
  );
}

export function Meter({ value, max, color = "var(--accent)", className }: { value: number; max: number; color?: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
