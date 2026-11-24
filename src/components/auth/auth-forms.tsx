"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { loginSchema, signupSchema, type LoginInput, type SignupInput } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type TextFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
};

export function TextField<T extends FieldValues>({ control, name, label, ...input }: TextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input id={name} aria-invalid={fieldState.invalid} {...input} {...field} value={field.value ?? ""} />
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

/** Map Better Auth error codes to safe, user-facing copy. */
function authErrorMessage(code: string | undefined, fallback: string) {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Incorrect email or password.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists.";
    case "PASSWORD_TOO_SHORT":
      return "Password is too short.";
    case "TOO_MANY_REQUESTS":
      return "Too many attempts. Please wait a minute and try again.";
    default:
      return fallback;
  }
}

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  async function onSubmit(values: LoginInput) {
    setError(null);
    const { error } = await authClient.signIn.email({ email: values.email, password: values.password });
    if (error) {
      setError(authErrorMessage(error.code, "We couldn't sign you in. Please try again."));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <FormAlert message={error} />
      <FieldGroup>
        <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" placeholder="you@company.com" />
        <TextField control={form.control} name="password" label="Password" type="password" autoComplete="current-password" />
      </FieldGroup>
      <Button type="submit" className="h-9 w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Sign in
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to Orbyte?{" "}
        <Link href="/signup" className="text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: SignupInput) {
    setError(null);
    const { error } = await authClient.signUp.email(values);
    if (error) {
      setError(authErrorMessage(error.code, "We couldn't create your account. Please try again."));
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <FormAlert message={error} />
      <FieldGroup>
        <TextField control={form.control} name="name" label="Name" autoComplete="name" placeholder="Ada Lovelace" />
        <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" placeholder="you@company.com" />
        <TextField control={form.control} name="password" label="Password" type="password" autoComplete="new-password" placeholder="At least 10 characters" />
      </FieldGroup>
      <Button type="submit" className="h-9 w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Create account
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
