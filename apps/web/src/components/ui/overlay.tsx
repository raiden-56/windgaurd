"use client";

import { X } from "lucide-react";
import { Dialog as D, DropdownMenu as DM, Popover as P, Tooltip as T } from "radix-ui";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Field, Textarea } from "./field";

// ───────────── Dialog ─────────────

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="wg-overlay fixed inset-0 z-50 bg-navy/45 backdrop-blur-[2px]" />
        <D.Content
          className={cn(
            "wg-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface shadow-lg focus:outline-none",
            w,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <D.Title className="font-display text-[17px] font-semibold text-fg">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
            </div>
            <D.Close className="-mr-1.5 -mt-0.5 grid size-8 shrink-0 place-items-center rounded-md text-subtle hover:bg-sunken hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3 rounded-b-xl">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ───────────── Sheet / drawer ─────────────

export function Sheet({
  open,
  onOpenChange,
  side = "right",
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  side?: "right" | "left" | "bottom";
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const pos = {
    right: "wg-sheet-right inset-y-0 right-0 h-full w-full max-w-md border-l",
    left: "wg-sheet-left inset-y-0 left-0 h-full w-[84vw] max-w-xs border-r",
    bottom: "wg-sheet-bottom inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-t",
  }[side];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="wg-overlay fixed inset-0 z-50 bg-navy/45" />
        <D.Content className={cn("fixed z-50 flex flex-col border-line bg-surface shadow-lg focus:outline-none", pos, className)}>
          {title ? (
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <D.Title className="font-display text-base font-semibold">{title}</D.Title>
                {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
              </div>
              <D.Close className="grid size-8 place-items-center rounded-md text-subtle hover:bg-sunken hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </D.Close>
            </div>
          ) : (
            <>
              <D.Title className="sr-only">Panel</D.Title>
              <D.Description className="sr-only">Panel</D.Description>
            </>
          )}
          {side === "bottom" && !title && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" />}
          <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="safe-bottom flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ───────────── Dropdown menu ─────────────

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export function MenuContent({ className, align = "end", children, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn("wg-menu z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-surface p-1 text-sm shadow-md", className)}
        {...props}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}
export function MenuItem({ className, danger, ...props }: React.ComponentProps<typeof DM.Item> & { danger?: boolean }) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-sunken data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-subtle",
        danger && "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  );
}
export function MenuCheckbox({ className, children, ...props }: React.ComponentProps<typeof DM.CheckboxItem>) {
  return (
    <DM.CheckboxItem className={cn("flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 outline-none data-[highlighted]:bg-sunken", className)} {...props}>
      <span className="grid size-4 place-items-center rounded border border-line-strong data-[state=checked]:bg-primary">
        <DM.ItemIndicator>
          <svg viewBox="0 0 12 12" className="size-3 text-primary" aria-hidden>
            <path d="M2.5 6.5l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </DM.ItemIndicator>
      </span>
      {children}
    </DM.CheckboxItem>
  );
}
export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <DM.Label className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">{children}</DM.Label>;

// ───────────── Popover & tooltip ─────────────

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ className, align = "start", ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={6} className={cn("wg-menu z-50 rounded-lg border border-line bg-surface p-3 shadow-md focus:outline-none", className)} {...props} />
    </P.Portal>
  );
}

export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="wg-menu z-[60] max-w-64 rounded-md bg-navy px-2.5 py-1.5 text-xs text-white shadow-md dark:bg-slate">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
export const TooltipProvider = T.Provider;

// ───────────── Confirm dialog (promise-based) ─────────────

interface ConfirmOpts {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Ask for a reason; the promise resolves to the entered text. */
  reason?: { label: string; required?: boolean; placeholder?: string };
}
type ConfirmFn = (o: ConfirmOpts) => Promise<string | false>;
const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { open: boolean }) | null>(null);
  const [reason, setReason] = useState("");
  const resolver = useRef<(v: string | false) => void>(undefined);
  const confirm = useCallback<ConfirmFn>((o) => {
    setReason("");
    setState({ ...o, open: true });
    return new Promise((res) => {
      resolver.current = res;
    });
  }, []);
  const close = (v: string | false) => {
    resolver.current?.(v);
    setState((s) => (s ? { ...s, open: false } : s));
  };
  const invalid = !!state?.reason?.required && reason.trim().length < 3;
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Dialog
          open={state.open}
          onOpenChange={(o) => !o && close(false)}
          title={state.title}
          description={state.description}
          size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant={state.danger ? "danger" : "primary"} disabled={invalid} onClick={() => close(reason.trim() || "ok")}>
                {state.confirmLabel ?? "Confirm"}
              </Button>
            </>
          }
        >
          {state.reason ? (
            <Field label={state.reason.label} required={state.reason.required}>
              <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={state.reason.placeholder} />
            </Field>
          ) : (
            <p className="text-sm text-muted">This action is recorded in the audit log.</p>
          )}
        </Dialog>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(ConfirmCtx);
  if (!c) throw new Error("ConfirmProvider missing");
  return c;
}
