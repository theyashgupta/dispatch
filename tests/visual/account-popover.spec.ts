import { expect, test, type Page } from "@playwright/test";
import { accountsBody, mockAccounts } from "./accounts-fixture.js";

const url = `http://127.0.0.1:${process.env.DISPATCH_VISUAL_PORT}/#/boards/LOCAL`;
const now = Date.parse(process.env.DISPATCH_VISUAL_NOW ?? "");

test.use({ viewport: { width: 1440, height: 900 } });

const boot = async (page: Page, count = 3) => {
  await page.clock.install({ time: now });
  await mockAccounts(page, now, count);
  await page.goto(url);
  await expect(page.locator("#usage-chip")).toBeVisible();
};

const openPopover = async (page: Page) => {
  await page.locator("#usage-chip").click();
  await expect(page.locator("#account-popover")).toBeVisible();
};

const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error(`no bounding box for ${selector}`);
  return found;
};

test("the popover is 320 px wide", async ({ page }) => {
  await boot(page);
  await openPopover(page);
  const popover = await box(page, "#account-popover");
  expect(Math.abs(popover.width - 320)).toBeLessThanOrEqual(0.5);
});

test("the popover opens above the counter in the expanded sidebar", async ({
  page,
}) => {
  await boot(page);
  await openPopover(page);
  const chip = await box(page, "#usage-chip");
  const popover = await box(page, "#account-popover");
  expect(popover.y + popover.height).toBeLessThanOrEqual(chip.y);
});

test("the popover opens right of the counter in the collapsed sidebar", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator("#usage-chip")).toBeVisible();
  await openPopover(page);
  const chip = await box(page, "#usage-chip");
  const popover = await box(page, "#account-popover");
  expect(popover.x).toBeGreaterThanOrEqual(chip.x + chip.width);
});

test("the popover height is capped and fits a short viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 400 });
  await boot(page);
  await openPopover(page);
  await page
    .locator("#account-popover")
    .getByRole("button", { name: "Switch account" })
    .click();
  await expect(
    page.getByRole("button", {
      name: /^Switch to limited\.person@example\.com/,
    }),
  ).toBeVisible();
  const popover = await box(page, "#account-popover");
  expect(popover.height).toBeLessThanOrEqual(400 * 0.4 + 0.5);
  expect(popover.y).toBeGreaterThanOrEqual(0);
  expect(popover.y + popover.height).toBeLessThanOrEqual(400);
});

test("the popover shows the active account usage", async ({ page }) => {
  await boot(page);
  await openPopover(page);
  const popover = page.locator("#account-popover");
  await expect(popover.getByText("active.person@example.com")).toBeVisible();
  await expect(
    popover.getByRole("progressbar", { name: "Session usage" }),
  ).toBeVisible();
  await expect(
    popover.getByRole("progressbar", { name: "Weekly usage" }),
  ).toBeVisible();
  await expect(popover.getByRole("progressbar")).toHaveCount(2);
  await expect(
    popover.getByRole("progressbar", { name: "Weekly Opus usage" }),
  ).toHaveCount(0);
  const line = popover.locator('[data-testid="account-state-line"]');
  await expect(line).toBeVisible();
  await expect(line).not.toHaveText("");
});

