"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CloudOff,
  CloudUpload,
  History,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Timer,
  UserCheck,
  Users,
  Wifi,
  WifiOff,
  ListChecks,
  MessageSquareText,
  Send,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import { Checkbox, Input, SearchInput, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, EmptyState, PageHeader, Skeleton, StatusBadge, Tabs } from "@/components/ui/display";
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip, useConfirm } from "@/components/ui/overlay";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useOnline } from "@/lib/connectivity";
import { addDaysISO, fmtDate, fmtDateTime, fmtHM, fmtTime, STATUS, todayISO, type AttendanceStatus } from "@/lib/format";
import { applyQueue, enqueue, getRoster, listQueue, saveRoster, type QueuedAction } from "@/lib/offline";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CorrectionDialog, ManualTimeDialog, RemarksDialog, type RegisterRow } from "./register-dialogs";
import { RecordsTab, ApprovalsTab } from "./records-tabs";

interface Register {
  site: { id: string; name: string; code: string; timezone: string };
  shift: { id: string; name: string; code: string; start: string; end: string; overnight: boolean; breakMinutes: number; graceMinutes: number; requiredWorkers: number; color: string };
  workDate: string;
  isToday: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  register: { id: string; status: "OPEN" | "SUBMITTED" | "APPROVED" | "LOCKED"; submittedAt: string | null; approvals: { action: string; actorName: string; note: string | null; createdAt: string }[] };
  requireApproval: boolean;
  counts: Record<string, number>;
  rows: RegisterRow[];
}

interface ViewModel extends Register {
  source: "server" | "device";
  savedAt?: string;
}

const QUICK: { status: AttendanceStatus; label: string; short: string; tone: string }[] = [
  { status: "PRESENT", label: "Present", short: "P", tone: "data-[on=true]:bg-[color:var(--st-present)] data-[on=true]:text-white data-[on=true]:border-transparent" },
  { status: "ABSENT", label: "Absent", short: "A", tone: "data-[on=true]:bg-[color:var(--st-absent)] data-[on=true]:text-white data-[on=true]:border-transparent" },
  { status: "LEAVE", label: "Leave", short: "L", tone: "data-[on=true]:bg-[color:var(--st-leave)] data-[on=true]:text-white data-[on=true]:border-transparent" },
  { status: "HALF_DAY", label: "Half day", short: "H", tone: "data-[on=true]:bg-[color:var(--st-half)] data-[on=true]:text-white data-[on=true]:border-transparent" },
];

const REG_TONE = { OPEN: "primary", SUBMITTED: "warning", APPROVED: "success", LOCKED: "navy" } as const;

function useShifts(siteId: string) {
  return useQuery({
    queryKey: ["lookups"],
    queryFn: () => api<{ shifts: { id: string; name: string; code: string; siteId: string; startMinute: number; endMinute: number; color: string; isActive: boolean }[]; sites: { id: string; name: string; timezone: string }[] }>("/lookups"),
    staleTime: 5 * 60_000,
    select: (d) => ({ ...d, siteShifts: d.shifts.filter((s) => s.siteId === siteId && s.isActive) }),
  });
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default function AttendancePage() {
  const { me, can, siteId: globalSite } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (params.get("tab") as "register" | "records" | "approvals") ?? "register";

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const pendingApprovals = useQuery({
    queryKey: ["dashboard", globalSite],
    queryFn: () => api<any>("/dashboard", { query: { siteId: globalSite } }),
    enabled: can("attendance.approve"),
    select: (d) => d.attention.pendingRegisters.length as number,
  });

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Daily register by site, date and shift. Supervisors record attendance on behalf of workers — workers never sign in."
        actions={
          <>
            <LinkButton variant="outline" href="/attendance/corrections">
              <Pencil /> Corrections
            </LinkButton>
            <LinkButton variant="outline" href="/attendance/sync">
              <CloudUpload /> Offline sync
            </LinkButton>
          </>
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => setParams({ tab: v === "register" ? null : v })}
        items={[
          { value: "register", label: "Daily register" },
          { value: "records", label: "All records" },
          ...(can("attendance.approve") ? [{ value: "approvals" as const, label: "Approvals", count: pendingApprovals.data }] : []),
        ]}
      />
      {tab === "register" && <RegisterTab params={params} setParams={setParams} me={me} />}
      {tab === "records" && <RecordsTab />}
      {tab === "approvals" && can("attendance.approve") && <ApprovalsTab onOpen={(r) => setParams({ tab: null, site: r.siteId, shift: r.shiftId, date: r.date })} />}
    </div>
  );
}

