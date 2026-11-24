"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-border bg-card px-6 py-16 text-center">
      <AlertTriangle className="mb-3 size-6 text-warning" />
      <h2 className="font-medium">Something went wrong</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        This page failed to load. Try again, and if it keeps happening, quote reference{" "}
        <code className="font-mono text-xs">{error.digest ?? "n/a"}</code>.
      </p>
      <Button className="mt-5" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
