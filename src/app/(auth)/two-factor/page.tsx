import type { Metadata } from "next";
import { TwoFactorChallenge } from "@/components/auth/two-factor-challenge";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Two-factor sign-in" };

export default async function TwoFactorPage({ searchParams }: PageProps<"/two-factor">) {
  const { next } = await searchParams;
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Two-factor sign-in</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <TwoFactorChallenge next={safeRedirectPath(next)} />
    </>
  );
}
