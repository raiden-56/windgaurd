"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { StatusBadge } from "@/components/ui/display";
import { addDaysISO, dayIn, fmtDateTime, fmtTime, localToISO, STATUS, type AttendanceStatus } from "@/lib/format";

export interface RegisterRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  location: string | null;
  status: AttendanceStatus;
  record: {
    id: string;
    status: AttendanceStatus;
    checkInAt: string | null;
    checkOutAt: string | null;
    workedMinutes: number | null;
    hoursFromSchedule?: boolean;
    overtimeMinutes?: number;
    lateMinutes?: number;
    isLate?: boolean;
    remarks: string | null;
    entryMode?: string;
    markedBy?: string | null;
    version: number;
    pendingCorrection?: boolean;
    syncedAt?: string | null;
    deviceRecordedAt?: string | null;
  } | null;
  queued?: number;
  conflict?: boolean;
}

/** Manual IN/OUT time entry — requires a reason that is written to the audit trail. */
export function ManualTimeDialog({
  open,
  onOpenChange,
  kind,
  row,
  workDate,
  shiftStart,
  overnight,
  tz,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: "in" | "out";
  row: RegisterRow | null;
  workDate: string;
  shiftStart: string;
  overnight: boolean;
  tz: string;
  onSubmit: (iso: string, reason: string) => Promise<void>;
}) {
  const [time, setTime] = useState("");
  const [day, setDay] = useState(workDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onOpen = (o: boolean) => {
    if (o) {
      setTime("");
      setReason("");
      setErr(null);
      setDay(workDate);
    }
    onOpenChange(o);
  };

  const changeTime = (v: string) => {
    setTime(v);
    // Overnight shift: a checkout earlier than the shift start belongs to the next calendar day.
    if (overnight && v) setDay(v < shiftStart ? addDaysISO(workDate, 1) : workDate);
  };

  const submit = async () => {
    if (!time) return setErr("Enter the time");
    if (reason.trim().length < 3) return setErr("Give a reason for the manual entry");
    const iso = localToISO(day, time, tz);
    if (new Date(iso).getTime() > Date.now() + 5 * 60_000) return setErr("Time cannot be in the future");
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(iso, reason.trim());
      onOpenChange(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open && !!row}
      onOpenChange={onOpen}
      title={kind === "in" ? "Record check-in time" : "Record check-out time"}
      description={row ? `${row.fullName} · ${row.employeeCode}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Save {kind === "in" ? "check-in" : "check-out"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Select value={day} onChange={(e) => setDay(e.target.value)}>
              <option value={workDate}>{workDate}</option>
              {overnight && <option value={addDaysISO(workDate, 1)}>{addDaysISO(workDate, 1)} (next day)</option>}
            </Select>
          </Field>
          <Field label="Time (24h)" required>
            <Input type="time" value={time} onChange={(e) => changeTime(e.target.value)} autoFocus />
          </Field>
        </div>
        <Field label="Reason for manual entry" required hint="Recorded in the audit log, e.g. copied from the paper gate register.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Gate tablet unavailable — time taken from paper register" />
        </Field>
        {err && <p className="text-[13px] font-medium text-danger">{err}</p>}
      </div>
    </Dialog>
  );
}

/** Correction request — historical attendance is never silently overwritten. */
export function CorrectionDialog({
  open,
  onOpenChange,
  row,
  workDate,
  tz,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: RegisterRow | null;
  workDate: string;
  tz: string;
  onSubmit: (body: { reason: string; proposed: Record<string, unknown> }) => Promise<void>;
}) {
  const rec = row?.record;
  const [status, setStatus] = useState("");
  const [inTime, setInTime] = useState("");
  const [inDay, setInDay] = useState(workDate);
  const [outTime, setOutTime] = useState("");
  const [outDay, setOutDay] = useState(workDate);
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onOpen = (o: boolean) => {
    if (o && rec) {
      setStatus("");
      setInTime(rec.checkInAt ? fmtTime(rec.checkInAt, tz) : "");
      setInDay(rec.checkInAt ? dayIn(rec.checkInAt, tz) : workDate);
      setOutTime(rec.checkOutAt ? fmtTime(rec.checkOutAt, tz) : "");
      setOutDay(rec.checkOutAt ? dayIn(rec.checkOutAt, tz) : workDate);
      setRemarks(rec.remarks ?? "");
      setReason("");
      setErr(null);
    }
    onOpenChange(o);
  };

  const submit = async () => {
    if (!rec) return;
    const proposed: Record<string, unknown> = {};
    if (status) proposed.status = status;
    const newIn = inTime ? localToISO(inDay, inTime, tz) : null;
    const newOut = outTime ? localToISO(outDay, outTime, tz) : null;
    const stamp = (iso: string | null) => (iso ? `${dayIn(iso, tz)} ${fmtTime(iso, tz)}` : "");
    if ((inTime ? `${inDay} ${inTime}` : "") !== stamp(rec.checkInAt)) proposed.checkInAt = newIn;
    if ((outTime ? `${outDay} ${outTime}` : "") !== stamp(rec.checkOutAt)) proposed.checkOutAt = newOut;
    if ((remarks || null) !== (rec.remarks || null)) proposed.remarks = remarks || null;
    if (!Object.keys(proposed).length) return setErr("Change at least one value");
    if (reason.trim().length < 5) return setErr("Explain the correction (at least 5 characters)");
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({ reason: reason.trim(), proposed });
      onOpenChange(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open && !!rec}
      onOpenChange={onOpen}
      title="Request attendance correction"
      description={row ? `${row.fullName} · ${row.employeeCode} · ${workDate}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Submit for approval
          </Button>
        </>
      }
    >
      {rec && (
        <div className="grid gap-4">
          <div className="rounded-md border border-line bg-surface-2 p-3 text-[13px]">
            <div className="mb-1.5 text-xs font-semibold text-muted">Current values</div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <StatusBadge status={rec.status} />
              <span>
                In <b className="tabular">{rec.checkInAt ? fmtDateTime(rec.checkInAt, tz) : "—"}</b>
              </span>
              <span>
                Out <b className="tabular">{rec.checkOutAt ? fmtDateTime(rec.checkOutAt, tz) : "—"}</b>
              </span>
            </div>
          </div>
          <Field label="Corrected status" hint="Leave unchanged to keep the status (or let it be recalculated from the times).">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">— unchanged —</option>
              {(["PRESENT", "ABSENT", "LEAVE", "HALF_DAY", "WEEKLY_OFF", "HOLIDAY", "INCOMPLETE"] as AttendanceStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in">
              <div className="flex gap-1.5">
                <Input type="date" value={inDay} onChange={(e) => setInDay(e.target.value)} className="min-w-0" />
                <Input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} className="w-28 shrink-0" />
              </div>
            </Field>
            <Field label="Check-out">
              <div className="flex gap-1.5">
                <Input type="date" value={outDay} onChange={(e) => setOutDay(e.target.value)} className="min-w-0" />
                <Input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} className="w-28 shrink-0" />
              </div>
            </Field>
          </div>
          <Field label="Remarks">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <Field label="Reason for correction" required hint="An administrator reviews previous vs updated values before anything changes.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Check-out recorded before crane escort duty ended" />
          </Field>
          {err && <p className="text-[13px] font-medium text-danger">{err}</p>}
        </div>
      )}
    </Dialog>
  );
}

export function RemarksDialog({ open, onOpenChange, row, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; row: RegisterRow | null; onSubmit: (remarks: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open && !!row}
      onOpenChange={(o) => {
        if (o) setValue(row?.record?.remarks ?? "");
        onOpenChange(o);
      }}
      title="Remarks"
      description={row ? `${row.fullName} · ${row.employeeCode}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(value.trim());
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Textarea autoFocus value={value} maxLength={500} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Deployed to T17 for fence repair escort" />
    </Dialog>
  );
}
