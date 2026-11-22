import {
  ArrowDownUp,
  Bell,
  BookOpenCheck,
  CalendarClock,
  ChartLine,
  ClipboardCheck,
  DoorOpen,
  FileChartColumn,
  LayoutDashboard,
  MapPinned,
  ScrollText,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: string;
  match?: (path: string) => boolean;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operations",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard, perm: "attendance.read", match: (p) => p === "/" },
      { href: "/attendance", label: "Attendance", icon: ClipboardCheck, perm: "attendance.read" },
      { href: "/shifts", label: "Shift Management", icon: CalendarClock, perm: "shifts.read" },
      { href: "/gate", label: "Gate Register", icon: DoorOpen, perm: "gate.read" },
    ],
  },
  {
    label: "Workforce",
    items: [
      { href: "/employees", label: "Employee Management", icon: Users, perm: "employees.read" },
      { href: "/supervisors", label: "Supervisor Management", icon: UserCog, perm: "users.read" },
      { href: "/sites", label: "Site Management", icon: MapPinned, perm: "sites.read" },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/reports", label: "Attendance Reports", icon: FileChartColumn, perm: "reports.read" },
      { href: "/muster-roll", label: "Digital Muster Roll", icon: BookOpenCheck, perm: "reports.read" },
      { href: "/analytics", label: "Workforce Analytics", icon: ChartLine, perm: "reports.read" },
      { href: "/import-export", label: "Import / Export", icon: ArrowDownUp, perm: "reports.export" },
      { href: "/audit", label: "Audit Logs", icon: ScrollText, perm: "audit.read" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function isActive(item: NavItem, path: string) {
  if (item.match) return item.match(path);
  return path === item.href || path.startsWith(`${item.href}/`);
}
