import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && token.length > 0 && !error;
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
      </div>
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div role="alert" className="space-y-3 text-center text-sm">
          <p>This reset link is invalid or has expired.</p>
          <Link href="/forgot-password" className="text-foreground underline underline-offset-4 hover:text-[var(--ob-accent-2)]">
            Request a new link
          </Link>
        </div>
      )}
    </>
  );
}
