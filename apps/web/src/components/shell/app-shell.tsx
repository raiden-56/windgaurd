"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  ChevronsUpDown,
  CloudOff,
  CloudUpload,
  LayoutDashboard,
  ClipboardCheck,
  DoorOpen,
  LifeBuoy,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Check,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DemoChip } from "@/components/demo-gate";
import { Avatar } from "@/components/ui/display";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Sheet, Tip } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { DEMO } from "@/lib/base";
import { useAutoSync, useOnline, useQueueCounts } from "@/lib/connectivity";
import { ROLE_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { BrandMark, Wordmark } from "./brand";
import { isActive, NAV_GROUPS, type NavItem } from "./nav";
import { ThemeToggle } from "./theme";

function useUnread() {
  const { offlineSession } = useSession();
  return useQuery({
    queryKey: ["notifications", "count"],
    queryFn: () => api<{ unreadCount: number }>("/notifications", { query: { unread: "true" } }).then((r) => r.unreadCount),
    refetchInterval: 60_000,
    enabled: !offlineSession,
  });
}

function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const { can } = useSession();
  const unread = useUnread().data ?? 0;
  return (
    <nav className="flex flex-col gap-5" aria-label="Main">
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter((i) => !i.perm || can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.label}>
            {!collapsed && <div className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/35">{g.label}</div>}
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(item, path)} collapsed={collapsed} badge={item.href === "/notifications" ? unread : 0} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({ item, active, collapsed, badge, onNavigate }: { item: NavItem; active: boolean; collapsed?: boolean; badge?: number; onNavigate?: () => void }) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 items-center gap-3 rounded-md px-3 text-[13.5px] font-medium transition-colors",
        active ? "text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md bg-white/[0.09] ring-1 ring-inset ring-white/10" transition={{ type: "spring", stiffness: 500, damping: 42 }} />}
      {active && <motion.span layoutId="nav-bar" className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#14B8A6]" transition={{ type: "spring", stiffness: 500, damping: 42 }} />}
      <Icon className={cn("relative size-[18px] shrink-0", active ? "text-[#5EEAD4]" : "")} />
      {!collapsed && <span className="relative truncate">{item.label}</span>}
      {!!badge && (
        <span className={cn("relative ml-auto rounded bg-[#E04B4B] px-1.5 text-[10.5px] font-bold leading-[18px] text-white tabular", collapsed && "absolute right-1 top-1 ml-0 px-1 leading-4")}>{badge > 99 ? "99+" : badge}</span>
      )}
    </Link>
  );
  return collapsed ? (
    <Tip content={item.label} side="right">
      {link}
    </Tip>
  ) : (
    link
  );
}

function SidebarFooter({ collapsed }: { collapsed?: boolean }) {
  const { me, logout, switchOrg } = useSession();
  return (
    <div className="border-t border-white/10 p-3">
      {!collapsed && (
        <div className="mb-2 rounded-md bg-white/[0.04] px-3 py-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/35">Organization</div>
          {me.organizations.length > 1 ? (
            <Menu>
              <MenuTrigger className="mt-0.5 flex w-full items-center justify-between gap-2 text-left text-[13px] font-medium text-white/90 hover:text-white">
                <span className="truncate">{me.organization.name}</span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-white/50" />
              </MenuTrigger>
              <MenuContent align="start" className="w-64">
                <MenuLabel>Switch organization</MenuLabel>
                {me.organizations.map((o) => (
                  <MenuItem key={o.id} onSelect={() => o.id !== me.organization.id && switchOrg(o.id)}>
                    <Building2 />
                    <span className="flex-1 truncate">{o.name}</span>
                    {o.id === me.organization.id && <Check className="!text-primary" />}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          ) : (
            <div className="mt-0.5 truncate text-[13px] font-medium text-white/90">{me.organization.name}</div>
          )}
        </div>
      )}
      <Menu>
        <MenuTrigger className={cn("flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-white/[0.06]", collapsed && "justify-center")}>
          <Avatar name={me.user.fullName} className="size-8 ring-1 ring-white/15" />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-white">{me.user.fullName}</span>
              <span className="block truncate text-[11.5px] text-white/50">{ROLE_LABEL[me.user.role]}</span>
            </span>
          )}
          {!collapsed && <ChevronsUpDown className="size-3.5 text-white/40" />}
        </MenuTrigger>
        <MenuContent align="start" side="top" className="w-60">
          <MenuLabel>{me.user.email}</MenuLabel>
          <MenuItem asChild>
            <Link href="/settings">
              <UserRound /> Profile & security
            </Link>
          </MenuItem>
          <MenuItem asChild>
            <Link href="/settings?tab=help">
              <LifeBuoy /> Help & support
            </Link>
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => void logout()}>
            <LogOut /> Sign out
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

function ConnectivityChip() {
  const online = useOnline();
  const { pending, conflict } = useQueueCounts();
  const { offlineSession } = useSession();
  if (online && !pending && !conflict && !offlineSession) return null;
  const offline = !online || offlineSession;
  return (
    <Link
      href="/attendance/sync"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ring-1 ring-inset",
        offline ? "bg-warning-soft text-warning ring-warning/30" : conflict ? "bg-danger-soft text-danger ring-danger/30" : "bg-info-soft text-info ring-info/25",
      )}
    >
      {offline ? <CloudOff className="size-3.5" /> : <CloudUpload className="size-3.5" />}
      {offline ? "Offline" : conflict ? `${conflict} conflict${conflict > 1 ? "s" : ""}` : "Syncing"}
      {pending > 0 && <span className="tabular rounded bg-current/10 px-1">{pending} queued</span>}
    </Link>
  );
}

