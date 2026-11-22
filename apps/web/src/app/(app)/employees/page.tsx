"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { Download, FileSpreadsheet, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmployeeSheet } from "@/components/employee-form";
import { Button, LinkButton } from "@/components/ui/button";
import { ColumnToggle, DataTable, Pagination, type ColumnDef } from "@/components/ui/data-table";
import { Avatar, Badge, Card, PageHeader, StatusBadge, Tabs } from "@/components/ui/display";
import { SearchInput, Select } from "@/components/ui/field";
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { api, download, errorMessage } from "@/lib/api";
import { DAYS, fmtDate } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string | null;
  designation: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  site: { id: string; name: string; code: string } | null;
  location: { id: string; name: string } | null;
  defaultShift: { id: string; name: string; code: string; color: string } | null;
  joiningDate: string | null;
  employmentType: string;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "RESIGNED" | "TERMINATED";
  weeklyOffDay: number | null;
  lastAttendance: { date: string; status: any } | null;
}

const EMP_TONE = { ACTIVE: "success", INACTIVE: "neutral", SUSPENDED: "warning", RESIGNED: "neutral", TERMINATED: "danger" } as const;

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function EmployeesPage() {
  const { can, siteId: globalSite } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [status, setStatus] = useState<string>("ACTIVE");
  const [site, setSite] = useState(globalSite);
  const [designationId, setDesignation] = useState("");
  const [shiftId, setShift] = useState("");
  const [type, setType] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "employeeCode", desc: false }]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    try {
      return JSON.parse(localStorage.getItem("wg.emp.cols") || "{}");
    } catch {
      return {};
    }
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [bulk, setBulk] = useState<null | "status" | "site" | "shift" | "weeklyOff">(null);
  useEffect(() => setSite(globalSite), [globalSite]);
  useEffect(() => setPage(1), [debounced, status, site, designationId, shiftId, type]);
  useEffect(() => {
    try {
      localStorage.setItem("wg.emp.cols", JSON.stringify(visibility));
    } catch {
      /* ignore */
    }
  }, [visibility]);

  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api<any>("/lookups"), staleTime: 300_000 });
  const filters = { search: debounced, siteId: site, status, designationId, shiftId, type };
  const q = useQuery({
    queryKey: ["employees", filters, sorting, page, pageSize],
    queryFn: () =>
      api<{ total: number; items: Employee[]; statusCounts: Record<string, number> }>("/employees", {
        query: { ...filters, sort: sorting[0]?.id ?? "employeeCode", dir: sorting[0]?.desc ? "desc" : "asc", page, pageSize },
      }),
    placeholderData: keepPreviousData,
  });
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const sc = q.data?.statusCounts ?? {};

  const columns = useMemo<ColumnDef<Employee>[]>(
    () => [
      { id: "employeeCode", accessorKey: "employeeCode", header: "Employee ID", enableHiding: false, cell: ({ row: r }) => <span className="font-medium tabular">{r.original.employeeCode}</span> },
      {
        id: "fullName",
        accessorKey: "fullName",
        header: "Employee name",
        enableHiding: false,
        cell: ({ row: r }) => (
          <Link href={`/employees/${r.original.id}`} className="flex items-center gap-2.5 font-medium hover:text-primary-ink" onClick={(e) => e.stopPropagation()}>
            <Avatar name={r.original.fullName} className="size-7 text-[10px]" />
            {r.original.fullName}
          </Link>
        ),
      },
      { id: "designation", header: "Designation", cell: ({ row: r }) => <span className="text-[13px]">{r.original.designation?.name ?? "—"}</span> },
      { id: "department", header: "Department", enableSorting: false, cell: ({ row: r }) => <span className="text-[13px] text-muted">{r.original.department?.name ?? "—"}</span> },
      { id: "site", header: "Assigned site", cell: ({ row: r }) => <span className="whitespace-nowrap text-[13px]">{r.original.site?.name ?? <span className="text-subtle">Unassigned</span>}</span> },
      { id: "phone", header: "Contact", enableSorting: false, cell: ({ row: r }) => <span className="whitespace-nowrap text-[13px] tabular text-muted">{r.original.phone ?? "—"}</span> },
      { id: "joiningDate", header: "Joined", cell: ({ row: r }) => <span className="whitespace-nowrap text-[13px] tabular text-muted">{r.original.joiningDate ? fmtDate(r.original.joiningDate) : "—"}</span> },
      { id: "status", header: "Status", cell: ({ row: r }) => <Badge tone={EMP_TONE[r.original.status]}>{r.original.status.toLowerCase()}</Badge> },
      {
        id: "shift",
        header: "Current shift",
        enableSorting: false,
        cell: ({ row: r }) =>
          r.original.defaultShift ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]">
              <span className="size-2 rounded-sm" style={{ background: r.original.defaultShift.color }} />
              {r.original.defaultShift.name}
            </span>
          ) : (
            <span className="text-subtle">—</span>
          ),
      },
      { id: "weeklyOff", header: "Weekly off", enableSorting: false, cell: ({ row: r }) => <span className="text-[13px] text-muted">{r.original.weeklyOffDay != null ? DAYS[r.original.weeklyOffDay] : "—"}</span> },
      {
        id: "last",
        header: "Last attendance",
        enableSorting: false,
        cell: ({ row: r }) =>
          r.original.lastAttendance ? (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <StatusBadge status={r.original.lastAttendance.status} compact />
              <span className="text-xs text-muted">{fmtDate(r.original.lastAttendance.date, { day: "2-digit", month: "short" })}</span>
            </span>
          ) : (
            <span className="text-subtle">—</span>
          ),
      },
    ],
    [],
  );

  const exportAs = (format: "xlsx" | "csv" | "pdf") =>
    download("/employees-export", { format, ...filters })
      .then((n) => toast.success(`Downloaded ${n}`))
      .catch((e) => toast.error(errorMessage(e)));

  return (
    <div>
      <PageHeader
        title="Employee management"
        description="Guards, supervisors and site staff. Historical attendance is kept when an employee becomes inactive."
        actions={
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="outline">
                  <Download /> Export
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => exportAs("xlsx")}>
                  <FileSpreadsheet /> Excel (.xlsx)
                </MenuItem>
                <MenuItem onSelect={() => exportAs("csv")}>
                  <FileSpreadsheet /> CSV
                </MenuItem>
                <MenuItem onSelect={() => exportAs("pdf")}>
                  <Download /> PDF
                </MenuItem>
              </MenuContent>
            </Menu>
            {can("employees.import") && (
              <LinkButton variant="outline" href="/import-export">
                <Upload /> Bulk import
              </LinkButton>
            )}
            {can("employees.write") && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Add employee
              </Button>
            )}
          </>
        }
      />
      <Tabs
        className="mb-3"
        value={status}
        onChange={setStatus}
        items={[
          { value: "ACTIVE", label: "Active", count: sc.ACTIVE ?? 0 },
          { value: "SUSPENDED", label: "Suspended", count: sc.SUSPENDED ?? 0 },
          { value: "INACTIVE", label: "Inactive", count: sc.INACTIVE ?? 0 },
          { value: "RESIGNED", label: "Resigned", count: sc.RESIGNED ?? 0 },
          { value: "TERMINATED", label: "Terminated", count: sc.TERMINATED ?? 0 },
          { value: "", label: "All" },
        ]}
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Name, ID or phone" className="w-full sm:w-64" />
          <Select aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} wrapperClassName="w-44">
            <option value="">All sites</option>
            {(lookups.data?.sites ?? []).map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Designation" value={designationId} onChange={(e) => setDesignation(e.target.value)} wrapperClassName="w-44">
            <option value="">All designations</option>
            {(lookups.data?.designations ?? []).map((d: any) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Shift" value={shiftId} onChange={(e) => setShift(e.target.value)} wrapperClassName="w-44">
            <option value="">All shifts</option>
            {(lookups.data?.shifts ?? [])
              .filter((s: any) => !site || s.siteId === site)
              .map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {!site && ` · ${(lookups.data?.sites ?? []).find((x: any) => x.id === s.siteId)?.code ?? ""}`}
                </option>
              ))}
          </Select>
          <Select aria-label="Employment type" value={type} onChange={(e) => setType(e.target.value)} wrapperClassName="w-36">
            <option value="">Any type</option>
            <option value="PERMANENT">Permanent</option>
            <option value="CONTRACT">Contract</option>
            <option value="TEMPORARY">Temporary</option>
            <option value="TRAINEE">Trainee</option>
          </Select>
          <div className="ml-auto">
            <ColumnToggle columns={columns} visibility={visibility} onChange={setVisibility} />
          </div>
        </div>
        {selectedIds.length > 0 && can("employees.write") && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-primary-soft/60 px-4 py-2">
            <span className="text-[13px] font-semibold text-primary-ink">{selectedIds.length} selected</span>
            <Button size="xs" variant="outline" onClick={() => setBulk("status")}>
              Change status
            </Button>
            <Button size="xs" variant="outline" onClick={() => setBulk("site")}>
              Transfer site
            </Button>
            <Button size="xs" variant="outline" onClick={() => setBulk("shift")}>
              Set default shift
            </Button>
            <Button size="xs" variant="outline" onClick={() => setBulk("weeklyOff")}>
              Set weekly off
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSelection({})}>
              Clear
            </Button>
          </div>
        )}
        <DataTable
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isLoading}
          getRowId={(r) => r.id}
          sorting={sorting}
          onSortingChange={setSorting}
          manualSorting
          selectable={can("employees.write")}
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          columnVisibility={visibility}
          onColumnVisibilityChange={setVisibility}
          onRowClick={(r) => router.push(`/employees/${r.id}`)}
          emptyTitle="No employees found"
          emptyDescription="Adjust the filters, add an employee or import from Excel."
        />
        {q.data && <Pagination page={page} pageSize={pageSize} total={q.data.total} onPage={setPage} onPageSize={(n) => (setPageSize(n), setPage(1))} />}
      </Card>
      <EmployeeSheet open={createOpen} onOpenChange={setCreateOpen} onSaved={(id) => router.push(`/employees/${id}`)} />
      <BulkDialog
        action={bulk}
        ids={selectedIds}
        lookups={lookups.data}
        onClose={() => setBulk(null)}
        onDone={async () => {
          setSelection({});
          qc.invalidateQueries({ queryKey: ["employees"] });
        }}
      />
    </div>
  );
}

