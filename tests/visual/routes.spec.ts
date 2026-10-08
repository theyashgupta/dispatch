import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const seeded = `http://127.0.0.1:${process.env.DISPATCH_VISUAL_PORT}`;
const routes = [
  ...new Set(
    [
      ...readFileSync("src/web/routeTree.gen.ts", "utf8").matchAll(
        /fullPath: '\/([a-z-]+)\/\{-\$id\}'/g,
      ),
    ].map((m) => m[1]),
  ),
];

test("the route tree lists 22 page routes", () => {
  expect(routes).toHaveLength(22);
});

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 390]) {
    test(`every route is clean in ${theme} at ${width}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((value) => {
        localStorage.setItem("dsp.theme", value);
        localStorage.setItem("dsp.errorsInFeeds", "on");
      }, theme);
      await page.route("**/api/**", (route) =>
        route.request().method() === "GET" ? route.fallback() : route.abort(),
      );
      const errors: string[] = [];
      let current = "";
      page.on("console", (msg) => {
        if (msg.type() === "error")
          errors.push(`${current} console: ${msg.text()}`);
      });
      page.on("pageerror", (err) =>
        errors.push(`${current} pageerror: ${err.message}`),
      );
      for (const route of routes) {
        current = route;
        await page.goto(`${seeded}/?sweep=${route}#/${route}`);
        await expect(page.locator("div.z-9999")).toHaveCount(0);
        await expect(
          page.getByRole("heading", { level: 1 }).first(),
        ).toBeVisible();
        await page.waitForTimeout(500);
      }
      expect(errors).toEqual([]);
    });
  }
}

test("the theme control flips the live theme and stores it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("dsp.theme", "dark");
    localStorage.setItem("dsp.errorsInFeeds", "on");
  });
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET" ? route.fallback() : route.abort(),
  );
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(`${seeded}/#/board`);
  const html = page.locator("html");
  await expect(page.getByText("Todo ticket").first()).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page
    .getByRole("group", { name: "Theme" })
    .getByRole("button", { name: "Light" })
    .click();

  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("dsp.theme"))).toBe(
    "light",
  );
  expect(errors).toEqual([]);
});
