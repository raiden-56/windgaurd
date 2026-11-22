import { cn } from "@/lib/utils";

/** WINDGUARD mark: a shield whose inner strokes read as three turbine blades. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#3B82F6" />
      <path d="M16 5.5l8.5 3.2v6.6c0 5.4-3.6 9.6-8.5 11.2-4.9-1.6-8.5-5.8-8.5-11.2V8.7L16 5.5z" fill="#111C2D" />
      <g stroke="#14B8A6" strokeWidth="1.9" strokeLinecap="round">
        <path d="M16 15.6V9.6" />
        <path d="M16 15.6l5.1 2.9" />
        <path d="M16 15.6l-5.1 2.9" />
      </g>
      <circle cx="16" cy="15.6" r="1.6" fill="#fff" />
      <path d="M16 17.4v5.4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity=".85" />
    </svg>
  );
}

export function Wordmark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("font-display text-[15px] font-extrabold tracking-[0.14em]", light ? "text-white" : "text-fg", className)}>
      WINDGUARD
    </span>
  );
}
