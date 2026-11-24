# ADR-0002: Dynamic rendering instead of Cache Components

**Status:** accepted (Milestone 1)

`create-next-app` 16 enables `cacheComponents`. With it on, any session read must sit behind a `<Suspense>` boundary and session-derived caching needs `use cache: private` / explicit tags.

Nearly every Orbyte route is authenticated and per-user, and correctness of ownership checks matters more than prerendering a static shell. We therefore turn Cache Components **off** and use classic dynamic rendering: each request validates the session (`requireUser()`) and queries owner-scoped data.

Revisit when we have measured latency problems: the dashboard's independent panels are the obvious first candidates for streaming.
