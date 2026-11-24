"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { changePassword } from "@/app/(app)/settings/actions";
import { TextField } from "@/components/auth/auth-forms";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/validation/auth";

export function PasswordForm() {
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "", revokeOtherSessions: true },
  });

  async function onSubmit(values: ChangePasswordInput) {
    const result = await changePassword(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Password changed");
    form.reset();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <FieldGroup>
        <TextField control={form.control} name="currentPassword" label="Current password" type="password" autoComplete="current-password" />
        <TextField control={form.control} name="newPassword" label="New password" type="password" autoComplete="new-password" placeholder="At least 10 characters" />
        <TextField control={form.control} name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" />
        <Controller
          control={form.control}
          name="revokeOtherSessions"
          render={({ field }) => (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                className="size-4 rounded border-border accent-[var(--ob-accent)]"
              />
              Sign out of all other sessions
            </label>
          )}
        />
      </FieldGroup>
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Change password
      </Button>
    </form>
  );
}
