"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { OrbyteLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isActive, primaryNav, secondaryNav, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";
import type { ShellUser } from "./types";

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.title : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
        active
          ? "bg-elevated text-foreground"
          : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-[var(--ob-accent-2)]")} />
      {!collapsed && <span className="truncate">{item.title}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}

export function SidebarNav({
  user,
  collapsed,
  onToggle,
  onNavigate,
}: {
  user: ShellUser;
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 items-center px-4", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" onClick={onNavigate} aria-label="Orbyte overview">
          <OrbyteLogo collapsed={collapsed} />
        </Link>
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 px-2 py-2">
        {primaryNav.map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
        <div className="mt-auto flex flex-col gap-0.5 pt-4">
          {secondaryNav.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
          {onToggle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className={cn("h-8 justify-start gap-2.5 px-2.5 font-normal text-muted-foreground", collapsed && "justify-center px-0")}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              {!collapsed && "Collapse"}
            </Button>
          )}
        </div>
      </nav>

      <div className="border-t border-border p-2">
        <UserMenu user={user} collapsed={collapsed} />
      </div>
    </div>
  );
}
