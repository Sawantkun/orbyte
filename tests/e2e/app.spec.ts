import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

const STORAGE = "playwright/.auth/app-user.json";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signUp(page, { name: "Linus Shell", email: uniqueEmail("app"), password: "shell-password-123" });
  await context.storageState({ path: STORAGE });
  await context.close();
});

test.use({ storageState: STORAGE });

test("dashboard shows real, empty data with no invented metrics", async ({ page }) => {
  await page.goto("/dashboard");
  const metrics = page.getByRole("region", { name: "Key metrics" });
  await expect(metrics).toContainText("Workflows0");
  await expect(metrics).toContainText("No priced usage recorded");
  await expect(page.getByText("No executions yet").first()).toBeVisible();
  // Features from later milestones are disabled, not fake.
  await expect(page.getByRole("button", { name: "Upload asset" }).first()).toBeDisabled();
});

test("sidebar navigation and collapsed state persists across reloads", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Workflows" }).click();
  await expect(page).toHaveURL(/\/workflows$/);
  await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
});

test("command palette opens with the keyboard and navigates", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Search pages and actions…");
  await expect(input).toBeVisible();
  await input.fill("integrations");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/integrations$/);
});

test("profile name can be updated and is reflected in the shell", async ({ page }) => {
  await page.goto("/settings/profile");
  const name = page.getByLabel("Name");
  await name.fill("Linus Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Name")).toHaveValue("Linus Renamed");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome back, Linus" })).toBeVisible();
});

test("security page lists this device and validates password change", async ({ page }) => {
  await page.goto("/settings/security");
  await expect(page.getByText("This device")).toBeVisible();
  await page.getByLabel("Current password").fill("wrong-current-pass");
  await page.getByLabel("New password", { exact: true }).fill("brand-new-password");
  await page.getByLabel("Confirm new password").fill("brand-new-password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your current password is incorrect.")).toBeVisible();
});

test("mobile navigation opens in a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Assets" }).click();
  await expect(page).toHaveURL(/\/assets$/);
});
