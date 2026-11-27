# Security overview

How Orbyte protects users and their data. See `ARCHITECTURE.md` and `docs/decisions/` for the reasoning behind each control.

## Identity & access
* Email/password via Better Auth (scrypt hashes, 10–128 character passwords). Sessions live in the database, so revocation is immediate. Users can see and revoke their other sessions.
* Every page, server action and API route resolves the session on the server. Every query is scoped to `ownerId`; another user's resource returns **404**, never 403, so ids leak nothing.
* Post-login redirects accept only same-origin relative paths.

## Request protection
* **Rate limits**, Redis-backed with atomic Lua counters: sign-in 10/min, sign-up 5/min and password change 5/min per IP; API per user: reads 600/min, writes 120/min, uploads 60/min, runs 30/min, credential changes 10/min. If Redis is down, an in-process fallback still limits.
* **CSRF:** session cookies are `SameSite=Lax`, `HttpOnly`, and `Secure` in production. Mutating API requests with a foreign `Origin` are rejected (403). Better Auth checks trusted origins.
* **Content Security Policy** on every page: per-request nonce with `strict-dynamic` for scripts, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`. Plus `nosniff`, `X-Frame-Options: SAMEORIGIN`, a strict referrer policy, a permissions policy, and HSTS on https deployments.

## Data protection
* **Provider API keys:** AES-256-GCM with per-row IVs and authentication tags, bound to owner + provider through AAD; key versions support rotation. Keys are never returned by the API. They are decrypted only in memory while a provider call runs, and redacted from all persisted node data and logs.
* **Uploads:** extension allowlist + magic-byte sniffing (the browser's MIME type is ignored). Streamed to disk with the size limit enforced while streaming. Random, owner-scoped storage keys that are never exposed.
* **Serving files:** only through authorised routes, with `nosniff`, a `sandbox` CSP (scripts can't run, even in an SVG opened directly), text-like types as `text/plain`, and attachment downloads.
* **Logs** contain ids, error names and codes, never secrets, prompts or storage keys.

## Workflow execution
* No user code runs: Transform and Condition nodes use a fixed set of declarative operations.
* **HTTP Request node (SSRF):** http/https only, no URL credentials. DNS answers are checked against private, loopback, link-local and metadata ranges at connect time (no socket reuse), every redirect is re-checked, and responses are capped by time and size.
* Per-node timeouts, bounded concurrency, capped stored payloads (256 KB per value).

## Local Claude CLI provider (personal use)
* Switched on from the Integrations page and **owner-only**: the first account to switch it on owns it; other accounts can neither use nor claim it until it's switched off. `LOCAL_CLAUDE_CLI="off"` hard-disables it. It runs on the server machine's signed-in Claude subscription, so it is for a single person's own machine only: offering Claude subscription logins or limits to other users isn't allowed.
* Images sent to it (or to OpenAI) must be the run owner's own image assets; they're decoded and re-encoded by sharp (max 1568 px) before leaving the server.
* The CLI runs with `--tools ""` (no tools), no setting sources (no hooks, no CLAUDE.md), `--strict-mcp-config` (no MCP servers), no slash commands, no saved sessions, an empty temporary working directory, and an allow-listed environment, so app secrets never reach it. The prompt is sent on stdin, and output is size-capped. Cancel and timeouts kill the process.

## Account security
* **Password reset:** one-time links that expire after 1 hour; a reset signs out every other session and is recorded in the activity log. The request endpoint answers the same way whether or not the account exists, and emails are sent without awaiting so timing doesn't reveal it either. Rate limited (3 per 5 minutes).
* **Email verification:** links expire after 24 hours. `REQUIRE_EMAIL_VERIFICATION=on` blocks sign-in until verified. The app nags unverified accounts only when account email is actually configured.
* **Two-factor sign-in (TOTP):** set up from Settings → Security with password confirmation; turned on only after the first valid code. Secrets and backup codes are stored encrypted by Better Auth; backup codes are single-use; verification is rate limited (5 per minute) with lockout after repeated failures. Turning it off requires the password.
* **Send Email node:** sends only from the run owner's connected Gmail (app password encrypted like API keys and redacted from run data); recipients are validated, at most 10; subjects can't inject headers; attachments must be the owner's own assets (max 5 files, 20 MB); new nodes default to preview mode.

## Known limitations
* Styles allow `'unsafe-inline'` (React style attributes and UI libraries); scripts do not.

## Reporting
Please report vulnerabilities privately to the repository owner rather than in a public issue.
