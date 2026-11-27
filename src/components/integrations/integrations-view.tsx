"use client";

import { useState } from "react";
import { CheckCircle2, Code2, ExternalLink, HardDrive, KeyRound, Loader2, Mail, MessageSquare, Plug, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Table2, Terminal, Trash2, XCircle } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { INTEGRATION_CATALOG, INTEGRATION_CATEGORIES, type CatalogEntry, type IntegrationCategory } from "@/config/integration-catalog";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Time } from "@/components/time";

export type LocalClaude = { available: boolean; enabledByMe: boolean; ownedByOther: boolean; version: string | null };

export type ProviderCard = { id: string; kind: "api-key" | "gmail"; category: "ai" | "email"; name: string; description: string; available: boolean; keyPlaceholder: string; docsUrl: string; platformKey: boolean };
export type Integration = { id: string; provider: string; label: string; secretHint: string; status: "ACTIVE" | "INVALID" | "UNVERIFIED"; isDefault: boolean; lastValidatedAt: string | null; createdAt: string };

const STATUS = {
  ACTIVE: { label: "Connected", icon: CheckCircle2, cls: "text-success" },
  UNVERIFIED: { label: "Not verified", icon: ShieldCheck, cls: "text-warning" },
  INVALID: { label: "Rejected", icon: XCircle, cls: "text-destructive" },
} as const;

export function IntegrationsView({
  providers,
  initial,
  localClaude,
}: {
  providers: ProviderCard[];
  initial: Integration[];
  localClaude: LocalClaude;
}) {
  const [items, setItems] = useState(initial);
  const [claudeAdded, setClaudeAdded] = useState(localClaude.enabledByMe);
  // Services picked in the catalogue but not connected yet (their form is open).
  const [pending, setPending] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const upsert = (i: Integration) => {
    setItems((prev) => [...prev.filter((x) => x.id !== i.id), i]);
    setPending((p) => p.filter((id) => id !== i.provider));
  };

  const added = new Set([...items.map((i) => i.provider), ...(claudeAdded ? ["claude-cli"] : []), ...pending]);
  const shown = INTEGRATION_CATALOG.filter((c) => added.has(c.id));

  function pick(entry: CatalogEntry) {
    setAdding(false);
    if (!added.has(entry.id)) setPending((p) => [...p, entry.id]);
    // Bring the new card into view once it renders.
    requestAnimationFrame(() => document.getElementById(`service-${entry.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {shown.length === 0 ? "No services added yet." : `${shown.length} service${shown.length === 1 ? "" : "s"} added. Workflows use your own credentials first.`}
        </p>
        <Button onClick={() => setAdding(true)}>
          <Plus /> Add service
        </Button>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <span className="inline-flex size-10 items-center justify-center rounded-lg border border-border bg-elevated">
            <Plug className="size-5 text-muted-foreground" />
          </span>
          <h2 className="mt-3 font-medium">Connect your first service</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">AI models for AI Text and AI Image nodes, an email account for Send Email, and more as they arrive.</p>
          <Button className="mt-4" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Browse services
          </Button>
        </div>
      ) : (
        INTEGRATION_CATEGORIES.filter((cat) => shown.some((s) => s.category === cat.id)).map((cat) => (
          <section key={cat.id} aria-labelledby={`cat-${cat.id}`} className="space-y-2">
            <h2 id={`cat-${cat.id}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {cat.label}
            </h2>
            <ul className="grid gap-4 lg:grid-cols-2">
              {shown
                .filter((s) => s.category === cat.id)
                .map((entry) =>
                  entry.connect === "local-claude" ? (
                    <LocalClaudePanel
                      key={entry.id}
                      status={localClaude}
                      startOn={pending.includes(entry.id)}
                      onToggle={(on) => {
                        setClaudeAdded(on);
                        setPending((p) => p.filter((id) => id !== entry.id));
                      }}
                      onCancel={() => setPending((p) => p.filter((id) => id !== entry.id))}
                    />
                  ) : (
                    providers.find((p) => p.id === entry.id) && (
                      <ProviderPanel
                        key={entry.id}
                        provider={providers.find((p) => p.id === entry.id)!}
                        integrations={items.filter((i) => i.provider === entry.id)}
                        onChange={upsert}
                        onReplaceAll={setItems}
                        onRemoved={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
                        onCancel={() => setPending((p) => p.filter((id) => id !== entry.id))}
                      />
                    )
                  ),
                )}
            </ul>
          </section>
        ))
      )}

      <div className="flex gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--ob-accent-2)]" />
        <p>
          Keys and passwords are encrypted (AES-256-GCM) before they are stored, are only decrypted on the server while a workflow runs, and are never shown again or written to logs. Only the last four characters are kept for reference.
        </p>
      </div>

      <AddServiceDialog open={adding} onOpenChange={setAdding} added={added} onPick={pick} />
    </div>
  );
}