test("Escape closes the popover and focuses the counter", async ({ page }) => {
  await boot(page);
  await openPopover(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#account-popover")).toBeHidden();
  await expect(page.locator("#usage-chip")).toBeFocused();
});

test("an outside click closes the popover and focuses the counter", async ({
  page,
}) => {
  await boot(page);
  await openPopover(page);
  await page.waitForTimeout(200);
  const header = await page.locator("header").first().boundingBox();
  if (!header) throw new Error("no bounding box for header");
  await page.mouse.click(header.x + header.width / 2, header.y + 4);
  await expect(page.locator("#account-popover")).toBeHidden();
  await expect(page.locator("#usage-chip")).toBeFocused();
});

test("the counter does not navigate", async ({ page }) => {
  await boot(page);
  const before = page.url();
  await openPopover(page);
  expect(page.url()).toBe(before);
  await page.waitForTimeout(200);
  await page.locator("#usage-chip").click();
  await expect(page.locator("#account-popover")).toBeHidden();
  expect(page.url()).toBe(before);
});

test("Switch account is hidden with one account", async ({ page }) => {
  await boot(page, 1);
  await openPopover(page);
  await expect(
    page
      .locator("#account-popover")
      .getByRole("button", { name: "Switch account" }),
  ).toHaveCount(0);
});

test("switching opens the confirmation for the chosen account", async ({
  page,
}) => {
  await boot(page);
  await page.route("**/api/accounts/active", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          json: { activeId: "a2", moved: [], queued: [], skipped: [] },
        })
      : route.fallback(),
  );
  await openPopover(page);
  await page
    .locator("#account-popover")
    .getByRole("button", { name: "Switch account" })
    .click();
  const limited = page.getByRole("button", {
    name: /^Switch to limited\.person@example\.com/,
  });
  await expect(limited).toContainText("72%");
  expect(await limited.getAttribute("aria-label")).toContain("weekly 72%");
  await expect(
    page.getByRole("button", { name: "Switch to expired.person@example.com" }),
  ).toContainText("n/a");
  await limited.click();
  await expect(page.locator("#account-popover")).toBeHidden();
  const dialog = page.getByTestId("account-switch-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("limited.person@example.com");
  const put = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().endsWith("/api/accounts/active"),
  );
  await dialog.getByRole("button", { name: "Switch account" }).click();
  expect((await put).postDataJSON()).toMatchObject({ id: "a2" });
});

for (const [code, message] of [
  [
    "account-needs-login",
    "This account needs a new login. Log in again, then switch.",
  ],
  [
    "account-shadowed-by-home",
    "This account is the same login as Default. Switch to Default or remove the duplicate.",
  ],
]) {
  test(`a ${code} refusal shows its message in the switch dialog`, async ({
    page,
  }) => {
    await boot(page);
    await page.route("**/api/accounts/active", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 409, json: { error: code } })
        : route.fallback(),
    );
    await openPopover(page);
    await page
      .locator("#account-popover")
      .getByRole("button", { name: "Switch account" })
      .click();
    await page
      .getByRole("button", {
        name: /^Switch to limited\.person@example\.com/,
      })
      .click();
    const dialog = page.getByTestId("account-switch-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Switch account" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(message);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("switch-result")).toHaveCount(0);
  });
}

test("the Switch account list starts closed on every open", async ({
  page,
}) => {
  await boot(page);
  await openPopover(page);
  const popover = page.locator("#account-popover");
  const toggle = popover.getByRole("button", { name: "Switch account" });
  await toggle.click();
  await expect(
    popover.getByRole("list", { name: "Other accounts" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await openPopover(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    popover.getByRole("list", { name: "Other accounts" }),
  ).toHaveCount(0);
});

test("refresh disables the button while one request runs", async ({ page }) => {
  await boot(page);
  const usage = accountsBody(now).accounts[0].usage;
  const refreshes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/usage/refresh")) refreshes.push(r.url());
  });
  await page.route("**/api/accounts/a1/usage/refresh", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ json: { usage } });
  });
  await openPopover(page);
  const refresh = page
    .locator("#account-popover")
    .getByRole("button", { name: "Refresh usage" });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toBeEnabled();
  expect(refreshes).toHaveLength(1);
  expect(refreshes[0]).toMatch(/\/api\/accounts\/a1\/usage\/refresh$/);
  await expect(
    page.getByRole("button", { name: /Refresh usage for/ }),
  ).toHaveCount(0);
});

test("a refused refresh shows one alert line", async ({ page }) => {
  await boot(page);
  await page.route("**/api/accounts/a1/usage/refresh", (route) =>
    route.fulfill({ status: 429, json: { error: "rate-limited" } }),
  );
  await openPopover(page);
  const popover = page.locator("#account-popover");
  await popover.getByRole("button", { name: "Refresh usage" }).click();
  const alert = page.locator("#account-popover [role=alert]");
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText("Wait 30 seconds between refreshes.");
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await openPopover(page);
  await expect(page.locator("#account-popover [role=alert]")).toHaveCount(0);
});

test("the footer link opens the Accounts and Usage page", async ({ page }) => {
  await boot(page);
  await openPopover(page);
  await page
    .locator("#account-popover")
    .getByRole("button", { name: "Accounts and Usage" })
    .click();
  await expect(page.locator("#account-popover")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Accounts and Usage", level: 1 }),
  ).toBeVisible();
});
