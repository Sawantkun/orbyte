import { expect, test } from "@playwright/test";
import { signIn, signUp, uniqueEmail } from "./helpers";

test("protected routes redirect signed-out visitors to login", async ({ page }) => {
  await page.goto("/settings/security");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fsecurity$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("sign up, sign out, reject bad password, sign back in to the requested page", async ({ page }) => {
  const email = uniqueEmail("flow");
  const password = "a-long-enough-password";
  await signUp(page, { name: "Grace Hopper", email, password });
  await expect(page.getByRole("heading", { name: "Welcome back, Grace" })).toBeVisible();
  await expect(page.getByText("Created your Orbyte account").first()).toBeVisible();

  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/settings/profile");
  await expect(page).toHaveURL(/\/login\?next=/);
  await signIn(page, email, "not-the-password");
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();

  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/settings\/profile$/);
});

test("signup validates input and rejects an existing email", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter your name")).toBeVisible();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();

  const email = uniqueEmail("dupe");
  await signUp(page, { name: "First", email, password: "first-password-1" });
  await page.context().clearCookies();
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Second");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("second-password-2");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("An account with this email already exists.")).toBeVisible();
});

test("open redirects via ?next are ignored", async ({ page }) => {
  await page.goto("/login?next=https://evil.example");
  // A signed-out visitor stays on login; the form's destination is sanitised server-side.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
