# ADR-0009: Production hardening choices

**Status:** accepted (Milestone 6)

**Rate limiting in Redis, with a local fallback.** One fixed-window limiter (a Lua script: increment, first-hit expiry and verdict in a single atomic step) serves both Better Auth's `customStorage.consume` and the API's per-user limits. If Redis is unreachable the limiter falls back to per-process counters rather than failing open (no limits) or failing closed (an outage). Limits are per user for the API, so they are not fooled by spoofed `X-Forwarded-For`. Login limits are per IP and need `AUTH_IP_HEADERS` / `TRUSTED_PROXIES` configured behind a proxy.

**CSP: nonce scripts, inline styles.** Script injection is the real XSS risk, so scripts need a per-request nonce with `strict-dynamic`. Styles allow `'unsafe-inline'`: React renders `style` attributes, and Sonner, Recharts and React Flow inject `<style>` tags without nonces. Browsers ignore `'unsafe-inline'` when a nonce is present, so styles get no nonce. Nonces require per-request rendering; the root layout calls `connection()`, which was effectively already the case for this authenticated app (ADR-0002). `upgrade-insecure-requests` and HSTS apply only when `APPLICATION_URL` is https, so local http testing works.

**Origin check on API mutations.** `SameSite=Lax` cookies already stop cross-site POSTs carrying the session. Rejecting foreign `Origin` headers adds a second, independent CSRF control at almost no cost. Requests without `Origin` (server-to-server, CLI) are unaffected.

**Streaming uploads.** Multipart bodies stream through busboy into a private temp directory with the size limit enforced mid-stream. Validation (sniffing, UTF-8, JSON), thumbnails and the storage write read from that file. Memory use no longer grows with file size or upload concurrency.

**Range requests from the database size.** Ranges are resolved against `asset.sizeBytes` before touching storage, so clamping and 416s are correct for both storage adapters. Thumbnails are always served whole.

**Standalone tracing must be tested.** Next's file tracer missed `file-type`'s dynamic `import("strtok3")`. Dev and `next start` worked; the standalone server (what Docker runs) failed every upload. The fix is an explicit `outputFileTracingIncludes`. The lasting lesson: CI builds the Docker image and runs a smoke test (sign-up, upload, thumbnail, range, CSP) against it.

**Accessibility as a test.** axe runs against every page in E2E and fails on serious or critical issues. It found real problems: button contrast (so `#7C3AED` is used for white-text surfaces while `#8B5CF6` stays the brand accent), label/name mismatches, and colour-only links. A console-error check alongside it found a long-standing hydration mismatch in relative timestamps.
