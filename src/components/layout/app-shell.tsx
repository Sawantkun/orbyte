"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { FolderPlus, Menu, Plus, Search, Upload, Workflow } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { ActivityItem } from "@/lib/activity";
import { cn } from "@/lib/utils";
import { SIDEBAR_COOKIE } from "./constants";
import { CommandPalette } from "./command-palette";
import { Notifications } from "./notifications";
import { SidebarNav } from "./sidebar-nav";
import type { ShellUser } from "./types";


export function AppShell({
  user,
  defaultCollapsed,
  activity,
  children,
}: {
  user: ShellUser;
  defaultCollapsed: boolean;
  activity: ActivityItem[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = usePathname();
  // The workflow editor is a full-bleed canvas without page padding.
  const fullBleed = /^\/workflows\/(?!new$)[^/]+$/.test(pathname);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-sidebar transition-[width] duration-200 md:block",
          collapsed || fullBleed ? "w-[60px]" : "w-60",
        )}
      >
        {/* The Studio needs the width; the sidebar collapses while it is open. */}
        <SidebarNav user={user} collapsed={collapsed || fullBleed} onToggle={fullBleed ? undefined : toggle} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <SidebarNav user={user} collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-4" />
          </Button>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-muted-foreground transition-colors hover:border-[color-mix(in_oklab,var(--ob-border),white_12%)] hover:text-foreground"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="hidden rounded border border-border bg-card px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            <Notifications items={activity} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 gap-1.5">
                  <Plus className="size-4" /> <span className="hidden sm:inline">Create</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <CreateItem href="/workflows/new" icon={Workflow} label="New workflow" />
                <CreateItem href="/assets?upload=1" icon={Upload} label="Upload asset" />
                <CreateItem href="/collections" icon={FolderPlus} label="New collection" />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {fullBleed ? (
          <main id="main" className="h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden">
            {children}
          </main>
        ) : (
          <main id="main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        )}
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function CreateItem({ href, icon: Icon, label }: { href: string; icon: typeof Plus; label: string }) {
  return (
    <DropdownMenuItem asChild>
      <Link href={href}>
        <Icon /> {label}
      </Link>
    </DropdownMenuItem>
  );
}
