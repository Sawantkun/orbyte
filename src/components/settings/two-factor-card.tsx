"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Step =
  | { kind: "idle" }
  | { kind: "password"; purpose: "enable" | "disable" | "codes" }
  | { kind: "scan"; qr: string; secret: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/** Turn authenticator-app sign-in on or off, and manage backup codes. */
export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep({ kind: "idle" });
    setPassword("");
    setCode("");
    setError(null);
  };
  const failed = (e: { status?: number; code?: string } | null, fallback: string) =>
    setError(e?.status === 429 ? "Too many attempts. Wait a minute and try again." : e?.code === "INVALID_PASSWORD" ? "Incorrect password." : fallback);

  async function confirmPassword(purpose: "enable" | "disable" | "codes") {
    setBusy(true);
    setError(null);
    try {
      if (purpose === "enable") {
        const { data, error } = await authClient.twoFactor.enable({ password });
        if (error || !data || data.method !== "totp") return failed(error, "Couldn't start setup.");
        const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
        const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 192 });
        setStep({ kind: "scan", qr, secret, backupCodes: data.backupCodes });
      } else if (purpose === "disable") {
        const { error } = await authClient.twoFactor.disable({ password });
        if (error) return failed(error, "Couldn't turn off two-factor sign-in.");
        toast.success("Two-factor sign-in is off");
        reset();
        router.refresh();
      } else {
        const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
        if (error || !data) return failed(error, "Couldn't create new backup codes.");
        setStep({ kind: "codes", backupCodes: data.backupCodes });
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function verify(backupCodes: string[]) {
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s+/g, "") });
    setBusy(false);
    if (error) return failed(error, "That code didn't work. Enter the current code from your app.");
    toast.success("Two-factor sign-in is on");
    setCode("");
    setStep({ kind: "codes", backupCodes });
    router.refresh();
  }

  if (step.kind === "password") {
    return (
      <form
        className="max-w-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void confirmPassword(step.purpose);
        }}
      >
        <Label htmlFor="tf-password">Confirm your password</Label>
        <Input id="tf-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant={step.purpose === "disable" ? "destructive" : "default"} disabled={!password || busy}>
            {busy && <Loader2 className="animate-spin" />} {step.purpose === "enable" ? "Continue" : step.purpose === "disable" ? "Turn off" : "Create new codes"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (step.kind === "scan") {
    return (
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
          <li>Scan this QR code, or enter the setup key by hand.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
          <img src={step.qr} alt="QR code for your authenticator app" width={160} height={160} className="rounded-lg bg-white p-1" />
          <div className="min-w-0 space-y-1">
            <div className="text-xs text-muted-foreground">Setup key</div>
            <CopyText value={step.secret} label="Copy setup key" />
          </div>
        </div>
        <form
          className="max-w-sm space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(step.backupCodes);
          }}
        >
          <Label htmlFor="tf-code">Code from your app</Label>
          <Input id="tf-code" autoComplete="one-time-code" inputMode="numeric" maxLength={7} placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-widest" aria-invalid={!!error} />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!code.trim() || busy}>
              {busy && <Loader2 className="animate-spin" />} Verify and turn on
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (step.kind === "codes") {
    const text = step.backupCodes.join("\n");
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Save these backup codes somewhere safe. Each one works once if you lose your authenticator app. <span className="font-medium">They won&apos;t be shown again.</span>
        </p>
        <ul className="grid max-w-sm grid-cols-2 gap-1.5 rounded-lg border border-border bg-background/40 p-3 font-mono text-sm" aria-label="Backup codes">
          {step.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <CopyText value={text} label="Copy codes" button />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([`Orbyte backup codes\n\n${text}\n`], { type: "text/plain" }));
              const a = Object.assign(document.createElement("a"), { href: url, download: "orbyte-backup-codes.txt" });
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download /> Download
          </Button>
          <Button size="sm" onClick={reset}>
            I&apos;ve saved them
          </Button>
        </div>
      </div>
    );
  }

  return enabled ? (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm">
        <ShieldCheck className="size-4 text-success" /> On. Signing in asks for a code from your authenticator app.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setStep({ kind: "password", purpose: "codes" })}>
          New backup codes
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setStep({ kind: "password", purpose: "disable" })}>
          <ShieldOff /> Turn off
        </Button>
      </div>
    </div>
  ) : (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Off. Add a second step to sign-in with a code from an authenticator app.</p>
      <Button size="sm" onClick={() => setStep({ kind: "password", purpose: "enable" })}>
        Set up two-factor
      </Button>
    </div>
  );
}

function CopyText({ value, label, button }: { value: string; label: string; button?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it instead.");
    }
  };
  if (button)
    return (
      <Button size="sm" variant="outline" onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />} {label}
      </Button>
    );
  return (
    <span className="flex items-center gap-1">
      <code className="break-all font-mono text-sm select-all">{value}</code>
      <Button size="icon-sm" variant="ghost" onClick={() => void copy()} aria-label={label}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}
