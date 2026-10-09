import { expect, test, type Page } from "@playwright/test";

const seededPort = Number(process.env.DISPATCH_VISUAL_PORT);
const seeded = `http://127.0.0.1:${seededPort}`;
const orchestrated = `http://127.0.0.1:${seededPort + 3}`;
const now = Date.parse(process.env.DISPATCH_VISUAL_NOW ?? "");
const SETUP_STATUS = {
  needsKey: true,
  onboardingDone: false,
  prerequisites: ["tmux", "ttyd", "git", "claude"].map((name) => ({
    name,
    present: true,
    hint: null,
    installable: false,
    command: null,
  })),
  node: { ok: true, version: "22.22.0", floor: "22.22" },
  storage: { ok: true, path: "/home/visual/.dispatch/board.db" },
};

const screens: {
  name: string;
  url: string;
  ready: (page: Page) => Promise<void>;
}[] = [
  {
    name: "board",
    url: `${seeded}/#/board`,
    ready: (page) =>
      expect(page.getByText("Todo ticket").first()).toBeVisible(),
  },
  {
    name: "inbox",
    url: `${seeded}/#/inbox`,
    ready: (page) =>
      expect(page.getByText("Review the token rename").first()).toBeVisible(),
  },
  {
    name: "today",
    url: `${seeded}/#/today`,
    ready: (page) =>
      expect(page.getByText("Ticket that needs input").first()).toBeVisible(),
  },
  {
    name: "settings",
    url: `${seeded}/#/settings`,
    ready: (page) =>
      expect(
        page.getByRole("heading", { name: "Settings", level: 1 }),
      ).toBeVisible(),
  },
  {
    name: "card-panel",
    url: `${seeded}/?card=v-prog#/board`,
    ready: async (page) => {
      await expect(
        page.getByText("In progress ticket with a session").last(),
      ).toBeVisible();
      const url = new URL(page.url());
      expect(url.searchParams.has("card")).toBe(false);
      expect(url.hash).toBe("#/board");
    },
  },
  {
    name: "boards",
    url: `${orchestrated}/#/boards`,
    ready: (page) =>
      expect(
        page.getByText("8 need attention").locator("visible=true"),
      ).toBeVisible(),
  },
  {
    name: "orchestrator-panel",
    url: `${orchestrated}/#/board?board=ORC&panel=orchestrator&tab=decisions`,
    ready: (page) =>
      expect(
        page.getByText(/Retry the Phase 5 gate now/).first(),
      ).toBeVisible(),
  },
  {
    name: "dashboard",
    url: `${orchestrated}/#/dashboard?board=ORC`,
    ready: (page) =>
      expect(
        page.getByText("Allow WebFetch: docs.github.com?").first(),
      ).toBeVisible(),
  },
  {
    name: "setup-wizard",
    url: `http://127.0.0.1:${seededPort + 1}/#/board`,
    ready: (page) => expect(page.getByRole("dialog")).toBeVisible(),
  },
  {
    name: "gallery",
    url: `http://127.0.0.1:${seededPort + 2}/gallery.html`,
    ready: (page) => expect(page.locator("#gallery > *").first()).toBeVisible(),
  },
];

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 390]) {
    test.describe(`${theme} ${width}`, () => {
      test.use({ colorScheme: theme, viewport: { width, height: 900 } });

      for (const screen of screens) {
        test(screen.name, async ({ page }) => {
          await page.clock.install({ time: now });
          await page.clock.setFixedTime(now);
          await page.addInitScript((value) => {
            localStorage.setItem("dsp.theme", value);
            localStorage.setItem("dsp.errorsInFeeds", "on");
          }, theme);
          if (screen.name === "setup-wizard") {
            await page.route("**/api/setup", (route) =>
              route.request().method() === "GET"
                ? route.fulfill({ json: SETUP_STATUS })
                : route.fallback(),
            );
          }
          await page.route("**/api/**", (route) =>
            route.request().method() === "GET" && screen.name !== "gallery"
              ? route.fallback()
              : route.abort(),
          );
          const accounts =
            screen.name === "gallery"
              ? null
              : page.waitForResponse("**/api/accounts");
          await page.goto(screen.url);
          await accounts;
          await expect(page.locator("div.z-9999")).toHaveCount(0);
          await screen.ready(page);
          await page.evaluate(() => document.fonts.ready);
          await expect(page).toHaveScreenshot(
            `${screen.name}-${theme}-${width}.png`,
            {
              fullPage: screen.name === "gallery",
              mask: [
                page.locator("iframe"),
                page.getByRole("button", { name: /^Claude account/ }),
              ],
            },
          );
        });
      }
    });
  }
}
