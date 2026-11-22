"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarRange, Download, FileSpreadsheet, FileText, Printer, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { axisProps, ChartTooltip, gridProps, Legend, STATUS_SERIES } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader, Segmented, Skeleton, StatusBadge } from "@/components/ui/display";
import { Input, Select } from "@/components/ui/field";
import { api, download, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, STATUS, todayISO, addDaysISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type Period = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

const CELL_TONE: Record<string, string> = {
  A: "bg-danger-soft text-danger font-semibold",
  L: "bg-[color:var(--st-leave)]/12 text-[color:var(--st-leave)]",
  H: "bg-warning-soft text-warning",
  IC: "bg-[color:var(--st-incomplete)]/12 text-[color:var(--st-incomplete)]",
  WO: "bg-sunken text-muted",
  PH: "bg-sunken text-muted",
};

export default function ReportsPage() {
  const { me, siteId: globalSite } = useSession();
  const [period, setPeriod] = useState<Period>("monthly");
  const [date, setDate] = useState(addDaysISO(todayISO(), -1));
  const [from, setFrom] = useState(addDaysISO(todayISO(), -13));
  const [to, setTo] = useState(todayISO());
  const [siteId, setSite] = useState(globalSite);
  const [projectId, setProject] = useState("");
  const [designationId, setDesignation] = useState("");
  const [shiftId, setShift] = useState("");
  const [supervisorId, setSupervisor] = useState("");
  const [status, setStatus] = useState("");
  const [employeeId, setEmployee] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api<any>("/lookups"), staleTime: 300_000 });
  const employees = useQuery({ queryKey: ["employees", "all-min", siteId], queryFn: () => api<any>("/employees", { query: { siteId, pageSize: 500, status: "" } }), enabled: showFilters });

  const params = { period, date: period === "custom" ? undefined : date, from: period === "custom" ? from : undefined, to: period === "custom" ? to : undefined, siteId, projectId, designationId, shiftId, supervisorId, status, employeeId };
  const q = useQuery({ queryKey: ["report", params], queryFn: () => api<any>("/reports/attendance", { query: params }), placeholderData: keepPreviousData });
  const r = q.data;

  const exportAs = async (format: "xlsx" | "pdf" | "csv") => {
    const t = toast.loading(`Preparing ${format.toUpperCase()}…`);
    try {
      const name = await download("/reports/attendance/export", { ...params, format });
      toast.success(`Downloaded ${name}`, { id: t });
    } catch (e) {
      toast.error(errorMessage(e), { id: t });
    }
  };

  const isDaily = r && r.meta.from === r.meta.to;
  const t = r?.totals;

  return (
    <div>
      <PageHeader
        title="Attendance reports"
        description="Official register-format reports for any period, filtered by company, project, site, employee, designation, supervisor, shift or status."
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()} className="no-print">
              <Printer /> Print
            </Button>
            <Button variant="outline" onClick={() => exportAs("csv")} className="no-print">
              <FileText /> CSV
            </Button>
            <Button variant="outline" onClick={() => exportAs("pdf")} className="no-print">
              <Download /> PDF
            </Button>
            <Button onClick={() => exportAs("xlsx")} className="no-print">
              <FileSpreadsheet /> Excel
            </Button>
          </>
        }
      />

      <Card className="no-print mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            ariaLabel="Reporting period"
            value={period}
            onChange={setPeriod}
            items={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "yearly", label: "Yearly" },
              { value: "custom", label: "Custom" },
            ]}
          />
          {period === "custom" ? (
            <div className="flex items-center gap-1.5">
              <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
              <span className="text-muted">–</span>
              <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
            </div>
          ) : (
            <div className="relative">
              <CalendarRange className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input type={period === "monthly" ? "month" : "date"} aria-label="Report date" value={period === "monthly" ? date.slice(0, 7) : date} onChange={(e) => e.target.value && setDate(period === "monthly" ? `${e.target.value}-01` : e.target.value)} className="w-[170px] pl-8" />
            </div>
          )}
          <Select aria-label="Site" value={siteId} onChange={(e) => setSite(e.target.value)} wrapperClassName="w-48">
            <option value="">All sites</option>
            {me.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button variant={showFilters ? "subtle" : "ghost"} size="sm" onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal /> More filters
          </Button>
        </div>
        {showFilters && (
          <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-3 lg:grid-cols-6">
            <Select aria-label="Project" value={projectId} onChange={(e) => setProject(e.target.value)}>
              <option value="">All projects</option>
              {(lookups.data?.projects ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Employee" value={employeeId} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">All employees</option>
              {(employees.data?.items ?? []).map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} · {e.fullName}
                </option>
              ))}
            </Select>
            <Select aria-label="Designation" value={designationId} onChange={(e) => setDesignation(e.target.value)}>
              <option value="">All designations</option>
              {(lookups.data?.designations ?? []).map((d: any) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Supervisor" value={supervisorId} onChange={(e) => setSupervisor(e.target.value)}>
              <option value="">Any supervisor</option>
              {(lookups.data?.supervisors ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </Select>
            <Select aria-label="Shift" value={shiftId} onChange={(e) => setShift(e.target.value)}>
              <option value="">All shifts</option>
              {(lookups.data?.shifts ?? [])
                .filter((s: any) => !siteId || s.siteId === siteId)
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {(lookups.data?.sites ?? []).find((x: any) => x.id === s.siteId)?.code}
                  </option>
                ))}
            </Select>
            <Select aria-label="Attendance status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </Card>

      {q.isError && <EmptyState title="Could not build the report" description={errorMessage(q.error)} />}
      {!r && q.isLoading && <Skeleton className="h-96" />}
      {r && (
        <div className={cn("space-y-4 transition-opacity", q.isFetching && "opacity-60")}>
          {/* Official report header */}
          <Card className="overflow-hidden">
            <div className="h-1 bg-navy" />
            <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">{period === "custom" ? "Attendance report" : `${period} attendance report`}</div>
                <h2 className="mt-1 font-display text-xl font-bold">{r.meta.company}</h2>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                  <div>
                    <dt className="inline text-muted">Site: </dt>
                    <dd className="inline font-medium">{r.meta.site}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted">Reporting period: </dt>
                    <dd className="inline font-medium">{r.meta.periodLabel}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted">Generated: </dt>
                    <dd className="inline">{fmtDateTime(r.meta.generatedAt)}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted">Generated by: </dt>
                    <dd className="inline">{r.meta.generatedBy}</dd>
                  </div>
                  {r.meta.filters.length > 0 && <div className="sm:col-span-2 text-muted">Filters: {r.meta.filters.join(" · ")}</div>}
                </dl>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center md:grid-cols-3">
                {[
                  { l: "Attendance", v: t.attendancePct != null ? `${t.attendancePct}%` : "—" },
                  { l: "Working days", v: t.workingDays.toLocaleString("en-IN") },
                  { l: "Hours worked", v: Math.round(t.workedHours).toLocaleString("en-IN") },
                  { l: "Absent", v: t.absent, c: "text-danger" },
                  { l: "Leave", v: t.leave },
                  { l: "Late", v: t.late, c: "text-warning" },
                ].map((x) => (
                  <div key={x.l} className="min-w-24 rounded-md border border-line px-3 py-2">
                    <div className={cn("font-display text-lg font-bold tabular", x.c)}>{x.v}</div>
                    <div className="text-[11px] text-muted">{x.l}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {isDaily ? (
            <Card className="overflow-hidden">
              <CardHeader title="Daily register" description={`${r.daily.length} entries`} />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead>
                    <tr className="border-y border-line bg-surface-2 text-left text-xs text-muted">
                      {["S.No", "Emp ID", "Employee name", "Designation", "Site", "Shift", "IN", "OUT", "Hours", "Status", "Remarks"].map((h) => (
                        <th key={h} className={cn("px-3 py-2 font-semibold first:pl-5", h === "Hours" && "text-right")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.daily.map((d: any, i: number) => (
                      <tr key={d.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 pl-5 tabular text-muted">{i + 1}</td>
                        <td className="px-3 tabular">{d.employeeCode}</td>
                        <td className="px-3 font-medium">{d.fullName}</td>
                        <td className="px-3 text-[13px] text-muted">{d.designation}</td>
                        <td className="px-3 text-[13px]">{d.site}</td>
                        <td className="px-3 text-[13px]">{d.shift}</td>
                        <td className="px-3 tabular">{d.inTime || "—"}</td>
                        <td className="px-3 tabular">{d.outTime || "—"}</td>
                        <td className="px-3 text-right tabular">{d.hours || "—"}</td>
                        <td className="px-3">
                          <StatusBadge status={d.status} />
                          {d.isLate && <span className="ml-1.5 text-xs font-semibold text-warning">{d.late}</span>}
                        </td>
                        <td className="max-w-56 truncate px-3 text-[13px] text-muted">{d.remarks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!r.daily.length && <EmptyState title="No attendance recorded for this day" />}
              </div>
            </Card>
          ) : (
            <>
              {r.months.length > 1 && (
                <Card>
                  <CardHeader title="Monthly comparison" description="Attendance composition by month" />
                  <Legend className="px-4 pt-3 sm:px-5" items={STATUS_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
                  <div className="h-64 px-2 pb-3 pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={r.months} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="label" {...axisProps} />
                        <YAxis {...axisProps} width={48} />
                        <Tooltip cursor={{ fill: "var(--surface-sunken)" }} content={<ChartTooltip />} />
                        {STATUS_SERIES.map((s, i) => (
                          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="m" fill={s.color} stroke="var(--surface)" strokeWidth={1} radius={i === STATUS_SERIES.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={44} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="overflow-x-auto border-t border-line">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="bg-surface-2 text-left text-xs text-muted">
                          {["Month", "Scheduled", "Present", "Absent", "Leave", "Half day", "Working days", "Hours", "OT hrs", "Att. %"].map((h, i) => (
                            <th key={h} className={cn("px-3 py-2 font-semibold first:pl-5", i > 0 && "text-right")}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {r.months.map((m: any) => (
                          <tr key={m.month} className="border-t border-line">
                            <td className="px-3 py-2 pl-5 font-medium">{m.label}</td>
                            {[m.scheduled, m.present, m.absent, m.leave, m.halfDay, m.workingDays, m.workedHours, m.overtimeHours].map((v, i) => (
                              <td key={i} className="px-3 text-right tabular">
                                {v.toLocaleString("en-IN")}
                              </td>
                            ))}
                            <td className="px-3 text-right font-semibold tabular">{m.attendancePct ?? "—"}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {r.sites.length > 1 && (period === "yearly" || period === "quarterly" || period === "custom") && (
                <Card className="overflow-hidden">
                  <CardHeader title="Site-wise attendance" />
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-y border-line bg-surface-2 text-left text-xs text-muted">
                          {["Site", "Present", "Absent", "Leave", "Working days", "Hours", "Att. %"].map((h, i) => (
                            <th key={h} className={cn("px-3 py-2 font-semibold first:pl-5", i > 0 && "text-right")}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {r.sites.map((s: any) => (
                          <tr key={s.siteId} className="border-b border-line last:border-0">
                            <td className="px-3 py-2 pl-5 font-medium">{s.site}</td>
                            {[s.present, s.absent, s.leave, s.workingDays, s.workedHours].map((v: number, i: number) => (
                              <td key={i} className="px-3 text-right tabular">
                                {v.toLocaleString("en-IN")}
                              </td>
                            ))}
                            <td className="px-3 text-right font-semibold tabular">{s.attendancePct ?? "—"}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              <Card className="overflow-hidden">
                <CardHeader title="Employee-wise summary" description={`${r.employees.length} employees`} />
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead>
                      <tr className="border-y border-line bg-surface-2 text-left text-xs text-muted">
                        {["Emp ID", "Employee", "Designation", "Site", "Present", "Absent", "Leave", "Half day", "Wkly off", "Late", "Working days", "Hours", "OT hrs", "Att. %"].map((h, i) => (
                          <th key={h} className={cn("whitespace-nowrap px-3 py-2 font-semibold first:pl-5", i > 3 && "text-right")}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.employees.map((e: any) => (
                        <tr key={e.employeeId} className="border-b border-line last:border-0 hover:bg-surface-2">
                          <td className="px-3 py-2 pl-5 tabular">{e.employeeCode}</td>
                          <td className="px-3 font-medium">{e.fullName}</td>
                          <td className="px-3 text-[13px] text-muted">{e.designation}</td>
                          <td className="whitespace-nowrap px-3 text-[13px]">{e.site}</td>
                          <td className="px-3 text-right tabular">{e.present}</td>
                          <td className={cn("px-3 text-right tabular", e.absent && "font-semibold text-danger")}>{e.absent}</td>
                          <td className="px-3 text-right tabular">{e.leave}</td>
                          <td className="px-3 text-right tabular">{e.halfDay}</td>
                          <td className="px-3 text-right tabular">{e.weeklyOff}</td>
                          <td className={cn("px-3 text-right tabular", e.late && "text-warning")}>{e.late}</td>
                          <td className="px-3 text-right font-semibold tabular">{e.workingDays}</td>
                          <td className="px-3 text-right tabular">{e.workedHours}</td>
                          <td className="px-3 text-right tabular">{e.overtimeHours}</td>
                          <td className={cn("px-3 text-right font-semibold tabular", e.attendancePct != null && e.attendancePct < 90 && "text-danger")}>{e.attendancePct ?? "—"}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {r.days.length <= 31 && r.employees.length > 0 && (
                <Card className="overflow-hidden">
                  <CardHeader title="Attendance matrix" description={`Legend: ${Object.entries(r.abbreviations).filter(([k]) => k !== "PENDING").map(([k, v]) => `${v} ${STATUS[k as keyof typeof STATUS]?.label}`).join(" · ")}`} />
                  <div className="scrollbar-thin mt-3 overflow-x-auto">
                    <table className="border-separate border-spacing-0 text-xs">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-[1] min-w-48 border-b border-r border-line bg-surface-2 px-3 py-2 text-left font-semibold text-muted">Employee</th>
                          {r.days.map((d: string) => (
                            <th key={d} className="min-w-8 border-b border-line bg-surface-2 px-1 py-2 text-center font-semibold text-muted">
                              <div>{Number(d.slice(8))}</div>
                              <div className="text-[9px] font-normal text-subtle">{fmtDate(d, { weekday: "narrow" })}</div>
                            </th>
                          ))}
                          <th className="border-b border-l border-line bg-surface-2 px-3 py-2 text-right font-semibold text-muted">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.employees.map((e: any) => (
                          <tr key={e.employeeId}>
                            <td className="sticky left-0 z-[1] border-b border-r border-line bg-surface px-3 py-1.5">
                              <span className="font-medium">{e.fullName}</span> <span className="tabular text-subtle">{e.employeeCode}</span>
                            </td>
                            {r.days.map((d: string) => {
                              const v = e.cells[d] ?? "";
                              return (
                                <td key={d} className={cn("border-b border-line px-1 py-1.5 text-center tabular", CELL_TONE[v])}>
                                  {v}
                                </td>
                              );
                            })}
                            <td className="border-b border-l border-line px-3 py-1.5 text-right font-semibold tabular">{e.workingDays}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
