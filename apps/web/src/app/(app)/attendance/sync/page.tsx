"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, CloudOff, CloudUpload, Database, RefreshCw, ShieldAlert, Trash2, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui/display";
import { useConfirm } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import { useOnline } from "@/lib/connectivity";
import { fmtDate, fmtDateTime, relTime, STATUS } from "@/lib/format";
import { clearSynced, discard, listQueue, listRosters, syncNow, type QueuedAction, type RosterSnapshot } from "@/lib/offline";
import { useSession } from "@/lib/session";

const STATE_TONE = { pending: "warning", syncing: "primary", synced: "success", conflict: "danger", failed: "danger" } as const;

function describe(a: QueuedAction) {
  if (a.action === "MARK") return `Marked ${STATUS[a.status!]?.label.toLowerCase()}`;
  if (a.action === "CHECK_IN") return `Checked in ${a.time ? `at ${fmtDateTime(a.time)}` : ""}`;
  return `Checked out ${a.time ? `at ${fmtDateTime(a.time)}` : ""}`;
}

export default function SyncPage() {
  const online = useOnline();
  const { offlineSession } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [rosters, setRosters] = useState<RosterSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => {
      listQueue().then((q) => setQueue(q.reverse())).catch(() => undefined);
      listRosters().then(setRosters).catch(() => undefined);
    };
    load();
    window.addEventListener("wg:queue-changed", load);
    return () => window.removeEventListener("wg:queue-changed", load);
  }, []);
  const history = useQuery({ queryKey: ["sync-history"], queryFn: () => api<any[]>("/attendance/sync/history"), enabled: online && !offlineSession });

  const pending = queue.filter((q) => q.state === "pending" || q.state === "failed" || q.state === "syncing");
  const conflicts = queue.filter((q) => q.state === "conflict");

  const run = async () => {
    setBusy(true);
    try {
      const r = await syncNow();
      toast.success(`${r.synced} synchronized${r.conflicts ? `, ${r.conflicts} conflict(s)` : ""}${r.failed ? `, ${r.failed} failed` : ""}`);
      qc.invalidateQueries({ queryKey: ["register"] });
      history.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const raiseCorrection = async (a: QueuedAction) => {
    const att = a.attendanceId ?? history.data?.find((h) => h.clientId === a.clientId)?.attendanceId;
    if (!att) {
      toast.error("No server record to correct — discard this entry and re-mark it in the register.");
      return;
    }
    const proposed: Record<string, unknown> = {};
    if (a.action === "MARK") proposed.status = a.status;
    if (a.action === "CHECK_IN") proposed.checkInAt = a.time ?? a.deviceRecordedAt;
    if (a.action === "CHECK_OUT") proposed.checkOutAt = a.time ?? a.deviceRecordedAt;
    try {
      await api(`/attendance/${att}/corrections`, { body: { reason: `Offline entry recorded on device at ${fmtDateTime(a.deviceRecordedAt)} conflicted with the server record.`, proposed } });
      await discard(a.clientId);
      toast.success("Correction requested — an administrator will review both values");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link href="/attendance" className="inline-flex items-center gap-1 hover:text-fg">
            <ChevronLeft className="size-3.5" /> Attendance
          </Link>
        }
        title="Offline sync"
        description="Attendance captured without connectivity is stored on this device and sent to the server when the network returns. Server records are never overwritten silently — changed records are flagged as conflicts."
        actions={
          <Button onClick={run} loading={busy} disabled={!online || !pending.length}>
            <RefreshCw /> Sync now
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card className="flex items-center gap-3 p-4">
          {online ? <Wifi className="size-5 text-success" /> : <WifiOff className="size-5 text-warning" />}
          <div>
            <div className="text-xs text-muted">Connection</div>
            <div className="font-semibold">{online ? "Online" : "Offline"}</div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Pending sync</div>
          <div className="font-display text-2xl font-bold tabular">{pending.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Conflicts</div>
          <div className={`font-display text-2xl font-bold tabular ${conflicts.length ? "text-danger" : ""}`}>{conflicts.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Registers available offline</div>
          <div className="font-display text-2xl font-bold tabular">{rosters.length}</div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="On this device"
            description="Each entry has a client ID and the device timestamp of when it was recorded."
            action={
              queue.some((q) => q.state === "synced") ? (
                <Button variant="ghost" size="sm" onClick={() => clearSynced()}>
                  Clear synced
                </Button>
              ) : null
            }
          />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {queue.map((a) => (
              <li key={a.clientId} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.employeeName}</span>
                    <span className="text-xs tabular text-muted">{a.employeeCode}</span>
                    <Badge tone={STATE_TONE[a.state]}>{a.state}</Badge>
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {describe(a)} · work date {fmtDate(a.workDate)} · recorded {fmtDateTime(a.deviceRecordedAt)}
                    {a.syncedAt && ` · server ${relTime(a.syncedAt)}`}
                  </div>
                  {a.message && <div className={`mt-1 text-xs ${a.state === "conflict" || a.state === "failed" ? "text-danger" : "text-muted"}`}>{a.message}</div>}
                  {a.state === "conflict" && !!a.server && (
                    <div className="mt-1.5 inline-flex flex-wrap items-center gap-2 rounded bg-sunken px-2 py-1 text-xs">
                      Server now: <StatusBadge status={(a.server as any).status} /> {(a.server as any).checkInAt && `in ${fmtDateTime((a.server as any).checkInAt)}`}
                    </div>
                  )}
                  <div className="mt-1 font-mono text-[10.5px] text-subtle">id {a.clientId}</div>
                </div>
                {a.state === "conflict" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => raiseCorrection(a)}>
                      Request correction
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if ((await confirm({ title: "Discard device entry?", description: "The server value is kept. This only removes the entry from this device.", danger: true, confirmLabel: "Discard" })) !== false) discard(a.clientId);
                      }}
                    >
                      <Trash2 /> Keep server value
                    </Button>
                  </div>
                )}
                {a.state === "failed" && (
                  <Button size="sm" variant="ghost" onClick={() => discard(a.clientId)}>
                    <Trash2 /> Discard
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!queue.length && <EmptyState icon={CloudUpload} title="Nothing waiting on this device" description="When you mark attendance without a connection, entries appear here until they are synchronized." />}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Saved registers" description="Minimal rosters (name, ID, designation) kept for 3 days for offline use. No phone numbers or addresses are stored." />
            <ul className="mt-3 divide-y divide-line border-t border-line text-[13px]">
              {rosters.map((r) => (
                <li key={r.key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <Database className="size-4 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/attendance?site=${r.siteId}&shift=${r.shiftId}&date=${r.workDate}`} className="font-medium hover:text-primary-ink">
                      {r.siteName} · {r.shiftName}
                    </Link>
                    <div className="text-xs text-muted">
                      {fmtDate(r.workDate)} · {r.rows.length} employees · saved {relTime(r.savedAt)}
                    </div>
                  </div>
                </li>
              ))}
              {!rosters.length && <li className="px-5 py-6 text-center text-muted">Open a register while online to save it here.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Server sync history" description="Recorded server-side with the actual synchronization time." />
            <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto border-t border-line text-[13px]">
              {(history.data ?? []).map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-4 py-2 sm:px-5">
                  {h.result === "SYNCED" ? <CloudUpload className="size-4 text-success" /> : h.result === "CONFLICT" ? <ShieldAlert className="size-4 text-danger" /> : <CloudOff className="size-4 text-warning" />}
                  <div className="min-w-0 flex-1">
                    <div>
                      {h.action.replace("_", " ").toLowerCase()} · <span className="text-muted">{h.result.toLowerCase()}</span>
                    </div>
                    <div className="text-xs text-muted">
                      device {fmtDateTime(h.deviceRecordedAt)} → server {fmtDateTime(h.syncedAt)}
                    </div>
                  </div>
                </li>
              ))}
              {history.data && !history.data.length && <li className="px-5 py-6 text-center text-muted">No offline entries have been synchronized yet.</li>}
              {!online && <li className="px-5 py-6 text-center text-muted">Available when online.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
