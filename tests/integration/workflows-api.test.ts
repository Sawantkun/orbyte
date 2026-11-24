import { beforeEach, describe, expect, it } from "vitest";
import * as collection from "@/app/api/workflows/route";
import * as item from "@/app/api/workflows/[id]/route";
import * as duplicate from "@/app/api/workflows/[id]/duplicate/route";
import * as publish from "@/app/api/workflows/[id]/publish/route";
import * as versions from "@/app/api/workflows/[id]/versions/route";
import * as version from "@/app/api/workflows/[id]/versions/[version]/route";
import * as restore from "@/app/api/workflows/[id]/versions/[version]/restore/route";
import * as templates from "@/app/api/prompt-templates/route";
import * as templateItem from "@/app/api/prompt-templates/[id]/route";
import { db } from "@/lib/db";
import { starterDefinition } from "@/lib/workflow/starters";
import { json, params, request, signedInUser } from "../support/api";
import { resetDatabase } from "../support/db";

async function create(cookie: string, body: Record<string, unknown> = { name: "Flow", starter: "text" }) {
  const res = await collection.POST(request("/api/workflows", { method: "POST", cookie, body }), {} as never);
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string; updatedAt: string; name: string };
}

describe("workflows API", () => {
  beforeEach(resetDatabase);

  it("requires authentication on every endpoint", async () => {
    const p = params({ id: "x" });
    const responses = await Promise.all([
      collection.GET(request("/api/workflows"), {} as never),
      collection.POST(request("/api/workflows", { method: "POST", body: { name: "x" } }), {} as never),
      item.GET(request("/api/workflows/x"), p),
      item.PATCH(request("/api/workflows/x", { method: "PATCH", body: { name: "y" } }), p),
      item.DELETE(request("/api/workflows/x", { method: "DELETE" }), p),
      duplicate.POST(request("/api/workflows/x/duplicate", { method: "POST" }), p),
      publish.POST(request("/api/workflows/x/publish", { method: "POST", body: {} }), p),
      templates.GET(request("/api/prompt-templates"), {} as never),
    ]);
    for (const r of responses) {
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Sign in to continue" } });
    }
  });

  it("validates request bodies with useful errors", async () => {
    const { cookie } = await signedInUser();
    const bad = await collection.POST(request("/api/workflows", { method: "POST", cookie, body: { name: "", starter: "nope" } }), {} as never);
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(body.error.details.fieldErrors).sort()).toEqual(["name", "starter"]);

    const malformed = await collection.POST(request("/api/workflows", { method: "POST", cookie, body: "{not json" }), {} as never);
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("INVALID_JSON");

    const wf = await create(cookie);
    const badDef = await item.PATCH(
      request(`/api/workflows/${wf.id}`, { method: "PATCH", cookie, body: { definition: { schemaVersion: 2, nodes: [], edges: [] } } }),
      params({ id: wf.id }),
    );
    expect(badDef.status).toBe(400);
  });

  it("creates, lists with search + cursor pagination, reads, renames and deletes", async () => {
    const { cookie, id: ownerId } = await signedInUser();
    const created = [];
    for (const name of ["Alpha launch", "Beta blog", "Gamma launch"]) created.push(await create(cookie, { name, starter: "blank" }));

    const page1 = await json(await collection.GET(request("/api/workflows?limit=2", { cookie }), {} as never));
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.nextCursor).toBeTruthy();
    const page2 = await json(await collection.GET(request(`/api/workflows?limit=2&cursor=${page1.meta.nextCursor}`, { cookie }), {} as never));
    expect(page2.data).toHaveLength(1);
    expect(page2.meta.nextCursor).toBeNull();
    expect(new Set([...page1.data, ...page2.data].map((w: { id: string }) => w.id)).size).toBe(3);

    const search = await json(await collection.GET(request("/api/workflows?q=LAUNCH", { cookie }), {} as never));
    expect(search.data.map((w: { name: string }) => w.name).sort()).toEqual(["Alpha launch", "Gamma launch"]);

    const one = await json(await item.GET(request(`/api/workflows/${created[0].id}`, { cookie }), params({ id: created[0].id })));
    expect(one.data.definition).toEqual({ schemaVersion: 1, nodes: [], edges: [] });
    expect(one.data.versions).toEqual([]);

    const renamed = await item.PATCH(request(`/api/workflows/${created[0].id}`, { method: "PATCH", cookie, body: { name: "Renamed" } }), params({ id: created[0].id }));
    expect((await renamed.json()).data.name).toBe("Renamed");

    const del = await item.DELETE(request(`/api/workflows/${created[0].id}`, { method: "DELETE", cookie }), params({ id: created[0].id }));
    expect(del.status).toBe(204);
    expect(await db.workflow.count({ where: { ownerId } })).toBe(2);
    expect(await db.activityLog.count({ where: { ownerId, action: "workflow.deleted" } })).toBe(1);
  });

  it("isolates workflows between users (404, never 403)", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const wf = await create(alice.cookie);
    const p = params({ id: wf.id });

    expect((await item.GET(request(`/api/workflows/${wf.id}`, { cookie: bob.cookie }), p)).status).toBe(404);
    expect((await item.PATCH(request(`/api/workflows/${wf.id}`, { method: "PATCH", cookie: bob.cookie, body: { name: "pwned" } }), p)).status).toBe(404);
    expect((await item.DELETE(request(`/api/workflows/${wf.id}`, { method: "DELETE", cookie: bob.cookie }), p)).status).toBe(404);
    expect((await duplicate.POST(request(`/api/workflows/${wf.id}/duplicate`, { method: "POST", cookie: bob.cookie }), p)).status).toBe(404);
    expect((await publish.POST(request(`/api/workflows/${wf.id}/publish`, { method: "POST", cookie: bob.cookie, body: {} }), p)).status).toBe(404);
    expect((await versions.GET(request(`/api/workflows/${wf.id}/versions`, { cookie: bob.cookie }), p)).status).toBe(404);

    const bobList = await json(await collection.GET(request("/api/workflows", { cookie: bob.cookie }), {} as never));
    expect(bobList.data).toEqual([]);
    expect((await db.workflow.findUniqueOrThrow({ where: { id: wf.id } })).name).toBe("Flow");
  });

  it("rejects stale saves with 409 (optimistic concurrency)", async () => {
    const { cookie } = await signedInUser();
    const wf = await create(cookie);
    const p = params({ id: wf.id });
    const first = await item.PATCH(
      request(`/api/workflows/${wf.id}`, { method: "PATCH", cookie, body: { name: "Tab A", expectedUpdatedAt: wf.updatedAt } }),
      p,
    );
    expect(first.status).toBe(200);
    const stale = await item.PATCH(
      request(`/api/workflows/${wf.id}`, { method: "PATCH", cookie, body: { name: "Tab B", expectedUpdatedAt: wf.updatedAt } }),
      p,
    );
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details.currentUpdatedAt).toBeTruthy();
  });

  it("publishes immutable, incrementing versions and restores them", async () => {
    const { cookie, id: ownerId } = await signedInUser();
    const wf = await create(cookie);
    const p = params({ id: wf.id });

    const v1 = await publish.POST(request(`/api/workflows/${wf.id}/publish`, { method: "POST", cookie, body: {} }), p);
    expect(v1.status).toBe(201);
    const v1Body = await v1.json();
    expect(v1Body.data.version.version).toBe(1);
    expect(v1Body.data.workflow.status).toBe("ACTIVE");

    // Edit the draft: the published version must not change.
    const edited = starterDefinition("text");
    edited.nodes[0].data.label = "Changed";
    await item.PATCH(request(`/api/workflows/${wf.id}`, { method: "PATCH", cookie, body: { definition: edited } }), p);
    const stored = await json(await version.GET(request(`/api/workflows/${wf.id}/versions/1`, { cookie }), params({ id: wf.id, version: "1" })));
    expect(stored.data.definition.nodes[0].data.label).toBe("Topic");
    expect(stored.data.inputSchema).toEqual([{ name: "topic", type: "text", description: "What to write about", required: true, defaultValue: "" }]);

    const v2 = await json(await publish.POST(request(`/api/workflows/${wf.id}/publish`, { method: "POST", cookie, body: {} }), p));
    expect(v2.data.version.version).toBe(2);
    const list = await json(await versions.GET(request(`/api/workflows/${wf.id}/versions`, { cookie }), p));
    expect(list.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const restored = await restore.POST(request(`/api/workflows/${wf.id}/versions/1/restore`, { method: "POST", cookie }), params({ id: wf.id, version: "1" }));
    expect(restored.status).toBe(200);
    const after = await json(await item.GET(request(`/api/workflows/${wf.id}`, { cookie }), p));
    expect(after.data.definition.nodes[0].data.label).toBe("Topic");
    expect(after.data.definition).not.toHaveProperty("inputSchema");

    expect((await version.GET(request(`/api/workflows/${wf.id}/versions/abc`, { cookie }), params({ id: wf.id, version: "abc" }))).status).toBe(400);
    expect((await version.GET(request(`/api/workflows/${wf.id}/versions/9`, { cookie }), params({ id: wf.id, version: "9" }))).status).toBe(404);
    expect(await db.activityLog.count({ where: { ownerId, action: "workflow.published" } })).toBe(2);
  });

  it("refuses to publish an invalid graph and reports the issues", async () => {
    const { cookie } = await signedInUser();
    const wf = await create(cookie, { name: "Empty", starter: "blank" });
    const res = await publish.POST(request(`/api/workflows/${wf.id}/publish`, { method: "POST", cookie, body: {} }), params({ id: wf.id }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.details.issues.map((i: { code: string }) => i.code)).toEqual(["EMPTY"]);
    expect(await db.workflowVersion.count()).toBe(0);
  });

  it("duplicates the draft without versions", async () => {
    const { cookie } = await signedInUser();
    const wf = await create(cookie);
    await publish.POST(request(`/api/workflows/${wf.id}/publish`, { method: "POST", cookie, body: {} }), params({ id: wf.id }));
    const copy = await json(await duplicate.POST(request(`/api/workflows/${wf.id}/duplicate`, { method: "POST", cookie }), params({ id: wf.id })));
    expect(copy.data).toMatchObject({ name: "Flow (copy)", status: "DRAFT", latestVersion: 0 });
    const full = await json(await item.GET(request(`/api/workflows/${copy.data.id}`, { cookie }), params({ id: copy.data.id })));
    expect(full.data.definition.nodes).toHaveLength(4);
  });
});

