/** A node failure. `retryable` drives the retry policy; `message` is safe to show users. */
export class NodeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    /** Optional delay hint (e.g. from Retry-After). */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "NodeError";
  }
}

export function toNodeError(e: unknown): NodeError {
  if (e instanceof NodeError) return e;
  if (e instanceof Error && e.name === "AbortError") return new NodeError("CANCELLED", "Cancelled", false);
  return new NodeError("INTERNAL", "The node failed unexpectedly", false);
}
