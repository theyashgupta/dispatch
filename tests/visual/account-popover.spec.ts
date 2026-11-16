import { expect, test, type Page } from "@playwright/test";
import type { ClaudeAccountSummary } from "../../src/shared/types.js";
import { accountsBody, mockAccounts, okUsage } from "./accounts-fixture.js";

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
  const scroller = page.locator("#account-popover");
  const popover = await box(page, "#account-popover");
  expect(popover.height).toBeLessThanOrEqual(400 * 0.4 + 0.5);
  expect(
    await scroller.evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  expect(popover.y).toBeGreaterThanOrEqual(0);
  expect(popover.y + popover.height).toBeLessThanOrEqual(400);
});

test("the popover shows every account, active first", async ({ page }) => {
  await boot(page);
  await openPopover(page);
  const popover = page.locator("#account-popover");
  const blocks = popover.locator("[data-account-id]");
  await expect(blocks).toHaveCount(3);
  expect(
    await blocks.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-account-id")),
    ),
  ).toEqual(["a1", "a2", "a3"]);

  const active = popover.getByRole("region", {
    name: "active.person@example.com",
  });
  await expect(active.getByText("Active", { exact: true })).toBeVisible();
  await expect(active.getByRole("progressbar")).toHaveCount(3);
  await expect(
    active.getByRole("progressbar", { name: "Weekly Opus usage" }),
  ).toBeVisible();
  await expect(active.getByTestId("pace-badge")).toHaveCount(3);
  await expect(active.getByText(/^resets /)).toHaveCount(3);
  await expect(active.getByRole("button", { name: /^Switch to/ })).toHaveCount(
    0,
  );

  const limited = popover.getByRole("region", {
    name: "limited.person@example.com",
  });
  await expect(limited.getByText("Active", { exact: true })).toHaveCount(0);
  await expect(limited.getByRole("progressbar")).toHaveCount(2);
  await expect(limited.getByTestId("account-state-line")).toContainText(
    "Limited until",
  );
  await expect(
    limited.getByRole("button", {
      name: "Switch to limited.person@example.com",
    }),
  ).toBeVisible();

  const expired = popover.getByRole("region", {
    name: "expired.person@example.com",
  });
  await expect(expired.getByRole("progressbar")).toHaveCount(0);
  await expect(expired.getByTestId("account-state-line")).toHaveText(
    "Login expired, sign in again",
  );

  for (const email of [
    "active.person@example.com",
    "limited.person@example.com",
    "expired.person@example.com",
  ]) {
    await expect(
      popover.getByRole("button", { name: `Refresh usage for ${email}` }),
    ).toBeVisible();
  }
  await expect(
    popover.getByRole("button", { name: "Switch account" }),
  ).toHaveCount(0);
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

test("Switch is hidden with one account", async ({ page }) => {
  await boot(page, 1);
  await openPopover(page);
  const popover = page.locator("#account-popover");
  await expect(popover.locator("[data-account-id]")).toHaveCount(1);
  await expect(popover.getByRole("button", { name: /^Switch/ })).toHaveCount(0);
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
    .getByRole("button", { name: "Switch to limited.person@example.com" })
    .click();
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
      .getByRole("button", { name: "Switch to limited.person@example.com" })
      .click();
    const dialog = page.getByTestId("account-switch-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Switch account" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(message);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("switch-result")).toHaveCount(0);
  });
}

test("refresh disables the button while one request runs", async ({ page }) => {
  await boot(page);
  const usage = accountsBody(now).accounts[1].usage;
  const refreshes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/usage/refresh")) refreshes.push(r.url());
  });
  await page.route("**/api/accounts/a2/usage/refresh", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ json: { usage } });
  });
  await openPopover(page);
  const popover = page.locator("#account-popover");
  const refresh = popover.getByRole("button", {
    name: "Refresh usage for limited.person@example.com",
  });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(
    popover.getByRole("button", {
      name: "Refresh usage for active.person@example.com",
    }),
  ).toBeEnabled();
  await expect(refresh).toBeEnabled();
  expect(refreshes).toHaveLength(1);
  expect(refreshes[0]).toMatch(/\/api\/accounts\/a2\/usage\/refresh$/);
});

