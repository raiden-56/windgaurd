"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Loader2,
  RotateCcw,
  Upload,
  XCircle,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Segmented, Tabs } from "@/components/ui/display";
import { Checkbox, Select } from "@/components/ui/field";
import { api, download, errorMessage, upload } from "@/lib/api";
import { addDaysISO, fmtDateTime, relTime, todayISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface UploadResult {
  jobId: string;
  fileName: string;
  headers: string[];
  mapping: Record<string, string | null>;
  totalRows: number;
  preview: (string | null)[][];
}
interface Checked {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  existingRows: number;
  rows: { rowNumber: number; data: Record<string, string | null>; errors: { field: string; message: string }[]; warnings: { field: string; message: string }[]; existing: boolean }[];
}

const STEPS = ["Template", "Upload", "Map columns", "Validate & select", "Import", "Summary"];

export default function ImportExportPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<"import" | "export">(can("employees.import") ? "import" : "export");
  return (
    <div>
      <PageHeader title="Import / Export" description="Bring employee records in from Excel or CSV, and take attendance and workforce data out in Excel, PDF or CSV." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[...(can("employees.import") ? [{ value: "import" as const, label: "Bulk employee import" }] : []), { value: "export" as const, label: "Exports" }]}
      />
      {tab === "import" ? <ImportWizard /> : <Exports />}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="no-scrollbar mb-4 flex gap-1 overflow-x-auto">
      {STEPS.map((s, i) => (
        <li key={s} className="flex shrink-0 items-center gap-1">
          <span className={cn("flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium", i === step ? "bg-navy text-white dark:bg-slate" : i < step ? "text-success" : "text-subtle")}>
            <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-bold", i === step ? "bg-white/15" : i < step ? "bg-success-soft" : "bg-sunken")}>{i < step ? <Check className="size-3" /> : i + 1}</span>
            {s}
          </span>
          {i < STEPS.length - 1 && <ArrowRight className="size-3.5 text-line-strong" />}
        </li>
      ))}
    </ol>
  );
}