function RegisterTab({ params, setParams, me }: { params: URLSearchParams; setParams: (p: Record<string, string | null>) => void; me: ReturnType<typeof useSession>["me"] }) {
  const { can, siteId: globalSite, offlineSession } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const online = useOnline() && !offlineSession;

  const site = params.get("site") || globalSite || me.sites[0]?.id || "";
  const siteTz = me.sites.find((s) => s.id === site)?.timezone ?? "Asia/Kolkata";
  const date = params.get("date") || "";
  const shift = params.get("shift") || "";
  const lookups = useShifts(site);

  // Default to the shift in progress right now at this site (handles overnight shifts).
  const current = useQuery({ queryKey: ["current-shift", site], queryFn: () => api<{ workDate: string; shiftId: string | null }>("/attendance/current", { query: { siteId: site } }), enabled: !!site && online && (!date || !shift) });
  useEffect(() => {
    if (!site) return;
    if (date && shift) return;
    if (current.data?.shiftId) setParams({ site, date: date || current.data.workDate, shift: shift || current.data.shiftId });
    else if (!online && lookups.data?.siteShifts[0]) setParams({ site, date: date || todayISO(siteTz), shift: shift || lookups.data.siteShifts[0].id });
  }, [site, date, shift, current.data, online, lookups.data, setParams, siteTz]);

  const [queue, setQueue] = useState<QueuedAction[]>([]);
  useEffect(() => {
    const load = () => listQueue().then(setQueue).catch(() => undefined);
    load();
    window.addEventListener("wg:queue-changed", load);
    return () => window.removeEventListener("wg:queue-changed", load);
  }, []);

  const key = ["register", site, shift, date];
  const reg = useQuery<ViewModel>({
    queryKey: key,
    enabled: !!site && !!shift && !!date,
    networkMode: "always",
    retry: false,
    queryFn: async () => {
      try {
        if (!navigator.onLine) throw new TypeError("offline");
        const r = await api<Register>("/attendance/register", { query: { siteId: site, shiftId: shift, workDate: date } });
        void saveRoster({
          siteId: r.site.id,
          siteName: r.site.name,
          timezone: r.site.timezone,
          shiftId: r.shift.id,
          shiftName: r.shift.name,
          shiftStart: r.shift.start,
          shiftEnd: r.shift.end,
          workDate: r.workDate,
          registerStatus: r.register.status,
          rows: r.rows.map((x) => ({
            employeeId: x.employeeId,
            employeeCode: x.employeeCode,
            fullName: x.fullName,
            designation: x.designation,
            location: x.location,
            status: x.status,
            record: x.record ? { id: x.record.id, status: x.record.status, checkInAt: x.record.checkInAt, checkOutAt: x.record.checkOutAt, version: x.record.version, remarks: x.record.remarks } : null,
          })),
        }).catch(() => undefined);
        return { ...r, source: "server" };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const snap = await getRoster(site, shift, date);
        if (!snap) throw new Error("This register has not been saved on this device yet. Open it once while online to use it offline.");
        return {
          site: { id: snap.siteId, name: snap.siteName, code: "", timezone: snap.timezone },
          shift: { id: snap.shiftId, name: snap.shiftName, code: "", start: snap.shiftStart, end: snap.shiftEnd, overnight: snap.shiftEnd <= snap.shiftStart, breakMinutes: 0, graceMinutes: 0, requiredWorkers: 0, color: "" },
          workDate: snap.workDate,
          isToday: snap.workDate === todayISO(snap.timezone),
          scheduledStart: "",
          scheduledEnd: "",
          register: { id: "", status: snap.registerStatus as any, submittedAt: null, approvals: [] },
          requireApproval: true,
          counts: {},
          rows: snap.rows.map((r) => ({ ...r, record: r.record ? { ...r.record, workedMinutes: null } : null })),
          source: "device",
          savedAt: snap.savedAt,
        };
      }
    },
  });

  // Keep other shifts of today available offline for supervisors.
  useEffect(() => {
    if (!online || me.user.role !== "SUPERVISOR" || !lookups.data || !date) return;
    for (const s of lookups.data.siteShifts) {
      if (s.id === shift) continue;
      qc.prefetchQuery({
        queryKey: ["register", site, s.id, date],
        queryFn: async () => {
          const r = await api<Register>("/attendance/register", { query: { siteId: site, shiftId: s.id, workDate: date } });
          await saveRoster({ siteId: r.site.id, siteName: r.site.name, timezone: r.site.timezone, shiftId: r.shift.id, shiftName: r.shift.name, shiftStart: r.shift.start, shiftEnd: r.shift.end, workDate: r.workDate, registerStatus: r.register.status, rows: r.rows.map((x) => ({ employeeId: x.employeeId, employeeCode: x.employeeCode, fullName: x.fullName, designation: x.designation, location: x.location, status: x.status, record: x.record ? { id: x.record.id, status: x.record.status, checkInAt: x.record.checkInAt, checkOutAt: x.record.checkOutAt, version: x.record.version, remarks: x.record.remarks } : null })) });
          return { ...r, source: "server" as const };
        },
        staleTime: 60_000,
      });
    }
  }, [online, me.user.role, lookups.data, date, site, shift, qc]);

  const data = reg.data;
  const tz = data?.site.timezone ?? siteTz;
  const { rows, pendingByEmp } = useMemo(() => {
    if (!data) return { rows: [] as RegisterRow[], pendingByEmp: new Map<string, QueuedAction[]>() };
    const applied = applyQueue(data.rows as any, queue, { siteId: site, shiftId: shift, workDate: date });
    return {
      rows: (applied.rows as RegisterRow[]).map((r) => {
        const q = applied.pendingByEmp.get(r.employeeId);
        return { ...r, queued: q?.filter((x) => x.state !== "conflict").length ?? 0, conflict: !!q?.some((x) => x.state === "conflict") };
      }),
      pendingByEmp: applied.pendingByEmp,
    };
  }, [data, queue, site, shift, date]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [site, shift, date]);
  const visible = rows.filter((r) => (!filter || r.status === filter) && (!search || `${r.fullName} ${r.employeeCode}`.toLowerCase().includes(search.toLowerCase())));
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const editable = data?.register.status === "OPEN" || can("attendance.editHistorical");
  const canMark = can("attendance.mark") && editable && data?.register.status !== "LOCKED";
  const future = date > todayISO(tz);
  const slot = { siteId: site, shiftId: shift, workDate: date };

  const [busyEmp, setBusyEmp] = useState<string | null>(null);
  const [manual, setManual] = useState<{ kind: "in" | "out"; row: RegisterRow } | null>(null);
  const [correction, setCorrection] = useState<RegisterRow | null>(null);
  const [remarksRow, setRemarksRow] = useState<RegisterRow | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["register", site, shift, date] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  /** Applies an optimistic status so supervisors never wait on the network. */
  const optimistic = (ids: string[], status: AttendanceStatus) => {
    qc.setQueryData<ViewModel>(key, (old) =>
      old ? { ...old, rows: old.rows.map((r) => (ids.includes(r.employeeId) ? { ...r, status, record: r.record ? { ...r.record, status } : { id: "", status, checkInAt: null, checkOutAt: null, workedMinutes: null, remarks: null, version: 0 } } : r)) } : old,
    );
  };

  const offlineAction = async (row: RegisterRow, action: QueuedAction["action"], extra: { status?: AttendanceStatus; time?: string | null; remarks?: string | null } = {}) => {
    await enqueue({
      action,
      siteId: site,
      shiftId: shift,
      workDate: date,
      employeeId: row.employeeId,
      employeeName: row.fullName,
      employeeCode: row.employeeCode,
      userId: me.user.id,
      snapshotVersion: data?.rows.find((r) => r.employeeId === row.employeeId)?.record?.version ?? null,
      ...extra,
    });
  };

  const mark = async (targets: RegisterRow[], status: AttendanceStatus) => {
    if (!targets.length) return;
    if (!online) {
      for (const r of targets) await offlineAction(r, "MARK", { status });
      toast.message(`Saved on device · ${targets.length} ${STATUS[status].label.toLowerCase()}`, { description: "Will sync when connectivity returns." });
      return;
    }
    const ids = targets.map((t) => t.employeeId);
    const prev = qc.getQueryData<ViewModel>(key);
    optimistic(ids, status);
    if (targets.length === 1) setBusyEmp(ids[0]!);
    try {
      await api("/attendance/mark", { body: { ...slot, entries: targets.map((t) => ({ employeeId: t.employeeId, status })) } });
      if (targets.length > 1) toast.success(`${targets.length} marked ${STATUS[status].label.toLowerCase()}`);
      setSelected(new Set());
    } catch (err) {
      if (err instanceof TypeError) {
        for (const r of targets) await offlineAction(r, "MARK", { status });
        toast.message("Connection lost — saved on device");
      } else {
        qc.setQueryData(key, prev);
        toast.error(errorMessage(err));
      }
    } finally {
      setBusyEmp(null);
      refresh();
    }
  };

  const check = async (row: RegisterRow, kind: "in" | "out", time?: string, reason?: string) => {
    if (!online) {
      await offlineAction(row, kind === "in" ? "CHECK_IN" : "CHECK_OUT", { time: time ?? null });
      toast.message(`${kind === "in" ? "Check-in" : "Check-out"} saved on device`, { description: `${row.fullName} · ${fmtTime(time ?? new Date().toISOString(), tz)}` });
      return;
    }
    setBusyEmp(row.employeeId);
    try {
      await api(`/attendance/check-${kind}`, { body: { ...slot, employeeId: row.employeeId, time: time ?? null, reason: reason ?? null } });
      toast.success(`${row.fullName} checked ${kind}`, { description: fmtTime(time ?? new Date().toISOString(), tz) });
    } catch (err) {
      if (err instanceof TypeError) {
        await offlineAction(row, kind === "in" ? "CHECK_IN" : "CHECK_OUT", { time: time ?? new Date().toISOString() });
        toast.message("Connection lost — saved on device");
      } else {
        throw err;
      }
    } finally {
      setBusyEmp(null);
      refresh();
    }
  };

  const checkSafe = (row: RegisterRow, kind: "in" | "out") => check(row, kind).catch((e) => toast.error(errorMessage(e)));

  const pendingRows = rows.filter((r) => r.status === "PENDING");
  const markAllPresent = async () => {
    if (!pendingRows.length) return toast.info("Everyone on this register is already marked");
    const ok = await confirm({ title: `Mark ${pendingRows.length} employees present?`, description: "Only unmarked employees are changed. Adjust exceptions individually afterwards.", confirmLabel: "Mark present" });
    if (ok) await mark(pendingRows, "PRESENT");
  };

  const regStatus = data?.register.status;

  return (
    <div className="pb-20 lg:pb-0">
      {/* Selectors */}
      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select aria-label="Site" wrapperClassName="w-full sm:w-60" value={site} onChange={(e) => setParams({ site: e.target.value, shift: null, date: null })}>
            {me.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setParams({ date: addDaysISO(date, -1) })} disabled={!date}>
              <ChevronLeft />
            </Button>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input type="date" aria-label="Attendance date" value={date} max={todayISO(tz)} onChange={(e) => e.target.value && setParams({ date: e.target.value })} className="w-[160px] pl-8" />
            </div>
            <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setParams({ date: addDaysISO(date, 1) })} disabled={!date || date >= todayISO(tz)}>
              <ChevronRight />
            </Button>
            {date !== todayISO(tz) && (
              <Button variant="ghost" size="sm" onClick={() => setParams({ date: null, shift: null })}>
                Now
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Shift">
            {(lookups.data?.siteShifts ?? []).map((s) => {
              const on = s.id === shift;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setParams({ shift: s.id })}
                  className={cn("flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors", on ? "border-navy bg-navy text-white dark:border-slate dark:bg-slate" : "border-line-strong bg-surface text-fg hover:border-subtle")}
                >
                  <span className="size-2 rounded-sm" style={{ background: s.color }} />
                  {s.name}
                  <span className={cn("tabular text-xs", on ? "text-white/60" : "text-subtle")}>
                    {hhmm(s.startMinute)}–{hhmm(s.endMinute)}
                    {s.endMinute <= s.startMinute && " +1"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {reg.isError && (
        <Card>
          <EmptyState icon={WifiOff} title="Register unavailable" description={errorMessage(reg.error)} action={<Button onClick={() => reg.refetch()}>Retry</Button>} />
        </Card>
      )}

      {(reg.isLoading || (!data && !reg.isError)) && (
        <Card className="p-4">
          <Skeleton className="mb-3 h-8 w-64" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-12" />
          ))}
        </Card>
      )}

      {data && (
        <>
          {/* Register status strip */}
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Badge tone={REG_TONE[data.register.status]} dot>
                Register {data.register.status.toLowerCase()}
              </Badge>
              <span className="text-[13px] text-muted">
                {fmtDate(data.workDate, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · {data.shift.start}–{data.shift.end}
                {data.shift.overnight && <span className="ml-1 text-xs">(ends next day)</span>}
                {data.shift.graceMinutes ? ` · ${data.shift.graceMinutes} min grace` : ""}
              </span>
            </div>
            {data.source === "device" ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs font-medium text-warning">
                <CloudOff className="size-3.5" /> Offline · roster saved {fmtDateTime(data.savedAt, tz)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-subtle">
                <Wifi className="size-3.5" /> Live · available offline on this device
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {(["PRESENT", "ON_DUTY", "ABSENT", "LEAVE", "HALF_DAY", "INCOMPLETE", "PENDING"] as AttendanceStatus[]).map((s) =>
                counts[s] ? (
                  <button key={s} type="button" onClick={() => setFilter(filter === s ? "" : s)} className={cn("rounded-md transition-opacity", filter && filter !== s && "opacity-40")}>
                    <StatusBadge status={s} className="cursor-pointer" />
                    <span className="sr-only">filter</span>
                    <span className="ml-1 text-xs font-semibold tabular text-fg">{counts[s]}</span>
                  </button>
                ) : null,
              )}
            </div>
          </div>

          {data.register.status !== "OPEN" && <RegisterBanner data={data} onDone={refresh} />}

          <Card className="overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <SearchInput value={search} onChange={setSearch} placeholder="Search name or ID" className="w-full sm:w-64" />
              <Select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)} wrapperClassName="w-40">
                <option value="">All statuses</option>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {selected.size > 0 && canMark && (
                  <div className="flex items-center gap-1.5 rounded-md bg-primary-soft px-2 py-1">
                    <span className="px-1 text-[13px] font-semibold text-primary-ink">{selected.size} selected</span>
                    {QUICK.map((q) => (
                      <Button key={q.status} size="xs" variant="outline" onClick={() => mark(rows.filter((r) => selected.has(r.employeeId)), q.status)}>
                        {q.label}
                      </Button>
                    ))}
                  </div>
                )}
                {canMark && !future && (
                  <Button variant="outline" onClick={markAllPresent} disabled={!pendingRows.length}>
                    <ListChecks /> Mark all present
                  </Button>
                )}
                {canMark && regStatus === "OPEN" && data.source === "server" && (
                  <Button onClick={() => setSubmitOpen(true)} className="hidden lg:inline-flex">
                    <Send /> Submit register
                  </Button>
                )}
              </div>
            </div>

            {future && (
              <div className="border-b border-line bg-info-soft px-4 py-2 text-[13px] text-info">This date is in the future — the roster is shown for planning; attendance can be recorded on the day.</div>
            )}

            {/* Desktop table */}
            <div className="scrollbar-thin hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    {canMark && (
                      <th className="sticky top-0 w-10 border-b border-line bg-surface-2 py-2 pl-4">
                        <Checkbox
                          aria-label="Select all"
                          checked={visible.length > 0 && visible.every((r) => selected.has(r.employeeId))}
                          onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((r) => r.employeeId)) : new Set())}
                        />
                      </th>
                    )}
                    {["Employee", "Designation", "Location", "Sched. in", "Actual in", "Actual out", "Hours", "Status", "Late", "Remarks", "Marked by", ""].map((h, i) => (
                      <th key={i} className={cn("sticky top-0 whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 font-semibold", h === "Hours" && "text-right", !canMark && i === 0 && "pl-4")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <DesktopRow
                      key={r.employeeId}
                      row={r}
                      tz={tz}
                      shiftStart={data.shift.start}
                      canMark={canMark && !future}
                      busy={busyEmp === r.employeeId}
                      selected={selected.has(r.employeeId)}
                      onSelect={(v) => setSelected((s) => {
                        const n = new Set(s);
                        v ? n.add(r.employeeId) : n.delete(r.employeeId);
                        return n;
                      })}
                      onMark={(st) => mark([r], st)}
                      onCheck={(k) => checkSafe(r, k)}
                      onManual={(k) => setManual({ kind: k, row: r })}
                      onCorrection={() => setCorrection(r)}
                      onRemarks={() => setRemarksRow(r)}
                      canCorrect={can("corrections.request") && !!r.record?.id && data.source === "server"}
                      online={online}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-line lg:hidden">
              {visible.map((r) => (
                <MobileRow
                  key={r.employeeId}
                  row={r}
                  tz={tz}
                  canMark={canMark && !future}
                  busy={busyEmp === r.employeeId}
                  onMark={(st) => mark([r], st)}
                  onCheck={(k) => checkSafe(r, k)}
                  onManual={(k) => setManual({ kind: k, row: r })}
                  onCorrection={() => setCorrection(r)}
                  onRemarks={() => setRemarksRow(r)}
                  canCorrect={can("corrections.request") && !!r.record?.id && data.source === "server"}
                />
              ))}
            </ul>
            {!visible.length && (
              <EmptyState
                icon={Users}
                title={rows.length ? "No employees match the filter" : "No employees rostered for this shift"}
                description={rows.length ? undefined : "Assign employees in Shift Management → Roster, or set each employee's default shift."}
                action={!rows.length && can("roster.manage") ? <LinkButton href="/shifts?tab=roster">Open roster</LinkButton> : undefined}
              />
            )}
          </Card>

          {data.register.approvals.length > 0 && (
            <Card className="mt-3 p-4">
              <h3 className="mb-2 text-[13px] font-semibold">Approval history</h3>
              <ol className="space-y-1.5 text-[13px]">
                {data.register.approvals.map((a, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 text-muted">
                    <span className="font-semibold text-fg">{a.action.toLowerCase()}</span> by {a.actorName} · {fmtDateTime(a.createdAt, tz)}
                    {a.note && <span className="italic">“{a.note}”</span>}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* Sticky mobile submit bar */}
          {canMark && regStatus === "OPEN" && (
            <div className="safe-bottom fixed inset-x-0 bottom-14 z-20 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur-md lg:hidden">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1 text-xs text-muted">
                  <span className="font-semibold text-fg tabular">{rows.length - pendingRows.length}</span>/{rows.length} marked
                  {pendingRows.length > 0 && <span className="text-warning"> · {pendingRows.length} pending</span>}
                </div>
                {pendingRows.length > 0 ? (
                  <Button size="lg" variant="outline" onClick={markAllPresent}>
                    <ListChecks /> All present
                  </Button>
                ) : null}
                <Button size="lg" onClick={() => setSubmitOpen(true)} disabled={data.source !== "server" || !online}>
                  <Send /> Submit
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ManualTimeDialog
        open={!!manual}
        onOpenChange={(o) => !o && setManual(null)}
        kind={manual?.kind ?? "in"}
        row={manual?.row ?? null}
        workDate={date}
        shiftStart={data?.shift.start ?? "00:00"}
        overnight={!!data?.shift.overnight}
        tz={tz}
        onSubmit={async (iso, reason) => {
          if (!manual) return;
          await check(manual.row, manual.kind, iso, reason).catch((e) => {
            throw new Error(errorMessage(e));
          });
        }}
      />
      <CorrectionDialog
        open={!!correction}
        onOpenChange={(o) => !o && setCorrection(null)}
        row={correction}
        workDate={date}
        tz={tz}
        onSubmit={async (body) => {
          await api(`/attendance/${correction!.record!.id}/corrections`, { body }).catch((e) => {
            throw new Error(errorMessage(e));
          });
          toast.success("Correction submitted for approval");
          refresh();
        }}
      />
      <RemarksDialog
        open={!!remarksRow}
        onOpenChange={(o) => !o && setRemarksRow(null)}
        row={remarksRow}
        onSubmit={async (remarks) => {
          try {
            if (remarksRow?.record?.id) await api(`/attendance/${remarksRow.record.id}/remarks`, { method: "PATCH", body: { remarks: remarks || null } });
            else if (remarksRow) {
              toast.error("Mark the employee first, then add remarks");
              return;
            }
            toast.success("Remarks saved");
            refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      {data && <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} data={data} rows={rows} slot={slot} onDone={refresh} />}
    </div>
  );
}

function TimeCell({ iso, tz, workDate }: { iso: string | null | undefined; tz: string; workDate?: string }) {
  if (!iso) return <span className="text-subtle">—</span>;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
  return (
    <span className="tabular">
      {fmtTime(iso, tz)}
      {workDate && day > workDate && <sup className="ml-0.5 text-[10px] font-semibold text-muted">+1</sup>}
    </span>
  );
}

function RowMenu({ row, canMark, canCorrect, onManual, onCorrection, onRemarks }: { row: RegisterRow; canMark: boolean; canCorrect: boolean; onManual: (k: "in" | "out") => void; onCorrection: () => void; onRemarks: () => void }) {
  const rec = row.record;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${row.fullName}`}>
          <MoreHorizontal />
        </Button>
      </MenuTrigger>
      <MenuContent className="w-56">
        {canMark && !rec?.checkInAt && (
          <MenuItem onSelect={() => onManual("in")}>
            <Timer /> Enter check-in time…
          </MenuItem>
        )}
        {canMark && rec?.checkInAt && !rec.checkOutAt && (
          <MenuItem onSelect={() => onManual("out")}>
            <Timer /> Enter check-out time…
          </MenuItem>
        )}
        {canMark && (
          <MenuItem onSelect={onRemarks} disabled={!rec?.id}>
            <MessageSquareText /> Remarks…
          </MenuItem>
        )}
        {canCorrect && (
          <MenuItem onSelect={onCorrection} disabled={rec?.pendingCorrection}>
            <Pencil /> {rec?.pendingCorrection ? "Correction pending" : "Request correction…"}
          </MenuItem>
        )}
        {rec?.id && (
          <>
            <MenuSeparator />
            <MenuItem asChild>
              <Link href={`/audit?entityId=${rec.id}`}>
                <History /> View history
              </Link>
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

function SyncFlag({ row }: { row: RegisterRow }) {
  if (row.conflict)
    return (
      <Tip content="An offline entry conflicted with the server — review in Offline sync">
        <Link href="/attendance/sync" className="inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 text-[10.5px] font-semibold text-danger">
          Conflict
        </Link>
      </Tip>
    );
  if (row.queued)
    return (
      <Tip content="Saved on this device, waiting to sync">
        <span className="inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 text-[10.5px] font-semibold text-warning">
          <CloudOff className="size-3" /> Queued
        </span>
      </Tip>
    );
  if (row.record?.entryMode === "OFFLINE")
    return (
      <Tip content={`Recorded offline ${row.record.deviceRecordedAt ? fmtDateTime(row.record.deviceRecordedAt) : ""} · synced ${row.record.syncedAt ? fmtDateTime(row.record.syncedAt) : ""}`}>
        <span className="rounded bg-sunken px-1.5 text-[10.5px] font-semibold text-muted">Offline</span>
      </Tip>
    );
  if (row.record?.entryMode === "MANUAL") return <span className="rounded bg-sunken px-1.5 text-[10.5px] font-semibold text-muted">Manual</span>;
  if (row.record?.entryMode === "CORRECTION") return <span className="rounded bg-warning-soft px-1.5 text-[10.5px] font-semibold text-warning">Corrected</span>;
  return null;
}

function DesktopRow({
  row,
  tz,
  shiftStart,
  canMark,
  busy,
  selected,
  onSelect,
  onMark,
  onCheck,
  onManual,
  onCorrection,
  onRemarks,
  canCorrect,
}: {
  row: RegisterRow;
  tz: string;
  shiftStart: string;
  canMark: boolean;
  busy: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onMark: (s: AttendanceStatus) => void;
  onCheck: (k: "in" | "out") => void;
  onManual: (k: "in" | "out") => void;
  onCorrection: () => void;
  onRemarks: () => void;
  canCorrect: boolean;
  online: boolean;
}) {
  const rec = row.record;
  const workDate = rec?.checkInAt ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(rec.checkInAt)) : undefined;
  return (
    <tr className={cn("group transition-colors hover:bg-surface-2", selected && "bg-primary-soft/50", busy && "opacity-70")}>
      {canMark && (
        <td className="border-b border-line py-2 pl-4">
          <Checkbox aria-label={`Select ${row.fullName}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        </td>
      )}
      <td className={cn("border-b border-line px-3 py-2", !canMark && "pl-4")}>
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <Link href={`/employees/${row.employeeId}`} className="block truncate font-medium text-fg hover:text-primary-ink">
              {row.fullName}
            </Link>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className="tabular">{row.employeeCode}</span>
              <SyncFlag row={row} />
            </div>
          </div>
        </div>
      </td>
      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-[13px] text-muted">{row.designation ?? "—"}</td>
      <td className="max-w-40 truncate border-b border-line px-3 py-2 text-[13px] text-muted">{row.location ?? "—"}</td>
      <td className="border-b border-line px-3 py-2 tabular text-muted">{shiftStart}</td>
      <td className="border-b border-line px-3 py-2">
        {rec?.checkInAt ? (
          <TimeCell iso={rec.checkInAt} tz={tz} />
        ) : canMark && !["ABSENT", "LEAVE", "WEEKLY_OFF", "HOLIDAY"].includes(row.status) ? (
          <Button size="xs" variant="outline" onClick={() => onCheck("in")} disabled={busy}>
            <LogIn /> Check in
          </Button>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="border-b border-line px-3 py-2">
        {rec?.checkOutAt ? (
          <TimeCell iso={rec.checkOutAt} tz={tz} workDate={workDate} />
        ) : rec?.checkInAt && canMark ? (
          <Button size="xs" variant="outline" onClick={() => onCheck("out")} disabled={busy}>
            <LogOut /> Check out
          </Button>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="border-b border-line px-3 py-2 text-right tabular">
        {rec?.workedMinutes != null ? (
          <Tip content={rec.hoursFromSchedule ? "Scheduled hours (no IN/OUT times recorded)" : `${rec.overtimeMinutes ? `Includes ${fmtHM(rec.overtimeMinutes)} overtime` : "Net of break"}`}>
            <span className={cn(rec.hoursFromSchedule && "text-muted")}>
              {fmtHM(rec.workedMinutes)}
              {rec.hoursFromSchedule && <span className="text-[10px]">*</span>}
              {!!rec.overtimeMinutes && <span className="ml-1 text-[10.5px] font-semibold text-primary-ink">OT</span>}
            </span>
          </Tip>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="border-b border-line px-3 py-2">
        {canMark ? (
          <div className="flex items-center gap-1">
            {QUICK.map((q) => (
              <Tip key={q.status} content={q.label}>
                <button
                  type="button"
                  data-on={row.status === q.status}
                  onClick={() => row.status !== q.status && onMark(q.status)}
                  disabled={busy || (!!rec?.checkInAt && (q.status === "ABSENT" || q.status === "LEAVE"))}
                  className={cn("grid size-7 place-items-center rounded-md border border-line-strong text-xs font-bold text-muted transition-colors hover:border-subtle hover:text-fg disabled:opacity-30", q.tone)}
                  aria-label={`Mark ${q.label}`}
                  aria-pressed={row.status === q.status}
                >
                  {q.short}
                </button>
              </Tip>
            ))}
            {!["PRESENT", "ABSENT", "LEAVE", "HALF_DAY", "PENDING"].includes(row.status) && <StatusBadge status={row.status} className="ml-1" />}
          </div>
        ) : (
          <StatusBadge status={row.status} />
        )}
      </td>
      <td className="border-b border-line px-3 py-2 text-xs">{rec?.isLate ? <span className="font-semibold text-warning tabular">+{rec.lateMinutes}m</span> : <span className="text-subtle">—</span>}</td>
      <td className="max-w-48 truncate border-b border-line px-3 py-2 text-[13px] text-muted" title={rec?.remarks ?? ""}>
        {rec?.remarks || "—"}
      </td>
      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-[13px] text-muted">{rec?.markedBy ?? "—"}</td>
      <td className="border-b border-line py-2 pr-3 text-right">
        <RowMenu row={row} canMark={canMark} canCorrect={canCorrect} onManual={onManual} onCorrection={onCorrection} onRemarks={onRemarks} />
      </td>
    </tr>
  );
}

function MobileRow({
  row,
  tz,
  canMark,
  busy,
  onMark,
  onCheck,
  onManual,
  onCorrection,
  onRemarks,
  canCorrect,
}: {
  row: RegisterRow;
  tz: string;
  canMark: boolean;
  busy: boolean;
  onMark: (s: AttendanceStatus) => void;
  onCheck: (k: "in" | "out") => void;
  onManual: (k: "in" | "out") => void;
  onCorrection: () => void;
  onRemarks: () => void;
  canCorrect: boolean;
}) {
  const rec = row.record;
  const blocked = ["ABSENT", "LEAVE", "WEEKLY_OFF", "HOLIDAY"].includes(row.status);
  return (
    <li className={cn("px-4 py-3", busy && "opacity-70")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-fg">{row.fullName}</span>
            <SyncFlag row={row} />
          </div>
          <div className="mt-0.5 text-xs text-muted">
            <span className="tabular">{row.employeeCode}</span> · {row.designation ?? "—"}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <StatusBadge status={row.status} />
            {rec?.checkInAt && (
              <span className="text-muted">
                In <b className="text-fg"><TimeCell iso={rec.checkInAt} tz={tz} /></b>
                {rec.isLate && <span className="ml-1 font-semibold text-warning">+{rec.lateMinutes}m</span>}
              </span>
            )}
            {rec?.checkOutAt && (
              <span className="text-muted">
                Out <b className="text-fg"><TimeCell iso={rec.checkOutAt} tz={tz} /></b>
              </span>
            )}
            {rec?.workedMinutes != null && rec.checkOutAt && <span className="text-muted">{fmtHM(rec.workedMinutes)} h</span>}
          </div>
        </div>
        <RowMenu row={row} canMark={canMark} canCorrect={canCorrect} onManual={onManual} onCorrection={onCorrection} onRemarks={onRemarks} />
      </div>
      {canMark && (
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {QUICK.slice(0, 3).map((q) => (
            <button
              key={q.status}
              type="button"
              data-on={row.status === q.status}
              onClick={() => row.status !== q.status && onMark(q.status)}
              disabled={busy || (!!rec?.checkInAt && q.status !== "PRESENT")}
              className={cn("h-11 rounded-md border border-line-strong text-[13px] font-semibold text-fg transition-colors active:scale-[0.97] disabled:opacity-35", q.tone)}
              aria-pressed={row.status === q.status}
            >
              {q.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onCheck("in")}
            disabled={busy || !!rec?.checkInAt || blocked}
            className="flex h-11 items-center justify-center gap-1 rounded-md border border-line-strong text-[13px] font-semibold text-[color:var(--st-duty)] active:scale-[0.97] disabled:opacity-35"
          >
            <LogIn className="size-4" /> In
          </button>
          <button
            type="button"
            onClick={() => onCheck("out")}
            disabled={busy || !rec?.checkInAt || !!rec?.checkOutAt}
            className="flex h-11 items-center justify-center gap-1 rounded-md border border-line-strong text-[13px] font-semibold text-[color:var(--st-present)] active:scale-[0.97] disabled:opacity-35"
          >
            <LogOut className="size-4" /> Out
          </button>
        </div>
      )}
    </li>
  );
}

function SubmitDialog({ open, onOpenChange, data, rows, slot, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; data: ViewModel; rows: RegisterRow[]; slot: { siteId: string; shiftId: string; workDate: string }; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const pending = rows.filter((r) => r.status === "PENDING");
  const queued = rows.filter((r) => r.queued);
  const absent = rows.filter((r) => r.status === "ABSENT");
  const openDuty = rows.filter((r) => r.status === "ON_DUTY");
  const submit = async () => {
    setBusy(true);
    try {
      const res = await api<{ status: string }>("/attendance/register/submit", { body: { ...slot, note: note || null } });
      toast.success(res.status === "APPROVED" ? "Register submitted and approved" : "Register submitted for approval");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Submit attendance register"
      description={`${data.site.name} · ${data.shift.name} · ${fmtDate(data.workDate, { weekday: "short", day: "2-digit", month: "short" })}`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep editing
          </Button>
          <Button onClick={submit} loading={busy} disabled={pending.length > 0 || queued.length > 0}>
            <Send /> Confirm & submit
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {(["PRESENT", "ON_DUTY", "HALF_DAY", "ABSENT", "LEAVE", "INCOMPLETE", "WEEKLY_OFF", "PENDING"] as AttendanceStatus[])
          .filter((s) => counts[s])
          .map((s) => (
            <div key={s} className="rounded-md border border-line p-2.5">
              <div className="font-display text-xl font-bold tabular">{counts[s]}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className={cn("size-1.5 rounded-full", STATUS[s].dot)} />
                {STATUS[s].label}
              </div>
            </div>
          ))}
      </div>
      {pending.length > 0 && (
        <div className="mt-4 rounded-md border border-warning/30 bg-warning-soft p-3 text-[13px] text-warning">
          <b>{pending.length} employee(s) not marked:</b> {pending.slice(0, 6).map((p) => p.fullName).join(", ")}
          {pending.length > 6 && "…"}
        </div>
      )}
      {queued.length > 0 && <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-[13px] text-warning">{queued.length} entries are still waiting to sync from this device. Sync them first.</div>}
      {absent.length > 0 && (
        <p className="mt-4 text-[13px] text-muted">
          <b className="text-danger">Absent:</b> {absent.map((a) => a.fullName).join(", ")}
        </p>
      )}
      {openDuty.length > 0 && <p className="mt-2 text-[13px] text-muted">{openDuty.length} employee(s) are still on duty — you can record their check-out after submitting.</p>}
      <div className="mt-4">
        <label className="text-[13px] font-medium">Note for approver (optional)</label>
        <Textarea className="mt-1.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. EMP0012 relieved early for hospital visit — informed site in-charge" />
      </div>
      <p className="mt-3 text-xs text-muted">{data.requireApproval ? "After submission, changes require an approved correction." : "This organization auto-approves submitted registers."}</p>
    </Dialog>
  );
}

function RegisterBanner({ data, onDone }: { data: ViewModel; onDone: () => void }) {
  const { can } = useSession();
  const confirm = useConfirm();
  const status = data.register.status;
  const act = async (action: "approve" | "reopen" | "lock") => {
    const r = await confirm({
      title: action === "approve" ? "Approve this register?" : action === "reopen" ? "Reopen this register?" : "Lock this register?",
      description: action === "lock" ? "Locked registers can only change through approved corrections." : action === "reopen" ? "The supervisor will be able to edit attendance directly again." : "Approved attendance becomes part of the official record.",
      confirmLabel: action[0]!.toUpperCase() + action.slice(1),
      danger: action === "reopen",
      reason: action === "reopen" ? { label: "Reason for reopening", required: true } : { label: "Note (optional)" },
    });
    if (r === false) return;
    try {
      await api(`/attendance/register/${data.register.id}/${action}`, { body: { note: r === "ok" ? null : r } });
      toast.success(`Register ${action === "approve" ? "approved" : action === "reopen" ? "reopened" : "locked"}`);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const tone = status === "SUBMITTED" ? "border-warning/30 bg-warning-soft" : status === "APPROVED" ? "border-success/30 bg-success-soft" : "border-line-strong bg-sunken";
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className={cn("mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3", tone)}>
        {status === "LOCKED" ? <Lock className="size-5 text-muted" /> : status === "APPROVED" ? <ShieldCheck className="size-5 text-success" /> : <ClipboardCheck className="size-5 text-warning" />}
        <div className="min-w-0 flex-1 text-[13px]">
          <b className="text-fg">{status === "SUBMITTED" ? "Submitted — awaiting approval" : status === "APPROVED" ? "Approved" : "Locked"}</b>
          <span className="text-muted">
            {data.register.submittedAt && ` · submitted ${fmtDateTime(data.register.submittedAt, data.site.timezone)}`} · Changes now go through attendance corrections.
          </span>
        </div>
        {can("attendance.approve") && (
          <div className="flex gap-2">
            {status === "SUBMITTED" && (
              <Button size="sm" onClick={() => act("approve")}>
                <Check /> Approve
              </Button>
            )}
            {status !== "LOCKED" && (
              <Button size="sm" variant="outline" onClick={() => act("lock")}>
                <Lock /> Lock
              </Button>
            )}
            {status !== "LOCKED" && (
              <Button size="sm" variant="outline" onClick={() => act("reopen")}>
                <LockOpen /> Reopen
              </Button>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