test("a refused refresh shows one alert line", async ({ page }) => {
  await boot(page);
  await page.route("**/api/accounts/a1/usage/refresh", (route) =>
    route.fulfill({ status: 429, json: { error: "rate-limited" } }),
  );
  await openPopover(page);
  const popover = page.locator("#account-popover");
  await popover
    .getByRole("button", {
      name: "Refresh usage for active.person@example.com",
    })
    .click();
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

const RAIL_THRESHOLDS = {
  warningPercent: 60,
  criticalPercent: 80,
  limitPercent: { session: 95, weekly_all: 100, weekly_scoped: 100 },
};

const RAIL_STATES: {
  name: string;
  percent: number;
  limitSource?: ClaudeAccountSummary["limitSource"];
  label: string;
  tone: string;
}[] = [
  { name: "calm", percent: 31, label: "31", tone: "ok" },
  { name: "warning", percent: 72, label: "72", tone: "stale" },
  { name: "critical", percent: 88, label: "88", tone: "down" },
  {
    name: "claude-limit",
    percent: 100,
    limitSource: "claude",
    label: "99+",
    tone: "down",
  },
  {
    name: "threshold-limit",
    percent: 95,
    limitSource: "threshold",
    label: "95",
    tone: "down",
  },
];

const bootRail = async (page: Page, rail: (typeof RAIL_STATES)[number]) => {
  await page.clock.install({ time: now });
  await page.route("**/api/config/usage-thresholds", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: RAIL_THRESHOLDS })
      : route.fallback(),
  );
  await page.route("**/api/accounts", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = accountsBody(now);
    body.accounts[0] = {
      ...body.accounts[0],
      usage: okUsage(now, rail.percent, 20),
      ...(rail.limitSource
        ? {
            state: "limited",
            limitSource: rail.limitSource,
            limitedUntil: new Date(now + 60 * 60_000).toISOString(),
          }
        : {}),
    };
    return route.fulfill({ json: body });
  });
  await page.goto(url);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator("#usage-chip")).toHaveText(rail.label);
};

for (const rail of RAIL_STATES) {
  test(`the collapsed counter at ${rail.name} fits inside the rail`, async ({
    page,
  }) => {
    await bootRail(page, rail);
    const chip = page.locator("#usage-chip");
    const chipBox = await box(page, "#usage-chip");
    const railBox = await box(page, "[data-slot=sidebar-container]");
    expect(chipBox.width).toBe(36);
    expect(chipBox.height).toBe(36);
    expect(chipBox.x).toBeGreaterThanOrEqual(railBox.x);
    expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(
      railBox.x + railBox.width - 1,
    );
    await expect(chip.locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      rail.tone,
    );
    await expect(chip).toHaveAccessibleName(
      new RegExp(
        `^Claude account active\\.person@example\\.com, ${rail.percent}% used`,
      ),
    );
    await expect(chip).toHaveAttribute(
      "title",
      new RegExp(`^active\\.person@example\\.com: ${rail.percent}% used`),
    );
    await expect(page.locator("[data-slot=sidebar-footer]")).toHaveScreenshot(
      `collapsed-rail-${rail.name}.png`,
    );
  });
}

test("the expanded sidebar keeps the full counter pill", async ({ page }) => {
  await boot(page);
  const chip = page.locator("#usage-chip");
  await expect(chip).toHaveText("48%");
  expect((await box(page, "#usage-chip")).height).toBe(28);
});

test("Escape in the collapsed rail returns focus to the counter with the focus outline", async ({
  page,
}) => {
  await bootRail(page, RAIL_STATES[0]);
  await openPopover(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#account-popover")).toBeHidden();
  const chip = page.locator("#usage-chip");
  await expect(chip).toBeFocused();
  expect(await chip.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
    "solid",
  );
});
