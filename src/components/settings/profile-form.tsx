"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateProfile } from "@/app/(app)/settings/actions";
import { TextField } from "@/components/auth/auth-forms";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { profileSchema, type ProfileInput } from "@/lib/validation/auth";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const form = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: { name } });

  async function onSubmit(values: ProfileInput) {
    const result = await updateProfile(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Profile updated");
    form.reset(values);
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <FieldGroup>
        <TextField control={form.control} name="name" label="Name" autoComplete="name" />
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" value={email} readOnly disabled />
          <FieldDescription>Changing your email requires verification and is not available yet.</FieldDescription>
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Save changes
      </Button>
    </form>
  );
}
