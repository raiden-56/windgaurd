"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BrandMark, Wordmark } from "@/components/shell/brand";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, useConfirm } from "@/components/ui/overlay";
import { withBase } from "@/lib/base";
import { bootDemo, demoInfo, resetDemoData, subscribeDemoStatus, takeOverDemo, type DemoStatus } from "@/lib/demo-backend";
import { fmtDateTime } from "@/lib/format";

/**
 * Static (GitHub Pages) build only: starts the in-browser backend and holds the UI behind a
 * preparation screen until it answers. The first visit builds the database (~15 s); later
 * visits reopen it from IndexedDB in a moment.
 */
export function DemoGate({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<DemoStatus>({ phase: "Starting…", ready: false, error: null, busy: false, stolen: false });
  useEffect(() => {
    const off = subscribeDemoStatus(setS);
    bootDemo().catch(() => undefined);
    return () => {
      off();
    };
  }, []);

  if (s.ready && !s.stolen) return <>{children}</>;
  const elsewhere = s.busy || s.stolen;
  return (
    <main className="grid min-h-dvh place-items-center bg-navy px-4 py-10 text-white">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <BrandMark className="size-10" />
          <Wordmark light />
        </div>
        <h1 className="mt-8 font-display text-2xl font-bold tracking-tight">{s.error ? "The demo could not start" : elsewhere ? "WINDGUARD is open in another tab" : "Preparing the live demo"}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-white/70">
          WINDGUARD&apos;s real server and a PostgreSQL database run inside this browser tab, so you can use every feature without an account. Your changes stay on this device.
        </p>
        {elsewhere && !s.error ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-white/80">The demo database can only be used by one tab at a time. Switch to the other tab, or continue here and that tab will pause.</p>
            <Button variant="accent" onClick={takeOverDemo}>
              Use it in this tab
            </Button>
          </div>
        ) : s.error ? (
          <div className="mt-6 space-y-4">
            <p role="alert" className="rounded-md bg-white/10 p-3 text-sm text-white/85">
              {s.error}. A current version of Chrome, Edge, Firefox or Safari is needed (WebAssembly and IndexedDB); private windows may block storage.
            </p>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </div>
        ) : (
          <div className="mt-8" role="status" aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="wg-demo-progress h-full w-1/3 rounded-full bg-accent" />
            </div>
            <p className="mt-3 text-sm text-white/80">{s.phase}</p>
            <p className="mt-1 text-xs text-white/50">The first visit takes about 15 seconds; later visits open instantly.</p>
          </div>
        )}
      </div>
    </main>
  );
}

/** Top-bar chip explaining where demo data lives, with a reset to fresh sample data for today. */
export function DemoChip() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [seededAt, setSeededAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reset() {
    const ok = await confirm({
      title: "Reset demo data?",
      description: "Generates fresh sample data with today as the current day. Everything you changed in this browser is discarded and you will need to sign in again.",
      confirmLabel: "Reset data",
      danger: true,
    });
    if (ok === false) return;
    setBusy(true);
    try {
      await resetDemoData();
      qc.clear();
      window.location.href = withBase("/login");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
      setBusy(false);
    }
  }

  return (
    <Popover onOpenChange={(open) => open && demoInfo().then((i) => setSeededAt(i.seededAt)).catch(() => undefined)}>
      <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md bg-info-soft px-2.5 text-xs font-semibold text-info ring-1 ring-inset ring-info/25 hover:ring-info/50">
        <FlaskConical className="size-3.5" />
        Demo
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-[13px] leading-relaxed">
        <p className="font-semibold text-fg">You are using the browser demo</p>
        <p className="text-muted">
          The application runs entirely in this browser. Companies, sites and workers are sample data; anything you record is saved only on this device and is not shared with anyone.
        </p>
        {seededAt && <p className="text-xs text-subtle">Sample data generated {fmtDateTime(seededAt)}</p>}
        <Button variant="outline" size="sm" className="w-full" loading={busy} onClick={reset}>
          <RotateCcw className="size-3.5" /> Reset to fresh data for today
        </Button>
      </PopoverContent>
    </Popover>
  );
}
