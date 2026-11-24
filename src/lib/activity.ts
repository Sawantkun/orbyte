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
  "collection.created": "Created a collection",
  "integration.added": "Connected an integration",
  "integration.removed": "Removed an integration",
};

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
  createdAt: string;
};
