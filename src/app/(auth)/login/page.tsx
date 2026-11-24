import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/auth-forms";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(next);
  if (await getCurrentUser()) redirect(destination);

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your Orbyte workspace.</p>
      </div>
      <LoginForm next={destination} />
    </>
  );
}
