"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, ChartTooltip, gridProps, Meter, SHIFT_COLORS } from "@/components/charts";
import { Card, CardHeader, EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui/display";
import { api } from "@/lib/api";
import { addDaysISO, todayISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<string, string> = { LIVE: "Live at gate", MANUAL: "Manual time entry", OFFLINE: "Captured offline", CORRECTION: "Approved correction", IMPORT: "Imported" };

export default function AnalyticsPage() {
  const { siteId } = useSession();
  const [range, setRange] = useState<"30" | "90" | "180" | "365">("90");
  const to = todayISO();
  const from = addDaysISO(to, -(Number(range) - 1));
  const q = useQuery({ queryKey: ["analytics", from, to, siteId], queryFn: () => api<any>("/analytics", { query: { from, to, siteId } }), placeholderData: keepPreviousData });
  const a = q.data;
  const modesTotal = a ? Object.values(a.entryModes as Record<string, number>).reduce((x, y) => x + y, 0) : 0;
  return (
    <div>
      <PageHeader
        title="Workforce analytics"
        description="Patterns behind the registers — which sites, shifts and weekdays need attention."
        actions={
          <Segmented
            ariaLabel="Range"
            value={range}
            onChange={setRange}
            items={[
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "180", label: "6 months" },
              { value: "365", label: "1 year" },
            ]}
          />
        }
      />
      {!a && <Skeleton className="h-96" />}
      {a && a.totalRecords === 0 && <EmptyState icon={BarChart3} title="No attendance in this range" />}
      {a && a.totalRecords > 0 && (
        <div className={cn("grid gap-4 lg:grid-cols-2", q.isFetching && "opacity-60")}>
          <Card>
            <CardHeader title="Attendance by site" description={`${a.totalRecords.toLocaleString("en-IN")} attendance records analysed`} />
            <div className="h-60 px-2 pb-3 pt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.sites} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
                  <CartesianGrid {...gridProps} horizontal={false} vertical />
                  <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" {...axisProps} width={140} />
                  <Tooltip cursor={{ fill: "var(--surface-sunken)" }} content={<ChartTooltip format={(v: number) => `${v}%`} />} />
                  <Bar dataKey="pct" name="Attendance" fill="var(--brand-blue)" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-px border-t border-line bg-line text-center text-xs">
              {a.sites.map((s: any) => (
                <div key={s.siteId} className="bg-surface p-3">
                  <div className="truncate font-medium">{s.code}</div>
                  <div className="mt-1 text-muted">
                    late <b className="text-warning">{s.lateRate ?? 0}%</b> · OT <b className="text-fg">{s.overtimeHours}h</b>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Absences by weekday" description="Unplanned absences per weekday — spot recurring absence days (attendance % in tooltip)" />
            <div className="h-72 px-2 pb-3 pt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.dayOfWeek} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} width={40} />
                  <Tooltip cursor={{ fill: "var(--surface-sunken)" }} content={<ChartTooltip format={(v: number, k: string) => (k === "pct" ? `${v}%` : v)} />} />
                  <Bar dataKey="absent" name="Absences" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {a.dayOfWeek.map((d: any) => {
                      const max = Math.max(...a.dayOfWeek.map((x: any) => x.absent));
                      return <Cell key={d.label} fill={d.absent === max ? "var(--st-absent)" : "var(--line-strong)"} />;
                    })}
                  </Bar>
                  <Bar dataKey="pct" name="Attendance %" hide />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Punctuality trend" description="Share of check-ins beyond the grace period, by week" />
            <div className="h-64 px-2 pb-3 pt-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={a.punctualityTrend} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} minTickGap={20} />
                  <YAxis {...axisProps} tickFormatter={(v) => `${v}%`} width={44} />
                  <Tooltip content={<ChartTooltip format={(v: number) => `${v}%`} />} />
                  <Line dataKey="lateRate" name="Late check-ins" stroke="var(--st-half)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Late arrivals by shift" description="Percentage of present workers checking in late, with average delay" />
            <ul className="space-y-3 p-4 sm:px-5">
              {a.lateByShift.map((s: any, i: number) => (
                <li key={s.shiftId}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm" style={{ background: SHIFT_COLORS[["First Shift", "Second Shift", "Third Shift"].indexOf(s.name)] ?? SHIFT_COLORS[i % 3] }} />
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted">{s.siteName}</span>
                    </span>
                    <span className="tabular text-muted">
                      <b className="text-fg">{s.lateRate}%</b> · avg {s.avgLateMins} min
                    </span>
                  </div>
                  <Meter className="mt-1.5" value={s.lateRate} max={Math.max(...a.lateByShift.map((x: any) => x.lateRate), 1)} color="var(--st-half)" />
                </li>
              ))}
            </ul>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Most absences" description="Employees with the most unplanned absences in the period" />
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left text-xs text-muted">
                  <th className="px-5 py-2 font-semibold">Employee</th>
                  <th className="px-3 py-2 font-semibold">Site</th>
                  <th className="px-3 py-2 text-right font-semibold">Absent</th>
                  <th className="px-5 py-2 text-right font-semibold">Late</th>
                </tr>
              </thead>
              <tbody>
                {a.topAbsentees.map((e: any) => (
                  <tr key={e.employeeId} className="border-b border-line last:border-0">
                    <td className="px-5 py-2">
                      <Link href={`/employees/${e.employeeId}`} className="font-medium hover:text-primary-ink">
                        {e.fullName}
                      </Link>
                      <span className="ml-1.5 text-xs tabular text-muted">{e.employeeCode}</span>
                    </td>
                    <td className="px-3 text-[13px] text-muted">{e.site}</td>
                    <td className="px-3 text-right font-semibold tabular text-danger">{e.absent}</td>
                    <td className="px-5 text-right tabular text-warning">{e.late}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardHeader title="How attendance was captured" description="Entry method across all records — manual and corrected entries carry an audit reason" />
            <ul className="space-y-3 p-4 sm:px-5">
              {Object.entries(a.entryModes as Record<string, number>)
                .sort((x, y) => y[1] - x[1])
                .map(([k, v]) => (
                  <li key={k}>
                    <div className="flex justify-between text-[13px]">
                      <span className="font-medium">{MODE_LABEL[k] ?? k}</span>
                      <span className="tabular text-muted">
                        {v.toLocaleString("en-IN")} · {((v / modesTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <Meter className="mt-1.5" value={v} max={modesTotal} color={k === "LIVE" ? "var(--accent)" : k === "OFFLINE" ? "var(--brand-blue)" : "var(--st-half)"} />
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
