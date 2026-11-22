"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wand2,
  ClipboardList,
  Moon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, Tabs } from "@/components/ui/display";
import { Checkbox, Field, Input, SearchInput, Select, Switch, Textarea } from "@/components/ui/field";
import { Dialog, Sheet, useConfirm } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import { addDaysISO, DAYS, fmtDate, fmtDateTime, relTime, todayISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type Tab = "shifts" | "roster" | "handover";

export default function ShiftsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") as Tab) || "shifts";
  return (
    <div>
      <PageHeader title="Shift management" description="Configure shifts per site, build the daily roster and record supervisor handovers." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => router.replace(`/shifts?tab=${v}`, { scroll: false })}
        items={[
          { value: "shifts", label: "Shifts" },
          { value: "roster", label: "Roster" },
          { value: "handover", label: "Shift handover" },
        ]}
      />
      {tab === "shifts" && <ShiftsTab />}
      {tab === "roster" && <RosterTab />}
      {tab === "handover" && <HandoverTab />}
    </div>
  );
}

// ─────────────────────────────── Shifts ───────────────────────────────

interface Shift {
  id: string;
  siteId: string;
  site: { name: string; code: string };
  name: string;
  code: string;
  start: string;
  end: string;
  startMinute: number;
  endMinute: number;
  overnight: boolean;
  breakMinutes: number;
  graceMinutes: number;
  requiredWorkers: number;
  supervisor: { id: string; fullName: string } | null;
  activeDays: number[];
  color: string;
  isActive: boolean;
  assignedEmployees: number;
}

function useLookups() {
  return useQuery({ queryKey: ["lookups"], queryFn: () => api<any>("/lookups"), staleTime: 300_000 });
}