describe("prompt templates API", () => {
  beforeEach(resetDatabase);

  it("creates with extracted variables, enforces unique names and ownership", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const body = { name: "Launch blurb", content: "Describe {{product_name}} for {{target_audience}}." };
    const created = await templates.POST(request("/api/prompt-templates", { method: "POST", cookie: alice.cookie, body }), {} as never);
    expect(created.status).toBe(201);
    const t = (await created.json()).data;
    expect(t.variables).toEqual(["product_name", "target_audience"]);

    const dupe = await templates.POST(request("/api/prompt-templates", { method: "POST", cookie: alice.cookie, body }), {} as never);
    expect(dupe.status).toBe(409);

    const p = params({ id: t.id });
    expect((await templateItem.PATCH(request(`/api/prompt-templates/${t.id}`, { method: "PATCH", cookie: bob.cookie, body: { name: "x" } }), p)).status).toBe(404);
    expect((await templateItem.DELETE(request(`/api/prompt-templates/${t.id}`, { method: "DELETE", cookie: bob.cookie }), p)).status).toBe(404);
    expect((await json(await templates.GET(request("/api/prompt-templates", { cookie: bob.cookie }), {} as never))).data).toEqual([]);

    const upd = await json(await templateItem.PATCH(request(`/api/prompt-templates/${t.id}`, { method: "PATCH", cookie: alice.cookie, body: { content: "Only {{tone}}" } }), p));
    expect(upd.data.variables).toEqual(["tone"]);
    expect((await templateItem.DELETE(request(`/api/prompt-templates/${t.id}`, { method: "DELETE", cookie: alice.cookie }), p)).status).toBe(204);
  });
});
