import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });
const STORAGE = "playwright/.auth/studio-user.json";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signUp(page, { name: "Ada Studio", email: uniqueEmail("studio"), password: "studio-password-123" });
  await context.storageState({ path: STORAGE });
  await context.close();
});
test.use({ storageState: STORAGE, viewport: { width: 1440, height: 900 } });

async function createWorkflow(page: Page, name: string, starter: "Blank canvas" | "Text generation" = "Text generation") {
  await page.goto("/workflows/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("radio", { name: new RegExp(starter) }).click();
  await page.getByRole("button", { name: "Create and open Studio" }).click();
  await expect(page).toHaveURL(/\/workflows\/[a-z0-9]+$/);
  await expect(page.locator(".react-flow")).toBeVisible();
}

const node = (page: Page, key: string) => page.getByTestId(`node-${key}`);
const saved = (page: Page) => expect(page.getByTestId("save-state")).toHaveText(/Saved/, { timeout: 10_000 });

test("empty state links to creation; created workflow opens in the Studio", async ({ page }) => {
  await page.goto("/workflows");
  await expect(page.getByText("No workflows yet")).toBeVisible();
  await createWorkflow(page, "Launch copy");
  for (const key of ["input_1", "prompt_1", "text_1", "output_1"]) await expect(node(page, key)).toBeVisible();
  await expect(page.getByText("Ready to publish")).toBeVisible();
});

test("edits persist across reloads (autosave)", async ({ page }) => {
  await createWorkflow(page, "Persistence");
  await node(page, "text_1").click();
  await page.getByLabel("Label").fill("Headline writer");
  await page.getByLabel("System instructions").fill("You write punchy headlines.");
  await saved(page);
  await page.reload();
  await expect(node(page, "text_1")).toContainText("Headline writer");
  await node(page, "text_1").click();
  await expect(page.getByLabel("System instructions")).toHaveValue("You write punchy headlines.");
});

test("add, connect, validate, undo/redo, delete and duplicate nodes", async ({ page }) => {
  await createWorkflow(page, "Graph editing");

  await page.getByRole("button", { name: "Add Transform node" }).click();
  await expect(node(page, "transform_1")).toBeVisible();
  // New transform has no input → validation error badge on the node.
  await expect(node(page, "transform_1")).toContainText("1");

  // Connect Draft → Transform by dragging between handles.
  const src = page.locator(".react-flow__node", { has: node(page, "text_1") }).locator(".react-flow__handle.source");
  const dst = page.locator(".react-flow__node", { has: node(page, "transform_1") }).locator(".react-flow__handle.target");
  await src.dragTo(dst);
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);

  await node(page, "transform_1").click();
  await page.getByRole("textbox", { name: "Input", exact: true }).fill("{{text_1.text}}");
  await expect(node(page, "transform_1")).not.toContainText(/^\d$/);

  // Undo/redo via keyboard (focus the canvas first so inputs don't capture it).
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);

  // Duplicate and delete via the inspector.
  await node(page, "transform_1").click();
  await page.getByRole("button", { name: "Duplicate node" }).click();
  await expect(node(page, "transform_2")).toBeVisible();
  await page.getByRole("button", { name: "Delete node" }).click();
  await expect(node(page, "transform_2")).toHaveCount(0);
  await saved(page);
});

test("cycles are rejected at connect time", async ({ page }) => {
  await createWorkflow(page, "No loops");
  const src = page.locator(".react-flow__node", { has: node(page, "text_1") }).locator(".react-flow__handle.source");
  const dst = page.locator(".react-flow__node", { has: node(page, "prompt_1") }).locator(".react-flow__handle.target");
  await src.dragTo(dst);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
});

test("publishing creates versions; invalid drafts are blocked; versions restore", async ({ page }) => {
  await createWorkflow(page, "Versioned");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published version 1")).toBeVisible();
  await expect(page.getByText("v1", { exact: true })).toBeVisible();

  // Break the graph: clear the prompt → publish refuses.
  await node(page, "text_1").click();
  await page.getByLabel("Prompt", { exact: true }).fill("");
  await expect(page.getByRole("button", { name: "Publish" })).toContainText("1");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Fix 1 error before publishing.")).toBeVisible();
  await expect(page.getByText("Draft: Prompt is required.").first()).toBeVisible();
  await saved(page);

  // Restore v1 into the draft.
  await page.getByRole("button", { name: "Version history" }).click();
  await page.getByRole("menuitem", { name: /Version 1/ }).click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Draft restored from version 1")).toBeVisible();
  await expect(page.getByText("Ready to publish")).toBeVisible();
  await page.reload();
  await node(page, "text_1").click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("{{prompt_1.text}}");
});

test("prompt templates can be saved to and loaded from the library", async ({ page }) => {
  await createWorkflow(page, "Template user");
  await node(page, "prompt_1").click();
  await page.getByLabel("Template", { exact: true }).fill("Tagline for {{topic}} in a {{topic}} tone");
  await page.getByRole("button", { name: "Save to library" }).click();
  await page.getByLabel("Name").last().fill("Tagline");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved to your prompt library")).toBeVisible();

  await page.getByLabel("Template", { exact: true }).fill("");
  await page.getByRole("button", { name: "Load from library" }).click();
  await page.getByRole("button", { name: /Tagline/ }).click();
  await expect(page.getByLabel("Template", { exact: true })).toHaveValue("Tagline for {{topic}} in a {{topic}} tone");
});

test("list page settles without refetch loops", async ({ page }) => {
  let requests = 0;
  page.on("request", (r) => {
    // Count list-page fetches only (link prefetches of /workflows/:id are expected).
    if (new URL(r.url()).pathname === "/workflows") requests++;
  });
  await page.goto("/workflows");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  expect(requests).toBeLessThanOrEqual(2);
  requests = 0;
  await page.getByLabel("Search workflows").fill("versioned");
  await page.waitForTimeout(1500);
  expect(requests).toBeLessThanOrEqual(2);
});

test("list: search, duplicate, delete with confirmation", async ({ page }) => {
  await page.goto("/workflows");
  await page.waitForLoadState("networkidle"); // let React hydrate before typing
  await page.getByLabel("Search workflows").fill("versioned");
  await expect(page.getByRole("link", { name: "Versioned" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch copy" })).toHaveCount(0);
  await page.getByLabel("Search workflows").fill("");
  await expect(page.getByRole("link", { name: "Launch copy" })).toBeVisible();

  await page.getByRole("button", { name: "Actions for Launch copy" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByRole("link", { name: "Launch copy (copy)" })).toBeVisible();

  await page.getByRole("button", { name: "Actions for Launch copy (copy)" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Assets it generated stay in your library");
  await page.getByRole("button", { name: "Delete workflow" }).click();
  await expect(page.getByRole("link", { name: "Launch copy (copy)" })).toHaveCount(0);
});

test("another user's workflow is a 404", async ({ page, browser }) => {
  await createWorkflow(page, "Private flow");
  const url = page.url();
  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p2 = await other.newPage();
  await signUp(p2, { name: "Eve", email: uniqueEmail("eve"), password: "eve-password-1234" });
  await p2.goto(url);
  await expect(p2.getByText("Page not found")).toBeVisible();
  await other.close();
});
