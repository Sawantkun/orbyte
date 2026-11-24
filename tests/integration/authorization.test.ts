import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDashboardData } from "@/server/dashboard";
import { listActiveSessions, revokeUserSession } from "@/server/sessions";
import { createUser, resetDatabase } from "../support/db";

const future = () => new Date(Date.now() + 86_400_000);

async function createSession(userId: string) {
  return db.session.create({
    data: { userId, token: `tok_${Math.random().toString(36).slice(2)}`, expiresAt: future() },
  });
}

describe("session revocation ownership", () => {
  beforeEach(resetDatabase);

  it("lets a user revoke their own other session", async () => {
    const a = await createUser();
    const current = await createSession(a.id);
    const other = await createSession(a.id);
    expect(await revokeUserSession(a.id, other.id, current.id)).toEqual({ ok: true });
    expect(await db.session.count({ where: { userId: a.id } })).toBe(1);
  });

  it("refuses to revoke another user's session and leaves it intact", async () => {
    const a = await createUser();
    const b = await createUser();
    const aCurrent = await createSession(a.id);
    const bSession = await createSession(b.id);
    expect(await revokeUserSession(a.id, bSession.id, aCurrent.id)).toEqual({ ok: false, error: "Session not found" });
    expect(await db.session.findUnique({ where: { id: bSession.id } })).not.toBeNull();
  });

  it("refuses the current session and malformed ids", async () => {
    const a = await createUser();
    const current = await createSession(a.id);
    expect((await revokeUserSession(a.id, current.id, current.id)).ok).toBe(false);
    expect((await revokeUserSession(a.id, 42, current.id)).ok).toBe(false);
    expect((await revokeUserSession(a.id, "x".repeat(65), current.id)).ok).toBe(false);
  });

  it("never exposes session tokens when listing", async () => {
    const a = await createUser();
    const s = await createSession(a.id);
    const list = await listActiveSessions(a.id, s.id);
    expect(list).toHaveLength(1);
    expect(list[0].current).toBe(true);
    expect(JSON.stringify(list)).not.toContain(s.token);
  });
});

describe("dashboard data isolation", () => {
  beforeEach(resetDatabase);

  async function seedFor(userId: string, name: string) {
    const wf = await db.workflow.create({ data: { ownerId: userId, name, definition: { nodes: [], edges: [] } } });
    const v = await db.workflowVersion.create({
      data: { workflowId: wf.id, version: 1, definition: {}, createdById: userId },
    });
    const ex = await db.workflowExecution.create({
      data: { ownerId: userId, workflowId: wf.id, workflowVersionId: v.id, status: "COMPLETED" },
    });
    await db.asset.create({
      data: { ownerId: userId, name: `${name}.png`, kind: "IMAGE", mimeType: "image/png", sizeBytes: 10, storageKey: `k/${name}`, workflowId: wf.id, executionId: ex.id },
    });
    await db.usageRecord.create({ data: { ownerId: userId, provider: "openai", model: "m", costUsd: "0.5" } });
  }

  it("only counts and lists the caller's own records", async () => {
    const a = await createUser("Alice");
    const b = await createUser("Bob");
    await seedFor(a.id, "alice-flow");
    await seedFor(b.id, "bob-flow");
    await seedFor(b.id, "bob-flow-2");

    const data = await getDashboardData(a.id);
    expect(data.stats).toEqual({ workflows: 1, executions: 1, successfulExecutions: 1, assets: 1, estimatedSpendUsd: 0.5 });
    expect(data.recentWorkflows.map((w) => w.name)).toEqual(["alice-flow"]);
    expect(data.recentExecutions.map((e) => e.workflowName)).toEqual(["alice-flow"]);
    expect(data.recentAssets.map((x) => x.name)).toEqual(["alice-flow.png"]);
    expect(data.assetDistribution).toEqual([{ kind: "IMAGE", count: 1 }]);
    expect(data.executionActivity.reduce((s, d) => s + d.completed, 0)).toBe(1);
  });

  it("reports no spend (not $0) when nothing priced was recorded", async () => {
    const a = await createUser();
    await db.usageRecord.create({ data: { ownerId: a.id, provider: "openai", model: "unpriced", costUsd: null } });
    expect((await getDashboardData(a.id)).stats.estimatedSpendUsd).toBeNull();
  });
});

describe("cascade rules", () => {
  beforeEach(resetDatabase);

  it("deleting a collection keeps its assets", async () => {
    const a = await createUser();
    const c = await db.assetCollection.create({ data: { ownerId: a.id, name: "Campaign" } });
    const asset = await db.asset.create({
      data: { ownerId: a.id, name: "x", kind: "TEXT", mimeType: "text/plain", sizeBytes: 1, storageKey: "k/x", collectionId: c.id },
    });
    await db.assetCollection.delete({ where: { id: c.id } });
    const after = await db.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.collectionId).toBeNull();
  });

  it("deleting a workflow keeps generated assets but drops executions", async () => {
    const a = await createUser();
    const wf = await db.workflow.create({ data: { ownerId: a.id, name: "w", definition: {} } });
    const v = await db.workflowVersion.create({ data: { workflowId: wf.id, version: 1, definition: {}, createdById: a.id } });
    const ex = await db.workflowExecution.create({ data: { ownerId: a.id, workflowId: wf.id, workflowVersionId: v.id } });
    const asset = await db.asset.create({
      data: { ownerId: a.id, name: "gen", kind: "IMAGE", mimeType: "image/png", sizeBytes: 1, storageKey: "k/gen", source: "WORKFLOW", workflowId: wf.id, executionId: ex.id },
    });
    await db.workflow.delete({ where: { id: wf.id } });
    expect(await db.workflowExecution.count()).toBe(0);
    const kept = await db.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(kept.workflowId).toBeNull();
    expect(kept.executionId).toBeNull();
  });

  it("deleting a user removes everything they own", async () => {
    const a = await createUser();
    await db.assetCollection.create({ data: { ownerId: a.id, name: "c" } });
    await db.activityLog.create({ data: { ownerId: a.id, action: "x", entityType: "y" } });
    await db.user.delete({ where: { id: a.id } });
    expect(await db.assetCollection.count()).toBe(0);
    expect(await db.activityLog.count()).toBe(0);
  });
});
