/* WINDGUARD service worker
 * - App shell & static assets cached for offline launch.
 * - Pages: network-first, falling back to the last cached copy, then /offline.
 * - API calls are never cached here; the app keeps only minimal rosters in IndexedDB.
 * - Background Sync replays offline attendance when connectivity returns.
 * - Web Push displays server notifications.
 */
const VERSION = "wg-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const PAGE_CACHE = `${VERSION}-pages`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirstPage(request) {
  const url = new URL(request.url);
  const key = url.pathname; // one cached copy per route, query ignored
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic" && !url.pathname.startsWith("/login")) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(key, res.clone());
    }
    return res;
  } catch {
    const cache = await caches.open(PAGE_CACHE);
    return (
      (await cache.match(key)) ||
      (key.startsWith("/attendance") && (await cache.match("/attendance"))) ||
      (await cache.match("/")) ||
      (await caches.match("/offline"))
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) (await caches.open(ASSET_CACHE)).put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // always live
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.searchParams.has("_rsc")) return;
  if (/\.(png|svg|ico|woff2?|webmanifest)$/.test(url.pathname) || url.pathname.startsWith("/_next/image")) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ───────────── Background Sync: replay the IndexedDB attendance queue ─────────────

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("windguard", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      // The page creates the schema; nothing queued yet if we get here.
      const db = req.result;
      if (!db.objectStoreNames.contains("rosters")) db.createObjectStore("rosters", { keyPath: "key" }).createIndex("bySaved", "savedAt");
      if (!db.objectStoreNames.contains("queue")) {
        const q = db.createObjectStore("queue", { keyPath: "clientId" });
        q.createIndex("byState", "state");
        q.createIndex("byCreated", "createdAt");
      }
    };
  });
}

function all(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction("queue").objectStore("queue").index("byCreated").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function put(db, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite");
    for (const i of items) tx.objectStore("queue").put(i);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function replayQueue() {
  const db = await idb();
  const items = (await all(db)).filter((a) => a.state === "pending" || a.state === "failed");
  if (!items.length) return;
  const res = await fetch("/api/attendance/sync", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
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
    }),
  });
  if (!res.ok) throw new Error(`Sync failed ${res.status}`); // retried by the browser
  const results = await res.json();
  const now = new Date().toISOString();
  await put(
    db,
    items.map((i) => {
      const r = results.find((x) => x.clientId === i.clientId);
      if (!r) return i;
      return { ...i, state: r.result === "SYNCED" ? "synced" : r.result === "CONFLICT" ? "conflict" : "failed", message: r.message, server: r.server, attendanceId: r.attendanceId, syncedAt: now };
    }),
  );
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: "wg-sync-done" });
}

self.addEventListener("sync", (event) => {
  if (event.tag === "wg-attendance-sync") event.waitUntil(replayQueue());
});

// ───────────── Push notifications ─────────────

self.addEventListener("push", (event) => {
  let data = { title: "WINDGUARD", body: "", link: "/notifications" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* plain text */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link: data.link },
      tag: data.link,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(link);
          return c.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
