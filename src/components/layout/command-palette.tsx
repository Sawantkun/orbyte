"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogOut, Plus, Upload } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { primaryNav, secondaryNav } from "@/config/navigation";
import { features } from "@/config/features";
import { useSignOut } from "./user-menu";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const signOut = useSignOut();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Jump to a page or run an action">
      <Command>
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {[...primaryNav, ...secondaryNav].map((item) => (
            <CommandItem
              key={item.href}
              value={[item.title, ...(item.keywords ?? [])].join(" ")}
              onSelect={() => run(() => router.push(item.href))}
            >
              <item.icon /> {item.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            disabled={!features.workflowStudio.available}
            onSelect={() => run(() => router.push("/workflows/new"))}
          >
            <Plus /> New workflow
            {!features.workflowStudio.available && <CommandShortcut>Milestone 2</CommandShortcut>}
          </CommandItem>
          <CommandItem disabled={!features.assetLibrary.available} onSelect={() => run(() => router.push("/assets?upload=1"))}>
            <Upload /> Upload asset
            {!features.assetLibrary.available && <CommandShortcut>Milestone 4</CommandShortcut>}
          </CommandItem>
          <CommandItem value="sign out log out" onSelect={() => run(() => void signOut())}>
            <LogOut /> Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
