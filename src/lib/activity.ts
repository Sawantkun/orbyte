/** Human-readable labels for ActivityLog actions. Unknown actions fall back to the raw name. */
const LABELS: Record<string, string> = {
  "account.created": "Created your Orbyte account",
  "profile.updated": "Updated your profile",
  "password.changed": "Changed your password",
  "workflow.created": "Created a workflow",
  "workflow.updated": "Updated a workflow",
  "workflow.deleted": "Deleted a workflow",
  "workflow.published": "Published a workflow",
  "execution.started": "Started an execution",
  "execution.completed": "Execution completed",
  "execution.failed": "Execution failed",
  "execution.cancelled": "Execution cancelled",
  "asset.uploaded": "Uploaded an asset",
  "asset.generated": "Generated an asset",
  "asset.deleted": "Deleted assets",
  "collection.created": "Created a collection",
  "integration.added": "Connected an integration",
  "integration.removed": "Removed an integration",
  "integration.updated": "Replaced an API key",
  "collection.deleted": "Deleted a collection",
  "assets.deleted": "Deleted assets",
};

const ROUTES: Record<string, string> = {
  workflow: "/workflows/",
  execution: "/executions/",
  asset: "/assets/",
  collection: "/collections/",
};

/** Where an activity item links to; null for deletions and entities without a page. */
export function activityHref(action: string, entityType: string, entityId: string | null): string | null {
  if (action.endsWith(".deleted") || action.endsWith(".removed")) return null;
  if (entityType === "integration") return "/integrations";
  if (entityType === "user") return "/settings/profile";
  const base = ROUTES[entityType];
  return base && entityId ? base + entityId : null;
}

export function activityLabel(action: string, metadata?: unknown): string {
  const base = LABELS[action] ?? action;
  const name =
    metadata && typeof metadata === "object" && "name" in metadata && typeof metadata.name === "string"
      ? metadata.name
      : null;
  return name ? `${base}: ${name}` : base;
}

export type ActivityItem = {
  id: string;
  action: string;
  label: string;
  href: string | null;
  createdAt: string;
};
