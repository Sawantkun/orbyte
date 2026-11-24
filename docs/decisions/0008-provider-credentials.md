# ADR-0008: User provider credentials

**Status:** accepted (Milestone 5)

**Encryption.** User API keys are sealed with AES-256-GCM using `ENCRYPTION_KEY` (32 bytes). Each row stores ciphertext, a random 96-bit IV, the auth tag and a `keyVersion`. The additional authenticated data is `orbyte:integration:v1:<ownerId>:<provider>`, so a ciphertext copied onto another user's or provider's row fails authentication instead of decrypting. Only the last four characters are stored in clear as a hint.

**Rotation.** Set a new `ENCRYPTION_KEY`, move the old one to `ENCRYPTION_KEY_PREVIOUS`, bump `ENCRYPTION_KEY_VERSION`, run `pnpm secrets:rotate`, then remove the previous key. Reads work throughout because both versions are in the keyring.

**Where plaintext exists.** Only inside the worker (or API process during validation), in memory, for the duration of a provider call. API responses never include secret material. Every resolved key is registered with the engine's redactor, so it is scrubbed from node inputs, outputs, logs and errors even if a provider echoes it.

**Precedence.** The user's key, then the platform `OPENAI_API_KEY`, then a clear "not configured" error. A user key the provider rejects at run time is marked `INVALID` (shown on the Integrations page). If no platform key exists, the run fails with "Your OpenAI key was rejected" rather than silently using nothing.

**Validation.** Keys are checked with a zero-cost call (`GET /v1/models`). A definite rejection (401/403) blocks saving. Network trouble or rate limiting saves the key as `UNVERIFIED` rather than blocking the user.

**One key per provider.** Multiple labelled keys per provider (e.g. per client) are supported by the schema (`label`) but not exposed yet. Replacing a key keeps the row and its history.
