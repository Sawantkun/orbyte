/**
 * Re-encrypt stored provider credentials with the current ENCRYPTION_KEY.
 * Usage: set ENCRYPTION_KEY (new), ENCRYPTION_KEY_VERSION (bumped) and
 * ENCRYPTION_KEY_PREVIOUS (old), then `pnpm secrets:rotate`.
 */
import { db } from "@/lib/db";
import { rotateIntegrationSecrets } from "@/server/integrations";

const result = await rotateIntegrationSecrets();
console.log(`Re-encrypted ${result.rotated} credential(s); ${result.failed} could not be decrypted.`);
await db.$disconnect();
process.exit(result.failed ? 1 : 0);
