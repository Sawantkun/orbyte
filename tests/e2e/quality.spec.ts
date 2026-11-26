import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

/**
 * Cross-cutting quality gates: no CSP violations or console errors, a CSP
 * header on every page, and no serious/critical axe accessibility violations.
 */
test.describe.configure({ mode: "serial" });
const STORAGE = "playwright/.auth/quality-user.json";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signUp(page, { name: "Quality Check", email: uniqueEmail("quality"), password: "quality-password-1" });
  // Give the pages some content.
  await page.goto("/workflows/new");
  await page.getByLabel("Name").fill("Audit flow");
  await page.getByRole("button", { name: "Create and open Studio" }).click();
  await expect(page).toHaveURL(/\/workflows\/[a-z0-9]+$/);
  await context.storageState({ path: STORAGE });
  await context.close();
});
test.use({ storageState: STORAGE, viewport: { width: 1440, height: 900 } });

const PAGES = ["/dashboard", "/workflows", "/workflows/new", "/executions", "/assets", "/collections", "/integrations", "/activity", "/settings/profile", "/settings/security", "/settings/usage"];

function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  return problems;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

for (const path of PAGES) {
  test(`${path}: CSP enforced, no console errors, no serious a11y violations`, async ({ page }) => {
    const problems = watchConsole(page);
    const res = await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(res?.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(problems).toEqual([]);
    expect(await axe(page)).toEqual([]);
  });
}

test("workflow studio: no console errors and no serious a11y violations", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/workflows");
  await page.getByRole("link", { name: "Audit flow" }).click();
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTestId("node-text_1").click();
  expect(problems).toEqual([]);
  expect(await axe(page)).toEqual([]);
});

test("public pages pass too", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  for (const path of ["/", "/login", "/signup"]) {
    const problems = watchConsole(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(problems, path).toEqual([]);
    expect(await axe(page), path).toEqual([]);
  }
  await ctx.close();
});
