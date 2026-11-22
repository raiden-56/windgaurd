"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarOff,
  ClipboardCheck,
  Clock,
  CloudUpload,
  Hourglass,
  LogIn,
  LogOut,
  Pencil,
  ShieldCheck,
  Smartphone,
  Timer,
  UserCheck,
  UserX,
  Users,
  UserCog,
  Plane,
  Activity,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, ChartTooltip, gridProps, Legend, Meter, SegmentBar, SHIFT_COLORS, STATUS_SERIES } from "@/components/charts";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, Card, CardHeader, CountUp, EmptyState, Segmented, Skeleton } from "@/components/ui/display";
import { api } from "@/lib/api";
import { fmtDate, relTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface Dashboard {
  today: string;
  kpis: {
    activeEmployees: number;
    supervisors: number;
    present: number;
    absent: number;
    onLeave: number;
    halfDay: number;
    onDutyNow: number;
    openShifts: number;
    attendancePct: number | null;
    lateCheckins: number;
    incompleteCheckouts: number;
    notMarked: number;
    rosteredToday: number;
  };
  overview: { counts: Record<string, number>; pending: number; week: { date: string; present: number; absent: number; leave: number; halfDay: number; pct: number | null }[] };
  shiftDistribution: { name: string; code: string; required: number; filled: number; present: number }[];
  shiftSlots: { siteId: string; siteName: string; shiftId: string; shiftName: string; code: string; sortOrder: number; start: string; end: string; required: number; rostered: number; present: number; notMarked: number; started: boolean; inProgress: boolean }[];
  siteWorkforce: { siteId: string; name: string; code: string; employees: number; present: number; absent: number; leave: number; openPositions: number }[];
  trends: {
    daily: { date: string; present: number; absent: number; leave: number; halfDay: number; pct: number | null }[];
    weekly: { key: string; label: string; pct: number | null; present: number; absent: number }[];
    monthly: { key: string; label: string; pct: number | null; present: number; absent: number }[];
    yearly: { key: string; label: string; pct: number | null; present: number; absent: number }[];
  };
  recentActivity: { id: string; action: string; userName: string; userRole: string; after: any; reason: string | null; createdAt: string }[];
  attention: {
    notMarked: { siteId: string; siteName: string; shiftId: string; shiftName: string; count: number; date: string }[];
    missingCheckouts: { id: string; employee: string; employeeCode: string; siteId: string; shiftId: string; date: string; siteName?: string; shiftName?: string }[];
    missingCheckoutsTotal: number;
    unfilledShifts: { siteId: string; siteName: string; shiftName: string; required: number; rostered: number }[];
    quietSupervisors: { id: string; fullName: string; lastSeenAt: string | null }[];
    pendingRegisters: { id: string; siteId: string; shiftId: string; siteName: string; shiftName: string; date: string; submittedAt: string }[];
    pendingCorrections: number;
    offlineSynced24h: number;
  };
}

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function greeting(d: Date | null) {
  if (!d) return "Hello";
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(d));
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const ACTION_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  "attendance.check_in": { label: "checked in", icon: LogIn, tone: "text-[color:var(--st-duty)]" },
  "attendance.check_out": { label: "checked out", icon: LogOut, tone: "text-[color:var(--st-present)]" },
  "attendance.create": { label: "marked attendance", icon: ClipboardCheck, tone: "text-muted" },
  "attendance.update": { label: "updated attendance", icon: Pencil, tone: "text-muted" },
  "attendance.correction.apply": { label: "applied a correction", icon: BadgeCheck, tone: "text-warning" },
  "attendance.correction.request": { label: "requested a correction", icon: Pencil, tone: "text-warning" },
  "attendance.auto_leave": { label: "recorded approved leave", icon: Plane, tone: "text-[color:var(--st-leave)]" },
  "attendance.mark_incomplete": { label: "flagged a missing check-out", icon: AlertTriangle, tone: "text-[color:var(--st-incomplete)]" },
  "register.submit": { label: "submitted a register", icon: ClipboardCheck, tone: "text-primary-ink" },
  "register.approve": { label: "approved a register", icon: ShieldCheck, tone: "text-success" },
  "register.reopen": { label: "reopened a register", icon: Pencil, tone: "text-warning" },
  "roster.assign": { label: "assigned shift positions", icon: Users, tone: "text-muted" },
  "roster.change_shift": { label: "changed a shift assignment", icon: Users, tone: "text-muted" },
  "handover.create": { label: "recorded a shift handover", icon: UserCog, tone: "text-muted" },
  "handover.confirm": { label: "confirmed a handover", icon: UserCheck, tone: "text-success" },
  "sync.synced": { label: "synchronized offline entries", icon: CloudUpload, tone: "text-info" },
};

