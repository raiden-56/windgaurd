"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, BookOpenCheck, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Printer, Stamp } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { api, download, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, STATUS } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  A: "bg-danger-soft text-danger font-bold",
  L: "bg-[color:var(--st-leave)]/12 text-[color:var(--st-leave)] font-semibold",
  H: "bg-warning-soft text-warning font-semibold",
  IC: "bg-[color:var(--st-incomplete)]/12 text-[color:var(--st-incomplete)] font-semibold",
  WO: "bg-sunken text-muted",
  PH: "bg-sunken text-muted",
  OD: "bg-info-soft text-info",
};

export default function MusterRollPage() {
  const { me, can, siteId: globalSite } = useSession();
  const params = useSearchParams();
  const qc = useQueryClient();
  const now = new Date();
  const [site, setSite] = useState(params.get("site") || globalSite || me.sites[0]?.id || "");
  const [ym, setYm] = useState(() => {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  const [certifyOpen, setCertifyOpen] = useState(false);
  const [keeper, setKeeper] = useState(me.user.fullName);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["muster", site, ym], queryFn: () => api<any>("/muster-roll", { query: { siteId: site, year: ym.y, month: ym.m } }), enabled: !!site });
  const m = q.data;
  const shift = (n: number) => {
    const d = new Date(ym.y, ym.m - 1 + n, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() + 1 });
  };
  const exportAs = async (format: "xlsx" | "pdf" | "csv") => {
    const t = toast.loading("Preparing muster roll…");
    try {
      const n = await download("/muster-roll/export", { siteId: site, year: ym.y, month: ym.m, format });
      toast.success(`Downloaded ${n}`, { id: t });
    } catch (e) {
      toast.error(errorMessage(e), { id: t });
    }
  };
  const certify = async () => {
    setBusy(true);
    try {
      await api("/muster-roll/certify", { body: { siteId: site, year: ym.y, month: ym.m, keeperName: keeper } });
      toast.success("Muster roll certified — recorded in the audit log");
      qc.invalidateQueries({ queryKey: ["muster"] });
      setCertifyOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Digital muster roll"
        description="The monthly Form of Register of Attendance — the digital replacement for the paper muster roll."
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()} className="no-print">
              <Printer /> Print
            </Button>
            <Button variant="outline" onClick={() => exportAs("pdf")} className="no-print">
              <Download /> PDF
            </Button>
            <Button variant="outline" onClick={() => exportAs("xlsx")} className="no-print">
              <FileSpreadsheet /> Excel
            </Button>
            {can("attendance.mark") && (
              <Button onClick={() => setCertifyOpen(true)} className="no-print" disabled={!m?.rows.length}>
                <Stamp /> Certify
              </Button>
            )}
          </>
        }
      />
      <Card className="no-print mb-4 flex flex-wrap items-center gap-2 p-3">
        <Select aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} wrapperClassName="w-56">
          {me.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <Input type="month" aria-label="Month" value={`${ym.y}-${String(ym.m).padStart(2, "0")}`} onChange={(e) => e.target.value && setYm({ y: Number(e.target.value.slice(0, 4)), m: Number(e.target.value.slice(5, 7)) })} className="w-[160px]" />
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
        </div>
        {m?.certifications[0] && (
          <Badge tone="success" className="ml-auto">
            <BadgeCheck className="size-3.5" /> Certified by {m.certifications[0].keeperName} · {fmtDateTime(m.certifications[0].createdAt)}
          </Badge>
        )}
      </Card>

      {q.isLoading && <Skeleton className="h-96" />}
      {m && (
        <Card className="overflow-hidden print:border-0">
          <div className="border-b border-line p-5 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Muster roll · Form of register of attendance</div>
            <h2 className="mt-1 font-display text-lg font-bold">{m.company}</h2>
            <p className="text-[13px] text-muted">
              {m.site.name} ({m.site.code}){m.site.district && `, ${m.site.district}`}
              {m.site.state && `, ${m.site.state}`} · <b className="text-fg">{m.label}</b>
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
              {Object.entries(m.abbreviations as Record<string, string>)
                .filter(([k]) => k !== "PENDING" && k !== "NOT_SCHEDULED")
                .map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1">
                    <span className={cn("grid min-w-6 place-items-center rounded px-1 font-semibold", TONE[v] ?? "bg-surface-2 text-fg")}>{v}</span>
                    {STATUS[k as keyof typeof STATUS]?.label}
                  </span>
                ))}
            </div>
          </div>
          {m.rows.length ? (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="border-separate border-spacing-0 text-xs">
                <thead>
                  <tr className="text-muted">
                    <th className="sticky left-0 z-[2] border-b border-r border-line bg-surface-2 px-2 py-2 text-right font-semibold">S.No</th>
                    <th className="sticky left-[42px] z-[2] min-w-56 border-b border-r border-line bg-surface-2 px-3 py-2 text-left font-semibold">Employee</th>
                    <th className="min-w-28 border-b border-line bg-surface-2 px-2 py-2 text-left font-semibold">Designation</th>
                    <th className="min-w-32 border-b border-r border-line bg-surface-2 px-2 py-2 text-left font-semibold">Deployment</th>
                    {m.days.map((d: string) => {
                      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                      return (
                        <th key={d} className={cn("min-w-7 border-b border-line bg-surface-2 px-0.5 py-1.5 text-center font-semibold", dow === 0 && "text-danger")}>
                          <div>{Number(d.slice(8))}</div>
                          <div className="text-[9px] font-normal">{fmtDate(d, { weekday: "narrow" })}</div>
                        </th>
                      );
                    })}
                    <th className="border-b border-l border-line bg-surface-2 px-2 py-2 text-right font-semibold">Days</th>
                    <th className="border-b border-line bg-surface-2 px-2 py-2 text-right font-semibold">Hours</th>
                    <th className="min-w-36 border-b border-line bg-surface-2 px-3 py-2 text-left font-semibold">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {m.rows.map((r: any) => (
                    <tr key={r.employeeId} className="hover:[&>td]:bg-surface-2">
                      <td className="sticky left-0 z-[1] border-b border-r border-line bg-surface px-2 py-1.5 text-right tabular text-muted">{r.serial}</td>
                      <td className="sticky left-[42px] z-[1] border-b border-r border-line bg-surface px-3 py-1.5">
                        <div className="font-medium text-fg">{r.fullName}</div>
                        <div className="tabular text-subtle">{r.employeeCode}</div>
                      </td>
                      <td className="border-b border-line px-2 text-muted">{r.designation}</td>
                      <td className="border-b border-r border-line px-2 text-muted">{r.location}</td>
                      {m.days.map((d: string) => {
                        const v = r.cells[d];
                        return (
                          <td key={d} className={cn("border-b border-line px-0.5 py-1.5 text-center tabular", TONE[v] ?? "text-fg")}>
                            {v}
                          </td>
                        );
                      })}
                      <td className="border-b border-l border-line px-2 text-right font-bold tabular">{r.workingDays}</td>
                      <td className="border-b border-line px-2 text-right tabular">{r.totalHours}</td>
                      <td className="border-b border-line px-3 text-muted">{r.remarks}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="sticky left-0 z-[1] bg-surface-2 px-2 py-2" />
                    <td className="sticky left-[42px] z-[1] bg-surface-2 px-3 py-2">Total ({m.rows.length} employees)</td>
                    <td colSpan={2 + m.days.length} className="bg-surface-2" />
                    <td className="bg-surface-2 px-2 text-right tabular">{m.totals.workingDays}</td>
                    <td className="bg-surface-2 px-2 text-right tabular">{m.totals.totalHours}</td>
                    <td className="bg-surface-2" />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={BookOpenCheck} title="No attendance for this month" description="The muster roll fills in as attendance is recorded." />
          )}
          <div className="grid gap-6 border-t border-line p-5 text-[13px] sm:grid-cols-3">
            {["Register keeper / Supervisor", "Site In-charge", "Authorised Signatory"].map((s, i) => (
              <div key={s}>
                <div className="h-10 border-b border-line-strong">{i === 0 && m.certifications[0] && <span className="font-medium">{m.certifications[0].keeperName}</span>}</div>
                <div className="mt-1 text-xs text-muted">{s}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Dialog
        open={certifyOpen}
        onOpenChange={setCertifyOpen}
        title="Certify muster roll"
        description={m ? `${m.site.name} · ${m.label} · ${m.rows.length} employees · ${m.totals.workingDays} working days` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCertifyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={certify} loading={busy} disabled={keeper.trim().length < 2}>
              <Stamp /> Certify
            </Button>
          </>
        }
      >
        <Field label="Register keeper" hint="Printed on the muster roll as the person responsible for the register.">
          <Input value={keeper} onChange={(e) => setKeeper(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
