"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, X } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/overlay";
import { api, errorMessage } from "@/lib/api";
import { DAYS } from "@/lib/format";

const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").or(z.literal(""));

export const employeeSchema = z.object({
  employeeCode: z.string().trim().max(20).regex(/^[A-Za-z0-9\-_/]*$/, "Letters, digits, - _ / only"),
  fullName: z.string().trim().min(2, "Name is required").max(120).refine((v) => !/\d/.test(v), "Name should not contain digits"),
  phone: z.string().trim().regex(/^((\+?\d{1,3}[\s-]?)?\d{10})?$/, "Enter a 10-digit mobile number"),
  address: z.string().max(300),
  dateOfBirth: optDate,
  emergencyContact: z.string().max(120),
  designation: z.string().trim().min(2, "Designation is required").max(80),
  department: z.string().max(80),
  joiningDate: optDate,
  employmentType: z.enum(["PERMANENT", "CONTRACT", "TEMPORARY", "TRAINEE"]),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "RESIGNED", "TERMINATED"]),
  siteId: z.string(),
  locationId: z.string(),
  defaultShiftId: z.string(),
  weeklyOffDay: z.string(),
  remarks: z.string().max(1000),
  photoUrl: z.string().nullable(),
});
export type EmployeeFormValues = z.infer<typeof employeeSchema>;

const EMPTY: EmployeeFormValues = {
  employeeCode: "",
  fullName: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  emergencyContact: "",
  designation: "Security Guard",
  department: "Security",
  joiningDate: "",
  employmentType: "CONTRACT",
  status: "ACTIVE",
  siteId: "",
  locationId: "",
  defaultShiftId: "",
  weeklyOffDay: "",
  remarks: "",
  photoUrl: null,
};

