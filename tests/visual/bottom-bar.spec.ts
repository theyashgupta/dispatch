import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

const port = Number(process.env.DISPATCH_VISUAL_PORT);
const orchestrated = `http://127.0.0.1:${port + 3}`;
const BAR_HEIGHT = 64;

test.use({ viewport: { width: 390, height: 900 } });

const guardWrites = (page: Page) =>
  page.route("**/api/**", (route) =>
    route.request().method() === "GET" ? route.fallback() : route.abort(),
  );

const barHeightVar = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--bottom-bar-height")
      .trim(),
  );

const spaceXlPx = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.height = getComputedStyle(document.documentElement)
      .getPropertyValue("--space-xl")
      .trim();
    document.body.append(probe);
    const px = probe.getBoundingClientRect().height;
    probe.remove();
    return px;
  });

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error(`no bounding box for ${locator}`);
  return found;
};

const expectAbove = async (locator: Locator, barTop: number) => {
  const found = await box(locator);
  expect(found.y + found.height).toBeLessThanOrEqual(barTop);
};

test("toasts and floating bars clear the bottom bar through its height variable", async ({
  page,
}) => {
  const bar = page.locator('nav[aria-label="Primary"]');
  await page.clock.install({
    time: Date.parse(process.env.DISPATCH_VISUAL_NOW ?? ""),
  });
  await guardWrites(page);
  await page.route("**/api/board?*board=ORC*", (route) =>
    route.fulfill({ status: 500, json: { error: "boom" } }),
  );

  await page.goto(`${orchestrated}/#/boards/ORC`);
  await expect(bar).toBeVisible();
  await expect(page.getByText("Board ORC could not be loaded.")).toBeVisible();

  const barBox = await box(bar);
  expect(barBox.height).toBe(BAR_HEIGHT);
  await expect.poll(() => barHeightVar(page)).toBe(`${BAR_HEIGHT}px`);

  const spaceXl = await spaceXlPx(page);
  expect(spaceXl).toBeGreaterThan(0);

  const toaster = page.locator("[data-sonner-toaster]");
  await expect(toaster).toHaveCSS("bottom", `${spaceXl + BAR_HEIGHT}px`);
  await expectAbove(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Board ORC could not be loaded." }),
    barBox.y,
  );

  await page.unroute("**/api/board?*board=ORC*");
  await page.goto(`${orchestrated}/#/boards/ORC`);
  await page.reload();
  await expect(bar).toBeVisible();
  await expect.poll(() => barHeightVar(page)).toBe(`${BAR_HEIGHT}px`);
  await page
    .getByText("Todo by the orchestrator")
    .click({ modifiers: ["ControlOrMeta"] });
  await page
    .getByText("Plain todo ticket")
    .click({ modifiers: ["ControlOrMeta"] });

  const selection = page
    .getByRole("button", { name: "Clear selection" })
    .locator("..");
  await expect(selection).toContainText("2 selected");
  await expect(selection).toHaveCSS("bottom", `${spaceXl + BAR_HEIGHT}px`);
  await expectAbove(selection, (await box(bar)).y);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => barHeightVar(page)).toBe("");
});

const scrollTo = async (page: Page, locator: Locator, top: number) => {
  await locator.evaluate((el, value) => {
    el.scrollTop = value;
  }, top);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
};

test("the bottom bar hides on scroll down and returns on scroll up, and reduced motion keeps it shown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await guardWrites(page);
  const bar = page.locator('nav[aria-label="Primary"]');
  const column = page.locator(".scroll-stable-y.dot-grid");

  await page.goto(`${orchestrated}/#/boards/ORC/dashboard`);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCSS("height", `${BAR_HEIGHT}px`);
  await expect
    .poll(() => column.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(500);

  await scrollTo(page, column, 20);
  await scrollTo(page, column, 300);
  await expect(bar).toHaveJSProperty("inert", true);
  await expect(bar).toHaveCSS("height", "0px");
  await expect.poll(() => barHeightVar(page)).toBe("0px");

  await scrollTo(page, column, 200);
  await expect(bar).toHaveJSProperty("inert", false);
  await expect(bar).toHaveCSS("height", `${BAR_HEIGHT}px`);
  await expect.poll(() => barHeightVar(page)).toBe(`${BAR_HEIGHT}px`);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(bar).toHaveCSS("height", `${BAR_HEIGHT}px`);
  await scrollTo(page, column, 20);
  await scrollTo(page, column, 600);
  await page.waitForTimeout(300);
  await expect(bar).toHaveJSProperty("inert", false);
  await expect(bar).toHaveCSS("height", `${BAR_HEIGHT}px`);
  await expect(bar).toHaveCSS("transition-duration", "0s");
  expect(await barHeightVar(page)).toBe(`${BAR_HEIGHT}px`);
});

const FIELD_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

const renderedFields = (page: Page) =>
  page.evaluate((selector) => {
    const label = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      const detail =
        el.getAttribute("type") ??
        el.getAttribute("name") ??
        el.getAttribute("placeholder") ??
        el.getAttribute("aria-label") ??
        "";
      return detail ? `${tag}[${detail}]` : tag;
    };
    return [...document.querySelectorAll(selector)]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return el.checkVisibility() && rect.width > 0 && rect.height > 0;
      })
      .map((el) => ({
        label: label(el),
        size: parseFloat(getComputedStyle(el).fontSize),
      }));
  }, FIELD_SELECTOR);

const measureFieldSizes = async (browser: Browser, hasTouch: boolean) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    hasTouch,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    await guardWrites(page);
    await page.goto(`${orchestrated}/#/boards/ORC`);
    await expect(page.locator('nav[aria-label="Primary"]')).toBeVisible();
    const coarse = await page.evaluate(
      () => matchMedia("(pointer: coarse)").matches,
    );
    await page.getByRole("button", { name: "New ticket" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator(`input:visible, textarea:visible`).first(),
    ).toBeVisible();
    const dialogFields = await renderedFields(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.keyboard.press("b");
    await expect(
      page.getByRole("combobox", { name: "Search commands and tickets" }),
    ).toBeVisible();
    const fields = [...dialogFields, ...(await renderedFields(page))];
    return { coarse, fields };
  } finally {
    await context.close();
  }
};

test("editable fields use at least 16 px text on touch devices and the rule stays off on a fine pointer", async ({
  browser,
}) => {
  const touch = await measureFieldSizes(browser, true);
  expect(touch.coarse).toBe(true);
  expect(touch.fields.length).toBeGreaterThan(0);
  const small = touch.fields.filter((field) => field.size < 16);
  expect(
    small,
    `touch fields under 16 px: ${small.map((f) => `${f.label}=${f.size}`).join(", ")}`,
  ).toEqual([]);

  const fine = await measureFieldSizes(browser, false);
  expect(fine.coarse).toBe(false);
  expect(fine.fields.length).toBeGreaterThan(0);
  expect(Math.min(...fine.fields.map((field) => field.size))).toBeLessThan(16);
});
