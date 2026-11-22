"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronLeft, ClipboardCheck, MapPin, Pencil, Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { axisProps, ChartTooltip, gridProps, Meter } from "@/components/charts";
import { SiteDialog } from "@/components/site-dialog";
import { Button, LinkButton } from "@/components/ui/button";
import { Avatar, Badge, Card, CardHeader, EmptyState, Skeleton } from "@/components/ui/display";
import { Input, Select } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, relTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const KINDS = [
  ["SECURITY_GATE", "Security gate"],
  ["CONTROL_ROOM", "Control room"],
  ["TURBINE_AREA", "Wind turbine area"],
  ["SUBSTATION", "Substation"],
  ["DEPLOYMENT_POINT", "Deployment point"],
] as const;

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default function SiteDetailPage() {
  const id = useSearchParams().get("id") ?? "";
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["site", id], queryFn: () => api<any>(`/sites/${id}`) });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<any[]>("/projects"), enabled: can("sites.manage") });
  const [edit, setEdit] = useState(false);
  const [locName, setLocName] = useState("");
  const [locKind, setLocKind] = useState("DEPLOYMENT_POINT");
  const s = q.data;
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (!s) return <EmptyState icon={Building2} title="Site not found" action={<LinkButton href="/sites">Back to sites</LinkButton>} />;

  const addLocation = async () => {
    try {
      await api(`/sites/${id}/locations`, { body: { name: locName, kind: locKind } });
      setLocName("");
      toast.success("Deployment point added");
      qc.invalidateQueries({ queryKey: ["site", id] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const removeLocation = async (l: any) => {
    if ((await confirm({ title: `Remove ${l.name}?`, description: "Points with employees or roster history are deactivated instead of deleted.", danger: true, confirmLabel: "Remove" })) === false) return;
    try {
      const r = await api<any>(`/locations/${l.id}`, { method: "DELETE" });
      toast.success(r.deactivated ? "Deployment point deactivated (history kept)" : "Deployment point removed");
      qc.invalidateQueries({ queryKey: ["site", id] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const t = s.last30;
  return (
    <div>
      <Link href="/sites" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
        <ChevronLeft className="size-3.5" /> Sites
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted">{s.project?.name ?? "No project"}</div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {s.name} <span className="text-base font-semibold text-subtle">{s.code}</span>
          </h1>
          <p className="mt-1 flex items-center gap-1 text-[13px] text-muted">
            <MapPin className="size-3.5" />
            {[s.address, s.district, s.state].filter(Boolean).join(", ")} · {s.timezone}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton variant="outline" href={`/muster-roll?site=${id}`}>
            Muster roll
          </LinkButton>
          <LinkButton variant="outline" href={`/attendance?site=${id}`}>
            <ClipboardCheck /> Register
          </LinkButton>
          {can("sites.manage") && (
            <Button onClick={() => setEdit(true)}>
              <Pencil /> Edit site
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { l: "Active employees", v: s.activeEmployees },
          { l: "Attendance (30d)", v: t.attendancePct != null ? `${t.attendancePct}%` : "—" },
          { l: "Absences (30d)", v: t.absent, c: "text-danger" },
          { l: "Late arrivals (30d)", v: t.late, c: "text-warning" },
          { l: "Overtime (30d)", v: `${Math.round(t.overtimeMinutes / 60)} h` },
        ].map((x) => (
          <Card key={x.l} className="p-4">
            <div className="text-xs text-muted">{x.l}</div>
            <div className={cn("mt-1 font-display text-2xl font-bold tabular", x.c)}>{x.v}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Attendance — last 30 days" description="Daily attendance % at this site" />
          <div className="h-60 px-2 pb-3 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.trend.map((d: any) => ({ ...d, label: fmtDate(d.date, { day: "2-digit", month: "short" }) }))} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="siteFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} domain={[80, 100]} tickFormatter={(v) => `${v}%`} width={44} />
                <Tooltip content={<ChartTooltip format={(v: number) => `${v}%`} />} />
                <Area dataKey="pct" name="Attendance" type="monotone" stroke="var(--accent)" strokeWidth={2} fill="url(#siteFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Today by shift" description={fmtDate(s.today, { weekday: "long", day: "2-digit", month: "short" })} />
          <ul className="space-y-3 p-4 sm:px-5">
            {s.todayByShift.map((x: any) => {
              const sh = s.shifts.find((y: any) => y.id === x.shiftId);
              const present = (x.statuses.PRESENT ?? 0) + (x.statuses.ON_DUTY ?? 0) + (x.statuses.HALF_DAY ?? 0) + (x.statuses.INCOMPLETE ?? 0);
              return (
                <li key={x.shiftId}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="size-2.5 rounded-sm" style={{ background: sh?.color }} />
                      {x.name}
                      <span className="text-xs font-normal tabular text-subtle">
                        {sh && `${hhmm(sh.startMinute)}–${hhmm(sh.endMinute)}`}
                      </span>
                    </span>
                    <span className="tabular text-muted">
                      <b className="text-fg">{present}</b> present · {x.rostered}/{x.required} assigned
                    </span>
                  </div>
                  <Meter className="mt-1.5" value={present} max={Math.max(x.required, x.rostered)} color={x.rostered < x.required ? "var(--st-absent)" : "var(--st-present)"} />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Deployment points" description="Security gate, control room, turbine areas, substation" />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {s.locations.map((l: any) => (
              <li key={l.id} className={cn("flex items-center gap-3 px-4 py-2.5 sm:px-5", !l.isActive && "opacity-50")}>
                <Building2 className="size-4 text-subtle" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{l.name}</div>
                  <div className="text-xs text-muted">
                    {KINDS.find((k) => k[0] === l.kind)?.[1] ?? l.kind} · {l._count.employees} employees{!l.isActive && " · inactive"}
                  </div>
                </div>
                {can("sites.manage") && l.isActive && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${l.name}`} onClick={() => removeLocation(l)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {can("sites.manage") && (
            <div className="flex gap-2 border-t border-line p-3">
              <Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="New point, e.g. WTG Cluster C" aria-label="New deployment point name" />
              <Select value={locKind} onChange={(e) => setLocKind(e.target.value)} wrapperClassName="w-40 shrink-0" aria-label="Kind">
                {KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
              <Button size="icon" aria-label="Add deployment point" disabled={locName.trim().length < 2} onClick={addLocation}>
                <Plus />
              </Button>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Supervisors" action={can("users.manage") && <LinkButton size="sm" variant="outline" href="/supervisors">Manage</LinkButton>} />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {s.supervisors.map((a: any) => (
              <li key={a.user.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <Avatar name={a.user.fullName} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">
                    {a.user.fullName} {a.isPrimary && <Badge tone="navy">primary</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    {a.user.phone ?? a.user.email} · last sign-in {relTime(a.user.lastLoginAt)}
                  </div>
                </div>
              </li>
            ))}
            {!s.supervisors.length && <EmptyState icon={Users} title="No supervisor assigned" className="py-6" />}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Active shifts" action={<LinkButton size="sm" variant="outline" href="/shifts">Configure</LinkButton>} />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {s.shifts.map((sh: any) => (
              <li key={sh.id} className={cn("flex items-center gap-3 px-4 py-2.5 text-[13px] sm:px-5", !sh.isActive && "opacity-50")}>
                <span className="size-2.5 rounded-sm" style={{ background: sh.color }} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{sh.name}</div>
                  <div className="text-xs text-muted">
                    {hhmm(sh.startMinute)}–{hhmm(sh.endMinute)} · {sh.requiredWorkers} required · {sh.supervisor?.fullName ?? "no supervisor"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <SiteDialog open={edit} onOpenChange={setEdit} projects={projects.data ?? []} site={s} />
    </div>
  );
}
