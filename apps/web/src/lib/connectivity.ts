"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { withBase } from "./base";
import { queueCounts, syncNow } from "./offline";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useQueueCounts() {
  const [counts, setCounts] = useState({ pending: 0, conflict: 0, synced: 0 });
  useEffect(() => {
    let alive = true;
    const load = () => queueCounts().then((c) => alive && setCounts(c)).catch(() => undefined);
    load();
    window.addEventListener("wg:queue-changed", load);
    return () => {
      alive = false;
      window.removeEventListener("wg:queue-changed", load);
    };
  }, []);
  return counts;
}

/** Mounted once in the shell: syncs the offline queue whenever connectivity returns. */
export function useAutoSync() {
  const online = useOnline();
  const qc = useQueryClient();
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const run = async () => {
      const c = await queueCounts();
      if (!c.pending || cancelled) return;
      try {
        const r = await syncNow();
        if (r.synced || r.conflicts) {
          qc.invalidateQueries({ queryKey: ["register"] });
          qc.invalidateQueries({ queryKey: ["dashboard"] });
          if (r.conflicts) toast.warning(`${r.synced} offline record(s) synchronized · ${r.conflicts} need review`, { action: { label: "Review", onClick: () => (window.location.href = withBase("/attendance/sync")) } });
          else toast.success(`${r.synced} offline record(s) synchronized`);
        }
      } catch {
        /* stays queued; retried on next reconnect or manually */
      }
    };
    void run();
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "wg-sync-done") {
        window.dispatchEvent(new Event("wg:queue-changed"));
        qc.invalidateQueries({ queryKey: ["register"] });
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [online, qc]);
}
