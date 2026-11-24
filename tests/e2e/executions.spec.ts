import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });
const STORAGE = "playwright/.auth/exec-user.json";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signUp(page, { name: "Run Tester", email: uniqueEmail("exec"), password: "exec-password-123" });
  await context.storageState({ path: STORAGE });
  await context.close();
});
test.use({ storageState: STORAGE, viewport: { width: 1440, height: 900 } });

async function createAndPublish(page: Page, name: string) {
  await page.goto("/workflows/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("radio", { name: /Text generation/ }).click();
  await page.getByRole("button", { name: "Create and open Studio" }).click();
  await expect(page).toHaveURL(/\/workflows\/[a-z0-9]+$/);
  await expect(page.getByRole("button", { name: "Run" })).toBeDisabled();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published version 1")).toBeVisible();
}

test("runs a published AI text workflow through the worker and shows per-node results", async ({ page }) => {
  await createAndPublish(page, "Run me");
  await page.getByRole("button", { name: "Run" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("topic")).toBeVisible();
  // Required input is enforced server-side.
  await dialog.getByRole("button", { name: "Run" }).click();
  await expect(dialog.getByText("Required")).toBeVisible();
  await dialog.getByRole("textbox").fill("sea otters");
  await dialog.getByRole("button", { name: "Run" }).click();

  await expect(page).toHaveURL(/\/executions\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Run me" })).toBeVisible();
  await expect(page.locator("main").getByText("Completed").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("json-outputs")).toContainText("Mock gpt-6.2-sol: Write a concise, engaging paragraph about sea otters");
  await expect(page.getByText("4 / 4 completed")).toBeVisible();
  // Priced model → an estimated cost is shown.
  await expect(page.getByText(/\$0\.\d+/).first()).toBeVisible();

  // Inspect the AI node.
  await page.getByTestId("node-text_1").click();
  await expect(page.getByTestId("json-output")).toContainText("Mock gpt-6.2-sol");
  await expect(page.getByText("Calling openai gpt-6.2-sol")).toBeVisible();
  await expect(page.getByText(/sk-e2e-test-key/)).toHaveCount(0);

  // Listed on the executions page and the dashboard.
  await page.goto("/executions");
  await expect(page.getByRole("link", { name: "Run me" })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Recent executions" })).toContainText("Run me");
});

test("cancels a running execution and retries it", async ({ page }) => {
  await createAndPublish(page, "Slow one");
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("[slow] topic");
  await page.getByRole("dialog").getByRole("button", { name: "Run" }).click();
  await expect(page).toHaveURL(/\/executions\/[a-z0-9]+$/);
  await expect(page.locator("main").getByText("Running").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Cancel execution" }).click();
  await expect(page.locator("main").getByText("Cancelled").first()).toBeVisible({ timeout: 10_000 });

  const before = page.url();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByText("Retry of")).toBeVisible();
  await expect(page.locator("main").getByText("Completed").first()).toBeVisible({ timeout: 20_000 });
});

test("a failing node fails the run with a clear error and skips downstream nodes", async ({ page }) => {
  // The mock rejects prompts containing this marker with an auth error (non-retryable).
  await page.goto("/workflows/new");
  await page.getByLabel("Name").fill("Will fail");
  await page.getByRole("radio", { name: /Text generation/ }).click();
  await page.getByRole("button", { name: "Create and open Studio" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published version 1")).toBeVisible();
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("[fail-auth] topic");
  await page.getByRole("dialog").getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Failed" })).toContainText("OpenAI rejected the API key", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByTestId("node-output_1").click();
  await expect(page.locator("section[aria-label=Details]").getByText("Skipped")).toBeVisible();
});

test("executions list filters by status", async ({ page }) => {
  await page.goto("/executions?status=FAILED");
  await expect(page.getByRole("link", { name: "Will fail" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Run me" })).toHaveCount(0);
  await page.getByRole("link", { name: "Completed" }).click();
  await expect(page.getByRole("link", { name: "Run me" })).toBeVisible();
});
