# ADR-0004: Database sessions without cookie cache

**Status:** accepted (Milestone 1)

Better Auth can cache the session in a signed cookie to skip a DB read. That means a revoked session keeps working until the cache expires. Orbyte exposes "sign out other sessions", so revocation must be immediate: the cookie cache is disabled. Cost: one indexed lookup per request. Revisit with Redis secondary storage if it shows up in profiles.

Session management in the UI addresses sessions by **id**; tokens never leave the server, and the revoke operation is owner-scoped (`deleteMany where { id, userId }`).