function BulkDialog({ action, ids, lookups, onClose, onDone }: { action: null | "status" | "site" | "shift" | "weeklyOff"; ids: string[]; lookups: any; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(""), [action]);
  const title = { status: "Change status", site: "Transfer to site", shift: "Set default shift", weeklyOff: "Set weekly off" }[action ?? "status"];
  const submit = async () => {
    setBusy(true);
    try {
      await api("/employees/bulk", { body: { ids, action, value: action === "weeklyOff" ? (value === "" ? null : Number(value)) : value } });
      toast.success(`${ids.length} employee(s) updated`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!action}
      onOpenChange={(o) => !o && onClose()}
      title={`${title} · ${ids.length} employees`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={action !== "weeklyOff" && !value}>
            Apply
          </Button>
        </>
      }
    >
      <Select aria-label={title} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">{action === "weeklyOff" ? "No fixed day" : "Choose…"}</option>
        {action === "status" &&
          ["ACTIVE", "INACTIVE", "SUSPENDED", "RESIGNED", "TERMINATED"].map((s) => (
            <option key={s} value={s}>
              {s[0] + s.slice(1).toLowerCase()}
            </option>
          ))}
        {action === "site" &&
          (lookups?.sites ?? []).map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        {action === "shift" &&
          (lookups?.shifts ?? []).map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name} · {(lookups?.sites ?? []).find((x: any) => x.id === s.siteId)?.name}
            </option>
          ))}
        {action === "weeklyOff" &&
          DAYS.map((d, i) => (
            <option key={d} value={String(i)}>
              {d}
            </option>
          ))}
      </Select>
      <p className="mt-3 text-xs text-muted">{action === "site" ? "Transfers are recorded in each employee's site history; their default shift is cleared." : "Each change is written to the audit log."}</p>
      {action === "shift" && <p className="mt-1 text-xs text-muted">All selected employees must belong to the shift's site.</p>}
    </Dialog>
  );
}