function ImportWizard() {
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["import-fields"], queryFn: () => api<{ key: string; label: string; required?: boolean }[]>("/imports/fields") });
  const history = useQuery({ queryKey: ["imports"], queryFn: () => api<any[]>("/imports") });
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [up, setUp] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [checked, setChecked] = useState<Checked | null>(null);
  const [validating, setValidating] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [existing, setExisting] = useState<"update" | "skip">("update");
  const [view, setView] = useState<"all" | "errors" | "warnings" | "existing">("all");
  const [jobId, setJobId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const job = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: () => api<any>(`/imports/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === "PROCESSING" ? 800 : false),
  });
  useEffect(() => {
    if (job.data && job.data.status !== "PROCESSING" && step === 4) {
      setStep(5);
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["imports"] });
    }
  }, [job.data, step, qc]);

  const reset = () => {
    setStep(1);
    setFile(null);
    setUp(null);
    setChecked(null);
    setSelected(new Set());
    setJobId(null);
  };

  const doUpload = async (f: File) => {
    setFile(f);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await upload<UploadResult>("/imports/upload", fd);
      setUp(r);
      setMapping(r.mapping);
      setStep(2);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const validate = async () => {
    if (!up) return;
    setValidating(true);
    try {
      const r = await api<Checked>(`/imports/${up.jobId}/validate`, { body: { mapping } });
      setChecked(r);
      setSelected(new Set(r.rows.filter((x) => !x.errors.length).map((x) => x.rowNumber)));
      setStep(3);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setValidating(false);
    }
  };

  const commit = async () => {
    if (!up) return;
    try {
      await api(`/imports/${up.jobId}/commit`, { body: { rows: [...selected], existing } });
      setJobId(up.jobId);
      setStep(4);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const rows = useMemo(() => {
    if (!checked) return [];
    return checked.rows.filter((r) => (view === "errors" ? r.errors.length : view === "warnings" ? r.warnings.length : view === "existing" ? r.existing : true));
  }, [checked, view]);
  const fieldList = fields.data ?? [];
  const selectable = checked?.rows.filter((r) => !r.errors.length) ?? [];
  const toImport = checked?.rows.filter((r) => selected.has(r.rowNumber)) ?? [];
  const willUpdate = toImport.filter((r) => r.existing).length;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div>
        <Stepper step={step} />
        {step <= 1 && (
          <Card className="p-5">
            <div className="grid gap-5 md:grid-cols-[1fr_1.3fr]">
              <div>
                <h3 className="font-display text-base font-semibold">1. Start from the template</h3>
                <p className="mt-1 text-[13px] text-muted">Columns: Employee ID, Employee Name, Phone Number, Designation, Department, Joining Date, Employment Type, Assigned Site, Assigned Shift, Status. A reference sheet lists your site and shift codes.</p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    download("/imports/template")
                      .then(() => setStep(1))
                      .catch((e) => toast.error(errorMessage(e)));
                  }}
                >
                  <FileSpreadsheet /> Download Excel template
                </Button>
                <ul className="mt-4 space-y-1.5 text-[13px] text-muted">
                  <li>• Leave Employee ID blank to auto-generate one.</li>
                  <li>• Existing IDs can update those employees.</li>
                  <li>• Nothing is saved until you confirm the import.</li>
                </ul>
              </div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  const f = e.dataTransfer.files[0];
                  if (f) void doUpload(f);
                }}
                className={cn("flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors", drag ? "border-primary bg-primary-soft" : "border-line-strong bg-surface-2")}
              >
                {uploading ? <Loader2 className="size-8 animate-spin text-primary" /> : <FileUp className="size-8 text-subtle" />}
                <p className="mt-3 font-medium">{uploading ? `Reading ${file?.name}…` : "2. Drop your .xlsx or .csv file here"}</p>
                <p className="mt-1 text-xs text-muted">Up to 5,000 rows · 5 MB</p>
                <Button className="mt-4" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  <Upload /> Choose file
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void doUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </Card>
        )}

        {step === 2 && up && (
          <Card>
            <CardHeader title="Map columns" description={`${up.fileName} · ${up.totalRows} data rows detected. Columns were matched automatically — adjust if needed.`} />
            <div className="grid gap-3 p-4 sm:grid-cols-2 sm:px-5">
              {fieldList.map((f) => (
                <div key={f.key} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
                  <div className="min-w-0 flex-1 text-[13px] font-medium">
                    {f.label}
                    {f.required && <span className="text-danger"> *</span>}
                  </div>
                  <Select aria-label={`Column for ${f.label}`} value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })} wrapperClassName="w-44">
                    <option value="">— not in file —</option>
                    {up.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <div className="border-t border-line px-5 py-3">
              <div className="mb-2 text-xs font-semibold text-muted">Preview (first {up.preview.length} rows)</div>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-2 text-left text-muted">
                      {up.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {up.preview.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {r.map((c, j) => (
                          <td key={j} className="whitespace-nowrap px-2 py-1.5">
                            {c ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-between border-t border-line px-5 py-3">
              <Button variant="ghost" onClick={reset}>
                <RotateCcw /> Start over
              </Button>
              <Button onClick={validate} loading={validating} disabled={!mapping.fullName}>
                Validate {up.totalRows} rows <ArrowRight />
              </Button>
            </div>
          </Card>
        )}

        {step === 3 && checked && (
          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
              {[
                { l: "Valid rows", v: checked.validRows, c: "text-success", icon: CheckCircle2 },
                { l: "Rows with errors", v: checked.errorRows, c: "text-danger", icon: XCircle },
                { l: "Rows with warnings", v: checked.warningRows, c: "text-warning", icon: AlertTriangle },
                { l: "Match existing IDs", v: checked.existingRows, c: "text-primary-ink", icon: RotateCcw },
              ].map((x) => (
                <div key={x.l} className="bg-surface p-4">
                  <x.icon className={cn("size-4", x.c)} />
                  <div className="mt-1 font-display text-2xl font-bold tabular">{x.v}</div>
                  <div className="text-xs text-muted">{x.l}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-y border-line p-3">
              <Segmented
                ariaLabel="Row filter"
                value={view}
                onChange={setView}
                items={[
                  { value: "all", label: `All ${checked.totalRows}` },
                  { value: "errors", label: `Errors ${checked.errorRows}` },
                  { value: "warnings", label: `Warnings ${checked.warningRows}` },
                  { value: "existing", label: `Existing ${checked.existingRows}` },
                ]}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  download(`/imports/${up!.jobId}/error-report`)
                    .then((n) => toast.success(`Downloaded ${n}`))
                    .catch((e) => toast.error(errorMessage(e)))
                }
                disabled={!checked.errorRows && !checked.warningRows}
              >
                <Download /> Error report
              </Button>
              <div className="ml-auto flex items-center gap-2 text-[13px]">
                <span className="text-muted">Existing employee IDs:</span>
                <Select aria-label="How to handle existing employees" value={existing} onChange={(e) => setExisting(e.target.value as "update" | "skip")} wrapperClassName="w-44">
                  <option value="update">Update existing</option>
                  <option value="skip">Skip duplicates</option>
                </Select>
              </div>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[920px] text-[13px]">
                <thead className="sticky top-0 z-[1] bg-surface-2">
                  <tr className="text-left text-xs text-muted">
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        aria-label="Select all valid rows"
                        checked={selectable.length > 0 && selected.size === selectable.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.rowNumber)) : new Set())}
                      />
                    </th>
                    <th className="px-2 py-2 font-semibold">Row</th>
                    <th className="px-2 py-2 font-semibold">Employee ID</th>
                    <th className="px-2 py-2 font-semibold">Name</th>
                    <th className="px-2 py-2 font-semibold">Phone</th>
                    <th className="px-2 py-2 font-semibold">Designation</th>
                    <th className="px-2 py-2 font-semibold">Site</th>
                    <th className="px-2 py-2 font-semibold">Shift</th>
                    <th className="px-2 py-2 font-semibold">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const bad = r.errors.length > 0;
                    const fieldsWithIssue = new Set([...r.errors, ...r.warnings].map((x) => x.field));
                    const cell = (k: string) => <span className={cn(r.errors.some((x) => x.field === k) && "font-semibold text-danger", r.warnings.some((x) => x.field === k) && !bad && "text-warning")}>{r.data[k] ?? <span className="text-subtle">—</span>}</span>;
                    return (
                      <tr key={r.rowNumber} className={cn("border-t border-line", bad ? "bg-danger-soft/40" : selected.has(r.rowNumber) ? "" : "opacity-60")}>
                        <td className="px-3 py-2">
                          <Checkbox aria-label={`Select row ${r.rowNumber}`} disabled={bad} checked={selected.has(r.rowNumber)} onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(r.rowNumber) : n.delete(r.rowNumber); return n; })} />
                        </td>
                        <td className="px-2 tabular text-muted">{r.rowNumber}</td>
                        <td className="px-2 tabular">
                          {cell("employeeCode")} {r.existing && <Badge tone="primary">existing</Badge>}
                        </td>
                        <td className="px-2 font-medium">{cell("fullName")}</td>
                        <td className="px-2 tabular">{cell("phone")}</td>
                        <td className="px-2">{cell("designation")}</td>
                        <td className="px-2">{cell("site")}</td>
                        <td className="px-2">{cell("shift")}</td>
                        <td className="px-2 py-2">
                          {r.errors.map((x, i) => (
                            <div key={`e${i}`} className="flex items-start gap-1 text-danger">
                              <XCircle className="mt-0.5 size-3.5 shrink-0" /> {x.message}
                            </div>
                          ))}
                          {r.warnings.map((x, i) => (
                            <div key={`w${i}`} className="flex items-start gap-1 text-warning">
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {x.message}
                            </div>
                          ))}
                          {!fieldsWithIssue.size && <span className="text-success">Ready</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back to mapping
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-muted">
                  {toImport.length} selected · {toImport.length - willUpdate} new · {willUpdate} {existing === "update" ? "to update" : "to skip"}
                </span>
                <Button onClick={commit} disabled={!toImport.length}>
                  <Upload /> Import {toImport.length} rows
                </Button>
              </div>
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card className="p-10 text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-primary" />
            <p className="mt-3 font-medium">Importing in the background…</p>
            <p className="mt-1 text-[13px] text-muted">Each row is saved independently; you will see exactly what succeeded and what failed.</p>
          </Card>
        )}

        {step === 5 && job.data && (
          <Card className="p-6">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-3">
              {job.data.status === "COMPLETED" ? <CheckCircle2 className="size-8 text-success" /> : <XCircle className="size-8 text-danger" />}
              <div>
                <h3 className="font-display text-lg font-semibold">{job.data.status === "COMPLETED" ? "Import complete" : "Import failed"}</h3>
                <p className="text-[13px] text-muted">{job.data.fileName}</p>
              </div>
            </motion.div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { l: "Created", v: job.data.createdCount, c: "text-success" },
                { l: "Updated", v: job.data.updatedCount, c: "text-primary-ink" },
                { l: "Skipped", v: job.data.skippedCount, c: "text-muted" },
                { l: "Failed", v: job.data.failedCount, c: "text-danger" },
              ].map((x) => (
                <div key={x.l} className="rounded-md border border-line p-3">
                  <div className={cn("font-display text-2xl font-bold tabular", x.c)}>{x.v}</div>
                  <div className="text-xs text-muted">{x.l}</div>
                </div>
              ))}
            </div>
            {job.data.result?.outcomes?.some((o: any) => o.outcome === "failed") && (
              <ul className="mt-4 space-y-1 rounded-md border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">
                {job.data.result.outcomes
                  .filter((o: any) => o.outcome === "failed")
                  .slice(0, 10)
                  .map((o: any) => (
                    <li key={o.rowNumber}>
                      Row {o.rowNumber}: {o.message}
                    </li>
                  ))}
              </ul>
            )}
            {job.data.result?.error && <p className="mt-3 text-[13px] text-danger">{job.data.result.error}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={reset}>
                <Upload /> Import another file
              </Button>
              <Button variant="outline" onClick={() => download(`/imports/${job.data.id}/error-report`).catch((e) => toast.error(errorMessage(e)))}>
                <Download /> Download issues report
              </Button>
              <Link href="/employees" className="inline-flex h-9 items-center px-3 text-sm font-medium text-primary-ink hover:underline">
                View employees →
              </Link>
            </div>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader title="Recent imports" />
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {(history.data ?? []).map((h) => (
            <li key={h.id} className="px-4 py-2.5 text-[13px] sm:px-5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{h.fileName}</span>
                <Badge tone={h.status === "COMPLETED" ? "success" : h.status === "FAILED" ? "danger" : "neutral"}>{h.status.toLowerCase()}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {h.status === "COMPLETED" ? `${h.createdCount} created · ${h.updatedCount} updated · ${h.skippedCount} skipped · ${h.failedCount} failed` : `${h.totalRows} rows`} · {relTime(h.createdAt)}
              </div>
            </li>
          ))}
          {history.data && !history.data.length && <li className="px-5 py-6 text-center text-[13px] text-muted">No imports yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

function Exports() {
  const { me, siteId } = useSession();
  const [site, setSite] = useState(siteId);
  const history = useQuery({ queryKey: ["exports"], queryFn: () => api<any[]>("/exports") });
  const qc = useQueryClient();
  const today = todayISO();
  const now = new Date();
  const run = async (path: string, query: Record<string, any>) => {
    const t = toast.loading("Preparing export…");
    try {
      const n = await download(path, query);
      toast.success(`Downloaded ${n}`, { id: t });
      qc.invalidateQueries({ queryKey: ["exports"] });
    } catch (e) {
      toast.error(errorMessage(e), { id: t });
    }
  };
  const items = [
    { title: "Today's attendance register", desc: "Daily register with IN/OUT, hours, status and remarks", path: "/reports/attendance/export", q: { period: "daily", date: today, siteId: site } },
    { title: "Yesterday's register", desc: "For end-of-day reconciliation", path: "/reports/attendance/export", q: { period: "daily", date: addDaysISO(today, -1), siteId: site } },
    { title: "This week", desc: "Employee-wise totals and day matrix", path: "/reports/attendance/export", q: { period: "weekly", date: today, siteId: site } },
    { title: "This month", desc: "Monthly attendance with OT and late arrivals", path: "/reports/attendance/export", q: { period: "monthly", date: today, siteId: site } },
    { title: "This year", desc: "Month-wise and site-wise summaries", path: "/reports/attendance/export", q: { period: "yearly", date: today, siteId: site } },
    { title: "Employee directory", desc: "All active employees with site and shift", path: "/employees-export", q: { siteId: site, status: "ACTIVE" } },
    ...(site ? [{ title: "Muster roll (this month)", desc: "Form of register of attendance", path: "/muster-roll/export", q: { siteId: site, year: now.getFullYear(), month: now.getMonth() + 1 } }] : []),
    { title: "Gate register (30 days)", desc: "Visitor and vehicle movements", path: "/gate/report", q: { siteId: site, from: addDaysISO(today, -29), to: today } },
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div>
        <Card className="mb-3 flex items-center gap-2 p-3">
          <span className="text-[13px] text-muted">Scope</span>
          <Select aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} wrapperClassName="w-56">
            <option value="">All sites</option>
            {me.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Link href="/reports" className="ml-auto text-[13px] font-medium text-primary-ink hover:underline">
            Custom reports →
          </Link>
        </Card>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((it) => (
            <Card key={it.title} className="flex flex-col p-4">
              <div className="font-medium">{it.title}</div>
              <div className="mt-0.5 flex-1 text-[13px] text-muted">{it.desc}</div>
              <div className="mt-3 flex gap-1.5">
                {(["xlsx", "pdf", "csv"] as const).map((f) => (
                  <Button key={f} size="sm" variant={f === "xlsx" ? "primary" : "outline"} onClick={() => run(it.path, { ...it.q, format: f })}>
                    {f === "xlsx" ? "Excel" : f.toUpperCase()}
                  </Button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
      <Card className="h-fit">
        <CardHeader title="Export log" description="Every export is audited" />
        <ul className="mt-3 max-h-[560px] divide-y divide-line overflow-y-auto border-t border-line">
          {(history.data ?? []).map((h) => (
            <li key={h.id} className="px-4 py-2.5 text-[13px] sm:px-5">
              <div className="flex items-center justify-between">
                <span className="font-medium">{h.reportType}</span>
                <Badge>{h.format}</Badge>
              </div>
              <div className="text-xs text-muted">
                {h.createdByName} · {h.rowCount} rows · {fmtDateTime(h.createdAt)}
              </div>
            </li>
          ))}
          {history.data && !history.data.length && <EmptyState title="No exports yet" className="py-8" />}
        </ul>
      </Card>
    </div>
  );
}
