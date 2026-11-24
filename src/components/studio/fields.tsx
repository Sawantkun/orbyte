"use client";

import { useId, useRef } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type FieldProps = { label: string; hint?: React.ReactNode; error?: string; className?: string };

function Shell({ label, hint, error, className, htmlFor, children }: FieldProps & { htmlFor: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  ...shell
}: FieldProps & { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  const id = useId();
  return (
    <Shell {...shell} htmlFor={id}>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={!!shell.error} className={cn("h-8", mono && "font-mono text-xs")} />
    </Shell>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  ...shell
}: FieldProps & { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const id = useId();
  return (
    <Shell {...shell} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        aria-invalid={!!shell.error}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        className="h-8"
      />
    </Shell>
  );
}

export function SelectInput<T extends string>({
  value,
  onChange,
  options,
  ...shell
}: FieldProps & { value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[] }) {
  const id = useId();
  return (
    <Shell {...shell} htmlFor={id}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} size="sm" className="w-full" aria-invalid={!!shell.error}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Shell>
  );
}

export function SwitchInput({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
      <div>
        <Label htmlFor={id} className="text-sm font-normal">
          {label}
        </Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Textarea with an "insert variable" menu listing upstream references. */
export function TemplateInput({
  value,
  onChange,
  references,
  rows = 4,
  placeholder,
  ...shell
}: FieldProps & {
  value: string;
  onChange: (v: string) => void;
  references: { ref: string; label: string }[];
  rows?: number;
  placeholder?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  function insert(token: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <Shell {...shell} htmlFor={id}>
      <div className="relative">
        <Textarea
          ref={ref}
          id={id}
          value={value}
          rows={rows}
          placeholder={placeholder}
          aria-invalid={!!shell.error}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-0 resize-y pb-8 font-mono text-xs leading-relaxed"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="absolute right-1.5 bottom-1.5 text-muted-foreground" aria-label="Insert variable">
              <Braces /> Variable
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-1">
            {references.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">Connect an upstream node to reference its output here.</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto">
                {references.map((r) => (
                  <li key={r.ref}>
                    <button
                      type="button"
                      onClick={() => insert(r.ref)}
                      className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-elevated"
                    >
                      <span className="font-mono text-xs text-[var(--ob-accent-2)]">{r.ref}</span>
                      <span className="text-[11px] text-muted-foreground">{r.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </Shell>
  );
}

export function KeyValueInput({
  label,
  value,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: {
  label: string;
  value: { key: string; value: string }[];
  onChange: (v: { key: string; value: string }[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {value.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            aria-label={`${label} key ${i + 1}`}
            className="h-8 font-mono text-xs"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => onChange(value.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
          />
          <Input
            aria-label={`${label} value ${i + 1}`}
            className="h-8 font-mono text-xs"
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => onChange(value.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
          />
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove row" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="xs" onClick={() => onChange([...value, { key: "", value: "" }])}>
        Add {label.toLowerCase().replace(/s$/, "")}
      </Button>
    </div>
  );
}

export function TextAreaInput({ value, onChange, rows = 3, ...shell }: FieldProps & { value: string; onChange: (v: string) => void; rows?: number }) {
  const id = useId();
  return (
    <Shell {...shell} htmlFor={id}>
      <Textarea id={id} value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className="min-h-0 resize-y text-sm" />
    </Shell>
  );
}
