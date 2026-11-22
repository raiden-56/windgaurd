"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, getActiveOrg, setActiveOrg } from "./api";

export interface Me {
  user: { id: string; email: string; fullName: string; phone: string | null; role: "SUPER_ADMIN" | "COMPANY_ADMIN" | "SUPERVISOR" | "VIEWER"; hasPassword: boolean; lastLoginAt: string | null };
  permissions: string[];
  organization: { id: string; name: string; code: string; timezone: string };
  organizations: { id: string; name: string; code: string }[];
  sites: { id: string; name: string; code: string; timezone: string; district: string | null; state: string | null }[];
  passkeyCount: number;
}

interface SessionValue {
  me: Me;
  /** True when the session comes from the offline snapshot rather than the server. */
  offlineSession: boolean;
  can: (perm: string) => boolean;
  siteId: string;
  setSiteId: (id: string) => void;
  switchOrg: (id: string) => void;
  logout: () => Promise<void>;
  refresh: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);
const ME_KEY = "wg.me";
const SITE_KEY = "wg.site";

function readSnapshot(): Me | null {
  try {
    const raw = localStorage.getItem(ME_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [siteId, setSite] = useState("");
  const [offlineSession, setOfflineSession] = useState(false);
  const [snapshot, setSnapshot] = useState<Me | null>(null);

  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/auth/me"),
    retry: (count, err) => !(err instanceof ApiError) && count < 1,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    try {
      setSite(localStorage.getItem(SITE_KEY) ?? "");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (query.data) {
      setOfflineSession(false);
      try {
        localStorage.setItem(ME_KEY, JSON.stringify(query.data));
      } catch {
        /* ignore */
      }
      // Drop a remembered site the user can no longer access.
      if (siteId && !query.data.sites.some((s) => s.id === siteId)) setSite("");
    }
  }, [query.data, siteId]);

  useEffect(() => {
    if (!query.error) return;
    if (query.error instanceof ApiError && query.error.status === 401) {
      try {
        localStorage.removeItem(ME_KEY);
      } catch {
        /* ignore */
      }
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    // Network failure: continue with the previously authenticated session (offline mode).
    const snap = readSnapshot();
    if (snap) {
      setSnapshot(snap);
      setOfflineSession(true);
    } else router.replace("/login");
  }, [query.error, router, pathname]);

  useEffect(() => {
    const onUnauthorized = () => {
      if (!navigator.onLine) return;
      qc.invalidateQueries({ queryKey: ["me"] });
    };
    window.addEventListener("wg:unauthorized", onUnauthorized);
    return () => window.removeEventListener("wg:unauthorized", onUnauthorized);
  }, [qc]);

  const me = query.data ?? (offlineSession ? snapshot : null);

  const setSiteId = useCallback((id: string) => {
    setSite(id);
    try {
      localStorage.setItem(SITE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const switchOrg = useCallback(
    (id: string) => {
      setActiveOrg(id);
      setSiteId("");
      qc.clear();
      router.push("/");
      router.refresh();
    },
    [qc, router, setSiteId],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors on logout */
    }
    try {
      localStorage.removeItem(ME_KEY);
    } catch {
      /* ignore */
    }
    setActiveOrg(null);
    qc.clear();
    router.replace("/login");
  }, [qc, router]);

  const value = useMemo<SessionValue | null>(() => {
    if (!me) return null;
    const perms = new Set(me.permissions);
    return {
      me,
      offlineSession,
      can: (p) => perms.has(p),
      siteId,
      setSiteId,
      switchOrg,
      logout,
      refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
    };
  }, [me, offlineSession, siteId, setSiteId, switchOrg, logout, qc]);

  if (!value) return <>{fallback}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function useActiveOrgId() {
  return getActiveOrg();
}
