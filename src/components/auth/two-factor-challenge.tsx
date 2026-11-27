"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Second sign-in step: an authenticator code, or one of the backup codes. */
export function TwoFactorChallenge({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const clean = mode === "totp" ? code.replace(/\s+/g, "") : code.trim();
    const { error } =
      mode === "totp" ? await authClient.twoFactor.verifyTotp({ code: clean, trustDevice: trust }) : await authClient.twoFactor.verifyBackupCode({ code: clean, trustDevice: trust });
    setBusy(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : error.code === "INVALID_TWO_FACTOR_COOKIE" || error.status === 401
            ? "Your sign-in timed out. Sign in again."
            : mode === "totp"
              ? "That code didn't work. Codes change every 30 seconds; try the current one."
              : "That backup code didn't work, or it was already used.",
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      className="space-y-5"
    >
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}{" "}
          {error.includes("timed out") && (
            <Link href="/login" className="underline underline-offset-4">
              Sign in
            </Link>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="code">{mode === "totp" ? "Authentication code" : "Backup code"}</Label>
        <Input
          id="code"
          autoFocus
          autoComplete="one-time-code"
          inputMode={mode === "totp" ? "numeric" : "text"}
          maxLength={mode === "totp" ? 7 : 32}
          placeholder={mode === "totp" ? "123 456" : "xxxxx-xxxxx"}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="text-center font-mono tracking-widest"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="size-4 accent-[var(--ob-accent)]" />
        Trust this device for 30 days
      </label>
      <Button type="submit" className="h-9 w-full" disabled={busy || !code.trim()}>
        {busy && <Loader2 className="animate-spin" />} Verify
      </Button>
      <p className="text-center text-sm">
        <button
          type="button"
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => {
            setMode(mode === "totp" ? "backup" : "totp");
            setCode("");
            setError(null);
          }}
        >
          {mode === "totp" ? "Use a backup code instead" : "Use your authenticator app"}
        </button>
      </p>
    </form>
  );
}