/** 24-hour timeline from 00:00 with the shift drawn as one or two segments (overnight). */
function ShiftTimeline({ shifts }: { shifts: Shift[] }) {
  return (
    <div className="relative">
      <div className="relative h-auto rounded-md border border-line bg-surface-2">
        <div className="pointer-events-none absolute inset-0 flex">
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className={cn("flex-1 border-l border-line/70", h === 0 && "border-l-0", h % 6 === 0 && h > 0 && "border-line-strong")} />
          ))}
        </div>
        <div className="relative space-y-1.5 py-2">
          {shifts.map((s) => {
            const segs = s.overnight
              ? [
                  [s.startMinute, 1440],
                  [0, s.endMinute],
                ]
              : [[s.startMinute, s.endMinute]];
            return (
              <div key={s.id} className="relative h-6">
                {segs.map(([a, b], i) => (
                  <div
                    key={i}
                    className={cn("absolute top-0 flex h-6 items-center overflow-hidden rounded px-2 text-[11px] font-semibold text-white", !s.isActive && "opacity-40")}
                    style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%`, background: s.color }}
                    title={`${s.name} ${s.start}–${s.end}`}
                  >
                    {i === 0 && <span className="truncate">{s.code}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between px-0.5 text-[10.5px] tabular text-subtle">
        {["00:00", "06:00", "12:00", "18:00", "24:00"].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const shiftForm = z.object({
  siteId: z.string().min(1, "Choose a site"),
  name: z.string().trim().min(2, "Name is required"),
  code: z.string().trim().min(1, "Code is required").max(12),
  start: z.string().regex(hhmm, "HH:MM"),
  end: z.string().regex(hhmm, "HH:MM"),
  breakMinutes: z.coerce.number().int().min(0).max(180),
  graceMinutes: z.coerce.number().int().min(0).max(120),
  requiredWorkers: z.coerce.number().int().min(0).max(500),
  supervisorId: z.string().optional(),
  color: z.string(),
  isActive: z.boolean(),
  activeDays: z.array(z.number()).min(1, "Pick at least one day"),
});
type ShiftForm = z.infer<typeof shiftForm>;

function ShiftDialog({ open, onOpenChange, shift, defaultSite }: { open: boolean; onOpenChange: (o: boolean) => void; shift: Shift | null; defaultSite: string }) {
  const qc = useQueryClient();
  const lookups = useLookups();
  const { me } = useSession();
  const form = useForm<z.input<typeof shiftForm>, unknown, ShiftForm>({ resolver: zodResolver(shiftForm) });
  useEffect(() => {
    if (!open) return;
    form.reset(
      shift
        ? { siteId: shift.siteId, name: shift.name, code: shift.code, start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes, graceMinutes: shift.graceMinutes, requiredWorkers: shift.requiredWorkers, supervisorId: shift.supervisor?.id ?? "", color: shift.color, isActive: shift.isActive, activeDays: shift.activeDays }
        : { siteId: defaultSite || me.sites[0]?.id || "", name: "", code: "", start: "06:00", end: "14:00", breakMinutes: 30, graceMinutes: 10, requiredWorkers: 4, supervisorId: "", color: "#2A78D6", isActive: true, activeDays: [0, 1, 2, 3, 4, 5, 6] },
    );
  }, [open, shift, defaultSite, me.sites, form]);
  const days = (form.watch("activeDays") ?? []) as number[];
  const start = form.watch("start");
  const end = form.watch("end");
  const overnight = !!start && !!end && end <= start;
  const siteId = form.watch("siteId");
  const sups = (lookups.data?.supervisors ?? []).filter((s: any) => !siteId || s.siteIds.includes(siteId));
  const submit = form.handleSubmit(async (v) => {
    try {
      const body = { ...v, supervisorId: v.supervisorId || null };
      if (shift) await api(`/shifts/${shift.id}`, { method: "PATCH", body: { ...body, siteId: undefined } });
      else await api("/shifts", { body });
      toast.success(shift ? "Shift updated" : "Shift created");
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  const err = form.formState.errors;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={shift ? `Edit ${shift.name}` : "New shift"}
      description="Times are local to the site. An end time earlier than the start means the shift finishes the next day."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={form.formState.isSubmitting}>
            {shift ? "Save changes" : "Create shift"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-6">
        <Field label="Site" required error={err.siteId?.message} className="sm:col-span-3">
          <Select {...form.register("siteId")} disabled={!!shift}>
            {me.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Shift name" required error={err.name?.message} className="sm:col-span-2">
          <Input {...form.register("name")} placeholder="Fourth Shift" />
        </Field>
        <Field label="Code" required error={err.code?.message}>
          <Input {...form.register("code")} placeholder="S4" className="uppercase" />
        </Field>
        <Field label="Start" required error={err.start?.message} className="sm:col-span-2">
          <Input type="time" {...form.register("start")} />
        </Field>
        <Field label="End" required error={err.end?.message} hint={overnight ? "Ends the next day (overnight)" : undefined} className="sm:col-span-2">
          <Input type="time" {...form.register("end")} />
        </Field>
        <Field label="Break (min)" error={err.breakMinutes?.message}>
          <Input type="number" min={0} {...form.register("breakMinutes")} />
        </Field>
        <Field label="Grace (min)" error={err.graceMinutes?.message} hint="Late after this">
          <Input type="number" min={0} {...form.register("graceMinutes")} />
        </Field>
        <Field label="Required workers" error={err.requiredWorkers?.message} className="sm:col-span-2">
          <Input type="number" min={0} {...form.register("requiredWorkers")} />
        </Field>
        <Field label="Assigned supervisor" className="sm:col-span-3">
          <Select {...form.register("supervisorId")}>
            <option value="">— none —</option>
            {sups.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Colour">
          <Input type="color" {...form.register("color")} className="h-9 p-1" />
        </Field>
        <Field label="Active days" error={err.activeDays?.message} className="sm:col-span-6">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => form.setValue("activeDays", on ? days.filter((x) => x !== i) : [...days, i].sort(), { shouldValidate: true })}
                  className={cn("h-8 w-12 rounded-md border text-[13px] font-medium", on ? "border-primary bg-primary-soft text-primary-ink" : "border-line-strong text-muted")}
                  aria-pressed={on}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="flex items-center gap-2 sm:col-span-6">
          <Switch checked={!!form.watch("isActive")} onChange={(v) => form.setValue("isActive", v)} id="shift-active" />
          <label htmlFor="shift-active" className="text-[13px]">
            Shift is active
          </label>
        </div>
      </form>
    </Dialog>
  );
}

function ShiftsTab() {
  const { can, siteId } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shifts", siteId], queryFn: () => api<Shift[]>("/shifts", { query: { siteId } }) });
  const { me } = useSession();
  const [edit, setEdit] = useState<Shift | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogSite, setDialogSite] = useState("");
  const bySite = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of me.sites) if (!siteId || s.id === siteId) m.set(s.id, []);
    for (const s of q.data ?? []) m.set(s.siteId, [...(m.get(s.siteId) ?? []), s]);
    return [...m.entries()];
  }, [q.data, me.sites, siteId]);
  const defaults = async (sid: string) => {
    try {
      const r = await api<{ created: number }>("/shifts/defaults", { body: { siteId: sid } });
      toast.success(r.created ? `Created ${r.created} default shifts` : "Default shifts already exist");
      qc.invalidateQueries({ queryKey: ["shifts"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (q.isLoading) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      {bySite.map(([sid, shifts]) => {
        const site = me.sites.find((s) => s.id === sid);
        return (
          <Card key={sid}>
            <CardHeader
              title={site?.name ?? shifts[0]?.site.name}
              description={`${shifts.filter((s) => s.isActive).length} active shifts · ${shifts.reduce((a, s) => a + (s.isActive ? s.requiredWorkers : 0), 0)} positions per day`}
              action={
                can("shifts.manage") && (
                  <>
                    {shifts.length === 0 && (
                      <Button variant="outline" size="sm" onClick={() => defaults(sid)}>
                        <Sparkles /> Create 3 default shifts
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        setEdit(null);
                        setDialogSite(sid);
                        setOpen(true);
                      }}
                    >
                      <Plus /> Add shift
                    </Button>
                  </>
                )
              }
            />
            {shifts.length ? (
              <>
                <div className="px-4 pt-4 sm:px-5">
                  <ShiftTimeline shifts={shifts} />
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="border-y border-line bg-surface-2 text-left text-xs text-muted">
                        <th className="px-5 py-2 font-semibold">Shift</th>
                        <th className="px-3 py-2 font-semibold">Timing</th>
                        <th className="px-3 py-2 text-right font-semibold">Break</th>
                        <th className="px-3 py-2 text-right font-semibold">Grace</th>
                        <th className="px-3 py-2 text-right font-semibold">Required</th>
                        <th className="px-3 py-2 text-right font-semibold">Default staff</th>
                        <th className="px-3 py-2 font-semibold">Supervisor</th>
                        <th className="px-3 py-2 font-semibold">Active days</th>
                        <th className="px-5 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {shifts.map((s) => (
                        <tr key={s.id} className={cn("border-b border-line last:border-0 hover:bg-surface-2", !s.isActive && "opacity-55")}>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                              <span className="font-medium">{s.name}</span>
                              <Badge>{s.code}</Badge>
                              {!s.isActive && <Badge tone="neutral">inactive</Badge>}
                            </div>
                          </td>
                          <td className="px-3 tabular">
                            {s.start}–{s.end}
                            {s.overnight && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-muted">
                                <Moon className="size-3" /> next day
                              </span>
                            )}
                          </td>
                          <td className="px-3 text-right tabular text-muted">{s.breakMinutes}m</td>
                          <td className="px-3 text-right tabular text-muted">{s.graceMinutes}m</td>
                          <td className="px-3 text-right font-semibold tabular">{s.requiredWorkers}</td>
                          <td className={cn("px-3 text-right tabular", s.assignedEmployees < s.requiredWorkers ? "font-semibold text-danger" : "text-muted")}>{s.assignedEmployees}</td>
                          <td className="px-3 text-[13px]">{s.supervisor?.fullName ?? <span className="text-subtle">—</span>}</td>
                          <td className="px-3">
                            <div className="flex gap-0.5">
                              {DAYS.map((d, i) => (
                                <span key={d} className={cn("grid size-5 place-items-center rounded text-[10px] font-semibold", s.activeDays.includes(i) ? "bg-primary-soft text-primary-ink" : "bg-sunken text-subtle")}>
                                  {d[0]}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 text-right">
                            {can("shifts.manage") && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Edit ${s.name}`}
                                onClick={() => {
                                  setEdit(s);
                                  setOpen(true);
                                }}
                              >
                                <Pencil />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState icon={CalendarClock} title="No shifts at this site" description="Start with the standard 06:00 / 14:00 / 22:00 three-shift pattern, then adjust." />
            )}
          </Card>
        );
      })}
      <ShiftDialog open={open} onOpenChange={setOpen} shift={edit} defaultSite={dialogSite} />
    </div>
  );
}

