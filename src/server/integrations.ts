import "server-only";
import { Prisma, type IntegrationStatus } from "@/generated/prisma/client";
import { findIntegrationProvider } from "@/config/integrations";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { recordActivity } from "./activity";
import { openSecret, sealSecret, secretHint, SecretDecryptionError } from "./crypto/secrets";
import { AppError, conflict, notFound } from "./errors";
import { gmailMailer } from "./mail";
import { EMAIL } from "@/lib/workflow/validate";

/** What the API returns. Never includes ciphertext, IV, tag or plaintext. */
export type IntegrationDto = {
  id: string;
  provider: string;
  label: string;
  secretHint: string;
  status: IntegrationStatus;
  /** The credential workflows use for this provider. */
  isDefault: boolean;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const publicSelect = { id: true, provider: true, label: true, secretHint: true, status: true, isDefault: true, lastValidatedAt: true, createdAt: true, updatedAt: true } as const;
type PublicRow = Prisma.IntegrationGetPayload<{ select: typeof publicSelect }>;
const toDto = (r: PublicRow): IntegrationDto => ({
  ...r,
  lastValidatedAt: r.lastValidatedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** `label` is the account name; for Gmail it's the address the app password belongs to. */
export type Validator = (provider: string, secret: string, label: string) => Promise<IntegrationStatus>;

/** Checks a credential with the provider without spending anything (lists models / SMTP login). */
export const validateWithProvider: Validator = async (provider, secret, label) => {
  if (provider === "gmail") {
    const r = await gmailMailer.verify({ user: label, pass: secret });
    return r === "ok" ? "ACTIVE" : r === "auth" ? "INVALID" : "UNVERIFIED";
  }
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

/** Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"). */
const MAX_PER_PROVIDER = 10;

const normalizeSecret = (provider: string, secret: string) => (provider === "gmail" ? secret.replace(/\s+/g, "") : secret.trim());

function assertProvider(provider: string, secret?: string) {
  const p = findIntegrationProvider(provider);
  if (!p || !p.available) throw new AppError(400, "UNSUPPORTED_PROVIDER", "This provider can't be connected yet.");
  if (secret !== undefined && !p.keyPattern.test(secret)) {
    throw new AppError(400, "INVALID_KEY_FORMAT", p.kind === "gmail" ? "A Gmail app password is 16 letters." : `That doesn't look like a ${p.name} API key.`);
  }
}

const rejectedMessage = (provider: string) =>
  provider === "gmail" ? "Gmail rejected this address and app password." : "The provider rejected this API key.";

export async function listIntegrations(ownerId: string): Promise<IntegrationDto[]> {
  const rows = await db.integration.findMany({ where: { ownerId }, select: publicSelect, orderBy: { createdAt: "asc" } });
  return rows.map(toDto);
}

/** One credential per provider per user (replace it to change keys). */
export async function createIntegration(ownerId: string, input: { provider: string; secret: string; label?: string }, validate: Validator = validateWithProvider): Promise<IntegrationDto> {
  const secret = normalizeSecret(input.provider, input.secret);
  assertProvider(input.provider, secret);
  let label = input.label?.trim() || "Default";
  if (input.provider === "gmail") {
    label = (input.label ?? "").trim().toLowerCase();
    if (!EMAIL.test(label)) throw new AppError(400, "INVALID_EMAIL", "Enter the Gmail address this app password belongs to.");
  }
  const existing = await db.integration.findMany({ where: { ownerId, provider: input.provider }, select: { label: true, isDefault: true } });
  if (existing.length >= MAX_PER_PROVIDER) throw conflict(`You can connect up to ${MAX_PER_PROVIDER} credentials per service.`);
  if (input.provider !== "gmail" && !input.label?.trim()) {
    // Name extra keys automatically: Default, Key 2, Key 3…
    for (let i = 1; existing.some((e) => e.label.toLowerCase() === label.toLowerCase()); i++) label = `Key ${i + 1}`;
  }
  if (existing.some((e) => e.label.toLowerCase() === label.toLowerCase())) {
    throw conflict(input.provider === "gmail" ? "This Gmail address is already connected." : `A key named "${label}" already exists.`);
  }
  const isDefault = !existing.some((e) => e.isDefault);

  const status = await validate(input.provider, secret, label);
  if (status === "INVALID") throw new AppError(422, "KEY_REJECTED", rejectedMessage(input.provider));
  try {
    const row = await db.integration.create({
      data: {
        ownerId,
        provider: input.provider,
        label,
        ...sealSecret(secret, { ownerId, provider: input.provider }),
        secretHint: secretHint(secret),
        status,
        isDefault,
        lastValidatedAt: status === "UNVERIFIED" ? null : new Date(),
      },
      select: publicSelect,
    });
    await recordActivity({ ownerId, action: "integration.added", entityType: "integration", entityId: row.id, metadata: { name: findIntegrationProvider(input.provider)!.name } });
    return toDto(row);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("That credential was just added. Reload the page.");
    throw e;
  }
}

export async function replaceIntegrationSecret(ownerId: string, id: string, secret: string, validate: Validator = validateWithProvider): Promise<IntegrationDto> {
  const row = await db.integration.findFirst({ where: { id, ownerId }, select: { provider: true, label: true } });
  if (!row) throw notFound("Integration");
  const clean = normalizeSecret(row.provider, secret);
  assertProvider(row.provider, clean);
  const status = await validate(row.provider, clean, row.label);
  if (status === "INVALID") throw new AppError(422, "KEY_REJECTED", rejectedMessage(row.provider));
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
    status = await validate(row.provider, openSecret(row, { ownerId, provider: row.provider }), row.label);
  } catch (e) {
    if (e instanceof SecretDecryptionError) status = "INVALID";
    else throw e;
  }
  const updated = await db.integration.update({ where: { id }, data: { status, lastValidatedAt: new Date() }, select: publicSelect });
  return toDto(updated);
}

/** Make this credential the one workflows use for its provider. */
export async function setDefaultIntegration(ownerId: string, id: string): Promise<IntegrationDto[]> {
  const row = await db.integration.findFirst({ where: { id, ownerId }, select: { provider: true } });
  if (!row) throw notFound("Integration");
  await db.$transaction([
    db.integration.updateMany({ where: { ownerId, provider: row.provider, isDefault: true, id: { not: id } }, data: { isDefault: false } }),
    db.integration.update({ where: { id }, data: { isDefault: true } }),
  ]);
  return listIntegrations(ownerId);
}

/** Rename a credential (not Gmail, whose label is the address). */
export async function renameIntegration(ownerId: string, id: string, label: string): Promise<IntegrationDto> {
  const row = await db.integration.findFirst({ where: { id, ownerId }, select: { provider: true } });
  if (!row) throw notFound("Integration");
  if (row.provider === "gmail") throw new AppError(400, "CANNOT_RENAME", "A Gmail connection is named after its address.");
  const clash = await db.integration.findFirst({ where: { ownerId, provider: row.provider, id: { not: id }, label: { equals: label.trim(), mode: "insensitive" } }, select: { id: true } });
  if (clash) throw conflict(`A key named "${label.trim()}" already exists.`);
  try {
    return toDto(await db.integration.update({ where: { id }, data: { label: label.trim() }, select: publicSelect }));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict(`A key named "${label.trim()}" already exists.`);
    throw e;
  }
}

export async function deleteIntegration(ownerId: string, id: string): Promise<void> {
  const row = await db.integration.findFirst({ where: { id, ownerId }, select: { provider: true, isDefault: true } });
  if (!row) throw notFound("Integration");
  await db.$transaction(async (tx) => {
    await tx.integration.deleteMany({ where: { id, ownerId } });
    if (row.isDefault) {
      // Promote the most recently updated remaining credential.
      const next = await tx.integration.findFirst({ where: { ownerId, provider: row.provider }, orderBy: { updatedAt: "desc" }, select: { id: true } });
      if (next) await tx.integration.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  await recordActivity({ ownerId, action: "integration.removed", entityType: "integration", entityId: id, metadata: { name: findIntegrationProvider(row.provider)?.name ?? row.provider } });
}

/**
 * Credential for the execution engine: the user's own key if connected,
 * otherwise null (callers fall back to the platform key). Keys previously
 * rejected by the provider are not used.
 */
export async function resolveUserSecret(ownerId: string, provider: string): Promise<{ integrationId: string; secret: string } | { integrationId: string; invalid: true } | null> {
  const row = await db.integration.findFirst({ where: { ownerId, provider }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
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

/** The owner's Gmail credential for the Send Email node, or null if not connected / rejected. */
export async function resolveGmail(ownerId: string): Promise<{ user: string; pass: string } | null> {
  const r = await resolveUserSecret(ownerId, "gmail");
  if (!r || "invalid" in r) return null;
  const row = await db.integration.findUnique({ where: { id: r.integrationId }, select: { label: true } });
  return row ? { user: row.label, pass: r.secret } : null;
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
