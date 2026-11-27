"use client";

import { useState } from "react";
import { Loader2, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** Shown until the account's email address is verified. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function resend() {
    setBusy(true);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/dashboard" });
    setBusy(false);
    if (error) return toast.error(error.status === 429 ? "Too many requests. Try again in a few minutes." : "Couldn't send the email.");
    setSent(true);
    toast.success(`Verification link sent to ${email}`);
  }

  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <MailWarning className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">
        Verify your email address <span className="font-medium">{email}</span>. We sent you a link when you signed up.
      </p>
      <Button size="sm" variant="outline" onClick={() => void resend()} disabled={busy || sent}>
        {busy && <Loader2 className="animate-spin" />} {sent ? "Link sent" : "Resend link"}
      </Button>
    </div>
  );
}
