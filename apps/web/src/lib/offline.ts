"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { api } from "./api";
import { uid } from "./utils";
import type { AttendanceStatus } from "./format";

/**
 * Offline attendance store (IndexedDB).
 * - rosters: minimal register snapshots (no phone numbers or addresses) so a supervisor
 *   can keep marking attendance with no connectivity.
 * - queue: attendance actions captured offline, each with a client-generated id and the
 *   device timestamp. The server applies them idempotently and reports conflicts.
 */

export interface RosterRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  location: string | null;
  status: AttendanceStatus;
  record: { id: string; status: AttendanceStatus; checkInAt: string | null; checkOutAt: string | null; version: number; remarks: string | null } | null;
}

export interface RosterSnapshot {
  key: string;
  savedAt: string;
  siteId: string;
  siteName: string;
  timezone: string;
  shiftId: string;
  shiftName: string;
  shiftStart: string;
  shiftEnd: string;
  workDate: string;
  registerStatus: string;
  rows: RosterRow[];
}

export type QueueState = "pending" | "syncing" | "synced" | "conflict" | "failed";

export interface QueuedAction {
  clientId: string;
  action: "MARK" | "CHECK_IN" | "CHECK_OUT";
  siteId: string;
  shiftId: string;
  workDate: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  status?: AttendanceStatus;
  time?: string | null;
  remarks?: string | null;
  deviceRecordedAt: string;
  baseVersion: number | null;
  prevClientId: string | null;
  userId: string;
  state: QueueState;
  message?: string;
  server?: unknown;
  attendanceId?: string;
  createdAt: number;
  syncedAt?: string;
}

interface WGDB extends DBSchema {
  rosters: { key: string; value: RosterSnapshot; indexes: { bySaved: string } };
  queue: { key: string; value: QueuedAction; indexes: { byState: string; byCreated: number } };
}

let dbPromise: Promise<IDBPDatabase<WGDB>> | null = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB<WGDB>("windguard", 1, {
      upgrade(d) {
        const r = d.createObjectStore("rosters", { keyPath: "key" });
        r.createIndex("bySaved", "savedAt");
        const q = d.createObjectStore("queue", { keyPath: "clientId" });
        q.createIndex("byState", "state");
        q.createIndex("byCreated", "createdAt");
      },
    });
  }
  return dbPromise;
}

export const rosterKey = (siteId: string, shiftId: string, workDate: string) => `${siteId}|${shiftId}|${workDate}`;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wg:queue-changed"));
}

export async function saveRoster(snap: Omit<RosterSnapshot, "key" | "savedAt">) {
  const d = await db();
  await d.put("rosters", { ...snap, key: rosterKey(snap.siteId, snap.shiftId, snap.workDate), savedAt: new Date().toISOString() });
  // Keep only recent snapshots — no unnecessary long-term caching of workforce data.
  const cutoff = new Date(Date.now() - 3 * 86400_000).toISOString();
  const tx = d.transaction("rosters", "readwrite");
  let cursor = await tx.store.index("bySaved").openCursor(IDBKeyRange.upperBound(cutoff));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getRoster(siteId: string, shiftId: string, workDate: string) {
  return (await db()).get("rosters", rosterKey(siteId, shiftId, workDate));
}

export async function listRosters() {
  return (await db()).getAll("rosters");
}

export async function listQueue() {
  const all = await (await db()).getAllFromIndex("queue", "byCreated");
  return all;
}

export async function queueCounts() {
  const all = await listQueue();
  return {
    pending: all.filter((a) => a.state === "pending" || a.state === "failed" || a.state === "syncing").length,
    conflict: all.filter((a) => a.state === "conflict").length,
    synced: all.filter((a) => a.state === "synced").length,
  };
}

/** Records an attendance action on the device. */
export async function enqueue(input: Omit<QueuedAction, "clientId" | "state" | "createdAt" | "deviceRecordedAt" | "baseVersion" | "prevClientId"> & { snapshotVersion: number | null }) {
  const d = await db();
  const all = await d.getAllFromIndex("queue", "byCreated");
  const chain = all
    .filter((a) => a.employeeId === input.employeeId && a.shiftId === input.shiftId && a.workDate === input.workDate && a.state !== "synced" && a.state !== "conflict")
    .pop();
  const { snapshotVersion, ...rest } = input;
  const item: QueuedAction = {
    ...rest,
    clientId: uid(),
    deviceRecordedAt: new Date().toISOString(),
    baseVersion: chain ? null : snapshotVersion,
    prevClientId: chain?.clientId ?? null,
    state: "pending",
    createdAt: Date.now(),
  };
  await d.put("queue", item);
  emit();
  void requestBackgroundSync();
  return item;
}

async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sync = (reg as any)?.sync;
    if (sync) await sync.register("wg-attendance-sync");
  } catch {
    /* Background Sync not supported — the app syncs when it regains connectivity. */
  }
}

