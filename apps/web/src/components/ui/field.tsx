"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition-[border-color,box-shadow] placeholder:text-subtle hover:border-subtle focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(control, "h-9", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, "min-h-20 py-2 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

/** Native select: fast, accessible and uses the OS picker on phones. */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn("relative", wrapperClassName)}>
      <select ref={ref} className={cn(control, "h-9 cursor-pointer appearance-none pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
    </div>
  ),
);
Select.displayName = "Select";

export function Label({ className, required, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("text-[13px] font-medium text-fg", className)} {...props}>
      {children}
      {required && (
        <span className="ml-0.5 text-danger" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
  htmlFor,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const id = useId();
  return (
    <div className={cn("group relative", className)}>
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle transition-colors group-focus-within:text-primary" aria-hidden />
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(control, "h-9 pl-8 pr-8")} />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-subtle hover:bg-sunken hover:text-fg" aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export const Checkbox = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} type="checkbox" className={cn("size-4 cursor-pointer rounded border-line-strong accent-[var(--primary)]", className)} {...props} />
));
Checkbox.displayName = "Checkbox";

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-line-strong",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}
