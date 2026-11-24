import "server-only";
import { Prisma, type IntegrationStatus } from "@/generated/prisma/client";
import { findIntegrationProvider } from "@/config/integrations";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { recordActivity } from "./activity";
import { openSecret, sealSecret, secretHint, SecretDecryptionError } from "./crypto/secrets";
import { AppError, conflict, notFound } from "./errors";

/** What the API returns. Never includes ciphertext, IV, tag or plaintext. */
export type IntegrationDto = {
  id: string;
  provider: string;
  label: string;
  secretHint: string;
  status: IntegrationStatus;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const publicSelect = { id: true, provider: true, label: true, secretHint: true, status: true, lastValidatedAt: true, createdAt: true, updatedAt: true } as const;
type PublicRow = Prisma.IntegrationGetPayload<{ select: typeof publicSelect }>;
const toDto = (r: PublicRow): IntegrationDto => ({
  ...r,
  lastValidatedAt: r.lastValidatedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export type Validator = (provider: string, secret: string) => Promise<IntegrationStatus>;

/** Checks a key against the provider without spending tokens (lists models). */
export const validateWithProvider: Validator = async (provider, secret) => {
  if (provider !== "openai") return "UNVERIFIED";
  try {
    const res = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/v1/models`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return "ACTIVE";
    if (res.status === 401 || res.status === 403) return "INVALID";
    return "UNVERIFIED"; // rate limited / provider trouble: don't block saving
  } catch {
    return "UNVERIFIED";
  }
};

function assertProvider(provider: string, secret?: string) {
  const p = findIntegrationProvider(provider);
  if (!p || !p.available) throw new AppError(400, "UNSUPPORTED_PROVIDER", "This provider can't be connected yet.");
  if (secret !== undefined && !p.keyPattern.test(secret.trim())) {
    throw new AppError(400, "INVALID_KEY_FORMAT", `That doesn't look like a ${p.name} API key.`);
  }
}

export async function listIntegrations(ownerId: string): Promise<IntegrationDto[]> {
  const rows = await db.integration.findMany({ where: { ownerId }, select: publicSelect, orderBy: { createdAt: "asc" } });
  return rows.map(toDto);
}

/** One credential per provider per user (replace it to change keys). */
export async function createIntegration(ownerId: string, input: { provider: string; secret: string; label?: string }, validate: Validator = validateWithProvider): Promise<IntegrationDto> {
  const secret = input.secret.trim();
  assertProvider(input.provider, secret);
  const existing = await db.integration.findFirst({ where: { ownerId, provider: input.provider }, select: { id: true } });
  if (existing) throw conflict("A key for this provider is already connected. Replace it instead.");

  const status = await validate(input.provider, secret);
  if (status === "INVALID") throw new AppError(422, "KEY_REJECTED", "The provider rejected this API key.");
  try {
    const row = await db.integration.create({
      data: {
        ownerId,
        provider: input.provider,
        label: input.label?.trim() || "Default",
        ...sealSecret(secret, { ownerId, provider: input.provider }),
        secretHint: secretHint(secret),
        status,
        lastValidatedAt: status === "UNVERIFIED" ? null : new Date(),
      },
      select: publicSelect,
    });
    await recordActivity({ ownerId, action: "integration.added", entityType: "integration", entityId: row.id, metadata: { name: findIntegrationProvider(input.provider)!.name } });
    return toDto(row);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("A key for this provider is already connected.");
    throw e;
  }
}

export async function replaceIntegrationSecret(ownerId: string, id: string, secret: string, validate: Validator = validateWithProvider): Promise<IntegrationDto> {
  const row = await db.integration.findFirst({ where: { id, ownerId }, select: { provider: true } });
  if (!row) throw notFound("Integration");
  const clean = secret.trim();
  assertProvider(row.provider, clean);
  const status = await validate(row.provider, clean);
  if (status === "INVALID") throw new AppError(422, "KEY_REJECTED", "The provider rejected this API key.");
  const updated = await db.integration.update({
    where: { id },
    data: { ...sealSecret(clean, { ownerId, provider: row.provider }), secretHint: secretHint(clean), status, lastValidatedAt: status === "UNVERIFIED" ? null : new Date() },
    select: publicSelect,
  });
  await recordActivity({ ownerId, action: "integration.updated", entityType: "integration", entityId: id, metadata: { name: findIntegrationProvider(row.provider)!.name } });
  return toDto(updated);
}

export async function revalidateIntegration(ownerId: string, id: string, validate: Validator = validateWithProvider): Promise<IntegrationDto> {
  const row = await db.integration.findFirst({ where: { id, ownerId } });
  if (!row) throw notFound("Integration");
  let status: IntegrationStatus;
  try {
    status = await validate(row.provider, openSecret(row, { ownerId, provider: row.provider }));
  } catch (e) {
    if (e instanceof SecretDecryptionError) status = "INVALID";
    else throw e;
  }
  const updated = await db.integration.update({ where: { id }, data: { status, lastValidatedAt: new Date() }, select: publicSelect });
  return toDto(updated);
}

export async function deleteIntegration(ownerId: string, id: string): Promise<void> {
  const row = await db.integration.findFirst({ where: { id, ownerId }, select: { provider: true } });
  if (!row) throw notFound("Integration");
  await db.integration.deleteMany({ where: { id, ownerId } });
  await recordActivity({ ownerId, action: "integration.removed", entityType: "integration", entityId: id, metadata: { name: findIntegrationProvider(row.provider)?.name ?? row.provider } });
}

/**
 * Credential for the execution engine: the user's own key if connected,
 * otherwise null (callers fall back to the platform key). Keys previously
 * rejected by the provider are not used.
 */
export async function resolveUserSecret(ownerId: string, provider: string): Promise<{ integrationId: string; secret: string } | { integrationId: string; invalid: true } | null> {
  const row = await db.integration.findFirst({ where: { ownerId, provider }, orderBy: { updatedAt: "desc" } });
  if (!row) return null;
  if (row.status === "INVALID") return { integrationId: row.id, invalid: true };
  try {
    return { integrationId: row.id, secret: openSecret(row, { ownerId, provider }) };
  } catch (e) {
    if (e instanceof SecretDecryptionError) {
      console.error("[integrations] could not decrypt credential", { integrationId: row.id, keyVersion: row.keyVersion });
      return { integrationId: row.id, invalid: true };
    }
    throw e;
  }
}

export async function markIntegrationInvalid(integrationId: string): Promise<void> {
  await db.integration.updateMany({ where: { id: integrationId }, data: { status: "INVALID", lastValidatedAt: new Date() } });
}

/** Whether the server has a platform-level key (the UI says so without revealing anything). */
export const platformKeyAvailable = (provider: string) => provider === "openai" && Boolean(env.OPENAI_API_KEY);

/** Re-encrypt every credential with the current key version. Returns the number re-encrypted. */
export async function rotateIntegrationSecrets(): Promise<{ rotated: number; failed: number }> {
  const rows = await db.integration.findMany({ where: { keyVersion: { not: env.ENCRYPTION_KEY_VERSION } } });
  let rotated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const plain = openSecret(row, { ownerId: row.ownerId, provider: row.provider });
      await db.integration.update({ where: { id: row.id }, data: sealSecret(plain, { ownerId: row.ownerId, provider: row.provider }) });
      rotated++;
    } catch {
      failed++;
    }
  }
  return { rotated, failed };
}
