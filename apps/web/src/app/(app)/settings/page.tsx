"use client";

import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startRegistration } from "@simplewebauthn/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, Fingerprint, KeyRound, Laptop, LifeBuoy, LogOut, Pencil, Plus, ShieldCheck, Smartphone, Trash2, UserRound, WifiOff, Download } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, Tabs } from "@/components/ui/display";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { Dialog, useConfirm } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import { withBase } from "@/lib/base";
import { fmtDate, fmtDateTime, relTime, ROLE_LABEL, STATUS } from "@/lib/format";
import { useSession } from "@/lib/session";

type Tab = "profile" | "security" | "rules" | "holidays" | "organizations" | "help";

export default function SettingsPage() {
  const { can, me } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") as Tab) || "profile";
  const items: { value: Tab; label: string }[] = [
    { value: "profile", label: "Profile" },
    { value: "security", label: "Passkeys & security" },
    ...(can("settings.manage") ? [{ value: "rules" as Tab, label: "Attendance rules" }] : []),
    { value: "holidays", label: "Holidays" },
    ...(me.user.role === "SUPER_ADMIN" ? [{ value: "organizations" as Tab, label: "Organizations" }] : []),
    { value: "help", label: "Help & support" },
  ];
  return (
    <div>
      <PageHeader title="Settings" description={`${me.organization.name} · signed in as ${me.user.fullName} (${ROLE_LABEL[me.user.role]})`} />
      <Tabs className="mb-4" value={tab} onChange={(v) => router.replace(`/settings?tab=${v}`, { scroll: false })} items={items} />
      {tab === "profile" && <Profile />}
      {tab === "security" && <Security />}
      {tab === "rules" && can("settings.manage") && <Rules />}
      {tab === "holidays" && <Holidays />}
      {tab === "organizations" && me.user.role === "SUPER_ADMIN" && <Organizations />}
      {tab === "help" && <Help />}
    </div>
  );
}

