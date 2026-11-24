# ADR-0006: Execution engine semantics

**Status:** accepted (Milestone 3)

**Where it runs.** A separate worker process consumes a BullMQ queue. The web app only validates and enqueues. Workers scale horizontally; the queue name is configurable to isolate environments sharing one Redis.

**Scheduling.** A node is ready once every predecessor is settled. It runs if at least one incoming edge is active; otherwise it is `SKIPPED`. This gives Condition nodes clean branch semantics and lets "join" nodes run when any branch reached them. Independent nodes run in parallel, bounded per execution.

**Failure.** Fail-fast: the first non-retryable failure (or exhausted retries) aborts in-flight nodes and skips the rest. Partial outputs are kept on node rows for inspection. Alternatives such as "continue other branches" were rejected for the MVP: they complicate reasoning about outputs and cost.

**Retries.** Engine-level per node (not BullMQ job retries) so completed nodes are never re-run and every attempt is visible as its own `NodeExecution` row. Only errors marked retryable (rate limits, 5xx, timeouts, network) are retried, honouring `Retry-After`.

**Durability.** All state is in Postgres; Redis only carries "please run X". A crashed worker's job is re-delivered by BullMQ's stalled-job detection and resumes from persisted node state. Jobs use `jobId = executionId`, and the API supports client idempotency keys.

**Cancellation.** Pending runs are cancelled synchronously by the API. Running ones get `cancelRequestedAt`; the worker polls it and aborts in-flight provider and HTTP calls via `AbortSignal`.

**Cost.** Pricing lives in the model catalogue with the date it was checked. Unknown pricing is stored as `NULL`, never `0`, so totals never under-report silently.

**SSRF.** The HTTP node validates the resolved address at connect time and disables keep-alive pooling. A test showed that a pooled socket would otherwise skip the check.
