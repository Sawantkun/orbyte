"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileText, Image as ImageIcon, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { STARTERS, type StarterId } from "@/lib/workflow/starters";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(1000),
  starter: z.enum(["blank", "text", "image"]),
});
type Values = z.infer<typeof schema>;

const ICONS: Record<StarterId, typeof Square> = { blank: Square, text: FileText, image: ImageIcon };

export function NewWorkflowForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "", description: "", starter: "text" } });

  async function onSubmit(values: Values) {
    setError(null);
    try {
      const { data } = await apiFetch<{ id: string }>("/api/workflows", { method: "POST", body: values });
      router.push(`/workflows/${data.id}`);
    } catch (e) {
      const message = e instanceof ApiClientError ? e.message : "Couldn't create the workflow.";
      setError(message);
      toast.error(message);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-2xl space-y-8">
      <FieldGroup>
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="wf-name">Name</FieldLabel>
              <Input id="wf-name" placeholder="Product launch copy" autoFocus aria-invalid={fieldState.invalid} {...field} />
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="description"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="wf-description">Description (optional)</FieldLabel>
              <Textarea id="wf-description" rows={2} placeholder="What does this workflow produce?" {...field} />
            </Field>
          )}
        />
      </FieldGroup>

      <Controller
        control={form.control}
        name="starter"
        render={({ field }) => (
          <fieldset>
            <legend className="mb-3 text-sm font-medium">Start from</legend>
            <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
              {STARTERS.map((s) => {
                const Icon = ICONS[s.id];
                const active = field.value === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => field.onChange(s.id)}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-colors",
                      active ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border bg-card hover:border-[color-mix(in_oklab,var(--ob-border),white_14%)]",
                    )}
                  >
                    <Icon className={cn("mb-3 size-4", active ? "text-[var(--ob-accent-2)]" : "text-muted-foreground")} />
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{s.description}</div>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
      />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Create and open Studio
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
