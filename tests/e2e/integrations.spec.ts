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

test("connect, validate, replace and remove an OpenAI key without ever showing it again", async ({ page }) => {
  await page.goto("/integrations");
  await expect(page.getByRole("listitem", { name: "Anthropic" })).toContainText("Coming soon");

  await openai(page).getByLabel("API key").fill("not-a-key");
  await openai(page).getByRole("button", { name: "Validate & connect" }).click();
  await expect(openai(page)).toContainText("doesn't look like a OpenAI API key");

  await openai(page).getByLabel("API key").fill("sk-e2e-revoked-key-000000000000000");
  await openai(page).getByRole("button", { name: "Validate & connect" }).click();
  await expect(openai(page)).toContainText("The provider rejected this API key.");

  await openai(page).getByLabel("API key").fill(USER_KEY);
  await openai(page).getByRole("button", { name: "Validate & connect" }).click();
  await expect(openai(page)).toContainText("Connected");
  await expect(openai(page)).toContainText("•••• •••• 0000");

  await page.reload();
  await expect(openai(page)).toContainText("Connected");
  expect(await page.content()).not.toContain(USER_KEY);

  await openai(page).getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("Key is valid")).toBeVisible();
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
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(openai(page).getByLabel("API key")).toBeVisible();
  await expect(openai(page)).toContainText("A workspace key is configured on this server");
});
