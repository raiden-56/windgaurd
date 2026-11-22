"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Building2, CalendarOff, ChevronLeft, Download, History, MapPin, Pencil, Phone, Plane, UserRound } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { EmployeeSheet } from "@/components/employee-form";
import { Button, LinkButton } from "@/components/ui/button";
import { Avatar, Badge, Card, CardHeader, EmptyState, Skeleton, StatusBadge } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog, Tip, useConfirm } from "@/components/ui/overlay";
import { api, download, errorMessage } from "@/lib/api";
import { addDaysISO, DAYS, fmtDate, fmtHM, fmtTime, STATUS, todayISO, type AttendanceStatus } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const EMP_TONE = { ACTIVE: "success", INACTIVE: "neutral", SUSPENDED: "warning", RESIGNED: "neutral", TERMINATED: "danger" } as const;

/** 13-week attendance heatmap (most recent on the right). */
function Heatmap({ records, tz }: { records: { workDate: string; status: AttendanceStatus }[]; tz: string }) {
  const map = new Map(records.map((r) => [r.workDate, r.status]));
  const today = todayISO(tz);
  const start = addDaysISO(today, -90);
  const startDow = new Date(`${start}T00:00:00Z`).getUTCDay();
  const days = Array.from({ length: 91 + startDow }, (_, i) => (i < startDow ? null : addDaysISO(start, i - startDow)));
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {w.map((d, di) =>
              d ? (
                <Tip key={d} content={`${fmtDate(d, { weekday: "short", day: "2-digit", month: "short" })} · ${map.get(d) ? STATUS[map.get(d)!].label : "Not scheduled"}`}>
                  <span className={cn("block size-3.5 rounded-[3px]", map.get(d) ? STATUS[map.get(d)!].dot : "bg-sunken", d > today && "opacity-0")} />
                </Tip>
              ) : (
                <span key={di} className="size-3.5" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
        {(["PRESENT", "HALF_DAY", "LEAVE", "ABSENT", "INCOMPLETE"] as AttendanceStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={cn("size-2.5 rounded-sm", STATUS[s].dot)} />
            {STATUS[s].label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-sunken" /> Off / not scheduled
        </span>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[13.5px] text-fg">{value || <span className="text-subtle">—</span>}</dd>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [edit, setEdit] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const q = useQuery({ queryKey: ["employee", id], queryFn: () => api<any>(`/employees/${id}`) });
  const e = q.data;
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (!e) return <EmptyState icon={UserRound} title="Employee not found" action={<LinkButton href="/employees">Back to employees</LinkButton>} />;
  const tz = e.site?.timezone ?? "Asia/Kolkata";
  const s = e.stats90;

  const archive = async () => {
    const ok = await confirm({ title: `Archive ${e.fullName}?`, description: "The employee is hidden from lists and future rosters. All historical attendance is preserved.", danger: true, confirmLabel: "Archive" });
    if (ok === false) return;
    try {
      await api(`/employees/${id}`, { method: "DELETE" });
      toast.success("Employee archived");
      qc.invalidateQueries({ queryKey: ["employees"] });
      router.push("/employees");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const cancelLeave = async (lid: string) => {
    if ((await confirm({ title: "Cancel this leave?", confirmLabel: "Cancel leave", danger: true })) === false) return;
    try {
      await api(`/leave/${lid}/cancel`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["employee", id] });
      toast.success("Leave cancelled");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <Link href="/employees" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
        <ChevronLeft className="size-3.5" /> Employees
      </Link>
      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <Avatar name={e.fullName} src={e.photoUrl} className="size-16 text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold tracking-tight">{e.fullName}</h1>
              <Badge tone={EMP_TONE[e.status as keyof typeof EMP_TONE]}>{e.status.toLowerCase()}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
              <span className="font-semibold tabular text-fg">{e.employeeCode}</span>
              <span>{e.designation?.name ?? "—"}</span>
              {e.site && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" /> {e.site.name}
                  {e.location && ` · ${e.location.name}`}
                </span>
              )}
              {e.phone && (
                <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1 hover:text-fg">
                  <Phone className="size-3.5" /> {e.phone}
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                download("/reports/attendance/export", { period: "custom", from: addDaysISO(todayISO(tz), -89), to: todayISO(tz), employeeId: id, format: "pdf" })
                  .then((n) => toast.success(`Downloaded ${n}`))
                  .catch((err) => toast.error(errorMessage(err)))
              }
            >
              <Download /> 90-day report
            </Button>
            {can("employees.write") && (
              <>
                <Button variant="outline" onClick={() => setLeaveOpen(true)}>
                  <Plane /> Record leave
                </Button>
                <Button onClick={() => setEdit(true)}>
                  <Pencil /> Edit
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-line [&>*:not(:last-child)]:border-r">
          {[
            { l: "Attendance (90d)", v: s.attendancePct != null ? `${s.attendancePct}%` : "—" },
            { l: "Working days", v: s.workingDays },
            { l: "Absent", v: s.absent, c: s.absent ? "text-danger" : "" },
            { l: "Leave", v: s.leave },
            { l: "Late arrivals", v: s.late, c: s.late ? "text-warning" : "" },
            { l: "Hours worked", v: Math.round(s.workedMinutes / 60).toLocaleString("en-IN") },
          ].map((x) => (
            <div key={x.l} className="px-5 py-3">
              <div className="text-xs text-muted">{x.l}</div>
              <div className={cn("mt-0.5 font-display text-xl font-bold tabular", x.c)}>{x.v}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Attendance — last 13 weeks" />
            <div className="p-4 sm:px-5">
              <Heatmap records={e.recentAttendance} tz={tz} />
            </div>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Recent attendance" description="Every entry links to its audit history" />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-y border-line bg-surface-2 text-left text-xs text-muted">
                    <th className="px-5 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Shift</th>
                    <th className="px-3 py-2 font-semibold">In</th>
                    <th className="px-3 py-2 font-semibold">Out</th>
                    <th className="px-3 py-2 text-right font-semibold">Hours</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Remarks</th>
                    <th className="px-5 py-2 font-semibold">Marked by</th>
                  </tr>
                </thead>
                <tbody>
                  {e.recentAttendance.slice(0, 30).map((r: any) => (
                    <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                      <td className="whitespace-nowrap px-5 py-2 tabular">
                        <Link href={`/audit?entityId=${r.id}`} className="hover:text-primary-ink">
                          {fmtDate(r.workDate, { weekday: "short", day: "2-digit", month: "short" })}
                        </Link>
                      </td>
                      <td className="px-3">
                        <span className="inline-flex items-center gap-1.5 text-[13px]">
                          <span className="size-2 rounded-sm" style={{ background: r.shift.color }} />
                          {r.shift.code}
                        </span>
                      </td>
                      <td className="px-3 tabular">
                        {fmtTime(r.checkInAt, tz) || "—"}
                        {r.isLate && <span className="ml-1 text-[11px] font-semibold text-warning">+{r.lateMinutes}m</span>}
                      </td>
                      <td className="px-3 tabular">{fmtTime(r.checkOutAt, tz) || "—"}</td>
                      <td className="px-3 text-right tabular">{fmtHM(r.workedMinutes)}</td>
                      <td className="px-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="max-w-48 truncate px-3 text-[13px] text-muted">{r.remarks ?? ""}</td>
                      <td className="whitespace-nowrap px-5 text-[13px] text-muted">{r.markedBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!e.recentAttendance.length && <EmptyState title="No attendance in the last 90 days" />}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Personal information" />
            <dl className="grid grid-cols-2 gap-4 p-4 sm:px-5">
              <Info label="Full name" value={e.fullName} />
              <Info label="Employee ID" value={e.employeeCode} />
              <Info label="Contact number" value={e.phone} />
              <Info label="Date of birth" value={e.dateOfBirth ? fmtDate(e.dateOfBirth) : null} />
              <div className="col-span-2">
                <Info label="Address" value={e.address} />
              </div>
              <div className="col-span-2">
                <Info label="Emergency contact" value={e.emergencyContact} />
              </div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Employment" />
            <dl className="grid grid-cols-2 gap-4 p-4 sm:px-5">
              <Info label="Designation" value={e.designation?.name} />
              <Info label="Department" value={e.department?.name} />
              <Info label="Joining date" value={e.joiningDate ? fmtDate(e.joiningDate) : null} />
              <Info label="Employment type" value={e.employmentType.toLowerCase()} />
              <Info label="Assigned site" value={e.site?.name} />
              <Info label="Deployment point" value={e.location?.name} />
              <Info label="Default shift" value={e.defaultShift ? `${e.defaultShift.name} (${e.defaultShift.code})` : null} />
              <Info label="Weekly off" value={e.weeklyOffDay != null ? DAYS[e.weeklyOffDay] : null} />
              {e.remarks && (
                <div className="col-span-2">
                  <Info label="Internal remarks" value={<span className="whitespace-normal">{e.remarks}</span>} />
                </div>
              )}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Site assignment history" />
            <ol className="p-4 sm:px-5">
              {e.siteHistory.map((h: any, i: number) => (
                <li key={h.id} className="relative flex gap-3 pb-4 last:pb-0 before:absolute before:bottom-0 before:left-[7px] before:top-5 before:w-px before:bg-line last:before:hidden">
                  <span className={cn("relative mt-1 size-[15px] shrink-0 rounded-full border-2", i === 0 && !h.endDate ? "border-accent bg-accent-soft" : "border-line-strong bg-surface")} />
                  <div className="text-[13px]">
                    <div className="font-medium">
                      <Building2 className="mr-1 inline size-3.5 text-subtle" />
                      {h.site.name}
                    </div>
                    <div className="text-xs text-muted">
                      {fmtDate(h.startDate)} – {h.endDate ? fmtDate(h.endDate) : "present"}
                      {h.note && ` · ${h.note}`}
                    </div>
                  </div>
                </li>
              ))}
              {!e.siteHistory.length && <p className="text-[13px] text-muted">No site assignments yet.</p>}
            </ol>
          </Card>
          <Card>
            <CardHeader title="Leave records" />
            <ul className="divide-y divide-line p-1">
              {e.leaveRecords.map((l: any) => (
                <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <CalendarOff className="size-4 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {fmtDate(l.startDate, { day: "2-digit", month: "short" })} – {fmtDate(l.endDate, { day: "2-digit", month: "short", year: "numeric" })}
                      <span className="ml-1.5 text-xs font-normal text-muted">{l.leaveType.toLowerCase()}</span>
                    </div>
                    {l.reason && <div className="truncate text-xs text-muted">{l.reason}</div>}
                  </div>
                  {l.status === "CANCELLED" ? (
                    <Badge>cancelled</Badge>
                  ) : can("employees.write") && l.endDate.slice(0, 10) >= todayISO(tz) ? (
                    <Button size="xs" variant="ghost" onClick={() => cancelLeave(l.id)}>
                      Cancel
                    </Button>
                  ) : (
                    <Badge tone="success">approved</Badge>
                  )}
                </li>
              ))}
              {!e.leaveRecords.length && <li className="px-3 py-4 text-center text-[13px] text-muted">No leave recorded.</li>}
            </ul>
          </Card>
          <div className="flex flex-wrap gap-2">
            <LinkButton variant="outline" size="sm" href={`/audit?entityId=${id}`}>
              <History /> Change history
            </LinkButton>
            {can("employees.write") && (
              <Button variant="danger-outline" size="sm" onClick={archive}>
                <Archive /> Archive employee
              </Button>
            )}
          </div>
        </div>
      </div>
      <EmployeeSheet open={edit} onOpenChange={setEdit} employee={e} />
      <LeaveDialog open={leaveOpen} onOpenChange={setLeaveOpen} employeeId={id} name={e.fullName} onDone={() => qc.invalidateQueries({ queryKey: ["employee", id] })} />
    </div>
  );
}

function LeaveDialog({ open, onOpenChange, employeeId, name, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; employeeId: string; name: string; onDone: () => void }) {
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [type, setType] = useState("CASUAL");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api("/leave", { body: { employeeId, startDate: start, endDate: end, leaveType: type, reason: reason || null } });
      toast.success("Leave recorded — it will appear as Leave on the register, not as absence");
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
      title="Record approved leave"
      description={name}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Save leave
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Leave type" className="col-span-2">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="CASUAL">Casual</option>
            <option value="SICK">Sick</option>
            <option value="EARNED">Earned</option>
            <option value="COMPENSATORY">Compensatory</option>
            <option value="UNPAID">Unpaid</option>
          </Select>
        </Field>
        <Field label="Reason" className="col-span-2">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
