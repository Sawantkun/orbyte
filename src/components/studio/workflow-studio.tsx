"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import type { NodeType, WorkflowDefinition } from "@/lib/workflow/schema";
import { validateWorkflow, type ValidationIssue } from "@/lib/workflow/validate";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { Palette } from "./palette";
import { StudioStoreContext, createStudioStore, useStudio, useStudioApi } from "./store";
import { RunDialog } from "./run-dialog";
import { Toolbar, type VersionInfo } from "./toolbar";
import { ValidationProvider } from "./validation-context";
import { LastRunProvider } from "./last-run";

export type StudioWorkflow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  latestVersion: number;
  updatedAt: string;
  definition: WorkflowDefinition;
  versions: VersionInfo[];
};

type Summary = { id: string; name: string; status: string; latestVersion: number; updatedAt: string };

const AUTOSAVE_MS = 1500;

export function WorkflowStudio({ workflow }: { workflow: StudioWorkflow }) {
  const [store] = useState(() =>
    createStudioStore({
      definition: workflow.definition,
      name: workflow.name,
      description: workflow.description ?? "",
      updatedAt: workflow.updatedAt,
    }),
  );
  return (
    <StudioStoreContext value={store}>
      <ReactFlowProvider>
        <StudioLayout workflow={workflow} />
      </ReactFlowProvider>
    </StudioStoreContext>
  );
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest("[role=dialog],[role=menu],[role=listbox]") !== null);

