import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });
const STORAGE = "playwright/.auth/integrations-user.json";
const USER_KEY = "sk-e2e-user-key-0000000000000000";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signUp(page, { name: "Key Holder", email: uniqueEmail("keys"), password: "keys-password-1234" });
  await context.storageState({ path: STORAGE });
  await context.close();
});
test.use({ storageState: STORAGE, viewport: { width: 1440, height: 900 } });

const openai = (page: Page) => page.getByRole("listitem", { name: "OpenAI" });

/** Opens the catalogue and picks a service. */
async function addService(page: Page, name: string) {
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
}

test("connect, validate, replace and remove an OpenAI key without ever showing it again", async ({ page }) => {
  await page.goto("/integrations");
  await expect(page.getByText("Connect your first service")).toBeVisible();
  await page.getByRole("button", { name: "Add service" }).click();
  const catalogue = page.getByRole("dialog");
  await expect(catalogue.getByRole("button", { name: "Anthropic API (coming soon)" })).toBeDisabled();
  await expect(catalogue.getByRole("button", { name: "Any HTTP API (built in)" })).toBeDisabled();
  await catalogue.getByRole("button", { name: "Messaging" }).click();
  await expect(catalogue).toContainText("Slack");
  await expect(catalogue).not.toContainText("OpenAI");
  await catalogue.getByLabel("Search services").fill("gpt");
  await expect(catalogue).toContainText("No services match");
  await catalogue.getByRole("button", { name: "All", exact: true }).click();
  await catalogue.getByRole("button", { name: "OpenAI", exact: true }).click();

  await openai(page).getByLabel("API key").fill("not-a-key");
  await openai(page).getByRole("button", { name: "Validate & connect" }).click();
  await expect(openai(page)).toContainText("doesn't look like a OpenAI API key");

  await openai(page).getByLabel("API key").fill("sk-e2e-revoked-key-000000000000000");
  await openai(page).getByRole("button", { name: "Validate & connect" }).click();
  await expect(openai(page)).toContainText("The provider rejected this API key.");

  await openai(page).getByLabel("API key").fill(USER_KEY);
  await openai(page).getByRole("button", { name: "Validate & connect" }).click();
  await expect(openai(page)).toContainText("Connected");
  await expect(openai(page)).toContainText("•••• 0000");

  await page.reload();
  await expect(openai(page)).toContainText("Connected");
  expect(await page.content()).not.toContain(USER_KEY);

  await openai(page).getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("OpenAI is working")).toBeVisible();
  await page.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "OpenAI (added)" })).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("workflows run with the user's key and usage shows up in analytics", async ({ page }) => {
  await page.goto("/workflows/new");
  await page.getByLabel("Name").fill("Uses my key");
  await page.getByRole("radio", { name: /Text generation/ }).click();
  await page.getByRole("button", { name: "Create and open Studio" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published version 1")).toBeVisible();
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("tide pools");
  await page.getByRole("dialog").getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("4 / 4 completed")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("node-text_1").click();
  await expect(page.getByText("Using your connected API key")).toBeVisible();
  await expect(page.getByText(USER_KEY)).toHaveCount(0);

  await page.goto("/settings/usage?days=7");
  await expect(page.getByRole("region", { name: "By model" })).toContainText("gpt-6.2-sol");
  await expect(page.getByRole("region", { name: "By workflow" })).toContainText("Uses my key");
  await expect(page.getByRole("img", { name: "Estimated cost per day" })).toBeVisible();
});

test("activity feed records and links events", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.getByRole("link", { name: "Connected an integration: OpenAI" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Published a workflow: Uses my key v1/ })).toBeVisible();
  await page.getByRole("link", { name: /Execution completed: Uses my key/ }).first().click();
  await expect(page).toHaveURL(/\/executions\//);
});

test("removing the key falls back to the workspace key", async ({ page }) => {
  await page.goto("/integrations");
  await openai(page).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("fall back to the workspace key");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(openai(page)).toHaveCount(0);
  await addService(page, "OpenAI");
  await expect(openai(page).getByLabel("API key")).toBeVisible();
  await expect(openai(page)).toContainText("A workspace key is configured on this server");
  await openai(page).getByRole("button", { name: "Cancel" }).click();
  await expect(openai(page)).toHaveCount(0);
});

test("AI Text can run through the local Claude CLI (personal use)", async ({ page }) => {
  await page.goto("/integrations");
  await addService(page, "Claude (local CLI)");
  const card = page.getByRole("listitem", { name: "Claude (local CLI)" });
  await expect(card).toContainText("Found");
  await card.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Claude (local CLI) is on")).toBeVisible();
  await expect(card).toContainText("Only your account can use it");

  await page.goto("/workflows/new");
  await page.getByLabel("Name").fill("Local Claude run");
  await page.getByRole("radio", { name: /Text generation/ }).click();
  await page.getByRole("button", { name: "Create and open Studio" }).click();
  await expect(page).toHaveURL(/\/workflows\/[a-z0-9]+$/);
  await page.getByTestId("node-text_1").click();
  await page.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: "Claude (local CLI)" }).click();
  await expect(page.getByRole("combobox", { name: "Model" })).toContainText("Claude Opus 5.5");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published version 1")).toBeVisible();

  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("lighthouses");
  await page.getByRole("dialog").getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("4 / 4 completed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("json-outputs")).toContainText("fake claude-opus-5-5: Write a concise, engaging paragraph about lighthouses");
  await page.getByTestId("node-text_1").click();
  await expect(page.getByText("Using the local Claude CLI on this machine (your Claude subscription)")).toBeVisible();
  await expect(page.locator("section[aria-label=Details]")).toContainText("Unknown pricing");
});

test("upload an image and have Claude explain it", async ({ page }) => {
  await page.goto("/workflows/new");
  await page.getByLabel("Name").fill("Image explainer");
  await page.getByRole("radio", { name: /Text generation/ }).click();
  await page.getByRole("button", { name: "Create and open Studio" }).click();
  await expect(page).toHaveURL(/\/workflows\/[a-z0-9]+$/);
  await page.getByTestId("node-input_1").click();
  await page.getByLabel("Field name").fill("photo");
  await page.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Image" }).click();
  await page.getByTestId("node-prompt_1").click();
  await page.getByLabel("Template").fill("Explain what's in this image.");
  await page.getByTestId("node-text_1").click();
  await page.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: "Claude (local CLI)" }).click();
  await page.getByLabel("Image (optional)").fill("{{photo}}");
  await expect(page.getByTestId("node-text_1")).toContainText("with image");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published version 1")).toBeVisible();

  await page.getByRole("button", { name: "Run" }).click();
  const dialog = page.getByRole("dialog");
  // A 1x1 PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await dialog.locator("input[type=file]").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
  await expect(dialog.getByText('Uploaded "dot.png" to your library')).toBeVisible();
  await dialog.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("4 / 4 completed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("json-outputs")).toContainText("saw 1 image(s) (image/png:");
  await page.getByTestId("node-text_1").click();
  await expect(page.getByText('Attached image "dot.png"')).toBeVisible();
});
