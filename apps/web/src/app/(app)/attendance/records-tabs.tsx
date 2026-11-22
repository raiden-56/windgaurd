"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination, type ColumnDef } from "@/components/ui/data-table";
import { Badge, Card, StatusBadge } from "@/components/ui/display";
import { Input, SearchInput, Select } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/overlay";
import { api, download, errorMessage } from "@/lib/api";
import { addDaysISO, fmtDate, fmtDateTime, fmtHM, fmtTime, STATUS, todayISO, type AttendanceStatus } from "@/lib/format";
import { useSession } from "@/lib/session";

interface RecordItem {
  id: string;
  workDate: string;
  status: AttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number | null;
  overtimeMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  remarks: string | null;
  entryMode: string;
  employee: { employeeCode: string; fullName: string; designation: { name: string } | null };
  site: { name: string; code: string; timezone: string };
  shift: { name: string; code: string; color: string };
  markedBy: { fullName: string } | null;
  siteId: string;
  shiftId: string;
  employeeId: string;
}

export function RecordsTab() {
  const { me, siteId: globalSite } = useSession();
  const today = todayISO();
  const [from, setFrom] = useState(addDaysISO(today, -6));
  const [to, setTo] = useState(today);
  const [site, setSite] = useState(globalSite);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [late, setLate] = useState(false);
  const [mode, setMode] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api<any>("/lookups"), staleTime: 300_000 });

  const q = useQuery({
    queryKey: ["records", from, to, site, status, search, late, mode, page, pageSize],
    queryFn: () => api<{ total: number; items: RecordItem[] }>("/attendance/records", { query: { from, to, siteId: site, status, search, late: late || undefined, mode, page, pageSize } }),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<RecordItem>[] = [
    { id: "date", header: "Date", cell: ({ row: r }) => <span className="whitespace-nowrap tabular">{fmtDate(r.original.workDate, { day: "2-digit", month: "short" })}</span> },
    {
      id: "employee",
      header: "Employee",
      cell: ({ row: r }) => (
        <div>
          <Link href={`/employees/${r.original.employeeId}`} className="font-medium hover:text-primary-ink">
            {r.original.employee.fullName}
          </Link>
          <div className="text-xs text-muted tabular">{r.original.employee.employeeCode}</div>
        </div>
      ),
    },
    { id: "designation", header: "Designation", cell: ({ row: r }) => <span className="text-[13px] text-muted">{r.original.employee.designation?.name ?? "—"}</span> },
    { id: "site", header: "Site", cell: ({ row: r }) => <span className="whitespace-nowrap text-[13px]">{r.original.site.name}</span> },
    {
      id: "shift",
      header: "Shift",
      cell: ({ row: r }) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]">
          <span className="size-2 rounded-sm" style={{ background: r.original.shift.color }} />
          {r.original.shift.code}
        </span>
      ),
    },
    { id: "in", header: "In", cell: ({ row: r }) => <span className="tabular">{fmtTime(r.original.checkInAt, r.original.site.timezone) || "—"}</span> },
    { id: "out", header: "Out", cell: ({ row: r }) => <span className="tabular">{fmtTime(r.original.checkOutAt, r.original.site.timezone) || "—"}</span> },
    { id: "hours", header: "Hours", meta: { align: "right" }, cell: ({ row: r }) => fmtHM(r.original.workedMinutes) },
    { id: "status", header: "Status", cell: ({ row: r }) => <StatusBadge status={r.original.status} /> },
    { id: "late", header: "Late", cell: ({ row: r }) => (r.original.isLate ? <span className="text-xs font-semibold text-warning">+{r.original.lateMinutes}m</span> : <span className="text-subtle">—</span>) },
    { id: "mode", header: "Entry", cell: ({ row: r }) => <span className="text-xs text-muted">{r.original.entryMode.toLowerCase()}</span> },
    { id: "markedBy", header: "Marked by", cell: ({ row: r }) => <span className="whitespace-nowrap text-[13px] text-muted">{r.original.markedBy?.fullName ?? "—"}</span> },
    {
      id: "open",
      header: "",
      cell: ({ row: r }) => (
        <Link href={`/attendance?site=${r.original.siteId}&shift=${r.original.shiftId}&date=${r.original.workDate.slice(0, 10)}`} className="text-subtle hover:text-primary-ink" aria-label="Open register">
          <ExternalLink className="size-4" />
        </Link>
      ),
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
        <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Employee name or ID" className="w-full sm:w-56" />
        <Input type="date" aria-label="From" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} className="w-[150px]" />
        <Input type="date" aria-label="To" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} className="w-[150px]" />
        <Select aria-label="Site" value={site} onChange={(e) => (setSite(e.target.value), setPage(1))} wrapperClassName="w-48">
          <option value="">All sites</option>
          {me.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} wrapperClassName="w-40">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Entry mode" value={mode} onChange={(e) => (setMode(e.target.value), setPage(1))} wrapperClassName="w-36">
          <option value="">Any entry</option>
          <option value="LIVE">Live</option>
          <option value="MANUAL">Manual time</option>
          <option value="OFFLINE">Offline</option>
          <option value="CORRECTION">Corrected</option>
        </Select>
        <label className="flex h-9 items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={late} onChange={(e) => (setLate(e.target.checked), setPage(1))} className="accent-[var(--primary)]" /> Late only
        </label>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() =>
            download("/reports/attendance/export", { period: "custom", from, to, siteId: site, status, format: "xlsx" })
              .then((n) => toast.success(`Downloaded ${n}`))
              .catch((e) => toast.error(errorMessage(e)))
          }
        >
          <Download /> Export
        </Button>
      </div>
      <DataTable columns={columns} data={q.data?.items ?? []} loading={q.isLoading} getRowId={(r) => r.id} emptyTitle="No attendance records" emptyDescription="Try a wider date range or clear filters." dense />
      {lookups.isFetched && q.data && <Pagination page={page} pageSize={pageSize} total={q.data.total} onPage={setPage} onPageSize={(n) => (setPageSize(n), setPage(1))} />}
    </Card>
  );
}

