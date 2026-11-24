# ADR-0005: Node keys, upstream-only references, draft/publish

**Status:** accepted (Milestone 2)

**References.** Each node has a human-readable, unique `key`. Templates use `{{key.field}}` or `{{inputFieldName}}`. We chose keys over node ids (unreadable) and labels (not unique, change often). The validator only accepts references to **ancestors**, which guarantees at execution time that every value exists before it is used and removes a whole class of runtime errors.

**Drafts vs versions.** The editor autosaves a draft that may be incomplete; publishing validates and snapshots an immutable version that executions reference. This keeps editing frictionless and execution history reproducible. Restoring a version copies it into the draft; versions are never mutated.

**Concurrency.** Saves send the last-seen `updatedAt`; mismatches return 409. We chose detect-and-reload over merging: graph merges are error-prone and multi-tab editing of one workflow is rare. Real-time collaboration would need CRDTs and is out of scope.

**Prompt templates** are copied into the node on load (the node keeps `templateId` for reference). Editing a library template never changes existing workflows or published versions.

**Model catalogue.** Model ids in `src/config/ai-models.ts` are placeholders to be verified against the provider when the OpenAI adapter is built in Milestone 3.