function StudioLayout({ workflow }: { workflow: StudioWorkflow }) {
  const api = useStudioApi();
  const { screenToFlowPosition } = useReactFlow();
  const [status, setStatus] = useState(workflow.status);
  const [latestVersion, setLatestVersion] = useState(workflow.latestVersion);
  const [versions, setVersions] = useState(workflow.versions);
  const [publishing, setPublishing] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<VersionInfo | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  // Revision at the last publish: anything after it is unpublished draft work.
  const [publishedRevision, setPublishedRevision] = useState(0);
  // On load: the saved draft is newer than the latest version (publish itself bumps updatedAt by ms).
  const [changedAtLoad, setChangedAtLoad] = useState(
    () => workflow.versions.length > 0 && Date.parse(workflow.updatedAt) - Date.parse(workflow.versions[0].createdAt) > 2000,
  );
  const draftChanged = useStudio((s) => s.revision !== publishedRevision) || changedAtLoad;
  const canvasRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);

  // ── Live validation (deferred so typing stays responsive) ─────────────────
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const deferredNodes = useDeferredValue(nodes);
  const deferredEdges = useDeferredValue(edges);
  const validation = useMemo(
    () =>
      validateWorkflow({
        schemaVersion: 1,
        nodes: deferredNodes.map((n) => ({ id: n.id, type: n.type!, position: n.position, data: n.data })),
        edges: deferredEdges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })),
      }),
    [deferredNodes, deferredEdges],
  );

  // ── Saving ────────────────────────────────────────────────────────────────
  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return savingRef.current;
    const s = api.getState();
    if (s.saveState === "saved") return true;
    if (s.saveState === "conflict") return false;
    if (!s.name.trim()) {
      toast.error("Give the workflow a name before saving.");
      s.markSaveFailed("error");
      return false;
    }
    const revision = s.revision;
    s.markSaving();
    const run = (async () => {
      try {
        const { data } = await apiFetch<Summary>(`/api/workflows/${workflow.id}`, {
          method: "PATCH",
          body: { name: s.name.trim(), description: s.description, definition: s.toDefinition(), expectedUpdatedAt: s.updatedAt },
        });
        api.getState().markSaved(data.updatedAt, revision);
        return true;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 409) {
          api.getState().markSaveFailed("conflict");
          toast.error("This workflow was changed in another tab or window.", {
            description: "Reload to get the latest version. Your unsaved edits here can't be merged automatically.",
            action: { label: "Reload", onClick: () => window.location.reload() },
            duration: Infinity,
          });
        } else {
          api.getState().markSaveFailed("error");
          toast.error(e instanceof ApiClientError ? e.message : "Couldn't save the workflow.");
        }
        return false;
      } finally {
        savingRef.current = null;
      }
    })();
    savingRef.current = run;
    return run;
  }, [api, workflow.id]);

  // Autosave after a short idle period; re-arms on every content change.
  const revision = useStudio((s) => s.revision);
  const saveState = useStudio((s) => s.saveState);
  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [revision, saveState, save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (saveState === "saved") return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  // ── Publish / restore ─────────────────────────────────────────────────────
  const publish = useCallback(async () => {
    if (!validation.valid) {
      const n = validation.issues.filter((i) => i.severity === "error").length;
      toast.error(`Fix ${n} error${n === 1 ? "" : "s"} before publishing.`, { description: "Select the workflow canvas background to see the list." });
      api.getState().selectOnly(null);
      // The inspector is always visible at lg+; only narrow screens need the sheet.
      if (!window.matchMedia("(min-width: 1024px)").matches) setInspectorOpen(true);
      return;
    }
    setPublishing(true);
    try {
      if (!(await save())) return;
      const { data } = await apiFetch<{ workflow: Summary; version: { id: string; version: number; createdAt: string }; warnings: ValidationIssue[] }>(
        `/api/workflows/${workflow.id}/publish`,
        { method: "POST", body: { expectedUpdatedAt: api.getState().updatedAt } },
      );
      api.getState().markSaved(data.workflow.updatedAt, api.getState().revision);
      setStatus(data.workflow.status);
      setPublishedRevision(api.getState().revision);
      setChangedAtLoad(false);
      setLatestVersion(data.version.version);
      setVersions((v) => [{ ...data.version, nodeCount: api.getState().nodes.length }, ...v]);
      toast.success(`Published version ${data.version.version}`, {
        description: data.warnings.length ? `${data.warnings.length} warning(s) — see the validation panel.` : undefined,
      });
    } catch (e) {
      const issues = e instanceof ApiClientError ? (e.details as { issues?: ValidationIssue[] } | undefined)?.issues : undefined;
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't publish.", { description: issues?.[0]?.message });
    } finally {
      setPublishing(false);
    }
  }, [api, save, validation, workflow.id]);

  const restore = useCallback(async () => {
    const target = restoreTarget;
    setRestoreTarget(null);
    if (!target) return;
    try {
      if (!(await save())) return;
      await apiFetch(`/api/workflows/${workflow.id}/versions/${target.version}/restore`, { method: "POST" });
      const { data } = await apiFetch<StudioWorkflow>(`/api/workflows/${workflow.id}`);
      api.getState().loadDefinition(data.definition);
      api.getState().markSaved(data.updatedAt, api.getState().revision);
      toast.success(`Draft restored from version ${target.version}`, { description: "Undo is available if you change your mind." });
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't restore that version.");
    }
  }, [api, restoreTarget, save, workflow.id]);

  // ── Adding nodes from the palette (click) ─────────────────────────────────
  const addAtCenter = useCallback(
    (type: NodeType) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const center = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 400, y: 300 };
      const p = screenToFlowPosition(center);
      const jitter = (api.getState().nodes.length % 5) * 24;
      api.getState().addNode(type, { x: p.x - 120 + jitter, y: p.y - 30 + jitter });
      setPaletteOpen(false);
    },
    [api, screenToFlowPosition],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const modKey = e.metaKey || e.ctrlKey;
      // `key` can be undefined (e.g. Chrome autofill dispatches synthetic keydown events).
      if (typeof e.key !== "string") return;
      const key = e.key.toLowerCase();
      if (modKey && key === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (isEditable(e.target)) return;
      const s = api.getState();
      if (modKey && key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (modKey && key === "y") {
        e.preventDefault();
        s.redo();
      } else if (modKey && key === "d") {
        e.preventDefault();
        s.duplicateNodes(s.nodes.filter((n) => n.selected).map((n) => n.id));
      } else if (key === "backspace" || key === "delete") {
        e.preventDefault();
        s.deleteSelection();
      } else if (key === "escape") {
        s.selectOnly(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api, save]);

  return (
    <ValidationProvider value={validation}>
      <div className="flex h-full flex-col">
        <Toolbar
          status={status}
          latestVersion={latestVersion}
          versions={versions}
          publishing={publishing}
          onSave={() => void save()}
          onPublish={() => void publish()}
          onRun={() => setRunOpen(true)}
          onRestore={setRestoreTarget}
          onTogglePalette={() => setPaletteOpen(true)}
          onToggleInspector={() => setInspectorOpen(true)}
        />
        <div className="flex min-h-0 flex-1">
          <aside aria-label="Node palette" className="hidden w-60 shrink-0 border-r border-border bg-sidebar lg:block">
            <Palette onAdd={addAtCenter} />
          </aside>
          <div ref={canvasRef} className="relative min-w-0 flex-1" aria-label="Workflow canvas">
            <LastRunProvider workflowId={workflow.id}>
              {(bar) => (
                <>
                  <Canvas />
                  {bar && <div className="pointer-events-none absolute top-3 left-3 z-10">{bar}</div>}
                </>
              )}
            </LastRunProvider>
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-xl border border-dashed border-border bg-card/80 px-6 py-5 text-center backdrop-blur">
                  <p className="text-sm font-medium">Start building</p>
                  <p className="mt-1 text-xs text-muted-foreground">Drag a node from the left, or click one to add it.</p>
                </div>
              </div>
            )}
          </div>
          <aside aria-label="Inspector" className="hidden w-80 shrink-0 border-l border-border bg-sidebar lg:block">
            <Inspector />
          </aside>
        </div>
      </div>

      <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Nodes</SheetTitle>
          <SheetDescription className="sr-only">Add nodes to the canvas</SheetDescription>
          <Palette onAdd={addAtCenter} />
        </SheetContent>
      </Sheet>
      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <SheetContent side="right" className="w-[22rem] bg-sidebar p-0">
          <SheetTitle className="sr-only">Inspector</SheetTitle>
          <SheetDescription className="sr-only">Configure the selected node</SheetDescription>
          <Inspector />
        </SheetContent>
      </Sheet>

      {latestVersion > 0 && <RunDialog workflowId={workflow.id} version={latestVersion} open={runOpen} onOpenChange={setRunOpen} draftChanged={draftChanged} />}

      <AlertDialog open={restoreTarget !== null} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {restoreTarget?.version} to the draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The current draft is replaced with this version&apos;s graph. Published versions are never changed, and you can undo this in the editor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restore()}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ValidationProvider>
  );
}
