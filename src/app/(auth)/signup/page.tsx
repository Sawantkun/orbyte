import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/auth-forms";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Start connecting and organizing your AI work.</p>
      </div>
      <SignupForm />
    </>
  );
}