// ─────────────────────────────── Roster ───────────────────────────────

interface Roster {
  site: { id: string; name: string; timezone: string };
  today: string;
  days: string[];
  shifts: { id: string; name: string; code: string; start: string; end: string; color: string; requiredWorkers: number }[];
  entries: { id: string; date: string; shiftId: string; employeeId: string; employeeCode: string; fullName: string; designation: string | null; location: string | null; overlap: boolean }[];
  cells: { date: string; shiftId: string; assigned: number; required: number; understaffed: boolean }[];
}

function mondayOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDaysISO(day, -dow);
}

function RosterTab() {
  const { me, can, siteId: globalSite } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [site, setSite] = useState(globalSite || me.sites[0]?.id || "");
  const [week, setWeek] = useState(() => mondayOf(todayISO()));
  const [cell, setCell] = useState<{ date: string; shiftId: string } | null>(null);
  const to = addDaysISO(week, 6);
  const q = useQuery({ queryKey: ["roster", site, week], queryFn: () => api<Roster>("/roster", { query: { siteId: site, from: week, to } }), enabled: !!site, placeholderData: keepPreviousData });
  const manage = can("roster.manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["roster"] });

  const run = async (label: string, path: string, body: unknown) => {
    try {
      const r = await api<any>(path, { body });
      toast.success(`${label}: ${r.created} assignment(s) created${r.skipped ? `, ${r.skipped} already existed` : ""}`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const data = q.data;
  const overlaps = data?.entries.filter((e) => e.overlap).length ?? 0;
  const understaffed = data?.cells.filter((c) => c.understaffed).length ?? 0;
  const open = data?.cells.reduce((a, c) => a + Math.max(0, c.required - c.assigned), 0) ?? 0;

  return (
    <div>
      <Card className="mb-3 flex flex-wrap items-center gap-2 p-3">
        <Select aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} wrapperClassName="w-56">
          {me.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setWeek(addDaysISO(week, -7))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-44 text-center text-[13px] font-medium tabular">
            {fmtDate(week, { day: "2-digit", month: "short" })} – {fmtDate(to, { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setWeek(addDaysISO(week, 7))}>
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeek(mondayOf(todayISO()))}>
            This week
          </Button>
        </div>
        {manage && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if ((await confirm({ title: "Generate roster from default shifts?", description: "Fills this week using each employee's default shift and weekly off. Existing assignments are kept.", confirmLabel: "Generate" })) !== false)
                  run("Generated", "/roster/generate", { siteId: site, from: week, to });
              }}
            >
              <Wand2 /> Generate week
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if ((await confirm({ title: "Duplicate this week into next week?", description: "Copies every assignment to the same weekday next week. Existing assignments are kept.", confirmLabel: "Duplicate" })) !== false)
                  run("Duplicated", "/roster/copy", { siteId: site, sourceFrom: week, targetFrom: addDaysISO(week, 7), days: 7 });
              }}
            >
              <Copy /> Duplicate to next week
            </Button>
          </div>
        )}
      </Card>

      <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
        <Badge tone={open ? "danger" : "success"}>{open} unassigned positions</Badge>
        <Badge tone={understaffed ? "warning" : "neutral"}>{understaffed} understaffed shifts</Badge>
        <Badge tone={overlaps ? "danger" : "neutral"}>{overlaps} overlapping assignments</Badge>
      </div>

      <Card className="overflow-hidden">
        {!data ? (
          <Skeleton className="m-4 h-72" />
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[2] w-40 border-b border-r border-line bg-surface-2 px-4 py-2 text-left text-xs font-semibold text-muted">Shift</th>
                  {data.days.map((d) => (
                    <th key={d} className={cn("border-b border-line bg-surface-2 px-2 py-2 text-left text-xs font-semibold", d === data.today ? "text-primary-ink" : "text-muted")}>
                      <div className="flex items-center justify-between">
                        <span>{fmtDate(d, { weekday: "short", day: "2-digit" })}</span>
                        {manage && d !== data.days[0] && (
                          <button
                            type="button"
                            className="rounded p-0.5 text-subtle hover:bg-sunken hover:text-fg"
                            title="Copy previous day's roster here"
                            aria-label={`Copy previous day's roster to ${d}`}
                            onClick={() => run("Copied previous day", "/roster/copy", { siteId: site, sourceFrom: addDaysISO(d, -1), targetFrom: d, days: 1 })}
                          >
                            <Copy className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.shifts.map((s) => (
                  <tr key={s.id}>
                    <td className="sticky left-0 z-[1] border-b border-r border-line bg-surface px-4 py-3 align-top">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                        {s.name}
                      </div>
                      <div className="mt-0.5 text-xs tabular text-muted">
                        {s.start}–{s.end} · need {s.requiredWorkers}
                      </div>
                    </td>
                    {data.days.map((d) => {
                      const c = data.cells.find((x) => x.date === d && x.shiftId === s.id)!;
                      const people = data.entries.filter((e) => e.date === d && e.shiftId === s.id);
                      const hasOverlap = people.some((p) => p.overlap);
                      return (
                        <td key={d} className={cn("border-b border-line p-1.5 align-top", d === data.today && "bg-primary-soft/30")}>
                          <button
                            type="button"
                            onClick={() => setCell({ date: d, shiftId: s.id })}
                            className={cn(
                              "block h-full min-h-24 w-full rounded-md border p-2 text-left transition-colors hover:border-line-strong hover:bg-surface-2",
                              c.understaffed ? "border-danger/40 bg-danger-soft/40" : "border-line",
                            )}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className={cn("font-semibold tabular", c.understaffed ? "text-danger" : "text-fg")}>
                                {c.assigned}/{c.required}
                              </span>
                              {hasOverlap && <AlertTriangle className="size-3.5 text-danger" aria-label="Overlapping assignment" />}
                            </div>
                            <ul className="mt-1.5 space-y-0.5">
                              {people.slice(0, 4).map((p) => (
                                <li key={p.id} className={cn("truncate text-[11.5px]", p.overlap ? "font-semibold text-danger" : "text-muted")}>
                                  {p.fullName}
                                </li>
                              ))}
                              {people.length > 4 && <li className="text-[11px] text-subtle">+{people.length - 4} more</li>}
                            </ul>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && <RosterCellSheet roster={data} cell={cell} onClose={() => setCell(null)} onChanged={refresh} manage={manage} />}
    </div>
  );
}

function RosterCellSheet({ roster, cell, onClose, onChanged, manage }: { roster: Roster; cell: { date: string; shiftId: string } | null; onClose: () => void; onChanged: () => void; manage: boolean }) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const shift = roster.shifts.find((s) => s.id === cell?.shiftId);
  const people = roster.entries.filter((e) => e.date === cell?.date && e.shiftId === cell?.shiftId);
  const assignedToday = new Set(roster.entries.filter((e) => e.date === cell?.date).map((e) => e.employeeId));
  const emps = useQuery({
    queryKey: ["employees", "roster-pick", roster.site.id],
    queryFn: () => api<{ items: { id: string; employeeCode: string; fullName: string; designation: { name: string } | null; defaultShift: { code: string } | null }[] }>("/employees", { query: { siteId: roster.site.id, status: "ACTIVE", pageSize: 500 } }),
    enabled: adding,
  });
  useEffect(() => {
    setAdding(false);
    setPick(new Set());
    setSearch("");
  }, [cell]);
  const available = (emps.data?.items ?? []).filter((e) => !people.some((p) => p.employeeId === e.id) && `${e.fullName} ${e.employeeCode}`.toLowerCase().includes(search.toLowerCase()));

  const remove = async (id: string) => {
    try {
      await api(`/roster/${id}`, { method: "DELETE" });
      toast.success("Removed from roster");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const move = async (id: string, shiftId: string) => {
    try {
      await api(`/roster/${id}`, { method: "PATCH", body: { shiftId } });
      toast.success("Shift changed");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const add = async () => {
    try {
      const r = await api<{ created: number }>("/roster", { body: { siteId: roster.site.id, shiftId: cell!.shiftId, workDate: cell!.date, employeeIds: [...pick] } });
      toast.success(`${r.created} employee(s) assigned`);
      setAdding(false);
      setPick(new Set());
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Sheet
      open={!!cell}
      onOpenChange={(o) => !o && onClose()}
      title={shift ? `${shift.name} · ${fmtDate(cell!.date, { weekday: "long", day: "2-digit", month: "short" })}` : ""}
      description={shift ? `${roster.site.name} · ${shift.start}–${shift.end} · ${people.length} of ${shift.requiredWorkers} required` : undefined}
      footer={
        manage && adding ? (
          <>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={add} disabled={!pick.size}>
              <UserPlus /> Assign {pick.size || ""}
            </Button>
          </>
        ) : manage ? (
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> Assign employees
          </Button>
        ) : undefined
      }
    >
      {!adding ? (
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
              <Avatar name={p.fullName} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{p.fullName}</div>
                <div className="text-xs text-muted">
                  {p.employeeCode} · {p.designation ?? "—"}
                  {p.overlap && <span className="ml-1 font-semibold text-danger">· overlaps another shift</span>}
                </div>
              </div>
              {manage && (
                <>
                  <select
                    aria-label={`Move ${p.fullName} to another shift`}
                    className="h-8 rounded-md border border-line-strong bg-surface px-1.5 text-xs"
                    value={p.shiftId}
                    onChange={(e) => move(p.id, e.target.value)}
                  >
                    {roster.shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code}
                      </option>
                    ))}
                  </select>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${p.fullName}`} onClick={() => remove(p.id)}>
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
          {!people.length && <EmptyState icon={Users} title="Nobody assigned" description="This position is unfilled." />}
        </ul>
      ) : (
        <div className="p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Search site employees" />
          <ul className="mt-3 divide-y divide-line rounded-md border border-line">
            {emps.isLoading && <li className="p-4"><Skeleton className="h-6" /></li>}
            {available.map((e) => {
              const busy = assignedToday.has(e.id);
              return (
                <li key={e.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                    <Checkbox checked={pick.has(e.id)} onChange={(ev) => setPick((s) => { const n = new Set(s); ev.target.checked ? n.add(e.id) : n.delete(e.id); return n; })} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{e.fullName}</div>
                      <div className="text-xs text-muted">
                        {e.employeeCode} · {e.designation?.name ?? "—"} · default {e.defaultShift?.code ?? "—"}
                      </div>
                    </div>
                    {busy && <Badge tone="warning">on another shift</Badge>}
                  </label>
                </li>
              );
            })}
            {emps.data && !available.length && <li className="p-4 text-center text-[13px] text-muted">No more employees at this site.</li>}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

// ─────────────────────────────── Handover ───────────────────────────────

interface Handover {
  id: string;
  site: { name: string };
  shift: { name: string; code: string };
  workDate: string;
  outgoingSupervisorId: string;
  outgoingName: string;
  incomingSupervisorId: string | null;
  incomingName: string | null;
  handoverAt: string;
  presentCount: number;
  presentEmployees: { code: string; name: string; status: string }[];
  missingEmployees: { code: string; name: string; status: string }[];
  remarks: string | null;
  pendingIssues: string | null;
  status: "PENDING" | "CONFIRMED";
  confirmedAt: string | null;
}

function HandoverTab() {
  const { me, can, siteId } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["handovers", siteId], queryFn: () => api<Handover[]>("/handovers", { query: { siteId } }) });
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Handover | null>(null);
  const confirmHandover = async (h: Handover) => {
    try {
      await api(`/handovers/${h.id}/confirm`, { method: "POST" });
      toast.success("Handover confirmed");
      qc.invalidateQueries({ queryKey: ["handovers"] });
      setDetail(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div>
      <div className="mb-3 flex justify-end">
        {can("handover.write") && (
          <Button onClick={() => setOpen(true)}>
            <ClipboardList /> Record handover
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {q.isLoading && <Skeleton className="m-4 h-40" />}
          {q.data?.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => setDetail(h)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 sm:px-5">
                <div className="grid size-9 place-items-center rounded-md bg-sunken text-muted">
                  <ArrowLeftRight className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium">
                    {h.outgoingName} <span className="text-muted">→</span> {h.incomingName ?? <span className="text-muted">any incoming supervisor</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {h.site.name} · {h.shift.name} · {fmtDate(h.workDate)} · {fmtDateTime(h.handoverAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="tabular">
                    <b>{h.presentCount}</b> present · <b className={h.missingEmployees.length ? "text-danger" : ""}>{h.missingEmployees.length}</b> missing
                  </span>
                  <Badge tone={h.status === "CONFIRMED" ? "success" : "warning"}>{h.status.toLowerCase()}</Badge>
                </div>
              </button>
            </li>
          ))}
        </ul>
        {q.data && !q.data.length && <EmptyState icon={ArrowLeftRight} title="No handovers recorded" description="Outgoing supervisors record who was present, who was missing and any pending issues." />}
      </Card>
      <HandoverDialog open={open} onOpenChange={setOpen} />
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title="Shift handover" description={detail ? `${detail.site.name} · ${detail.shift.name} · ${fmtDate(detail.workDate)}` : undefined} footer={detail && detail.status === "PENDING" && detail.outgoingSupervisorId !== me.user.id && can("handover.write") ? <Button onClick={() => confirmHandover(detail)}><Check /> Confirm handover</Button> : undefined}>
        {detail && (
          <div className="space-y-4 p-5 text-[13px]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted">Outgoing</div>
                <div className="font-medium">{detail.outgoingName}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Incoming</div>
                <div className="font-medium">{detail.incomingName ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Handed over</div>
                <div>{fmtDateTime(detail.handoverAt)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Status</div>
                <div>{detail.status === "CONFIRMED" ? `Confirmed ${relTime(detail.confirmedAt)}` : "Awaiting confirmation"}</div>
              </div>
            </div>
            {detail.remarks && (
              <div>
                <div className="text-xs font-semibold text-muted">Important remarks</div>
                <p className="mt-1">{detail.remarks}</p>
              </div>
            )}
            {detail.pendingIssues && (
              <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-warning">
                <div className="text-xs font-semibold">Pending issues</div>
                <p className="mt-1">{detail.pendingIssues}</p>
              </div>
            )}
            <div>
              <div className="text-xs font-semibold text-muted">Missing ({detail.missingEmployees.length})</div>
              <ul className="mt-1 space-y-0.5">
                {detail.missingEmployees.map((m) => (
                  <li key={m.code} className="flex justify-between">
                    <span>
                      {m.name} <span className="text-muted">{m.code}</span>
                    </span>
                    <span className="text-xs text-muted">{m.status.toLowerCase().replace("_", " ")}</span>
                  </li>
                ))}
                {!detail.missingEmployees.length && <li className="text-muted">None</li>}
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted">Present ({detail.presentEmployees.length})</div>
              <p className="mt-1 text-muted">{detail.presentEmployees.map((p) => p.name).join(", ") || "—"}</p>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function HandoverDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { me, siteId } = useSession();
  const qc = useQueryClient();
  const lookups = useLookups();
  const [site, setSite] = useState(siteId || me.sites[0]?.id || "");
  const [shift, setShift] = useState("");
  const [date, setDate] = useState(todayISO());
  const [incoming, setIncoming] = useState("");
  const [remarks, setRemarks] = useState("");
  const [issues, setIssues] = useState("");
  const [busy, setBusy] = useState(false);
  const shifts = (lookups.data?.shifts ?? []).filter((s: any) => s.siteId === site);
  const sups = (lookups.data?.supervisors ?? []).filter((s: any) => s.siteIds.includes(site) && s.id !== me.user.id);
  useEffect(() => {
    if (shifts.length && !shifts.some((s: any) => s.id === shift)) setShift(shifts[0].id);
  }, [shifts, shift]);
  const submit = async () => {
    setBusy(true);
    try {
      await api("/handovers", { body: { siteId: site, shiftId: shift, workDate: date, incomingSupervisorId: incoming || null, remarks: remarks || null, pendingIssues: issues || null } });
      toast.success("Handover recorded — present and missing workers were captured from the register");
      qc.invalidateQueries({ queryKey: ["handovers"] });
      onOpenChange(false);
      setRemarks("");
      setIssues("");
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
      title="Record shift handover"
      description="Present and missing employees are taken from the shift's attendance register."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!shift}>
            Record handover
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Site">
          <Select value={site} onChange={(e) => setSite(e.target.value)}>
            {me.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Shift">
          <Select value={shift} onChange={(e) => setShift(e.target.value)}>
            {shifts.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Incoming supervisor">
          <Select value={incoming} onChange={(e) => setIncoming(e.target.value)}>
            <option value="">— any —</option>
            {sups.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Important remarks" className="sm:col-span-2">
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Patrol rounds completed, gate log reconciled…" />
        </Field>
        <Field label="Pending issues" className="sm:col-span-2">
          <Textarea value={issues} onChange={(e) => setIssues(e.target.value)} placeholder="CCTV camera 4 offline; fence breach near T17…" />
        </Field>
      </div>
    </Dialog>
  );
}