function Profile() {
  const { me, refresh } = useSession();
  const [fullName, setName] = useState(me.user.fullName);
  const [phone, setPhone] = useState(me.user.phone ?? "");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const save = async () => {
    setBusy("p");
    try {
      await api("/auth/profile", { method: "PATCH", body: { fullName, phone: phone || null } });
      toast.success("Profile saved");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const changePw = async () => {
    setBusy("pw");
    try {
      await api("/auth/password", { body: { current: cur, next } });
      toast.success("Password changed");
      setCur("");
      setNext("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Your profile" />
        <div className="grid gap-4 p-4 sm:px-5">
          <Field label="Full name">
            <Input value={fullName} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" hint="Contact an administrator to change your sign-in email">
            <Input value={me.user.email} disabled />
          </Field>
          <Field label="Mobile">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <div className="text-xs text-muted">
            Role: <b className="text-fg">{ROLE_LABEL[me.user.role]}</b> · Sites: {me.user.role === "SUPERVISOR" ? me.sites.map((s) => s.name).join(", ") : "all"} · Last sign-in {relTime(me.user.lastLoginAt)}
          </div>
          <div>
            <Button onClick={save} loading={busy === "p"}>
              Save profile
            </Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title={me.user.hasPassword ? "Change password" : "Set a fallback password"} description="Used only when a passkey is unavailable on a device." />
        <div className="grid gap-4 p-4 sm:px-5">
          {me.user.hasPassword && (
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
            </Field>
          )}
          <Field label="New password" hint="At least 10 characters">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <div>
            <Button variant="secondary" onClick={changePw} loading={busy === "pw"} disabled={next.length < 10}>
              Update password
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Security() {
  const { refresh } = useSession();
  const params = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["passkeys"], queryFn: () => api<any[]>("/auth/passkeys") });
  const [support, setSupport] = useState<{ webauthn: boolean; platform: boolean } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    const w = browserSupportsWebAuthn();
    (w ? platformAuthenticatorIsAvailable() : Promise.resolve(false)).then((p) => setSupport({ webauthn: w, platform: p }));
  }, []);
  useEffect(() => {
    if (params.get("setup") === "passkey") toast.info("Register a passkey on this device so you can sign in with fingerprint or face recognition next time.");
  }, [params]);

  const register = async () => {
    setBusy(true);
    try {
      const optionsJSON = await api("/auth/passkey/register/options", { method: "POST" });
      const response = await startRegistration({ optionsJSON });
      await api("/auth/passkey/register/verify", { body: { response, name } });
      toast.success("Passkey registered — you can now sign in with this device's biometrics");
      setName("");
      qc.invalidateQueries({ queryKey: ["passkeys"] });
      refresh();
    } catch (e: any) {
      if (e?.name === "InvalidStateError") toast.error("This device already has a passkey for your account");
      else if (e?.name === "NotAllowedError") toast.error("Registration was cancelled");
      else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (p: any) => {
    if ((await confirm({ title: `Revoke “${p.name}”?`, description: "This device will no longer be able to sign in with its passkey.", danger: true, confirmLabel: "Revoke" })) === false) return;
    try {
      await api(`/auth/passkeys/${p.id}`, { method: "DELETE" });
      toast.success("Passkey revoked");
      qc.invalidateQueries({ queryKey: ["passkeys"] });
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const saveRename = async () => {
    if (!rename) return;
    try {
      await api(`/auth/passkeys/${rename.id}`, { method: "PATCH", body: { name: rename.name } });
      setRename(null);
      qc.invalidateQueries({ queryKey: ["passkeys"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const signOutAll = async () => {
    if ((await confirm({ title: "Sign out of every device?", description: "Including this one. Offline entries waiting on other devices will need a fresh sign-in to sync.", danger: true, confirmLabel: "Sign out everywhere" })) === false) return;
    await api("/auth/logout-all", { method: "POST" }).catch(() => undefined);
    window.location.href = withBase("/login");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardHeader title="Passkeys" description="Sign in with fingerprint, Face ID, Windows Hello or a security key. Your biometric never leaves the device — WINDGUARD stores only a public key." />
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {q.isLoading && <Skeleton className="m-4 h-12" />}
          {(q.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="grid size-9 place-items-center rounded-md bg-accent-soft text-accent">{/iPhone|Android|phone/i.test(p.name) ? <Smartphone className="size-4" /> : /Windows|Mac|Laptop/i.test(p.name) ? <Laptop className="size-4" /> : <Fingerprint className="size-4" />}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{p.name}</div>
                <div className="text-xs text-muted">
                  Added {fmtDate(p.createdAt)} · last used {p.lastUsedAt ? relTime(p.lastUsedAt) : "never"} {p.backedUp && "· synced passkey"}
                </div>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label="Rename passkey" onClick={() => setRename({ id: p.id, name: p.name })}>
                <Pencil />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Revoke passkey" onClick={() => revoke(p)}>
                <Trash2 />
              </Button>
            </li>
          ))}
          {q.data && !q.data.length && <EmptyState icon={Fingerprint} title="No passkeys yet" description="Register this device to sign in without a password." className="py-8" />}
        </ul>
        <div className="flex flex-wrap items-end gap-2 border-t border-line p-4 sm:px-5">
          <Field label="Device name (optional)" className="min-w-48 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gate tablet, My Android phone" />
          </Field>
          <Button onClick={register} loading={busy} disabled={!support?.webauthn}>
            <Plus /> Register passkey on this device
          </Button>
        </div>
        {support && (
          <p className="px-4 pb-4 text-xs text-muted sm:px-5">
            {!support.webauthn
              ? "This browser does not support passkeys. Use a current version of Chrome, Safari or Edge over HTTPS."
              : support.platform
                ? "This device has a built-in authenticator (fingerprint, face or screen lock)."
                : "No built-in authenticator detected — you can still use a phone nearby or a USB/NFC security key."}
          </p>
        )}
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Lost your device?" />
          <p className="p-4 text-[13px] text-muted sm:px-5">
            Revoke its passkey here from another signed-in device, or ask a company administrator to issue a one-time recovery code from Supervisor Management. Recovery codes expire after 24 hours and work once.
          </p>
        </Card>
        <Card>
          <CardHeader title="Sessions" />
          <div className="p-4 sm:px-5">
            <Button variant="danger-outline" onClick={signOutAll}>
              <LogOut /> Sign out of all devices
            </Button>
          </div>
        </Card>
      </div>
      <Dialog
        open={!!rename}
        onOpenChange={(o) => !o && setRename(null)}
        title="Rename passkey"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRename(null)}>
              Cancel
            </Button>
            <Button onClick={saveRename}>Save</Button>
          </>
        }
      >
        <Input autoFocus value={rename?.name ?? ""} onChange={(e) => setRename(rename && { ...rename, name: e.target.value })} />
      </Dialog>
    </div>
  );
}

function Rules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api<any>("/settings") });
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setS(q.data.settings);
  }, [q.data]);
  if (!s) return <Skeleton className="h-64" />;
  const save = async () => {
    setBusy(true);
    try {
      await api("/settings", {
        method: "PATCH",
        body: {
          employeeIdPrefix: s.employeeIdPrefix,
          employeeIdPadding: Number(s.employeeIdPadding),
          overtimeEnabled: s.overtimeEnabled,
          overtimeThresholdMins: Number(s.overtimeThresholdMins),
          halfDayThresholdMins: Number(s.halfDayThresholdMins),
          incompleteAfterHours: Number(s.incompleteAfterHours),
          countLeaveInPercentage: s.countLeaveInPercentage,
          requireRegisterApproval: s.requireRegisterApproval,
          abbreviations: s.abbreviations,
        },
      });
      toast.success("Attendance rules saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (k: string, label: string, hint: string) => (
    <label className="flex items-start justify-between gap-4 rounded-md border border-line p-3">
      <span>
        <span className="text-[13.5px] font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <Switch checked={!!s[k]} onChange={(v) => setS({ ...s, [k]: v })} label={label} />
    </label>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Calculation rules" description="Applied by the server to every new or corrected attendance record. Shift-specific break and grace periods are set per shift." />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:px-5">
          <Field label="Overtime threshold (min)" hint="Minutes beyond scheduled net hours before overtime counts">
            <Input type="number" value={s.overtimeThresholdMins} onChange={(e) => setS({ ...s, overtimeThresholdMins: e.target.value })} />
          </Field>
          <Field label="Half-day below (min worked)" hint="Checked-out shifts shorter than this become Half Day">
            <Input type="number" value={s.halfDayThresholdMins} onChange={(e) => setS({ ...s, halfDayThresholdMins: e.target.value })} />
          </Field>
          <Field label="Flag missing check-out after (h)" hint="Hours after shift end before an open check-in is Incomplete">
            <Input type="number" value={s.incompleteAfterHours} onChange={(e) => setS({ ...s, incompleteAfterHours: e.target.value })} />
          </Field>
          <div className="hidden sm:block" />
          <div className="space-y-2 sm:col-span-2">
            {toggle("overtimeEnabled", "Calculate overtime", "Record overtime minutes on check-out")}
            {toggle("requireRegisterApproval", "Registers need admin approval", "Otherwise submitted registers are approved automatically")}
            {toggle("countLeaveInPercentage", "Count approved leave in attendance %", "Off: leave is excluded from the denominator (recommended)")}
          </div>
        </div>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Employee IDs" description="Format for automatically generated IDs" />
          <div className="grid grid-cols-2 gap-4 p-4 sm:px-5">
            <Field label="Prefix">
              <Input value={s.employeeIdPrefix} onChange={(e) => setS({ ...s, employeeIdPrefix: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Digits">
              <Input type="number" min={3} max={8} value={s.employeeIdPadding} onChange={(e) => setS({ ...s, employeeIdPadding: e.target.value })} />
            </Field>
            <p className="col-span-2 text-xs text-muted">
              Next IDs look like <b className="tabular text-fg">{s.employeeIdPrefix}{"1".padStart(Number(s.employeeIdPadding) || 4, "0")}</b>
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Muster-roll abbreviations" />
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:px-5">
            {Object.entries(s.abbreviations as Record<string, string>).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-[13px]">
                <Input value={v} maxLength={3} className="w-14 text-center font-semibold" onChange={(e) => setS({ ...s, abbreviations: { ...s.abbreviations, [k]: e.target.value } })} />
                {STATUS[k as keyof typeof STATUS]?.label ?? k}
              </label>
            ))}
          </div>
        </Card>
        <div className="flex justify-end">
          <Button onClick={save} loading={busy}>
            Save rules
          </Button>
        </div>
      </div>
    </div>
  );
}

function Holidays() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ["holidays", year], queryFn: () => api<any[]>("/holidays", { query: { year } }) });
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [siteId, setSite] = useState("");
  const add = async () => {
    try {
      await api("/holidays", { body: { date, name, siteId: siteId || null } });
      setDate("");
      setName("");
      toast.success("Holiday added");
      qc.invalidateQueries({ queryKey: ["holidays"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async (h: any) => {
    if ((await confirm({ title: `Remove ${h.name}?`, danger: true, confirmLabel: "Remove" })) === false) return;
    await api(`/holidays/${h.id}`, { method: "DELETE" }).catch((e) => toast.error(errorMessage(e)));
    qc.invalidateQueries({ queryKey: ["holidays"] });
  };
  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Holiday calendar"
        description="Holidays are shown on rosters and reports. Security posts usually stay staffed — mark a worker Holiday only where they were given the day off."
        action={
          <Select aria-label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} wrapperClassName="w-28">
            {[year - 1, year, year + 1].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
        }
      />
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {(q.data ?? []).map((h) => (
          <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <CalendarDays className="size-4 text-subtle" />
            <span className="w-32 text-[13px] tabular">{fmtDate(h.date, { weekday: "short", day: "2-digit", month: "short" })}</span>
            <span className="flex-1 text-[13.5px] font-medium">{h.name}</span>
            <Badge>{h.site?.name ?? "All sites"}</Badge>
            {can("settings.manage") && (
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${h.name}`} onClick={() => remove(h)}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
        {q.data && !q.data.length && <EmptyState title={`No holidays for ${year}`} className="py-8" />}
      </ul>
      {can("settings.manage") && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line p-4 sm:px-5">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Holiday" className="min-w-40 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Makar Sankranti" />
          </Field>
          <Field label="Applies to">
            <Select value={siteId} onChange={(e) => setSite(e.target.value)} wrapperClassName="w-44">
              <option value="">All sites</option>
              {me.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={add} disabled={!date || name.length < 2}>
            <Plus /> Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function Organizations() {
  const { switchOrg, me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["organizations"], queryFn: () => api<any[]>("/organizations") });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", code: "", legalName: "", address: "" });
  const create = async () => {
    try {
      await api("/organizations", { body: { ...f, legalName: f.legalName || null, address: f.address || null } });
      toast.success("Organization created");
      setOpen(false);
      setF({ name: "", code: "", legalName: "", address: "" });
      qc.invalidateQueries({ queryKey: ["organizations"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card>
      <CardHeader
        title="Organizations"
        description="Every record in WINDGUARD belongs to exactly one organization."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> New organization
          </Button>
        }
      />
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {(q.data ?? []).map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <Building2 className="size-5 text-subtle" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {o.name} <Badge>{o.code}</Badge> {o.id === me.organization.id && <Badge tone="primary">current</Badge>}
              </div>
              <div className="text-xs text-muted">
                {o._count.sites} sites · {o._count.employees} employees · {o._count.users} users · created {fmtDateTime(o.createdAt)}
              </div>
            </div>
            {o.id !== me.organization.id && (
              <Button size="sm" variant="outline" onClick={() => switchOrg(o.id)}>
                Switch to
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New organization"
        description="Default attendance rules and abbreviations are created automatically."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={f.name.length < 2 || f.code.length < 2}>
              Create
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Name" required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Code" required>
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Legal name">
            <Input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} />
          </Field>
          <Field label="Address">
            <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}

function Help() {
  const items = [
    {
      icon: Download,
      title: "Install WINDGUARD on a phone",
      body: "Android (Chrome): open the site, tap ⋮ → Install app. iPhone (Safari): tap Share → Add to Home Screen. On desktop Chrome/Edge use the install icon in the address bar. The installed app opens full-screen and keeps working offline.",
    },
    {
      icon: Fingerprint,
      title: "Sign in with fingerprint or face",
      body: "Settings → Passkeys & security → Register passkey on this device. Next time choose “Sign in with passkey”. The fingerprint or face scan is checked by the phone itself; WINDGUARD only receives a signed confirmation. Passkeys need HTTPS (localhost is allowed for testing).",
    },
    {
      icon: WifiOff,
      title: "Marking attendance without network",
      body: "Open each shift's register once while online (supervisors' registers for the day are saved automatically). If the network drops, keep marking — entries are stored on the device with their own timestamp and sync when the connection returns. Conflicts are never overwritten; review them under Attendance → Offline sync.",
    },
    {
      icon: ShieldCheck,
      title: "Correcting submitted attendance",
      body: "Once a register is submitted, open the row menu → Request correction. Give the reason; an administrator compares the previous and proposed values and approves or rejects. Every step is in the audit log.",
    },
    {
      icon: KeyRound,
      title: "A supervisor lost their phone",
      body: "Supervisor Management → ⋯ → Issue recovery code. Share the code in person. The supervisor uses “Lost your device?” on the sign-in page, sets a password and registers a passkey on the new phone. Revoke the old passkey from their account if needed.",
    },
    {
      icon: UserRound,
      title: "Workers never log in",
      body: "Employees are records in the directory, not users. Only administrators and supervisors have accounts; supervisors record IN/OUT on behalf of the workers at their sites.",
    },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((i) => (
        <Card key={i.title} className="p-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-md bg-primary-soft text-primary-ink">
              <i.icon className="size-4" />
            </span>
            <h3 className="font-display text-[15px] font-semibold">{i.title}</h3>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{i.body}</p>
        </Card>
      ))}
      <Card className="flex items-center gap-3 p-4 md:col-span-2">
        <LifeBuoy className="size-5 text-subtle" />
        <p className="text-[13px] text-muted">Need help from your company? Contact your WINDGUARD administrator. Version 1.0 · Every Shift. Every Worker. Accounted For.</p>
      </Card>
    </div>
  );
}