let syncing: Promise<{ synced: number; conflicts: number; failed: number }> | null = null;

/** Sends every pending/failed action to the server in capture order. */
export function syncNow() {
  if (syncing) return syncing;
  syncing = (async () => {
    const d = await db();
    const items = (await d.getAllFromIndex("queue", "byCreated")).filter((a) => a.state === "pending" || a.state === "failed" || a.state === "syncing");
    if (!items.length) return { synced: 0, conflicts: 0, failed: 0 };
    for (const i of items) await d.put("queue", { ...i, state: "syncing" });
    emit();
    try {
      const results = await api<{ clientId: string; result: "SYNCED" | "CONFLICT" | "FAILED"; message?: string; server?: unknown; attendanceId?: string }[]>("/attendance/sync", {
        body: {
          actions: items.map((i) => ({
            clientId: i.clientId,
            action: i.action,
            siteId: i.siteId,
            shiftId: i.shiftId,
            workDate: i.workDate,
            employeeId: i.employeeId,
            status: i.status,
            time: i.time ?? null,
            remarks: i.remarks ?? null,
            deviceRecordedAt: i.deviceRecordedAt,
            baseVersion: i.baseVersion,
            prevClientId: i.prevClientId,
          })),
        },
      });
      const now = new Date().toISOString();
      for (const r of results) {
        const item = items.find((i) => i.clientId === r.clientId);
        if (!item) continue;
        await d.put("queue", {
          ...item,
          state: r.result === "SYNCED" ? "synced" : r.result === "CONFLICT" ? "conflict" : "failed",
          message: r.message,
          server: r.server,
          attendanceId: r.attendanceId,
          syncedAt: now,
        });
      }
      emit();
      return {
        synced: results.filter((r) => r.result === "SYNCED").length,
        conflicts: results.filter((r) => r.result === "CONFLICT").length,
        failed: results.filter((r) => r.result === "FAILED").length,
      };
    } catch (err) {
      for (const i of items) await d.put("queue", { ...i, state: "failed", message: err instanceof Error ? err.message : "Sync failed" });
      emit();
      throw err;
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export async function discard(clientId: string) {
  await (await db()).delete("queue", clientId);
  emit();
}

export async function clearSynced() {
  const d = await db();
  const all = await d.getAll("queue");
  for (const a of all) if (a.state === "synced") await d.delete("queue", a.clientId);
  emit();
}

/** Overlays unsynced device actions onto a roster so the supervisor sees their own entries. */
export function applyQueue(rows: RosterRow[], queue: QueuedAction[], slot: { siteId: string; shiftId: string; workDate: string }) {
  const relevant = queue.filter((q) => q.siteId === slot.siteId && q.shiftId === slot.shiftId && q.workDate === slot.workDate && q.state !== "synced");
  if (!relevant.length) return { rows, pendingByEmp: new Map<string, QueuedAction[]>() };
  const pendingByEmp = new Map<string, QueuedAction[]>();
  for (const q of relevant) pendingByEmp.set(q.employeeId, [...(pendingByEmp.get(q.employeeId) ?? []), q]);
  const out = rows.map((r) => {
    const acts = pendingByEmp.get(r.employeeId);
    if (!acts) return r;
    let row = { ...r, record: r.record ? { ...r.record } : null };
    for (const a of acts) {
      if (a.state === "conflict") continue;
      const rec = row.record ?? { id: "", status: "PENDING" as AttendanceStatus, checkInAt: null, checkOutAt: null, version: 0, remarks: null };
      if (a.action === "MARK" && a.status) rec.status = a.status;
      if (a.action === "CHECK_IN") {
        rec.status = "ON_DUTY";
        rec.checkInAt = a.time ?? a.deviceRecordedAt;
      }
      if (a.action === "CHECK_OUT") {
        rec.status = "PRESENT";
        rec.checkOutAt = a.time ?? a.deviceRecordedAt;
      }
      row = { ...row, status: rec.status, record: rec };
    }
    return row;
  });
  return { rows: out, pendingByEmp };
}
