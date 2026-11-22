"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, FolderPlus, MapPin, Plus, Users, Wind } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { axisProps, ChartTooltip, gridProps, SegmentBar } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui/display";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import { addDaysISO, todayISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import { SiteDialog } from "@/components/site-dialog";

interface SiteRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  state: string | null;
  district: string | null;
  timezone: string;
  isActive: boolean;
  project: { id: string; name: string; code: string } | null;
  supervisors: { user: { id: string; fullName: string; isActive: boolean } }[];
  shifts: { id: string; name: string; code: string; requiredWorkers: number; color: string }[];
  locations: { id: string; name: string; kind: string; isActive: boolean }[];
  activeEmployees: number;
  requiredPerDay: number;
  todayStats: Record<string, number> & { rostered: number; today: string };
}

export default function SitesPage() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ["sites"], queryFn: () => api<SiteRow[]>("/sites") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<any[]>("/projects") });
  const [siteOpen, setSiteOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const groups = new Map<string, { project: SiteRow["project"]; sites: SiteRow[] }>();
  for (const s of q.data ?? []) {
    const k = s.project?.id ?? "none";
    if (!groups.has(k)) groups.set(k, { project: s.project, sites: [] });
    groups.get(k)!.sites.push(s);
  }

  return (
    <div>
      <PageHeader
        title="Site management"
        description="Company → project → site → deployment points. Each site keeps its own timezone, shifts, supervisors and workforce."
        actions={
          can("sites.manage") && (
            <>
              <Button variant="outline" onClick={() => setProjectOpen(true)}>
                <FolderPlus /> New project
              </Button>
              <Button onClick={() => setSiteOpen(true)}>
                <Plus /> New site
              </Button>
            </>
          )
        }
      />
      {q.isLoading && <Skeleton className="h-64" />}
      <div className="space-y-6">
        {[...groups.values()].map((g) => (
          <section key={g.project?.id ?? "none"}>
            <div className="mb-2 flex items-center gap-2">
              <Wind className="size-4 text-accent" />
              <h2 className="font-display text-[15px] font-semibold">{g.project?.name ?? "Sites without a project"}</h2>
              {g.project && <Badge>{g.project.code}</Badge>}
              <span className="text-xs text-muted">· {g.sites.length} site{g.sites.length > 1 ? "s" : ""}</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {g.sites.map((s) => {
                const t = s.todayStats;
                const present = (t.PRESENT ?? 0) + (t.ON_DUTY ?? 0) + (t.HALF_DAY ?? 0) + (t.INCOMPLETE ?? 0);
                return (
                  <Link key={s.id} href={`/sites/view?id=${s.id}`} className="group block">
                    <Card className="h-full p-4 transition-[border-color,box-shadow] group-hover:border-line-strong group-hover:shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-base font-semibold">{s.name}</span>
                            {!s.isActive && <Badge>inactive</Badge>}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                            <MapPin className="size-3" />
                            {[s.district, s.state].filter(Boolean).join(", ") || "—"} · {s.code}
                          </div>
                        </div>
                        <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-md bg-surface-2 py-2">
                          <div className="font-display text-lg font-bold tabular">{s.activeEmployees}</div>
                          <div className="text-[11px] text-muted">Employees</div>
                        </div>
                        <div className="rounded-md bg-surface-2 py-2">
                          <div className="font-display text-lg font-bold tabular">
                            {present}
                            <span className="text-sm font-medium text-subtle">/{t.rostered}</span>
                          </div>
                          <div className="text-[11px] text-muted">Present today</div>
                        </div>
                        <div className="rounded-md bg-surface-2 py-2">
                          <div className="font-display text-lg font-bold tabular">{s.requiredPerDay}</div>
                          <div className="text-[11px] text-muted">Positions / day</div>
                        </div>
                      </div>
                      <SegmentBar
                        className="mt-3"
                        height={6}
                        segments={[
                          { label: "Present", value: present, color: "var(--st-present)" },
                          { label: "Leave", value: t.LEAVE ?? 0, color: "var(--st-leave)" },
                          { label: "Absent", value: t.ABSENT ?? 0, color: "var(--st-absent)" },
                          { label: "Not marked", value: Math.max(0, t.rostered - present - (t.LEAVE ?? 0) - (t.ABSENT ?? 0)), color: "var(--line-strong)" },
                        ]}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3.5" /> {s.supervisors.map((x) => x.user.fullName).join(", ") || <span className="text-danger">No supervisor</span>}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="size-3.5" /> {s.locations.filter((l) => l.isActive).length} deployment points
                        </span>
                        <span className="flex gap-1">
                          {s.shifts.map((sh) => (
                            <span key={sh.id} className="rounded px-1 text-[10.5px] font-semibold text-white" style={{ background: sh.color }}>
                              {sh.code}
                            </span>
                          ))}
                        </span>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
        {q.data && !q.data.length && (
          <Card>
            <EmptyState icon={Building2} title="No sites yet" description="Create your first site — default First, Second and Third shifts are added automatically." action={can("sites.manage") ? <Button onClick={() => setSiteOpen(true)}>New site</Button> : undefined} />
          </Card>
        )}
      </div>
      {(q.data?.length ?? 0) > 1 && <CompareSites />}
      <SiteDialog open={siteOpen} onOpenChange={setSiteOpen} projects={projects.data ?? []} />
      <ProjectDialog open={projectOpen} onOpenChange={setProjectOpen} />
    </div>
  );
}

function CompareSites() {
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const to = todayISO();
  const from = addDaysISO(to, -(Number(range) - 1));
  const q = useQuery({ queryKey: ["compare", from, to], queryFn: () => api<any[]>("/sites/compare", { query: { from, to } }) });
  const data = (q.data ?? []).map((s) => ({ ...s, label: s.name.replace(/ (Wind Farm|Wind Park|Substation)$/, "") }));
  return (
    <Card className="mt-6">
      <CardHeader
        title="Compare sites"
        description="Attendance %, absences and late arrivals across sites"
        action={
          <Segmented
            ariaLabel="Comparison period"
            value={range}
            onChange={setRange}
            items={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
            ]}
          />
        }
      />
      <div className="grid gap-4 p-4 sm:px-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="label" {...axisProps} width={96} />
              <Tooltip cursor={{ fill: "var(--surface-sunken)" }} content={<ChartTooltip format={(v: number) => `${v}%`} />} />
              <Bar dataKey="attendancePct" name="Attendance" fill="var(--brand-blue)" radius={[0, 4, 4, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-semibold">Site</th>
                <th className="py-2 text-right font-semibold">Att. %</th>
                <th className="py-2 text-right font-semibold">Present</th>
                <th className="py-2 text-right font-semibold">Absent</th>
                <th className="py-2 text-right font-semibold">Leave</th>
                <th className="py-2 text-right font-semibold">Late</th>
                <th className="py-2 text-right font-semibold">OT hrs</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="py-2 font-medium">{s.name}</td>
                  <td className="py-2 text-right font-semibold tabular">{s.attendancePct ?? "—"}%</td>
                  <td className="py-2 text-right tabular">{s.present}</td>
                  <td className="py-2 text-right tabular text-danger">{s.absent}</td>
                  <td className="py-2 text-right tabular">{s.leave}</td>
                  <td className="py-2 text-right tabular text-warning">{s.late}</td>
                  <td className="py-2 text-right tabular">{Math.round(s.overtimeMinutes / 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function ProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mw, setMw] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api("/projects", { body: { name, code, capacityMw: mw ? Number(mw) : null, description: desc || null } });
      toast.success("Project created");
      qc.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
      setName("");
      setCode("");
      setMw("");
      setDesc("");
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
      title="New wind-energy project"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={name.length < 2 || code.length < 2}>
            Create project
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Project name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kutch Wind Cluster – Phase III" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KWC3" />
          </Field>
          <Field label="Capacity (MW)">
            <Input type="number" value={mw} onChange={(e) => setMw(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
