"use client";

import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type ProviderCard = { id: string; name: string; description: string; available: boolean; keyPlaceholder: string; docsUrl: string; platformKey: boolean };
export type Integration = { id: string; provider: string; label: string; secretHint: string; status: "ACTIVE" | "INVALID" | "UNVERIFIED"; lastValidatedAt: string | null; createdAt: string };

const STATUS = {
  ACTIVE: { label: "Connected", icon: CheckCircle2, cls: "text-success" },
  UNVERIFIED: { label: "Not verified", icon: ShieldCheck, cls: "text-warning" },
  INVALID: { label: "Key rejected", icon: XCircle, cls: "text-destructive" },
} as const;

export function IntegrationsView({ providers, initial }: { providers: ProviderCard[]; initial: Integration[] }) {
  const [items, setItems] = useState(initial);
  const upsert = (i: Integration) => setItems((prev) => [...prev.filter((x) => x.id !== i.id), i]);
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--ob-accent-2)]" />
        <p>
          Keys are encrypted (AES-256-GCM) before they are stored, are only decrypted on the server while a workflow runs, and are never shown again or written to logs. Only the last four characters are kept for reference.
        </p>
      </div>
      <ul className="grid gap-4 lg:grid-cols-2">
        {providers.map((p) => (
          <ProviderPanel key={p.id} provider={p} integration={items.find((i) => i.provider === p.id)} onChange={upsert} onRemoved={(id) => setItems((prev) => prev.filter((x) => x.id !== id))} />
        ))}
      </ul>
    </div>
  );
}

function ProviderPanel({
  provider,
  integration,
  onChange,
  onRemoved,
}: {
  provider: ProviderCard;
  integration?: Integration;
  onChange: (i: Integration) => void;
  onRemoved: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "validate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const showForm = provider.available && (!integration || editing);

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const { data } = integration
        ? await apiFetch<Integration>(`/api/integrations/${integration.id}`, { method: "PATCH", body: { secret } })
        : await apiFetch<Integration>("/api/integrations", { method: "POST", body: { provider: provider.id, secret } });
      onChange(data);
      setSecret("");
      setEditing(false);
      toast.success(data.status === "ACTIVE" ? `${provider.name} connected` : `${provider.name} key saved — it couldn't be verified right now`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't save the key.");
    } finally {
      setBusy(null);
    }
  }

  async function revalidate() {
    if (!integration) return;
    setBusy("validate");
    try {
      const { data } = await apiFetch<Integration>(`/api/integrations/${integration.id}/validate`, { method: "POST" });
      onChange(data);
      toast[data.status === "INVALID" ? "error" : "success"](data.status === "ACTIVE" ? "Key is valid" : data.status === "INVALID" ? "The provider rejected this key" : "Couldn't reach the provider");
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Validation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!integration) return;
    try {
      await apiFetch(`/api/integrations/${integration.id}`, { method: "DELETE" });
      onRemoved(integration.id);
      toast.success(`${provider.name} key removed`);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't remove the key.");
    }
  }

  const st = integration ? STATUS[integration.status] : null;

  return (
    <li className={cn("flex flex-col rounded-xl border border-border bg-card p-5", !provider.available && "opacity-60")} aria-label={provider.name}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated">
          <KeyRound className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">{provider.name}</h2>
            {!provider.available && <Badge variant="outline">Coming soon</Badge>}
            {st && (
              <span className={cn("inline-flex items-center gap-1 text-xs", st.cls)}>
                <st.icon className="size-3.5" /> {st.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{provider.description}</p>
        </div>
      </div>

      {integration && !editing && (
        <div className="mt-4 rounded-lg border border-border bg-background/40 px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs">•••• •••• {integration.secretHint}</span>
            <span className="text-xs text-muted-foreground">
              {integration.lastValidatedAt ? `Checked ${formatDistanceToNowStrict(new Date(integration.lastValidatedAt), { addSuffix: true })}` : "Not checked yet"}
            </span>
          </div>
          {integration.status === "INVALID" && <p className="mt-2 text-xs text-destructive">Workflows can&apos;t use this key. Replace it with a working one.</p>}
        </div>
      )}

      {showForm && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Label htmlFor={`key-${provider.id}`}>{integration ? "New API key" : "API key"}</Label>
          <Input
            id={`key-${provider.id}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={provider.keyPlaceholder}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            aria-invalid={!!error}
            className="font-mono text-xs"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" size="sm" disabled={!secret.trim() || busy !== null}>
              {busy === "save" && <Loader2 className="animate-spin" />} {integration ? "Validate & replace" : "Validate & connect"}
            </Button>
            {integration && (
              <Button type="button" size="sm" variant="ghost" onClick={() => (setEditing(false), setSecret(""), setError(null))}>
                Cancel
              </Button>
            )}
            {provider.docsUrl && (
              <a href={provider.docsUrl} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                Get a key <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </form>
      )}

      {integration && !editing && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Replace key
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void revalidate()} disabled={busy !== null}>
            {busy === "validate" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => setConfirmRemove(true)}>
            <Trash2 /> Remove
          </Button>
        </div>
      )}

      {provider.available && !integration && provider.platformKey && (
        <p className="mt-3 text-xs text-muted-foreground">A workspace key is configured on this server, so workflows can run without your own key. Connect yours to use your own quota and billing.</p>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your {provider.name} key?</AlertDialogTitle>
            <AlertDialogDescription>
              The encrypted key is deleted.{" "}
              {provider.platformKey ? "Workflows will fall back to the workspace key." : `Workflows using ${provider.name} will fail until you connect a key again.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Remove key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
