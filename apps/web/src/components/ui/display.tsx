"use client";

import { animate, motion, useInView, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { STATUS, type AttendanceStatus } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5", className)}>
      <div className="min-w-0">
        <h3 className="font-display text-[15px] font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-sunken text-muted ring-line-strong",
  primary: "bg-primary-soft text-primary-ink ring-primary/20",
  success: "bg-success-soft text-success ring-success/25",
  warning: "bg-warning-soft text-warning ring-warning/25",
  danger: "bg-danger-soft text-danger ring-danger/25",
  accent: "bg-accent-soft text-accent ring-accent/25",
  navy: "bg-navy text-white ring-navy",
} as const;

export function Badge({ tone = "neutral", className, children, dot }: { tone?: keyof typeof badgeTones; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 text-xs font-medium ring-1 ring-inset", badgeTones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className, compact }: { status: AttendanceStatus; className?: string; compact?: boolean }) {
  const s = STATUS[status] ?? STATUS.PENDING;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 text-xs font-medium ring-1 ring-inset",
        s.badge,
        status === "PENDING" && "border border-dashed border-line-strong ring-0",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot, status === "ON_DUTY" && "animate-pulse-dot")} aria-hidden />
      {compact ? s.short : s.label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-sunken", className)} aria-hidden />;
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-3 grid size-11 place-items-center rounded-lg border border-line bg-surface-2 text-subtle">
          <Icon className="size-5" />
        </div>
      )}
      <p className="font-display text-[15px] font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Animated count-up for KPI values. Respects reduced motion. */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number | null | undefined; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(value == null ? "—" : (0).toFixed(decimals));
  useEffect(() => {
    if (value == null) {
      setDisplay("—");
      return;
    }
    if (reduce || !inView || document.visibilityState !== "visible") {
      setDisplay(value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
      if (!inView) return;
    }
    const ctrl = animate(mv, value, {
      duration: 0.7,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setDisplay(v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })),
    });
    return () => ctrl.stop();
  }, [value, inView, reduce, decimals, mv]);
  return (
    <span ref={ref} className="tabular">
      {display}
      {value != null && suffix}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className, size = "md" }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number }[]; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className={cn("no-scrollbar relative flex items-center gap-1 overflow-x-auto border-b border-line", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 font-medium transition-colors",
              size === "sm" ? "h-9 text-[13px]" : "h-10 text-sm",
              active ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {it.label}
            {it.count !== undefined && (
              <span className={cn("tabular rounded px-1.5 text-[11px] font-semibold", active ? "bg-primary-soft text-primary-ink" : "bg-sunken text-subtle")}>{it.count}</span>
            )}
            {active && <motion.span layoutId={`tab-${items.map((i) => i.value).join("")}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          </button>
        );
      })}
    </div>
  );
}

/** Pill segmented control — used for quick period / view switching. */
export function Segmented<T extends string>({ value, onChange, items, className, ariaLabel }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[]; className?: string; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex items-center rounded-md border border-line bg-sunken p-0.5", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(it.value)}
            className={cn("relative h-7 rounded-[5px] px-2.5 text-[13px] font-medium transition-colors", active ? "text-fg" : "text-muted hover:text-fg")}
          >
            {active && <motion.span layoutId={`seg-${items.map((i) => i.value).join("")}`} className="absolute inset-0 rounded-[5px] border border-line bg-surface shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <span className="relative">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-muted">{eyebrow}</div>}
        <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-fg sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Avatar({ name, className, src }: { name: string; className?: string; src?: string | null }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  // Stable tone per name, drawn from the neutral/brand family (not status colours).
  const tones = ["bg-[#DCE7F7] text-[#1E4E8C]", "bg-[#DDF1EE] text-[#0E6B61]", "bg-[#E6E9EF] text-[#334155]", "bg-[#E9E4F7] text-[#4C3A99]"];
  const tone = tones[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length];
  if (src) return <img src={src} alt="" className={cn("size-8 shrink-0 rounded-full object-cover", className)} />;
  return <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold", tone, className)} aria-hidden>{letters}</span>;
}

export function Stat({ label, value, sub, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold tabular text-fg">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