function activityText(a: Dashboard["recentActivity"][number]) {
  const v = a.after ?? {};
  const who = v.employeeCode ? ` · ${v.employeeCode}` : "";
  const where = [v.site, v.shift, v.workDate].filter(Boolean).join(" · ");
  return { who, where };
}

function Kpi({ icon: Icon, label, value, suffix, hint, tone = "text-fg", href, loading }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | null | undefined; suffix?: string; hint?: React.ReactNode; tone?: string; href?: string; loading?: boolean }) {
  const body = (
    <div className="group flex h-full flex-col justify-between gap-2 px-4 py-3.5 transition-colors hover:bg-surface-2">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
        <Icon className="size-4 text-subtle" />
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-14" />
      ) : (
        <div className={cn("font-display text-[26px] font-bold leading-none tracking-tight", tone)}>
          <CountUp value={value} decimals={suffix === "%" ? 1 : 0} suffix={suffix} />
        </div>
      )}
      {hint && <div className="text-[11.5px] text-subtle">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function ShiftBoard({ data }: { data: Dashboard }) {
  const bySite = useMemo(() => {
    const m = new Map<string, Dashboard["shiftSlots"]>();
    for (const s of data.shiftSlots) m.set(s.siteName, [...(m.get(s.siteName) ?? []), s]);
    return [...m.entries()];
  }, [data.shiftSlots]);
  if (!bySite.length) return <EmptyState icon={Clock} title="No shifts configured" description="Create shifts for your sites to see today’s board." />;
  return (
    <div className="divide-y divide-line">
      {bySite.map(([site, slots]) => (
        <div key={site} className="grid gap-3 px-4 py-3 sm:grid-cols-[160px_1fr] sm:px-5">
          <div className="text-[13px] font-semibold text-fg sm:pt-1">{site}</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {slots.map((s) => {
              const short = s.rostered < s.required;
              return (
                <Link
                  key={s.shiftId}
                  href={`/attendance?site=${s.siteId}&shift=${s.shiftId}&date=${data.today}`}
                  className={cn("rounded-md border px-3 py-2 transition-colors hover:border-line-strong hover:bg-surface-2", s.inProgress ? "border-primary/40 bg-primary-soft/40" : "border-line")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
                      <span className="size-2 rounded-sm" style={{ background: SHIFT_COLORS[(s.sortOrder - 1) % 3] }} />
                      {s.code}
                      <span className="font-normal text-subtle tabular">
                        {s.start}–{s.end}
                      </span>
                    </span>
                    {s.inProgress ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-primary-ink">
                        <span className="size-1.5 animate-pulse-dot rounded-full bg-primary" /> Live
                      </span>
                    ) : !s.started ? (
                      <span className="text-[11px] text-subtle">Upcoming</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-xs">
                    <span className="text-muted">
                      <span className="font-display text-base font-bold text-fg tabular">{s.present}</span> / {s.rostered} present
                    </span>
                    <span className={cn("tabular", short ? "font-semibold text-danger" : "text-subtle")}>
                      {s.rostered}/{s.required} filled
                    </span>
                  </div>
                  <Meter value={s.present} max={Math.max(s.rostered, s.required)} className="mt-1.5" color={short ? "var(--st-absent)" : "var(--st-present)"} />
                  {s.started && s.notMarked > 0 && <div className="mt-1.5 text-[11px] font-medium text-warning">{s.notMarked} not marked yet</div>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Attention({ data }: { data: Dashboard }) {
  const { can } = useSession();
  const approver = can("attendance.approve");
  const a = data.attention;
  const items: { key: string; icon: React.ComponentType<{ className?: string }>; tone: string; title: string; detail: string; href: string }[] = [
    ...a.notMarked.map((n) => ({ key: `nm-${n.shiftId}`, icon: Hourglass, tone: "text-warning bg-warning-soft", title: `${n.count} not marked`, detail: `${n.siteName} · ${n.shiftName}`, href: `/attendance?site=${n.siteId}&shift=${n.shiftId}&date=${n.date}` })),
    ...(a.missingCheckoutsTotal
      ? [{ key: "mc", icon: LogOut, tone: "text-[color:var(--st-incomplete)] bg-[color:var(--st-incomplete)]/12", title: `${a.missingCheckoutsTotal} missing check-out${a.missingCheckoutsTotal > 1 ? "s" : ""}`, detail: a.missingCheckouts.slice(0, 2).map((m) => `${m.employee} (${m.shiftName})`).join(", "), href: `/attendance?site=${a.missingCheckouts[0]!.siteId}&shift=${a.missingCheckouts[0]!.shiftId}&date=${a.missingCheckouts[0]!.date}` }]
      : []),
    ...a.unfilledShifts.map((u) => ({ key: `uf-${u.siteName}-${u.shiftName}`, icon: Users, tone: "text-danger bg-danger-soft", title: `${u.required - u.rostered} unfilled position${u.required - u.rostered > 1 ? "s" : ""}`, detail: `${u.siteName} · ${u.shiftName} (${u.rostered}/${u.required})`, href: "/shifts?tab=roster" })),
    ...(approver ? a.quietSupervisors : []).map((q) => ({ key: `qs-${q.id}`, icon: Smartphone, tone: "text-muted bg-sunken", title: `${q.fullName} offline`, detail: `Last active ${relTime(q.lastSeenAt)} during a live shift`, href: "/supervisors" })),
    ...(approver && a.pendingRegisters.length ? [{ key: "pr", icon: ClipboardCheck, tone: "text-primary-ink bg-primary-soft", title: `${a.pendingRegisters.length} register${a.pendingRegisters.length > 1 ? "s" : ""} awaiting approval`, detail: a.pendingRegisters.slice(0, 2).map((r) => `${r.siteName} · ${r.shiftName}`).join(", "), href: "/attendance?tab=approvals" }] : []),
    ...(approver && a.pendingCorrections ? [{ key: "pc", icon: Pencil, tone: "text-warning bg-warning-soft", title: `${a.pendingCorrections} correction request${a.pendingCorrections > 1 ? "s" : ""}`, detail: "Review previous vs proposed values", href: "/attendance/corrections" }] : []),
  ];
  if (!items.length) return <EmptyState icon={BadgeCheck} title="All clear" description="Every rostered worker is marked and no approvals are waiting." className="py-8" />;
  return (
    <ul className="divide-y divide-line">
      {items.map((i, idx) => (
        <motion.li key={i.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
          <Link href={i.href} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 sm:px-5">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", i.tone)}>
              <i.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-fg">{i.title}</span>
              <span className="block truncate text-xs text-muted">{i.detail}</span>
            </span>
            <ArrowRight className="size-4 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        </motion.li>
      ))}
    </ul>
  );
}

function TrendCard({ data }: { data: Dashboard }) {
  const [range, setRange] = useState<"daily" | "weekly" | "monthly" | "yearly">("daily");
  const series = range === "daily" ? data.trends.daily.map((d) => ({ label: fmtDate(d.date, { day: "2-digit", month: "short" }), pct: d.pct })) : data.trends[range].map((d) => ({ label: d.label, pct: d.pct }));
  const values = series.map((s) => s.pct).filter((v): v is number => v != null);
  const min = values.length ? Math.max(0, Math.floor(Math.min(...values) - 3)) : 0;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return (
    <Card>
      <CardHeader
        title="Attendance trend"
        description={`Attendance % ${range === "daily" ? "over the last 30 days" : range === "weekly" ? "over the last 12 weeks" : range === "monthly" ? "over the last 12 months" : "by year"} · average ${avg?.toFixed(1) ?? "—"}%`}
        action={
          <Segmented
            ariaLabel="Trend range"
            value={range}
            onChange={setRange}
            items={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
              { value: "yearly", label: "Yearly" },
            ]}
          />
        }
      />
      <div className="h-64 px-2 pb-3 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          {range === "yearly" ? (
            <BarChart data={series} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={44} />
              <Tooltip cursor={{ fill: "var(--surface-sunken)" }} content={<ChartTooltip format={(v: number) => `${v}%`} />} />
              <Bar dataKey="pct" name="Attendance" fill="var(--brand-blue)" radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          ) : (
            <AreaChart data={series} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand-blue)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--brand-blue)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...axisProps} domain={[min, 100]} tickFormatter={(v) => `${v}%`} width={44} />
              <Tooltip cursor={{ stroke: "var(--line-strong)" }} content={<ChartTooltip format={(v: number) => (v == null ? "—" : `${v}%`)} />} />
              <Area type="monotone" dataKey="pct" name="Attendance" stroke="var(--brand-blue)" strokeWidth={2} fill="url(#trendFill)" connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function WeekCard({ data }: { data: Dashboard }) {
  const rows = data.overview.week.map((d) => ({ ...d, label: fmtDate(d.date, { weekday: "short", day: "2-digit" }) }));
  return (
    <Card>
      <CardHeader title="Attendance overview" description="Last 7 days by status" />
      <Legend className="px-4 pt-3 sm:px-5" items={STATUS_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
      <div className="h-56 px-2 pb-3 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} width={40} />
            <Tooltip cursor={{ fill: "var(--surface-sunken)" }} content={<ChartTooltip />} />
            {STATUS_SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={1} radius={i === STATUS_SERIES.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function ShiftDistribution({ data }: { data: Dashboard }) {
  return (
    <Card>
      <CardHeader title="Shift distribution" description="Today · required vs assigned vs present" />
      <Legend
        className="px-4 pt-3 sm:px-5"
        items={[
          { label: "Required", color: "var(--line-strong)" },
          { label: "Assigned", color: "var(--brand-blue)" },
          { label: "Present", color: "var(--st-present)" },
        ]}
      />
      <div className="h-56 px-2 pb-3 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.shiftDistribution} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} allowDecimals={false} width={40} />
            <Tooltip cursor={{ fill: "var(--surface-sunken)" }} content={<ChartTooltip />} />
            <Bar dataKey="required" name="Required" fill="var(--line-strong)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="filled" name="Assigned" fill="var(--brand-blue)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="present" name="Present" fill="var(--st-present)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function SiteWorkforce({ data }: { data: Dashboard }) {
  return (
    <Card>
      <CardHeader title="Site-wise workforce" description="Today" action={<Link href="/sites" className="text-[13px] font-medium text-primary-ink hover:underline">All sites</Link>} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line bg-surface-2 text-left text-xs text-muted">
              <th className="px-4 py-2 font-semibold sm:px-5">Site</th>
              <th className="px-2 py-2 text-right font-semibold">Staff</th>
              <th className="px-2 py-2 text-right font-semibold">Present</th>
              <th className="px-2 py-2 text-right font-semibold">Absent</th>
              <th className="px-2 py-2 text-right font-semibold">Leave</th>
              <th className="px-4 py-2 text-right font-semibold sm:px-5">Open</th>
            </tr>
          </thead>
          <tbody>
            {data.siteWorkforce.map((s) => (
              <tr key={s.siteId} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2.5 sm:px-5">
                  <Link href={`/sites/${s.siteId}`} className="font-medium text-fg hover:text-primary-ink">
                    {s.name}
                  </Link>
                  <SegmentBar
                    className="mt-1.5 max-w-48"
                    height={6}
                    segments={[
                      { label: "Present", value: s.present, color: "var(--st-present)" },
                      { label: "Leave", value: s.leave, color: "var(--st-leave)" },
                      { label: "Absent", value: s.absent, color: "var(--st-absent)" },
                    ]}
                  />
                </td>
                <td className="px-2 text-right tabular text-muted">{s.employees}</td>
                <td className="px-2 text-right font-semibold tabular">{s.present}</td>
                <td className={cn("px-2 text-right tabular", s.absent ? "font-semibold text-danger" : "text-muted")}>{s.absent}</td>
                <td className="px-2 text-right tabular text-muted">{s.leave}</td>
                <td className="px-4 text-right sm:px-5">{s.openPositions ? <Badge tone="danger">{s.openPositions}</Badge> : <span className="text-subtle">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RecentActivity({ data }: { data: Dashboard }) {
  return (
    <Card>
      <CardHeader title="Recent activity" description="Live from the audit trail" action={<Link href="/audit" className="text-[13px] font-medium text-primary-ink hover:underline">Audit log</Link>} />
      <ol className="mt-2 px-4 pb-3 sm:px-5">
        {data.recentActivity.slice(0, 9).map((a) => {
          const meta = ACTION_META[a.action] ?? { label: a.action.replace(/[._]/g, " "), icon: Activity, tone: "text-muted" };
          const { who, where } = activityText(a);
          return (
            <li key={a.id} className="relative flex gap-3 py-2 before:absolute before:bottom-0 before:left-[13px] before:top-9 before:w-px before:bg-line last:before:hidden">
              <span className={cn("relative grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface", meta.tone)}>
                <meta.icon className="size-3.5" />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[13px] text-fg">
                  <span className="font-semibold">{a.userName}</span> {meta.label}
                  <span className="text-muted">{who}</span>
                </p>
                <p className="truncate text-xs text-subtle">
                  {where && <>{where} · </>}
                  {relTime(a.createdAt)}
                </p>
              </div>
            </li>
          );
        })}
        {!data.recentActivity.length && <EmptyState title="No activity yet" className="py-6" />}
      </ol>
    </Card>
  );
}

function SupervisorHome({ data }: { data: Dashboard }) {
  const { me } = useSession();
  const live = data.shiftSlots.find((s) => s.inProgress) ?? data.shiftSlots.find((s) => !s.started) ?? data.shiftSlots[0];
  const k = data.kpis;
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="bg-navy px-5 py-4 text-white">
          <div className="text-xs text-white/60">Assigned site</div>
          <div className="mt-0.5 font-display text-lg font-bold">{me.sites.map((s) => s.name).join(", ")}</div>
          {live && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-white/[0.07] px-3 py-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50">{live.inProgress ? "Current shift" : "Next shift"}</div>
                <div className="font-semibold">
                  {live.shiftName} <span className="font-normal text-white/60 tabular">{live.start}–{live.end}</span>
                </div>
              </div>
              {live.inProgress && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[#5EEAD4]">
                  <span className="size-2 animate-pulse-dot rounded-full bg-[#5EEAD4]" /> Live
                </span>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 divide-x divide-line">
          {[
            { l: "Scheduled", v: k.rosteredToday },
            { l: "Present", v: k.present, c: "text-[color:var(--st-present)]" },
            { l: "Absent", v: k.absent, c: "text-danger" },
            { l: "Pending", v: k.notMarked, c: "text-warning" },
          ].map((x) => (
            <div key={x.l} className="px-2 py-3 text-center">
              <div className={cn("font-display text-2xl font-bold tabular", x.c)}>{x.v}</div>
              <div className="text-[11px] text-muted">{x.l}</div>
            </div>
          ))}
        </div>
        {live && (
          <div className="border-t border-line p-3">
            <LinkButton size="xl" className="w-full" href={`/attendance?site=${live.siteId}&shift=${live.shiftId}&date=${data.today}`}>
              <ClipboardCheck className="!size-5" /> Open {live.code} register
            </LinkButton>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Needs attention" />
        <div className="mt-2">
          <Attention data={data} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Today’s shifts" />
        <div className="mt-2">
          <ShiftBoard data={data} />
        </div>
      </Card>
      <WeekCard data={data} />
    </div>
  );
}

export default function OverviewPage() {
  const { me, siteId } = useSession();
  const now = useClock();
  const q = useQuery({ queryKey: ["dashboard", siteId], queryFn: () => api<Dashboard>("/dashboard", { query: { siteId } }), refetchInterval: 60_000 });
  const d = q.data;
  const k = d?.kpis;
  const counts = d?.overview.counts ?? {};
  const isSupervisor = me.user.role === "SUPERVISOR";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-muted">
            {now ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(now) : " "}
            {now && (
              <span className="ml-2 tabular text-subtle">
                {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(now)} IST
              </span>
            )}
          </p>
          <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight">
            {greeting(now)}, {me.user.fullName.split(" ")[0]}
          </h1>
        </div>
        {!isSupervisor && (
          <div className="flex gap-2">
            <LinkButton variant="outline" href="/reports">
              Reports
            </LinkButton>
            <LinkButton href="/attendance">
              <ClipboardCheck /> Mark attendance
            </LinkButton>
          </div>
        )}
      </div>

      {q.isError && !d && <EmptyState icon={AlertTriangle} title="Dashboard unavailable" description="Could not load live figures. Check your connection and try again." action={<Button onClick={() => q.refetch()}>Retry</Button>} />}

      {isSupervisor && d ? (
        <SupervisorHome data={d} />
      ) : (
        <div className="space-y-4">
          {/* Today's muster + KPI grid */}
          <Card className="overflow-hidden">
            <div className="grid lg:grid-cols-[340px_1fr]">
              <div className="border-b border-line p-5 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-fg">Today’s attendance</span>
                  {d && <span className="text-xs text-subtle">{fmtDate(d.today, { day: "2-digit", month: "short" })}</span>}
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-display text-5xl font-extrabold tracking-tight text-fg">{k ? <CountUp value={k.attendancePct} decimals={1} /> : <Skeleton className="inline-block h-12 w-28" />}</span>
                  <span className="text-xl font-semibold text-subtle">%</span>
                </div>
                <p className="mt-1 text-xs text-muted">of scheduled workers, excluding approved leave</p>
                <SegmentBar
                  className="mt-4"
                  segments={[
                    { label: "Present", value: (counts.PRESENT ?? 0) + (counts.INCOMPLETE ?? 0), color: "var(--st-present)" },
                    { label: "On duty", value: counts.ON_DUTY ?? 0, color: "var(--st-duty)" },
                    { label: "Half day", value: counts.HALF_DAY ?? 0, color: "var(--st-half)" },
                    { label: "Leave", value: counts.LEAVE ?? 0, color: "var(--st-leave)" },
                    { label: "Absent", value: counts.ABSENT ?? 0, color: "var(--st-absent)" },
                    { label: "Not marked", value: d?.overview.pending ?? 0, color: "var(--line-strong)" },
                  ]}
                />
                <Legend
                  className="mt-3"
                  items={[
                    { label: "Present", color: "var(--st-present)", value: (counts.PRESENT ?? 0) + (counts.INCOMPLETE ?? 0) },
                    { label: "On duty", color: "var(--st-duty)", value: counts.ON_DUTY ?? 0 },
                    { label: "Half day", color: "var(--st-half)", value: counts.HALF_DAY ?? 0 },
                    { label: "Leave", color: "var(--st-leave)", value: counts.LEAVE ?? 0 },
                    { label: "Absent", color: "var(--st-absent)", value: counts.ABSENT ?? 0 },
                    { label: "Not marked", color: "var(--line-strong)", value: d?.overview.pending ?? 0 },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 divide-line sm:grid-cols-3 xl:grid-cols-5 [&>*]:border-b [&>*]:border-r [&>*]:border-line">
                <Kpi loading={!k} icon={Users} label="Active employees" value={k?.activeEmployees} href="/employees" />
                <Kpi loading={!k} icon={UserCog} label="Supervisors" value={k?.supervisors} href="/supervisors" />
                <Kpi loading={!k} icon={UserCheck} label="Present today" value={k?.present} tone="text-[color:var(--st-present)]" />
                <Kpi loading={!k} icon={UserX} label="Absent today" value={k?.absent} tone={k?.absent ? "text-danger" : "text-fg"} />
                <Kpi loading={!k} icon={CalendarOff} label="On leave" value={k?.onLeave} />
                <Kpi loading={!k} icon={ShieldCheck} label="On duty now" value={k?.onDutyNow} tone="text-[color:var(--st-duty)]" hint="Checked in, shift running" />
                <Kpi loading={!k} icon={Users} label="Open positions" value={k?.openShifts} tone={k?.openShifts ? "text-danger" : "text-fg"} href="/shifts?tab=roster" hint="Required minus assigned" />
                <Kpi loading={!k} icon={Timer} label="Late check-ins" value={k?.lateCheckins} tone={k?.lateCheckins ? "text-warning" : "text-fg"} hint="Beyond grace period" />
                <Kpi loading={!k} icon={LogOut} label="Missing check-outs" value={k?.incompleteCheckouts} tone={k?.incompleteCheckouts ? "text-[color:var(--st-incomplete)]" : "text-fg"} />
                <Kpi loading={!k} icon={Hourglass} label="Not yet marked" value={k?.notMarked} tone={k?.notMarked ? "text-warning" : "text-fg"} hint={k ? `of ${k.rosteredToday} rostered` : undefined} />
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader title="Today’s shift board" description="Assigned and present against required strength · click a shift to open its register" />
              <div className="mt-3 border-t border-line">{d ? <ShiftBoard data={d} /> : <Skeleton className="m-5 h-40" />}</div>
            </Card>
            <Card>
              <CardHeader title="Attention required" />
              <div className="mt-2 border-t border-line">{d ? <Attention data={d} /> : <Skeleton className="m-5 h-40" />}</div>
            </Card>
          </div>

          {d && (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
                <TrendCard data={d} />
                <WeekCard data={d} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr]">
                <SiteWorkforce data={d} />
                <ShiftDistribution data={d} />
                <RecentActivity data={d} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