interface RegisterItem {
  id: string;
  siteId: string;
  shiftId: string;
  date: string;
  status: string;
  site: { name: string; code: string };
  shift: { name: string; code: string; color: string };
  submittedAt: string | null;
  submittedBy: string | null;
  summary: Record<string, number> | null;
}

export function ApprovalsTab({ onOpen }: { onOpen: (r: RegisterItem) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState("SUBMITTED");
  const q = useQuery({ queryKey: ["registers", status], queryFn: () => api<RegisterItem[]>("/attendance/registers", { query: { status } }) });
  const approve = async (r: RegisterItem) => {
    const ok = await confirm({ title: "Approve register?", description: `${r.site.name} · ${r.shift.name} · ${fmtDate(r.date)}`, confirmLabel: "Approve", reason: { label: "Note (optional)" } });
    if (ok === false) return;
    try {
      await api(`/attendance/register/${r.id}/approve`, { body: { note: ok === "ok" ? null : ok } });
      toast.success("Register approved");
      qc.invalidateQueries({ queryKey: ["registers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const columns: ColumnDef<RegisterItem>[] = [
    { id: "date", header: "Date", cell: ({ row: r }) => <span className="whitespace-nowrap font-medium">{fmtDate(r.original.date, { weekday: "short", day: "2-digit", month: "short" })}</span> },
    { id: "site", header: "Site", cell: ({ row: r }) => r.original.site.name },
    {
      id: "shift",
      header: "Shift",
      cell: ({ row: r }) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ background: r.original.shift.color }} />
          {r.original.shift.name}
        </span>
      ),
    },
    {
      id: "summary",
      header: "Summary",
      cell: ({ row: r }) => {
        const s = r.original.summary ?? {};
        return (
          <span className="text-[13px] text-muted">
            <b className="text-fg tabular">{(s.PRESENT ?? 0) + (s.ON_DUTY ?? 0) + (s.INCOMPLETE ?? 0)}</b> present · <b className={s.ABSENT ? "text-danger" : "text-fg"}>{s.ABSENT ?? 0}</b> absent · {s.LEAVE ?? 0} leave
          </span>
        );
      },
    },
    { id: "by", header: "Submitted by", cell: ({ row: r }) => <span className="text-[13px]">{r.original.submittedBy ?? "—"}<span className="block text-xs text-muted">{fmtDateTime(r.original.submittedAt)}</span></span> },
    { id: "status", header: "Status", cell: ({ row: r }) => <Badge tone={r.original.status === "SUBMITTED" ? "warning" : r.original.status === "APPROVED" ? "success" : "neutral"}>{r.original.status.toLowerCase()}</Badge> },
    {
      id: "actions",
      header: "",
      cell: ({ row: r }) => (
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="outline" onClick={() => onOpen(r.original)}>
            <ClipboardCheck /> Review
          </Button>
          {r.original.status === "SUBMITTED" && (
            <Button size="xs" onClick={() => approve(r.original)}>
              <Check /> Approve
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line p-3">
        <Select aria-label="Register status" value={status} onChange={(e) => setStatus(e.target.value)} wrapperClassName="w-48">
          <option value="SUBMITTED">Awaiting approval</option>
          <option value="APPROVED">Approved</option>
          <option value="LOCKED">Locked</option>
          <option value="OPEN">Open</option>
        </Select>
        <span className="text-[13px] text-muted">{q.data?.length ?? 0} registers</span>
      </div>
      <DataTable columns={columns} data={q.data ?? []} loading={q.isLoading} getRowId={(r) => r.id} emptyTitle="Nothing awaiting approval" emptyDescription="Submitted registers appear here for review." />
    </Card>
  );
}
