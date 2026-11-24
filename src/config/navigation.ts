import {
  Blocks,
  Boxes,
  FolderKanban,
  LayoutDashboard,
  Play,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Keywords for the command palette. */
  keywords?: string[];
};

export const primaryNav: NavItem[] = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard, keywords: ["home", "dashboard"] },
  { title: "Workflows", href: "/workflows", icon: Workflow, keywords: ["studio", "automation"] },
  { title: "Assets", href: "/assets", icon: Boxes, keywords: ["library", "files", "images"] },
  { title: "Executions", href: "/executions", icon: Play, keywords: ["runs", "history", "logs"] },
  { title: "Collections", href: "/collections", icon: FolderKanban, keywords: ["folders"] },
  { title: "Integrations", href: "/integrations", icon: Blocks, keywords: ["providers", "api keys", "openai"] },
];

export const secondaryNav: NavItem[] = [
  { title: "Settings", href: "/settings/profile", icon: Settings, keywords: ["profile", "account", "security"] },
];

export function isActive(pathname: string, href: string) {
  if (href === "/settings/profile") return pathname.startsWith("/settings");
  return pathname === href || pathname.startsWith(href + "/");
}
