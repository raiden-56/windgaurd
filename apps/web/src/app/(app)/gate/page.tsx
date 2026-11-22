"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Download, DoorOpen, LogOut, Plus, Truck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { Field, Input, SearchInput, Select, Switch, Textarea } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger, Sheet, useConfirm } from "@/components/ui/overlay";
import { api, download, errorMessage } from "@/lib/api";
import { fmtDate, fmtTime, todayISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const TYPES = [
  ["VISITOR", "Visitor"],
  ["VENDOR", "Vendor"],
  ["CONTRACTOR", "Contractor"],
  ["OEM_ENGINEER", "OEM engineer"],
  ["OFFICIAL", "Official / inspector"],
  ["DELIVERY", "Delivery"],
] as const;
const TYPE_LABEL = Object.fromEntries(TYPES);

interface Entry {
  id: string;
  site: { name: string; code: string; timezone: string };
  visitorName: string;
  company: string | null;
  visitorType: string;
  mobile: string | null;
  purpose: string;
  vehicleNumber: string | null;
  personToMeet: string | null;
  entryAt: string;
  exitAt: string | null;
  recordedByName: string;
  remarks: string | null;
}

function duration(a: string, b: string | null) {
  const ms = (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function GatePage() {
  const { me, can, siteId } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [site, setSite] = useState(siteId);
  const [date, setDate] = useState(todayISO());
  const [onSite, setOnSite] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => setSite(siteId), [siteId]);
  const q = useQuery({ queryKey: ["gate", site, date, onSite, search], queryFn: () => api<Entry[]>("/gate", { query: { siteId: site, date: onSite ? undefined : date, onSite: onSite ? "true" : undefined, search } }) });
  const month = useQuery({ queryKey: ["gate-summary", site, date], queryFn: () => api<any>("/gate/summary", { query: { siteId: site, from: `${date.slice(0, 7)}-01`, to: date } }) });
  const list = q.data ?? [];
  const inside = list.filter((e) => !e.exitAt).length;

  const exit = async (e: Entry) => {
    if ((await confirm({ title: `Record exit for ${e.visitorName}?`, description: e.vehicleNumber ? `Vehicle ${e.vehicleNumber}` : undefined, confirmLabel: "Record exit" })) === false) return;
    try {
      await api(`/gate/${e.id}/exit`, { body: {} });
      toast.success("Exit recorded");
      qc.invalidateQueries({ queryKey: ["gate"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const report = (from: string, to: string, format: "pdf" | "xlsx" | "csv") =>
    download("/gate/report", { siteId: site, from, to, format })
      .then((n) => toast.success(`Downloaded ${n}`))
      .catch((e) => toast.error(errorMessage(e)));

  return (
    <div>
      <PageHeader
        title="Gate entry register"
        description="Visitors and vehicles entering and leaving the site gate. Kept separate from employee attendance."
        actions={
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="outline">
                  <Download /> Gate report
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => report(date, date, "pdf")}>Daily report (PDF)</MenuItem>
                <MenuItem onSelect={() => report(date, date, "xlsx")}>Daily report (Excel)</MenuItem>
                <MenuItem onSelect={() => report(`${date.slice(0, 7)}-01`, date, "pdf")}>Monthly report (PDF)</MenuItem>
                <MenuItem onSelect={() => report(`${date.slice(0, 7)}-01`, date, "xlsx")}>Monthly report (Excel)</MenuItem>
              </MenuContent>
            </Menu>
            {can("gate.write") && (
              <Button onClick={() => setOpen(true)}>
                <Plus /> New entry
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted">{onSite ? "Currently on site" : `Entries · ${fmtDate(date, { day: "2-digit", month: "short" })}`}</div>
          <div className="mt-1 font-display text-2xl font-bold tabular">{list.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Still inside</div>
          <div className={cn("mt-1 font-display text-2xl font-bold tabular", inside && "text-warning")}>{inside}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Vehicles</div>
          <div className="mt-1 font-display text-2xl font-bold tabular">{list.filter((e) => e.vehicleNumber).length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">This month</div>
          <div className="mt-1 font-display text-2xl font-bold tabular">{month.data?.total ?? "—"}</div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Visitor, company or vehicle no." className="w-full sm:w-64" />
          <Select aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} wrapperClassName="w-48">
            <option value="">All sites</option>
            {me.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label="Date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} disabled={onSite} className="w-[160px]" />
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <Switch checked={onSite} onChange={setOnSite} /> Only currently on site
          </label>
        </div>
        {q.isLoading && <Skeleton className="m-4 h-40" />}
        <ul className="divide-y divide-line">
          {list.map((e) => {
            const tz = e.site.timezone;
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-md", e.exitAt ? "bg-sunken text-subtle" : "bg-accent-soft text-accent")}>
                  {e.vehicleNumber ? e.visitorType === "DELIVERY" || e.visitorType === "VENDOR" ? <Truck className="size-5" /> : <Car className="size-5" /> : <UserRound className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.visitorName}</span>
                    <Badge>{TYPE_LABEL[e.visitorType] ?? e.visitorType}</Badge>
                    {e.vehicleNumber && <span className="rounded border border-line-strong px-1.5 font-mono text-xs font-semibold">{e.vehicleNumber}</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-muted">
                    {e.company && `${e.company} · `}
                    {e.purpose}
                    {e.personToMeet && ` · to meet ${e.personToMeet}`}
                  </div>
                  <div className="mt-0.5 text-xs text-subtle">
                    {e.site.code} · recorded by {e.recordedByName}
                    {e.mobile && ` · ${e.mobile}`}
                  </div>
                </div>
                <div className="text-right text-[13px]">
                  <div className="tabular">
                    <span className="text-muted">In</span> <b>{fmtTime(e.entryAt, tz)}</b>
                    {e.exitAt && (
                      <>
                        {" "}
                        <span className="text-muted">Out</span> <b>{fmtTime(e.exitAt, tz)}</b>
                      </>
                    )}
                  </div>
                  <div className={cn("text-xs", e.exitAt ? "text-muted" : "font-semibold text-warning")}>{e.exitAt ? duration(e.entryAt, e.exitAt) : `On site ${duration(e.entryAt, null)}`}</div>
                </div>
                {!e.exitAt && can("gate.write") && (
                  <Button size="sm" variant="outline" onClick={() => exit(e)}>
                    <LogOut /> Exit
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {q.data && !list.length && <EmptyState icon={DoorOpen} title={onSite ? "Nobody is on site" : "No gate movements"} description="Record visitors and vehicles as they enter." />}
      </Card>
      <GateSheet open={open} onOpenChange={setOpen} defaultSite={site || me.sites[0]?.id || ""} />
    </div>
  );
}

function GateSheet({ open, onOpenChange, defaultSite }: { open: boolean; onOpenChange: (o: boolean) => void; defaultSite: string }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const blank = { siteId: defaultSite, visitorName: "", company: "", visitorType: "VISITOR", mobile: "", purpose: "", vehicleNumber: "", personToMeet: "", remarks: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF({ ...blank, siteId: defaultSite });
      setErr(null);
    }
  }, [open, defaultSite]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (f.visitorName.trim().length < 2) return setErr("Enter the visitor's name");
    if (f.purpose.trim().length < 2) return setErr("Enter the purpose of visit");
    if (f.mobile && !/^(\+?\d{1,3}[\s-]?)?\d{10}$/.test(f.mobile.replace(/\s/g, ""))) return setErr("Enter a 10-digit mobile number");
    setBusy(true);
    try {
      await api("/gate", { body: { ...f, mobile: f.mobile.replace(/\s/g, "") || null, company: f.company || null, vehicleNumber: f.vehicleNumber || null, personToMeet: f.personToMeet || null, remarks: f.remarks || null } });
      toast.success("Entry recorded");
      qc.invalidateQueries({ queryKey: ["gate"] });
      qc.invalidateQueries({ queryKey: ["gate-summary"] });
      onOpenChange(false);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New gate entry"
      description="Entry time is recorded now"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Record entry
          </Button>
        </>
      }
    >
      <div className="grid gap-4 p-5">
        <Field label="Site">
          <Select value={f.siteId} onChange={set("siteId")}>
            {me.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Visitor name" required>
          <Input value={f.visitorName} onChange={set("visitorName")} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Visitor type">
            <Select value={f.visitorType} onChange={set("visitorType")}>
              {TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mobile">
            <Input type="tel" inputMode="tel" value={f.mobile} onChange={set("mobile")} />
          </Field>
        </div>
        <Field label="Company">
          <Input value={f.company} onChange={set("company")} placeholder="e.g. Crane rental contractor" />
        </Field>
        <Field label="Purpose of visit" required>
          <Input value={f.purpose} onChange={set("purpose")} placeholder="e.g. Gearbox inspection at T14" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle number">
            <Input value={f.vehicleNumber} onChange={set("vehicleNumber")} className="font-mono uppercase" placeholder="GJ-12-AB-1234" />
          </Field>
          <Field label="Person to meet">
            <Input value={f.personToMeet} onChange={set("personToMeet")} />
          </Field>
        </div>
        <Field label="Remarks">
          <Textarea value={f.remarks} onChange={set("remarks")} placeholder="Tools listed on gate pass, ID verified…" />
        </Field>
        {err && <p className="text-[13px] font-medium text-danger">{err}</p>}
      </div>
    </Sheet>
  );
}
