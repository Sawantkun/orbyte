"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { Monitor } from "lucide-react";
import { toast } from "sonner";
import { revokeSession } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type SessionRow = {
  id: string;
  device: string;
  ipAddress: string;
  lastActive: string;
  current: boolean;
};

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<SessionRow | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmRevoke() {
    if (!target) return;
    const id = target.id;
    startTransition(async () => {
      const result = await revokeSession(id);
      setTarget(null);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Session signed out");
        router.refresh();
      }
    });
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            <Monitor className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="truncate">{s.device}</span>
                {s.current && <Badge variant="secondary">This device</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {s.ipAddress} · Active {formatDistanceToNowStrict(new Date(s.lastActive), { addSuffix: true })}
              </p>
            </div>
            {!s.current && (
              <Button variant="ghost" size="sm" onClick={() => setTarget(s)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out this session?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.device} will be signed out immediately and will need to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmRevoke} disabled={pending}>
              Sign out session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