/** Downscales a photo to at most 320px so it can be stored with the record. */
async function toDataUrl(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 320 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function EmployeeSheet({ open, onOpenChange, employee, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; employee?: any; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api<any>("/lookups"), staleTime: 300_000 });
  const nextCode = useQuery({ queryKey: ["next-code"], queryFn: () => api<{ code: string }>("/employees/next-code"), enabled: open && !employee });
  const form = useForm<EmployeeFormValues>({ resolver: zodResolver(employeeSchema), defaultValues: EMPTY });
  const { register, handleSubmit, watch, setValue, reset, formState } = form;
  const e = formState.errors;

  useEffect(() => {
    if (!open) return;
    if (employee) {
      reset({
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        phone: employee.phone ?? "",
        address: employee.address ?? "",
        dateOfBirth: employee.dateOfBirth?.slice(0, 10) ?? "",
        emergencyContact: employee.emergencyContact ?? "",
        designation: employee.designation?.name ?? "",
        department: employee.department?.name ?? "",
        joiningDate: employee.joiningDate?.slice(0, 10) ?? "",
        employmentType: employee.employmentType,
        status: employee.status,
        siteId: employee.site?.id ?? employee.siteId ?? "",
        locationId: employee.location?.id ?? employee.locationId ?? "",
        defaultShiftId: employee.defaultShift?.id ?? employee.defaultShiftId ?? "",
        weeklyOffDay: employee.weeklyOffDay != null ? String(employee.weeklyOffDay) : "",
        remarks: employee.remarks ?? "",
        photoUrl: employee.photoUrl ?? null,
      });
    } else reset(EMPTY);
  }, [open, employee, reset]);

  const siteId = watch("siteId");
  const photo = watch("photoUrl");
  const shifts = (lookups.data?.shifts ?? []).filter((s: any) => s.siteId === siteId && s.isActive);
  const locations = (lookups.data?.locations ?? []).filter((l: any) => l.siteId === siteId);

  const submit = handleSubmit(async (v) => {
    const body = {
      ...v,
      employeeCode: employee ? undefined : v.employeeCode || null,
      phone: v.phone || null,
      dateOfBirth: v.dateOfBirth || null,
      joiningDate: v.joiningDate || null,
      siteId: v.siteId || null,
      locationId: v.locationId || null,
      defaultShiftId: v.defaultShiftId || null,
      weeklyOffDay: v.weeklyOffDay === "" ? null : Number(v.weeklyOffDay),
      department: v.department || null,
      emergencyContact: v.emergencyContact || null,
      address: v.address || null,
      remarks: v.remarks || null,
    };
    try {
      const saved = employee ? await api(`/employees/${employee.id}`, { method: "PATCH", body }) : await api("/employees", { body });
      toast.success(employee ? "Employee updated" : `Employee ${saved.employeeCode} created`);
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee", saved.id] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      onOpenChange(false);
      onSaved?.(saved.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={employee ? `Edit ${employee.fullName}` : "Add employee"}
      description={employee ? `${employee.employeeCode} · changes are recorded in the audit log` : "Workers do not get a login. Supervisors record their attendance."}
      className="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={formState.isSubmitting}>
            {employee ? "Save changes" : "Create employee"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6 p-5" noValidate>
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">Personal information</h3>
          <div className="mb-4 flex items-center gap-4">
            {photo ? <img src={photo} alt="" className="size-16 rounded-full object-cover ring-1 ring-line" /> : <Avatar name={watch("fullName") || "New"} className="size-16 text-lg" />}
            <div className="flex gap-2">
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2">
                <Camera className="size-4" /> {photo ? "Change photo" : "Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (ev) => {
                    const f = ev.target.files?.[0];
                    if (!f) return;
                    if (f.size > 8 * 1024 * 1024) return toast.error("Choose an image under 8 MB");
                    setValue("photoUrl", await toDataUrl(f), { shouldDirty: true });
                  }}
                />
              </label>
              {photo && (
                <Button variant="ghost" size="sm" onClick={() => setValue("photoUrl", null, { shouldDirty: true })}>
                  <X /> Remove
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={e.fullName?.message} className="sm:col-span-2">
              <Input {...register("fullName")} aria-invalid={!!e.fullName} placeholder="Ramesh Kumar Patel" />
            </Field>
            <Field label="Employee ID" error={e.employeeCode?.message} hint={employee ? "Cannot be changed" : `Leave blank to auto-generate (${nextCode.data?.code ?? "…"})`}>
              <Input {...register("employeeCode")} disabled={!!employee} placeholder={nextCode.data?.code} className="uppercase" />
            </Field>
            <Field label="Mobile number" error={e.phone?.message}>
              <Input {...register("phone")} type="tel" inputMode="tel" placeholder="98765 43210" aria-invalid={!!e.phone} />
            </Field>
            <Field label="Date of birth" error={e.dateOfBirth?.message}>
              <Input type="date" {...register("dateOfBirth")} />
            </Field>
            <Field label="Emergency contact">
              <Input {...register("emergencyContact")} placeholder="Name (relation) number" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea {...register("address")} className="min-h-16" />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">Employment</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Designation" required error={e.designation?.message}>
              <Input {...register("designation")} list="designations" />
              <datalist id="designations">
                {(lookups.data?.designations ?? []).map((d: any) => (
                  <option key={d.id} value={d.name} />
                ))}
              </datalist>
            </Field>
            <Field label="Department">
              <Input {...register("department")} list="departments" />
              <datalist id="departments">
                {(lookups.data?.departments ?? []).map((d: any) => (
                  <option key={d.id} value={d.name} />
                ))}
              </datalist>
            </Field>
            <Field label="Joining date" error={e.joiningDate?.message}>
              <Input type="date" {...register("joiningDate")} />
            </Field>
            <Field label="Employment type">
              <Select {...register("employmentType")}>
                <option value="CONTRACT">Contract</option>
                <option value="PERMANENT">Permanent</option>
                <option value="TEMPORARY">Temporary</option>
                <option value="TRAINEE">Trainee</option>
              </Select>
            </Field>
            <Field label="Status">
              <Select {...register("status")}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="RESIGNED">Resigned</option>
                <option value="TERMINATED">Terminated</option>
              </Select>
            </Field>
            <Field label="Weekly off">
              <Select {...register("weeklyOffDay")}>
                <option value="">No fixed day</option>
                {DAYS.map((d, i) => (
                  <option key={d} value={String(i)}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">Deployment</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assigned site" hint={employee?.site && siteId !== employee.site.id ? "Changing the site records a transfer in the history" : undefined}>
              <Select
                {...register("siteId", {
                  onChange: () => {
                    setValue("defaultShiftId", "");
                    setValue("locationId", "");
                  },
                })}
              >
                <option value="">— unassigned —</option>
                {(lookups.data?.sites ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Deployment point">
              <Select {...register("locationId")} disabled={!siteId}>
                <option value="">— any —</option>
                {locations.map((l: any) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default shift" hint="Used to build the daily roster" className="sm:col-span-2">
              <Select {...register("defaultShiftId")} disabled={!siteId}>
                <option value="">— none —</option>
                {shifts.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Internal remarks" className="sm:col-span-2">
              <Textarea {...register("remarks")} className="min-h-16" placeholder="Visible to administrators only" />
            </Field>
          </div>
        </section>
      </form>
    </Sheet>
  );
}
