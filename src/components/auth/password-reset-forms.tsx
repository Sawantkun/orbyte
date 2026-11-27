"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { TextField } from "./auth-forms";

const emailSchema = z.object({ email: z.string().trim().email("Enter a valid email") });
const resetSchema = z
  .object({
    password: z.string().min(10, "At least 10 characters").max(128, "At most 128 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

const linkClass = "text-foreground underline underline-offset-4 hover:text-[var(--ob-accent-2)]";

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });

  async function onSubmit({ email }: z.infer<typeof emailSchema>) {
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    // Same message whether or not the account exists.
    if (error && error.status === 429) return setError("Too many requests. Please wait a few minutes and try again.");
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="space-y-4 text-center" role="status">
        <CheckCircle2 className="mx-auto size-8 text-success" />
        <p className="text-sm">
          If an account exists for <span className="font-medium">{sentTo}</span>, we&apos;ve sent a link to reset its password. It expires in 1 hour.
        </p>
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className={linkClass}>
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <FieldGroup>
        <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" placeholder="you@company.com" />
      </FieldGroup>
      <Button type="submit" className="h-9 w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Send reset link
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });

  async function onSubmit({ password }: z.infer<typeof resetSchema>) {
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      setError(error.code === "INVALID_TOKEN" ? "This reset link is invalid or has expired. Request a new one." : "We couldn't reset your password. Please try again.");
      return;
    }
    toast.success("Password changed. Sign in with your new password.");
    router.replace("/login");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}{" "}
          {error.includes("expired") && (
            <Link href="/forgot-password" className="underline underline-offset-4">
              Request a new link
            </Link>
          )}
        </div>
      )}
      <FieldGroup>
        <TextField control={form.control} name="password" label="New password" type="password" autoComplete="new-password" placeholder="At least 10 characters" />
        <TextField control={form.control} name="confirm" label="Confirm new password" type="password" autoComplete="new-password" />
      </FieldGroup>
      <Button type="submit" className="h-9 w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Set new password
      </Button>
      <p className="text-xs text-muted-foreground">Changing your password signs you out on every other device.</p>
    </form>
  );
}
