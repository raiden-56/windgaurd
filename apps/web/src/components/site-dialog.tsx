"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";

export function SiteDialog({ open, onOpenChange, projects, site }: { open: boolean; onOpenChange: (o: boolean) => void; projects: any[]; site?: any }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", code: "", projectId: "", address: "", state: "", district: "", timezone: "Asia/Kolkata", isActive: true, createDefaultShifts: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(
      site
        ? { name: site.name, code: site.code, projectId: site.projectId ?? site.project?.id ?? "", address: site.address ?? "", state: site.state ?? "", district: site.district ?? "", timezone: site.timezone, isActive: site.isActive, createDefaultShifts: false }
        : { name: "", code: "", projectId: "", address: "", state: "", district: "", timezone: "Asia/Kolkata", isActive: true, createDefaultShifts: true },
    );
  }, [open, site]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (f.name.trim().length < 2) return setErr("Enter the site name");
    if (!site && !/^[A-Za-z0-9-]{2,16}$/.test(f.code)) return setErr("Site code: 2–16 letters or digits");
    setBusy(true);
    try {
      const body = { ...f, projectId: f.projectId || null, address: f.address || null, state: f.state || null, district: f.district || null };
      if (site) await api(`/sites/${site.id}`, { method: "PATCH", body: { ...body, code: undefined, createDefaultShifts: undefined } });
      else await api("/sites", { body });
      toast.success(site ? "Site updated" : "Site created with default shifts");
      qc.invalidateQueries({ queryKey: ["sites"] });
      qc.invalidateQueries({ queryKey: ["site"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      onOpenChange(false);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={site ? `Edit ${site.name}` : "New site"}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {site ? "Save changes" : "Create site"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Site name" required className="sm:col-span-4">
          <Input value={f.name} onChange={set("name")} placeholder="Bhachau Wind Farm" />
        </Field>
        <Field label="Site code" required className="sm:col-span-2">
          <Input value={f.code} onChange={set("code")} disabled={!!site} className="uppercase" placeholder="BHC" />
        </Field>
        <Field label="Project" className="sm:col-span-3">
          <Select value={f.projectId} onChange={set("projectId")}>
            <option value="">— none —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Timezone" className="sm:col-span-3">
          <Select value={f.timezone} onChange={set("timezone")}>
            {["Asia/Kolkata", "Asia/Dubai", "Asia/Colombo", "Asia/Dhaka", "Asia/Kathmandu", "Europe/London", "UTC"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Address" className="sm:col-span-6">
          <Textarea value={f.address} onChange={set("address")} className="min-h-14" />
        </Field>
        <Field label="District" className="sm:col-span-3">
          <Input value={f.district} onChange={set("district")} />
        </Field>
        <Field label="State" className="sm:col-span-3">
          <Input value={f.state} onChange={set("state")} />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-6">
          {!site && (
            <label className="flex items-center gap-2 text-[13px]">
              <Switch checked={f.createDefaultShifts} onChange={(v) => setF({ ...f, createDefaultShifts: v })} /> Create default shifts (06:00–14:00, 14:00–22:00, 22:00–06:00)
            </label>
          )}
          {site && (
            <label className="flex items-center gap-2 text-[13px]">
              <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} /> Site is active
            </label>
          )}
        </div>
        {err && <p className="text-[13px] font-medium text-danger sm:col-span-6">{err}</p>}
      </div>
    </Dialog>
  );
}
