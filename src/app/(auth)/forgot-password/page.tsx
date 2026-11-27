import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      </div>
      <ForgotPasswordForm />
    </>
  );
}
