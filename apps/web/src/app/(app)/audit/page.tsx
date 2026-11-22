"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Lock, ScrollText } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { Pagination } from "@/components/ui/data-table";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Input, SearchInput, Select } from "@/components/ui/field";
import { api } from "@/lib/api";
import { fmtDateTime, ROLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Log {
  id: string;
  userName: string | null;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

const ACTION_PREFIXES = ["attendance", "register", "roster", "employee", "import", "report", "shift", "user", "auth", "passkey", "sync", "gate", "handover", "settings", "site", "leave", "muster"];

function fmtVal(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Diff({ log }: { log: Log }) {
  const before = log.previousValues ?? {};
  const after = log.newValues ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !["updatedAt", "createdAt", "organizationId"].includes(k));
  return (
    <div className="grid gap-3 bg-surface-2 px-5 py-3 text-[13px] lg:grid-cols-[1fr_280px]">
      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-3 py-1.5 font-semibold">Field</th>
              <th className="px-3 py-1.5 font-semibold">Previous</th>
              <th className="px-3 py-1.5 font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const changed = JSON.stringify(before[k]) !== JSON.stringify(after[k]);
              return (
                <tr key={k} className="border-t border-line">
                  <td className="px-3 py-1.5 font-mono text-xs">{k}</td>
                  <td className={cn("max-w-72 truncate px-3 py-1.5", changed && k in before && "text-danger")}>{k in before ? fmtVal(before[k]) : ""}</td>
                  <td className={cn("max-w-72 truncate px-3 py-1.5", changed && k in after && "font-medium text-success")}>{k in after ? fmtVal(after[k]) : ""}</td>
                </tr>
              );
            })}
            {!keys.length && (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-muted">
                  No field values recorded for this action.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <dl className="space-y-1.5 text-xs">
        <div>
          <dt className="text-muted">Entity</dt>
          <dd className="font-mono">
            {log.entity} {log.entityId}
          </dd>
        </div>
        {log.reason && (
          <div>
            <dt className="text-muted">Reason</dt>
            <dd className="text-[13px]">{log.reason}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted">IP address</dt>
          <dd className="font-mono">{log.ipAddress ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Device</dt>
          <dd className="line-clamp-2">{log.userAgent ?? "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function AuditPage() {
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [entityId, setEntityId] = useState(params.get("entityId") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setPage(1), [search, entity, action, entityId, from, to]);
  const q = useQuery({
    queryKey: ["audit", search, entity, action, entityId, from, to, page],
    queryFn: () => api<{ total: number; items: Log[]; entities: { entity: string; count: number }[] }>("/audit", { query: { search, entity, action, entityId, from, to, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader
        title="Audit logs"
        description="Immutable history of attendance, corrections, approvals, imports, exports and configuration changes. Entries cannot be edited or deleted — the database rejects it."
        actions={
          <Badge tone="navy">
            <Lock className="size-3" /> Append-only
          </Badge>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="User, action or reason" className="w-full sm:w-60" />
          <Select aria-label="Entity" value={entity} onChange={(e) => setEntity(e.target.value)} wrapperClassName="w-48">
            <option value="">All entities</option>
            {(q.data?.entities ?? []).map((e) => (
              <option key={e.entity} value={e.entity}>
                {e.entity} ({e.count})
              </option>
            ))}
          </Select>
          <Select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} wrapperClassName="w-40">
            <option value="">All actions</option>
            {ACTION_PREFIXES.map((a) => (
              <option key={a} value={`${a}.`}>
                {a}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
          <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
          {entityId && (
            <button type="button" onClick={() => setEntityId("")} className="rounded-md bg-primary-soft px-2 py-1 text-xs font-medium text-primary-ink">
              Record {entityId.slice(0, 10)}… ✕
            </button>
          )}
        </div>
        {q.isLoading && <Skeleton className="m-4 h-60" />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs text-muted">
                <th className="w-8" />
                <th className="px-3 py-2 font-semibold">Time</th>
                <th className="px-3 py-2 font-semibold">User</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Entity</th>
                <th className="px-3 py-2 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.items ?? []).map((l) => (
                <Fragment key={l.id}>
                  <tr className="cursor-pointer border-b border-line hover:bg-surface-2" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                    <td className="pl-3 text-subtle">{expanded === l.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular text-[13px]">{fmtDateTime(l.createdAt)}</td>
                    <td className="px-3">
                      <div className="text-[13px] font-medium">{l.userName ?? "System"}</div>
                      <div className="text-xs text-muted">{ROLE_LABEL[l.userRole ?? ""] ?? l.userRole}</div>
                    </td>
                    <td className="px-3">
                      <code className="rounded bg-sunken px-1.5 py-0.5 text-xs">{l.action}</code>
                    </td>
                    <td className="px-3 text-[13px] text-muted">{l.entity}</td>
                    <td className="max-w-72 truncate px-3 text-[13px] text-muted">{l.reason ?? ""}</td>
                  </tr>
                  {expanded === l.id && (
                    <tr className="border-b border-line">
                      <td colSpan={6} className="p-0">
                        <Diff log={l} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {q.data && !q.data.items.length && <EmptyState icon={ScrollText} title="No audit entries match" />}
        {q.data && <Pagination page={page} pageSize={50} total={q.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
