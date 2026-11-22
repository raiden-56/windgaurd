"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Fingerprint, KeyRound, LogOut, MoreHorizontal, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Avatar, Badge, Card, PageHeader, Tabs } from "@/components/ui/display";
import { Checkbox, Field, Input, SearchInput, Select } from "@/components/ui/field";
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import { relTime, ROLE_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";

interface AppUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: "SUPER_ADMIN" | "COMPANY_ADMIN" | "SUPERVISOR" | "VIEWER";
  isActive: boolean;
  extraPermissions: string[];
  lastLoginAt: string | null;
  sites: { id: string; name: string; code: string; isPrimary: boolean }[];
  passkeys: number;
  recordsMarked: number;
  registersSubmitted30d: number;
  hasPassword: boolean;
}

const EXTRAS = [
  { key: "roster.manage", label: "Manage roster", hint: "Assign employees to shifts at their sites" },
  { key: "attendance.editHistorical", label: "Edit submitted registers", hint: "Change submitted attendance without a correction" },
];

export default function SupervisorsPage() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [role, setRole] = useState<string>("SUPERVISOR");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<AppUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; code: string; hours: number; email: string } | null>(null);
  const q = useQuery({ queryKey: ["users"], queryFn: () => api<AppUser[]>("/users") });
  const rows = (q.data ?? []).filter((u) => (!role || u.role === role) && (!search || `${u.fullName} ${u.email}`.toLowerCase().includes(search.toLowerCase())));
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const u of q.data ?? []) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [q.data]);

  const issueCode = async (u: AppUser) => {
    const ok = await confirm({ title: `Issue a recovery code for ${u.fullName}?`, description: "Use this when a supervisor lost their phone or passkey. The code works once and expires in 24 hours.", confirmLabel: "Issue code" });
    if (ok === false) return;
    try {
      const r = await api<{ code: string; expiresHours: number }>(`/users/${u.id}/recovery-code`, { method: "POST" });
      setSecret({ title: "Recovery code", code: r.code, hours: r.expiresHours, email: u.email });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const revoke = async (u: AppUser) => {
    if ((await confirm({ title: `Sign ${u.fullName} out everywhere?`, description: "All their sessions end immediately.", danger: true, confirmLabel: "Sign out everywhere" })) === false) return;
    try {
      await api(`/users/${u.id}/revoke-sessions`, { method: "POST" });
      toast.success("Sessions revoked");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const toggleActive = async (u: AppUser) => {
    if ((await confirm({ title: `${u.isActive ? "Deactivate" : "Reactivate"} ${u.fullName}?`, danger: u.isActive, confirmLabel: u.isActive ? "Deactivate" : "Reactivate" })) === false) return;
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body: { isActive: !u.isActive } });
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(u.isActive ? "User deactivated" : "User reactivated");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: ColumnDef<AppUser>[] = [
    {
      id: "name",
      header: "User",
      cell: ({ row: r }) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.original.fullName} />
          <div className="min-w-0">
            <div className="font-medium">{r.original.fullName}</div>
            <div className="truncate text-xs text-muted">{r.original.email}</div>
          </div>
        </div>
      ),
    },
    { id: "role", header: "Role", cell: ({ row: r }) => <Badge tone={r.original.role === "SUPERVISOR" ? "accent" : r.original.role === "VIEWER" ? "neutral" : "primary"}>{ROLE_LABEL[r.original.role]}</Badge> },
    {
      id: "sites",
      header: "Assigned sites",
      cell: ({ row: r }) => (
        <div className="flex flex-wrap gap-1">
          {r.original.role === "SUPERVISOR" ? (
            r.original.sites.length ? (
              r.original.sites.map((s) => (
                <Badge key={s.id} tone={s.isPrimary ? "navy" : "neutral"}>
                  {s.code}
                </Badge>
              ))
            ) : (
              <span className="text-xs font-medium text-danger">No site assigned</span>
            )
          ) : (
            <span className="text-xs text-muted">All sites</span>
          )}
        </div>
      ),
    },
    {
      id: "security",
      header: "Sign-in",
      cell: ({ row: r }) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          {r.original.passkeys ? <Fingerprint className="size-3.5 text-success" /> : <KeyRound className="size-3.5" />}
          {r.original.passkeys ? `${r.original.passkeys} passkey${r.original.passkeys > 1 ? "s" : ""}` : r.original.hasPassword ? "Password only" : "Setup pending"}
        </span>
      ),
    },
    { id: "activity", header: "Registers (30d)", meta: { align: "right" }, cell: ({ row: r }) => <span className="tabular">{r.original.registersSubmitted30d}</span> },
    { id: "marked", header: "Records marked", meta: { align: "right" }, cell: ({ row: r }) => <span className="tabular text-muted">{r.original.recordsMarked.toLocaleString("en-IN")}</span> },
    { id: "last", header: "Last sign-in", cell: ({ row: r }) => <span className="whitespace-nowrap text-xs text-muted">{relTime(r.original.lastLoginAt)}</span> },
    { id: "status", header: "Status", cell: ({ row: r }) => <Badge tone={r.original.isActive ? "success" : "neutral"} dot>{r.original.isActive ? "active" : "inactive"}</Badge> },
    {
      id: "actions",
      header: "",
      cell: ({ row: r }) =>
        can("users.manage") && r.original.id !== me.user.id ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="User actions">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setEdit(r.original)}>
                <Pencil /> Edit role & sites
              </MenuItem>
              <MenuItem onSelect={() => issueCode(r.original)}>
                <KeyRound /> Issue recovery code
              </MenuItem>
              <MenuItem onSelect={() => revoke(r.original)}>
                <LogOut /> Sign out everywhere
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger={r.original.isActive} onSelect={() => toggleActive(r.original)}>
                <ShieldCheck /> {r.original.isActive ? "Deactivate" : "Reactivate"}
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Supervisor management"
        description="Application users — administrators, site supervisors and auditors. Workers are managed separately in Employee Management and never receive accounts."
        actions={
          can("users.manage") && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add user
            </Button>
          )
        }
      />
      <Tabs
        className="mb-3"
        value={role}
        onChange={setRole}
        items={[
          { value: "SUPERVISOR", label: "Supervisors", count: counts.SUPERVISOR ?? 0 },
          { value: "COMPANY_ADMIN", label: "Administrators", count: (counts.COMPANY_ADMIN ?? 0) + (counts.SUPER_ADMIN ?? 0) },
          { value: "VIEWER", label: "Viewers / auditors", count: counts.VIEWER ?? 0 },
          { value: "", label: "All users" },
        ]}
      />
      <Card className="overflow-hidden">
        <div className="border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or email" className="w-full sm:w-72" />
        </div>
        <DataTable columns={columns} data={role === "COMPANY_ADMIN" ? (q.data ?? []).filter((u) => ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(u.role) && (!search || `${u.fullName} ${u.email}`.toLowerCase().includes(search.toLowerCase()))) : rows} loading={q.isLoading} getRowId={(r) => r.id} emptyTitle="No users" rowClassName={(r) => (!r.isActive ? "opacity-60" : undefined)} />
      </Card>
      <UserDialog
        open={creating || !!edit}
        user={edit}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEdit(null);
          }
        }}
        onCreated={(r, email) => r.setupCode && setSecret({ title: "Account setup code", code: r.setupCode, hours: r.setupCodeExpiresHours, email })}
      />
      <Dialog
        open={!!secret}
        onOpenChange={(o) => !o && setSecret(null)}
        title={secret?.title ?? ""}
        description="Shown once. Share it with the user in person or by phone — it lets them set a password and then register a passkey."
        size="sm"
        footer={<Button onClick={() => setSecret(null)}>Done</Button>}
      >
        {secret && (
          <div className="text-center">
            <div className="rounded-lg border border-dashed border-line-strong bg-surface-2 py-4 font-mono text-2xl font-bold tracking-[0.25em]">{secret.code}</div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => {
                navigator.clipboard.writeText(secret.code).then(() => toast.success("Copied"));
              }}
            >
              <Copy /> Copy
            </Button>
            <p className="mt-2 text-xs text-muted">
              For <b>{secret.email}</b> · valid for {secret.hours} hours · Login page → “Lost your device? Use a recovery code”.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function UserDialog({ open, onOpenChange, user, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; user: AppUser | null; onCreated: (r: any, email: string) => void }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const sites = useQuery({ queryKey: ["lookups"], queryFn: () => api<any>("/lookups"), staleTime: 300_000 });
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AppUser["role"]>("SUPERVISOR");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setFullName(user?.fullName ?? "");
    setEmail(user?.email ?? "");
    setPhone(user?.phone ?? "");
    setRole(user?.role ?? "SUPERVISOR");
    setSiteIds(user?.sites.map((s) => s.id) ?? []);
    setExtras(user?.extraPermissions ?? []);
  }, [open, user]);
  const submit = async () => {
    if (fullName.trim().length < 2) return setErr("Enter the full name");
    if (!user && !/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter a valid email");
    if (role === "SUPERVISOR" && !siteIds.length) return setErr("Assign at least one site to a supervisor");
    setBusy(true);
    setErr(null);
    try {
      const body = { fullName, phone: phone || null, role, siteIds: role === "SUPERVISOR" ? siteIds : [], extraPermissions: role === "SUPERVISOR" ? extras : [] };
      if (user) {
        await api(`/users/${user.id}`, { method: "PATCH", body });
        toast.success("User updated");
      } else {
        const r = await api("/users", { body: { ...body, email } });
        toast.success("User created");
        onCreated(r, email);
      }
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
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
      title={user ? `Edit ${user.fullName}` : "Add application user"}
      description={user ? "Role changes sign the user out of existing sessions." : "A one-time setup code is generated — no password is sent by email."}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {user ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Work email" required>
          <Input type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Mobile">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Role" className="sm:col-span-2">
          <Select value={role} onChange={(e) => setRole(e.target.value as AppUser["role"])}>
            <option value="SUPERVISOR">Site Supervisor — marks attendance at assigned sites</option>
            <option value="COMPANY_ADMIN">Company Admin — manages the company</option>
            <option value="VIEWER">Viewer / Auditor — read-only access</option>
            {me.user.role === "SUPER_ADMIN" && <option value="SUPER_ADMIN">Super Admin — all organizations</option>}
          </Select>
        </Field>
        {role === "SUPERVISOR" && (
          <>
            <Field label="Assigned sites" required hint="The first site is the primary site" className="sm:col-span-2">
              <div className="grid gap-1.5 rounded-md border border-line p-2 sm:grid-cols-2">
                {(sites.data?.sites ?? []).map((s: any) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-surface-2">
                    <Checkbox checked={siteIds.includes(s.id)} onChange={(e) => setSiteIds(e.target.checked ? [...siteIds, s.id] : siteIds.filter((x) => x !== s.id))} />
                    {s.name}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Additional authorizations" className="sm:col-span-2">
              <div className="space-y-1.5">
                {EXTRAS.map((x) => (
                  <label key={x.key} className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:bg-surface-2">
                    <Checkbox className="mt-0.5" checked={extras.includes(x.key)} onChange={(e) => setExtras(e.target.checked ? [...extras, x.key] : extras.filter((k) => k !== x.key))} />
                    <span>
                      <span className="font-medium">{x.label}</span>
                      <span className="block text-xs text-muted">{x.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          </>
        )}
        {err && <p className="text-[13px] font-medium text-danger sm:col-span-2">{err}</p>}
      </div>
    </Dialog>
  );
}
