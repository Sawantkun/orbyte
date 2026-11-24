import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });
const STORAGE = "playwright/.auth/assets-user.json";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signUp(page, { name: "Asset Keeper", email: uniqueEmail("assets"), password: "assets-password-123" });
  await context.storageState({ path: STORAGE });
  await context.close();
});
test.use({ storageState: STORAGE, viewport: { width: 1440, height: 900 } });

let PNG: Buffer;
test.beforeAll(async () => {
  PNG = await sharp({ create: { width: 320, height: 200, channels: 3, background: "#8b5cf6" } }).png().toBuffer();
});

async function openLibrary(page: Page, path = "/assets") {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function upload(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.getByTestId("asset-file-input").setInputFiles(files);
  await expect(page.getByText("Uploads finished")).toBeVisible({ timeout: 15_000 });
}

const card = (page: Page, name: string) => page.getByRole("list", { name: "Assets" }).getByRole("link", { name, exact: true });

test("uploads files, shows thumbnails, and rejects disguised files", async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByText("No assets yet")).toBeVisible();
  await upload(page, [
    { name: "hero.png", mimeType: "image/png", buffer: PNG },
    { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Launch notes\nShip it.") },
    { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not really a png") },
  ]);
  await expect(page.getByText("The file content doesn't match .png.")).toBeVisible();
  await expect(card(page, "hero.png")).toBeVisible();
  await expect(card(page, "notes.md")).toBeVisible();
  await expect(card(page, "fake.png")).toHaveCount(0);

  // The thumbnail is served and decodes.
  const loaded = await card(page, "hero.png").locator("img").evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth > 0));
  expect(loaded).toBe(true);
});

test("detail page: preview, edit metadata, favorite, download", async ({ page }) => {
  await openLibrary(page);
  await card(page, "notes.md").click();
  await expect(page.getByTestId("text-preview")).toContainText("Launch notes");
  await page.getByLabel("Name").fill("launch-notes.md");
  await page.getByLabel("Tags").fill("launch, Q4 Plan");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "launch-notes.md" })).toBeVisible();
  await expect(page.getByLabel("Tags")).toHaveValue("launch, q4-plan");

  await page.getByRole("button", { name: "Add to favorites" }).click();
  await expect(page.getByRole("button", { name: "Remove from favorites" })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe("launch-notes.md");
});

test("search, type filters and favorites narrow the library", async ({ page }) => {
  await openLibrary(page);
  await page.getByLabel("Search assets").fill("q4-plan");
  await expect(card(page, "launch-notes.md")).toBeVisible();
  await expect(card(page, "hero.png")).toHaveCount(0);
  await page.getByLabel("Search assets").fill("");
  await expect(card(page, "hero.png")).toBeVisible();

  await page.getByRole("button", { name: "Images" }).click();
  await expect(card(page, "launch-notes.md")).toHaveCount(0);
  await expect(page).toHaveURL(/kinds=IMAGE/);
  await page.getByRole("button", { name: "All", exact: true }).click();

  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Favorites only").click();
  await page.keyboard.press("Escape");
  await expect(card(page, "launch-notes.md")).toBeVisible();
  await expect(card(page, "hero.png")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear favorite filter" }).click();
  await expect(card(page, "hero.png")).toBeVisible();

  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByRole("table")).toContainText("launch-notes.md");
  await page.getByRole("button", { name: "Grid view" }).click();
});

test("collections: create, move assets in, remove the collection without losing assets", async ({ page }) => {
  await page.goto("/collections");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByLabel("Name").fill("Website");
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page.getByRole("link", { name: "Website" })).toBeVisible();

  await openLibrary(page);
  await page.getByRole("checkbox", { name: "Select hero.png" }).click();
  await page.getByRole("checkbox", { name: "Select launch-notes.md" }).click();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Move to…" }).click();
  await page.getByRole("button", { name: "Website" }).click();
  await expect(page.getByText("Moved 2 assets")).toBeVisible();

  await page.goto("/collections");
  await expect(page.getByRole("link", { name: "Website" })).toContainText("2 assets");
  await page.getByRole("link", { name: "Website" }).click();
  await expect(page.getByRole("heading", { name: "Website" })).toBeVisible();
  await expect(card(page, "hero.png")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("stay in your library");
  await page.getByRole("button", { name: "Delete collection" }).click();
  await expect(page).toHaveURL(/\/collections$/);
  await openLibrary(page);
  await expect(card(page, "hero.png")).toBeVisible();
});

test("bulk tag and bulk delete with confirmation", async ({ page }) => {
  await openLibrary(page);
  await upload(page, [{ name: "scratch.txt", mimeType: "text/plain", buffer: Buffer.from("temp") }]);
  await page.getByRole("checkbox", { name: "Select scratch.txt" }).click();
  await page.getByRole("button", { name: "Tags" }).click();
  await page.getByLabel("Tags (comma-separated)").fill("temp");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Tagged 1 assets")).toBeVisible();

  await page.getByRole("checkbox", { name: "Select scratch.txt" }).click();
  await page.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted 1 assets")).toBeVisible();
  await expect(card(page, "scratch.txt")).toHaveCount(0);
});

test("a workflow-generated image lands in the library with its prompt and provenance", async ({ page }) => {
  await page.goto("/workflows/new");
  await page.getByLabel("Name").fill("Hero image maker");
  await page.getByRole("radio", { name: /Image generation/ }).click();
  await page.getByRole("button", { name: "Create and open Studio" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published version 1")).toBeVisible();
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("a lighthouse at dawn");
  await page.getByRole("dialog").getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("3 / 3 completed")).toBeVisible({ timeout: 20_000 });

  await openLibrary(page, "/assets?source=WORKFLOW");
  await card(page, "AI Image 1.png").click();
  await expect(page.getByTestId("original-prompt")).toHaveText("A clean, modern product illustration of a lighthouse at dawn");
  await expect(page.getByText("openai / gpt-image-2.6-flare")).toBeVisible();
  await expect(page.getByRole("link", { name: /Hero image maker/ })).toBeVisible();
  await page.getByRole("link", { name: /View run/ }).click();
  await expect(page).toHaveURL(/\/executions\//);
});

test("assets from another account are not reachable", async ({ page, browser }) => {
  await openLibrary(page);
  await card(page, "hero.png").click();
  await page.waitForURL(/\/assets\/[a-z0-9]+$/);
  const url = page.url();
  const id = url.split("/").pop()!;
  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p2 = await other.newPage();
  await signUp(p2, { name: "Mallory", email: uniqueEmail("mallory"), password: "mallory-password-1" });
  await p2.goto(url);
  await expect(p2.getByText("Page not found")).toBeVisible();
  expect((await p2.request.get(`/api/assets/${id}/download`)).status()).toBe(404);
  await other.close();
});
