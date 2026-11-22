"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, Bell, BellRing, CheckCheck, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui/display";
import { api, errorMessage } from "@/lib/api";
import { relTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL" | "SUCCESS";
  readAt: string | null;
  createdAt: string;
}

const SEV = {
  INFO: { icon: Info, tone: "text-info bg-info-soft" },
  WARNING: { icon: TriangleAlert, tone: "text-warning bg-warning-soft" },
  CRITICAL: { icon: AlertOctagon, tone: "text-danger bg-danger-soft" },
  SUCCESS: { icon: CheckCircle2, tone: "text-success bg-success-soft" },
};

function b64ToUint8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function PushToggle() {
  const key = useQuery({ queryKey: ["push-key"], queryFn: () => api<{ publicKey: string | null }>("/push/key") });
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied">("off");
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription().then((s) => setState(s ? "on" : "off")));
  }, []);
  if (!key.data?.publicKey) return <p className="text-xs text-muted">Push notifications are not configured on this server (set VAPID keys).</p>;
  if (state === "unsupported") return <p className="text-xs text-muted">This browser does not support push notifications. On iPhone, install WINDGUARD to the home screen first.</p>;
  const enable = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key.data!.publicKey!) });
      await api("/push/subscribe", { body: sub.toJSON() });
      setState("on");
      toast.success("Push notifications enabled on this device");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api("/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => undefined);
      await sub.unsubscribe();
    }
    setState("off");
  };
  return state === "on" ? (
    <Button variant="outline" size="sm" onClick={disable}>
      <BellRing /> Push on — turn off
    </Button>
  ) : state === "denied" ? (
    <p className="text-xs text-muted">Notifications are blocked in browser settings.</p>
  ) : (
    <Button variant="outline" size="sm" onClick={enable}>
      <Bell /> Enable push on this device
    </Button>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const q = useQuery({ queryKey: ["notifications", filter], queryFn: () => api<{ items: Notification[]; unreadCount: number }>("/notifications", { query: { unread: filter === "unread" ? "true" : undefined } }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const open = async (n: Notification) => {
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: "POST" }).catch(() => undefined);
    refresh();
    if (n.link) router.push(n.link);
  };
  const readAll = async () => {
    try {
      const r = await api<{ updated: number }>("/notifications/read-all", { method: "POST" });
      toast.success(`${r.updated} marked as read`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Attendance not completed, missing check-outs, unfilled shifts, approvals, corrections, sync results and handovers."
        actions={
          <Button variant="outline" onClick={readAll} disabled={!q.data?.unreadCount}>
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Filter"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All" },
            { value: "unread", label: `Unread${q.data?.unreadCount ? ` (${q.data.unreadCount})` : ""}` },
          ]}
        />
        <PushToggle />
      </div>
      <Card className="overflow-hidden">
        {q.isLoading && <Skeleton className="m-4 h-40" />}
        <ul className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {(q.data?.items ?? []).map((n) => {
              const s = SEV[n.severity] ?? SEV.INFO;
              return (
                <motion.li key={n.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
                  <button type="button" onClick={() => open(n)} className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 sm:px-5", !n.readAt && "bg-primary-soft/30")}>
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", s.tone)}>
                      <s.icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn("text-[13.5px]", n.readAt ? "font-medium" : "font-semibold")}>{n.title}</span>
                        {!n.readAt && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-muted">{n.body}</span>
                      <span className="mt-1 block text-xs text-subtle">{relTime(n.createdAt)}</span>
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
        {q.data && !q.data.items.length && <EmptyState icon={Bell} title={filter === "unread" ? "You're all caught up" : "No notifications yet"} />}
      </Card>
    </div>
  );
}