function SiteSwitcher() {
  const { me, siteId, setSiteId } = useSession();
  if (!me.sites.length) return null;
  const current = me.sites.find((s) => s.id === siteId);
  const allowAll = me.user.role !== "SUPERVISOR" || me.sites.length > 1;
  return (
    <Menu>
      <MenuTrigger className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium text-fg hover:border-line-strong">
        <span className={cn("size-2 shrink-0 rounded-full", current ? "bg-accent" : "bg-line-strong")} />
        <span className="truncate">{current ? current.name : allowAll ? "All sites" : me.sites[0]!.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-subtle" />
      </MenuTrigger>
      <MenuContent className="w-64">
        <MenuLabel>Site</MenuLabel>
        {allowAll && (
          <MenuItem onSelect={() => setSiteId("")}>
            <Building2 /> <span className="flex-1">All sites</span>
            {!siteId && <Check className="!text-primary" />}
          </MenuItem>
        )}
        {me.sites.map((s) => (
          <MenuItem key={s.id} onSelect={() => setSiteId(s.id)}>
            <span className="grid size-4 place-items-center text-[10px] font-bold text-subtle">{s.code.slice(0, 3)}</span>
            <span className="flex-1 truncate">{s.name}</span>
            {s.id === siteId && <Check className="!text-primary" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const unread = useUnread().data ?? 0;
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
        <button type="button" onClick={onMenu} className="grid size-9 place-items-center rounded-md text-muted hover:bg-sunken lg:hidden" aria-label="Open navigation">
          <MenuIcon className="size-5" />
        </button>
        <Link href="/" className="flex items-center gap-2 lg:hidden" aria-label="WINDGUARD home">
          <BrandMark className="size-7" />
        </Link>
        <div className="hidden sm:block">
          <SiteSwitcher />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {DEMO && <DemoChip />}
          <ConnectivityChip />
          <ThemeToggle />
          <Tip content="Notifications">
            <Link href="/notifications" className="relative grid size-9 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <Bell className="size-[18px]" />
              {unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[9.5px] font-bold leading-4 text-white ring-2 ring-bg">{unread > 9 ? "9+" : unread}</span>}
            </Link>
          </Tip>
        </div>
      </div>
      <div className="border-t border-line px-4 py-2 sm:hidden">
        <SiteSwitcher />
      </div>
    </header>
  );
}

function BottomNav({ onMore }: { onMore: () => void }) {
  const path = usePathname();
  const { can } = useSession();
  const unread = useUnread().data ?? 0;
  const items = [
    { href: "/", label: "Home", icon: LayoutDashboard, active: path === "/" },
    { href: "/attendance", label: "Attendance", icon: ClipboardCheck, active: path.startsWith("/attendance") },
    ...(can("gate.read") ? [{ href: "/gate", label: "Gate", icon: DoorOpen, active: path.startsWith("/gate") }] : []),
    { href: "/notifications", label: "Alerts", icon: Bell, active: path.startsWith("/notifications"), badge: unread },
  ];
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden no-print" aria-label="Quick navigation">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", i.active ? "text-primary-ink" : "text-muted")}>
              {i.active && <motion.span layoutId="bottom-active" className="absolute inset-x-5 top-0 h-0.5 rounded-b bg-primary" />}
              <span className="relative">
                <i.icon className="size-5" />
                {!!i.badge && <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[9px] font-bold leading-4 text-white">{i.badge > 9 ? "9+" : i.badge}</span>}
              </span>
              {i.label}
            </Link>
          </li>
        ))}
        <li>
          <button type="button" onClick={onMore} className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted">
            <MenuIcon className="size-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useAutoSync();

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("wg.sidebar") === "collapsed");
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("wg.sidebar", c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md">
        Skip to content
      </a>
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 68 : 252 }}
        transition={{ type: "spring", stiffness: 420, damping: 40 }}
        className="fixed inset-y-0 left-0 z-40 hidden flex-col bg-navy lg:flex no-print"
      >
        <div className={cn("flex h-14 items-center gap-2.5 border-b border-white/10 px-4", collapsed && "justify-center px-0")}>
          <BrandMark className="size-8" />
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <Wordmark light />
              <div className="text-[10.5px] text-white/45">Every shift. Every worker.</div>
            </div>
          )}
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
          <NavLinks collapsed={collapsed} />
        </div>
        <button
          type="button"
          onClick={toggle}
          className={cn("mx-3 mb-2 flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium text-white/50 hover:bg-white/[0.06] hover:text-white", collapsed && "justify-center px-0")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && "Collapse"}
        </button>
        <SidebarFooter collapsed={collapsed} />
      </motion.aside>

      <Sheet open={drawer} onOpenChange={setDrawer} side="left" className="bg-navy">
        <div className="flex h-full flex-col bg-navy">
          <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
            <BrandMark />
            <Wordmark light />
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <NavLinks onNavigate={() => setDrawer(false)} />
          </div>
          <SidebarFooter />
        </div>
      </Sheet>

      <div className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-[68px]" : "lg:pl-[252px]")}>
        <Topbar onMenu={() => setDrawer(true)} />
        <main id="main" className="mx-auto w-full max-w-[1520px] px-4 pb-24 pt-5 lg:px-6 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomNav onMore={() => setDrawer(true)} />
    </div>
  );
}
