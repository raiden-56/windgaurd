"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronLeft, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import { Avatar, Badge, Card, EmptyState, PageHeader, Skeleton, StatusBadge, Tabs } from "@/components/ui/display";
import { useConfirm } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, relTime, ROLE_LABEL, type AttendanceStatus } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Correction {
  id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  previousValues: Record<string, any>;
  proposedValues: Record<string, any>;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  requestedBy: { fullName: string; role: string };
  reviewedBy: { fullName: string } | null;
  attendance: { id: string; siteId: string; shiftId: string; workDate: string; status: AttendanceStatus; employee: { employeeCode: string; fullName: string }; site: { name: string; timezone: string }; shift: { name: string } };
}

const FIELD_LABEL: Record<string, string> = { status: "Status", checkInAt: "Check-in", checkOutAt: "Check-out", remarks: "Remarks" };

function Value({ field, value, tz }: { field: string; value: any; tz: string }) {
  if (value === null || value === undefined || value === "") return <span className="text-subtle">—</span>;
  if (field === "status") return <StatusBadge status={value} />;
  if (field === "checkInAt" || field === "checkOutAt") return <span className="tabular">{fmtDateTime(value, tz)}</span>;
  return <span>{String(value)}</span>;
}

export default function CorrectionsPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const q = useQuery({ queryKey: ["corrections", status], queryFn: () => api<Correction[]>("/attendance/corrections/list", { query: { status } }) });
  const counts = useQuery({ queryKey: ["corrections", "PENDING"], queryFn: () => api<Correction[]>("/attendance/corrections/list", { query: { status: "PENDING" } }) });

  const review = async (c: Correction, decision: "approve" | "reject") => {
    const r = await confirm({
      title: decision === "approve" ? "Approve correction?" : "Reject correction?",
      description: `${c.attendance.employee.fullName} · ${fmtDate(c.attendance.workDate)} · ${c.attendance.shift.name}`,
      confirmLabel: decision === "approve" ? "Approve & apply" : "Reject",
      danger: decision === "reject",
      reason: decision === "reject" ? { label: "Reason for rejection", required: true } : { label: "Review note (optional)" },
    });
    if (r === false) return;
    try {
      await api(`/attendance/corrections/${c.id}/${decision}`, { body: { note: r === "ok" ? null : r } });
      toast.success(decision === "approve" ? "Correction applied — the change is recorded in the audit log" : "Correction rejected");
      qc.invalidateQueries({ queryKey: ["corrections"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
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
        title="Attendance corrections"
        description="Historical attendance is never silently overwritten. Every change shows previous and proposed values and needs an administrator's approval."
      />
      <Tabs
        className="mb-4"
        value={status}
        onChange={setStatus}
        items={[
          { value: "PENDING", label: "Pending review", count: counts.data?.length },
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
        ]}
      />
      {q.isLoading && <Skeleton className="h-40" />}
      {q.data && !q.data.length && (
        <Card>
          <EmptyState icon={Pencil} title={status === "PENDING" ? "No corrections awaiting review" : `No ${status.toLowerCase()} corrections`} description="Supervisors request corrections from the register's row menu." action={<LinkButton variant="outline" href="/attendance">Open register</LinkButton>} />
        </Card>
      )}
      <div className="grid gap-3">
        {q.data?.map((c) => {
          const tz = c.attendance.site.timezone;
          const fields = Object.keys(c.proposedValues);
          return (
            <Card key={c.id} className="overflow-hidden">
              <div className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/attendance?site=${c.attendance.siteId}&shift=${c.attendance.shiftId}&date=${c.attendance.workDate.slice(0, 10)}`} className="font-display text-[15px] font-semibold hover:text-primary-ink">
                      {c.attendance.employee.fullName}
                    </Link>
                    <span className="text-xs tabular text-muted">{c.attendance.employee.employeeCode}</span>
                    <Badge tone={c.status === "PENDING" ? "warning" : c.status === "APPROVED" ? "success" : "danger"}>{c.status.toLowerCase()}</Badge>
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {fmtDate(c.attendance.workDate, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · {c.attendance.site.name} · {c.attendance.shift.name}
                  </div>
                  <div className="mt-3 overflow-x-auto rounded-md border border-line">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-surface-2 text-left text-xs text-muted">
                          <th className="px-3 py-1.5 font-semibold">Field</th>
                          <th className="px-3 py-1.5 font-semibold">Previous value</th>
                          <th className="w-6" />
                          <th className="px-3 py-1.5 font-semibold">Updated value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f) => (
                          <tr key={f} className="border-t border-line">
                            <td className="px-3 py-2 font-medium">{FIELD_LABEL[f] ?? f}</td>
                            <td className="px-3 py-2 text-muted line-through decoration-danger/50">
                              <Value field={f} value={c.previousValues[f]} tz={tz} />
                            </td>
                            <td className="text-subtle">
                              <ArrowRight className="size-3.5" />
                            </td>
                            <td className="px-3 py-2 font-medium">
                              <Value field={f} value={c.proposedValues[f]} tz={tz} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex items-start gap-2.5 text-[13px]">
                    <Avatar name={c.requestedBy.fullName} className="size-6 text-[10px]" />
                    <div>
                      <span className="font-semibold">{c.requestedBy.fullName}</span> <span className="text-muted">({ROLE_LABEL[c.requestedBy.role]}) · {relTime(c.createdAt)}</span>
                      <p className="mt-0.5 text-fg">“{c.reason}”</p>
                    </div>
                  </div>
                  {c.reviewedBy && (
                    <div className="mt-2 text-[13px] text-muted">
                      {c.status === "APPROVED" ? "Approved" : "Rejected"} by <b className="text-fg">{c.reviewedBy.fullName}</b> · {fmtDateTime(c.reviewedAt)}
                      {c.reviewNote && <> — “{c.reviewNote}”</>}
                    </div>
                  )}
                </div>
                {c.status === "PENDING" && can("corrections.approve") && (
                  <div className="flex gap-2 sm:flex-col">
                    <Button onClick={() => review(c, "approve")}>
                      <Check /> Approve
                    </Button>
                    <Button variant="danger-outline" onClick={() => review(c, "reject")}>
                      <X /> Reject
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