const CATEGORY_ICONS: Record<IntegrationCategory, typeof Sparkles> = {
  ai: Sparkles,
  email: Mail,
  messaging: MessageSquare,
  storage: HardDrive,
  productivity: Table2,
  developer: Code2,
};

/** The full catalogue: everything workflows can connect to, with what works today clearly marked. */
function AddServiceDialog({ open, onOpenChange, added, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; added: Set<string>; onPick: (e: CatalogEntry) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IntegrationCategory | "all">("all");
  const q = query.trim().toLowerCase();
  const matches = INTEGRATION_CATALOG.filter(
    (e) => (category === "all" || e.category === category) && (!q || `${e.name} ${e.description} ${e.usedBy.join(" ")}`.toLowerCase().includes(q)),
  );
  const order = { available: 0, builtin: 1, soon: 2 } as const;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery("");
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add a service</DialogTitle>
          <DialogDescription>Services your workflows can use. Connect one to make it available in your nodes.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services…" aria-label="Search services" className="pl-8" />
        </div>
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-1.5">
          {[{ id: "all" as const, label: "All" }, ...INTEGRATION_CATEGORIES].map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                category === c.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {matches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No services match “{query}”.</p>
          ) : (
            INTEGRATION_CATEGORIES.filter((c) => matches.some((m) => m.category === c.id)).map((c) => (
              <section key={c.id} className="mb-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {matches
                    .filter((m) => m.category === c.id)
                    .sort((a, b) => order[a.status] - order[b.status])
                    .map((entry) => {
                      const Icon = CATEGORY_ICONS[entry.category];
                      const isAdded = added.has(entry.id);
                      const canAdd = entry.status === "available" && !isAdded;
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            disabled={!canAdd}
                            onClick={() => onPick(entry)}
                            aria-label={`${entry.name}${isAdded ? " (added)" : entry.status === "soon" ? " (coming soon)" : entry.status === "builtin" ? " (built in)" : ""}`}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors",
                              canAdd ? "hover:border-primary/60 hover:bg-primary/5" : "cursor-default",
                              entry.status === "soon" && "opacity-60",
                            )}
                          >
                            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-elevated">
                              <Icon className="size-4 text-muted-foreground" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-medium">{entry.name}</span>
                                {isAdded ? (
                                  <Badge variant="outline" className="text-success">Added</Badge>
                                ) : entry.status === "soon" ? (
                                  <Badge variant="outline">Coming soon</Badge>
                                ) : entry.status === "builtin" ? (
                                  <Badge variant="outline">Built in</Badge>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">{entry.description}</span>
                              <span className="mt-1 block text-[11px] text-muted-foreground/80">Used by {entry.usedBy.join(", ")}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProviderPanel({
  provider,
  integrations,
  onChange,
  onReplaceAll,
  onRemoved,
  onCancel,
}: {
  provider: ProviderCard;
  integrations: Integration[];
  onChange: (i: Integration) => void;
  /** Replace every credential in the list (after changing the default). */
  onReplaceAll: (all: Integration[]) => void;
  onRemoved: (id: string) => void;
  /** Removes a picked-but-not-connected card. */
  onCancel: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const isGmail = provider.kind === "gmail";
  const sorted = [...integrations].sort((x, y) => Number(y.isDefault) - Number(x.isDefault) || x.createdAt.localeCompare(y.createdAt));
  const primary = sorted[0];
  const st = primary ? STATUS[primary.status] : null;

  return (
    <li id={`service-${provider.id}`} className="flex flex-col rounded-xl border border-border bg-card p-5" aria-label={provider.name}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated">
          {isGmail ? <Mail className="size-4 text-muted-foreground" /> : <KeyRound className="size-4 text-muted-foreground" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">{provider.name}</h2>
            {st && (
              <span className={cn("inline-flex items-center gap-1 text-xs", st.cls)}>
                <st.icon className="size-3.5" /> {st.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{provider.description}</p>
        </div>
      </div>

      {sorted.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label={`${provider.name} ${isGmail ? "accounts" : "keys"}`}>
          {sorted.map((i) => (
            <CredentialRow
              key={i.id}
              provider={provider}
              integration={i}
              showDefault={sorted.length > 1}
              isLast={sorted.length === 1}
              onChange={onChange}
              onReplaceAll={onReplaceAll}
              onRemoved={onRemoved}
            />
          ))}
        </ul>
      )}

      {(sorted.length === 0 || adding) && (
        <CredentialForm
          provider={provider}
          extra={sorted.length > 0}
          onSaved={(i) => {
            onChange(i);
            setAdding(false);
          }}
          onCancel={() => (sorted.length === 0 ? onCancel() : setAdding(false))}
        />
      )}

      {sorted.length > 0 && !adding && (
        <Button size="sm" variant="ghost" className="mt-3 self-start" onClick={() => setAdding(true)}>
          <Plus /> {isGmail ? "Add another account" : "Add another key"}
        </Button>
      )}

      {sorted.length === 0 && provider.platformKey && (
        <p className="mt-3 text-xs text-muted-foreground">A workspace key is configured on this server, so workflows can run without your own key. Connect yours to use your own quota and billing.</p>
      )}
    </li>
  );
}

/** Connect a new credential (the first, or an extra one with its own name). */
function CredentialForm({ provider, extra, onSaved, onCancel }: { provider: ProviderCard; extra: boolean; onSaved: (i: Integration) => void; onCancel: () => void }) {
  const isGmail = provider.kind === "gmail";
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = isGmail ? "app password" : "key";
  const fid = `${provider.id}-${extra ? "extra" : "first"}`;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiFetch<Integration>("/api/integrations", { method: "POST", body: { provider: provider.id, secret, ...(label.trim() ? { label } : {}) } });
      onSaved(data);
      toast.success(data.status === "ACTIVE" ? `${provider.name} connected` : `${provider.name} ${noun} saved — it couldn't be verified right now`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : `Couldn't save the ${noun}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-4 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {isGmail ? (
        <>
          <Label htmlFor={`addr-${fid}`}>Gmail address</Label>
          <Input id={`addr-${fid}`} type="email" autoComplete="email" placeholder="you@gmail.com" value={label} onChange={(e) => setLabel(e.target.value)} aria-invalid={!!error} />
        </>
      ) : (
        extra && (
          <>
            <Label htmlFor={`name-${fid}`}>Name</Label>
            <Input id={`name-${fid}`} placeholder="e.g. Work, Personal" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
          </>
        )
      )}
      <Label htmlFor={`key-${fid}`}>{isGmail ? "App password" : "API key"}</Label>
      <Input
        id={`key-${fid}`}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={provider.keyPlaceholder}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        aria-invalid={!!error}
        className="font-mono text-xs"
      />
      {isGmail && (
        <p className="text-xs text-muted-foreground">
          Not your Google password: create a 16-letter app password under Google Account → Security → App passwords (needs 2-Step Verification).
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={!secret.trim() || (isGmail && !label.trim()) || busy}>
          {busy && <Loader2 className="animate-spin" />} Validate & connect
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {provider.docsUrl && (
          <a href={provider.docsUrl} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {isGmail ? "Create app password" : "Get a key"} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </form>
  );
}

/** One stored credential: masked, with its status and actions. */
function CredentialRow({
  provider,
  integration,
  showDefault,
  isLast,
  onChange,
  onReplaceAll,
  onRemoved,
}: {
  provider: ProviderCard;
  integration: Integration;
  showDefault: boolean;
  isLast: boolean;
  onChange: (i: Integration) => void;
  onReplaceAll: (all: Integration[]) => void;
  onRemoved: (id: string) => void;
}) {
  const isGmail = provider.kind === "gmail";
  const noun = isGmail ? "app password" : "key";
  const [mode, setMode] = useState<"view" | "replace" | "rename">("view");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "validate" | "default" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const st = STATUS[integration.status];

  async function submit() {
    setBusy("save");
    setError(null);
    try {
      const body = mode === "replace" ? { secret: value } : { label: value };
      const { data } = await apiFetch<Integration>(`/api/integrations/${integration.id}`, { method: "PATCH", body });
      onChange(data);
      setMode("view");
      setValue("");
      toast.success(mode === "replace" ? `${provider.name} ${noun} replaced` : "Renamed");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't save.");
    } finally {
      setBusy(null);
    }
  }

  async function revalidate() {
    setBusy("validate");
    try {
      const { data } = await apiFetch<Integration>(`/api/integrations/${integration.id}/validate`, { method: "POST" });
      onChange(data);
      toast[data.status === "INVALID" ? "error" : "success"](data.status === "ACTIVE" ? `${provider.name} is working` : data.status === "INVALID" ? `${provider.name} rejected this ${noun}` : "Couldn't reach the provider");
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Validation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function makeDefault() {
    setBusy("default");
    try {
      const { data } = await apiFetch<Integration[]>(`/api/integrations/${integration.id}`, { method: "PATCH", body: { isDefault: true } });
      onReplaceAll(data);
      toast.success(`Workflows now use "${integration.label}"`);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't change the default.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    try {
      await apiFetch(`/api/integrations/${integration.id}`, { method: "DELETE" });
      onRemoved(integration.id);
      toast.success(isLast ? `${provider.name} disconnected` : `Removed "${integration.label}"`);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : `Couldn't remove the ${noun}.`);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-background/40 px-3 py-2.5 text-sm" aria-label={integration.label}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {(isGmail || showDefault) && <span className="truncate font-medium">{integration.label}</span>}
          <span className="shrink-0 font-mono text-xs text-muted-foreground">•••• {integration.secretHint}</span>
          {showDefault && integration.isDefault && <Badge variant="outline">Used by workflows</Badge>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {showDefault && (
            <span className={cn("inline-flex items-center gap-1", st.cls)}>
              <st.icon className="size-3.5" /> {st.label}
            </span>
          )}
          {integration.lastValidatedAt ? <>Checked <Time iso={integration.lastValidatedAt} /></> : "Not checked yet"}
        </span>
      </div>
      {integration.status === "INVALID" && <p className="mt-2 text-xs text-destructive">Workflows can&apos;t use this {noun}. Replace it with a working one.</p>}

      {mode !== "view" ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor={`edit-${integration.id}`}>{mode === "replace" ? (isGmail ? "New app password" : "New API key") : "Name"}</Label>
          <Input
            id={`edit-${integration.id}`}
            type={mode === "replace" ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            maxLength={mode === "rename" ? 60 : 500}
            placeholder={mode === "replace" ? provider.keyPlaceholder : integration.label}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!error}
            className={mode === "replace" ? "font-mono text-xs" : undefined}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!value.trim() || busy !== null}>
              {busy === "save" && <Loader2 className="animate-spin" />} {mode === "replace" ? "Validate & replace" : "Save name"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode("view");
                setValue("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {showDefault && !integration.isDefault && (
            <Button size="sm" variant="outline" onClick={() => void makeDefault()} disabled={busy !== null}>
              {busy === "default" && <Loader2 className="animate-spin" />} Use for workflows
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMode("replace")}>
            Replace {noun}
          </Button>
          {!isGmail && (
            <Button size="sm" variant="ghost" onClick={() => (setMode("rename"), setValue(integration.label))}>
              Rename
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void revalidate()} disabled={busy !== null}>
            {busy === "validate" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => setConfirmRemove(true)}>
            <Trash2 /> Remove
          </Button>
        </div>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isLast ? `Disconnect ${provider.name}?` : `Remove "${integration.label}"?`}</AlertDialogTitle>
            <AlertDialogDescription>
              The encrypted {noun} is deleted.{" "}
              {!isLast
                ? integration.isDefault
                  ? "Workflows will switch to your next most recent one."
                  : "Workflows aren't using it."
                : provider.platformKey
                  ? "Workflows will fall back to the workspace key."
                  : isGmail
                    ? "Send Email nodes will fail until you connect Gmail again."
                    : `Workflows using ${provider.name} will fail until you connect a key again.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              {isLast ? "Disconnect" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * Personal-use provider: AI Text nodes run through the Claude Code CLI signed in on
 * the machine running Orbyte. Owner-only: the account that switches it on owns it.
 */
function LocalClaudePanel({ status: initial, onToggle, startOn, onCancel }: { status: LocalClaude; onToggle: (on: boolean) => void; startOn: boolean; onCancel: () => void }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const disabled = !status.available || status.ownedByOther || busy || (!status.enabledByMe && !status.version);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const { data } = await apiFetch<LocalClaude>("/api/integrations/local-claude", { method: "POST", body: { enabled } });
      setStatus(data);
      onToggle(data.enabledByMe);
      toast.success(enabled ? "Claude (local CLI) is on" : "Claude (local CLI) is off");
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't change the setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li id="service-claude-cli" className="flex flex-col rounded-xl border border-border bg-card p-5" aria-label="Claude (local CLI)">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated">
          <Terminal className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">Claude (local CLI)</h2>
            <Badge variant="outline">Personal use</Badge>
            {status.enabledByMe && (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="size-3.5" /> On
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Runs your AI Text nodes through the Claude Code CLI signed in on the computer running Orbyte, using that Claude subscription. Text only, with no tools.
          </p>
        </div>
        <Switch
          checked={status.enabledByMe}
          disabled={disabled}
          onCheckedChange={(v) => void toggle(v)}
          aria-label="Use Claude (local CLI)"
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {!status.available
          ? "Disabled on this instance."
          : status.ownedByOther
            ? "Another account on this Orbyte already uses it. Only the account that switched it on can run workflows with it."
            : !status.version
              ? "The Claude CLI wasn't found on this computer. Install Claude Code and sign in, then reload this page."
              : status.enabledByMe
                ? `Using ${status.version}. In an AI Text node, choose the provider “Claude (local CLI)”. Only your account can use it.`
                : `Found ${status.version}. Switch it on to use your own Claude with AI Text nodes. Only your account will be able to use it.`}
      </p>
      {startOn && !status.enabledByMe && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={disabled} onClick={() => void toggle(true)}>
            {busy && <Loader2 className="animate-spin" />} Turn on
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
}
