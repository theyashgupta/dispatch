import { expect, test, type Page } from "@playwright/test";
import type {
  BoardSnapshot,
  Item,
  PrDetail,
  SourceConnection,
} from "../../src/shared/types.js";

const seeded = `http://127.0.0.1:${process.env.DISPATCH_VISUAL_PORT}`;
const now = Date.parse(process.env.DISPATCH_VISUAL_NOW ?? "");
const at = (minutesAgo: number) =>
  new Date(now - minutesAgo * 60_000).toISOString();

const AVATAR_URL = "https://avatars.githubusercontent.com/u/1?v=4";
const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPI676GFTEMLQkAIGtzwS0lkuUAAAAASUVORK5CYII=",
  "base64",
);

const prItem = (
  repo: string,
  number: number,
  title: string,
  minutesAgo: number,
  meta: Record<string, string>,
  state: Item["state"],
): Item => ({
  id: `github:${repo}#${number}`,
  source: "github",
  type: "pr_open",
  title,
  snippet: "",
  url: `https://github.com/${repo}/pull/${number}`,
  createdAt: at(minutesAgo),
  priority: 25,
  state,
  meta: {
    repo,
    number: String(number),
    category: "open",
    createdAt: at(minutesAgo),
    ...meta,
  },
});

const ITEMS: Item[] = [
  prItem(
    "visual/app",
    12,
    "Fix token refresh race",
    30,
    {
      author: "octo",
      authorAvatar: AVATAR_URL,
      checks: "fail",
      reviewDecision: "CHANGES_REQUESTED",
      mergeable: "CONFLICTING",
      draft: "false",
      reviewRequestedFromMe: "true",
    },
    "unread",
  ),
  prItem(
    "visual/app",
    14,
    "Add pagination to the audit log",
    180,
    {
      author: "mona",
      authorAvatar: AVATAR_URL,
      checks: "pass",
      reviewDecision: "APPROVED",
      mergeable: "MERGEABLE",
      draft: "false",
      reviewRequestedFromMe: "false",
    },
    "read",
  ),
  prItem(
    "visual/app",
    15,
    "Draft: rework the settings page",
    1440,
    {
      author: "hubot",
      authorAvatar: "",
      checks: "pending",
      reviewDecision: "",
      mergeable: "UNKNOWN",
      draft: "true",
      reviewRequestedFromMe: "false",
    },
    "read",
  ),
  prItem(
    "visual/web",
    3,
    "Update the landing copy",
    2880,
    {
      author: "ghost",
      authorAvatar: "",
      checks: "",
      reviewDecision: "",
      mergeable: "",
      draft: "false",
      reviewRequestedFromMe: "false",
    },
    "read",
  ),
];

const CONNECTION: SourceConnection = {
  configured: true,
  connected: true,
  account: "octo",
  via: "gh",
  enabled: true,
};

const DETAIL: PrDetail = {
  title: "Fix token refresh race",
  url: "https://github.com/visual/app/pull/12",
  author: "octo",
  state: "open",
  draft: false,
  body: "Two refreshes could run at once and overwrite each other.\n\n- Serialise the refresh behind one promise\n- Add a regression test",
  base: "main",
  head: "fix/token-race",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  additions: 142,
  deletions: 87,
  changedFiles: 2,
  files: [
    {
      filename: "src/auth/refresh.ts",
      status: "modified",
      additions: 98,
      deletions: 61,
      patch:
        "@@ -1,4 +1,5 @@\n export async function refresh() {\n-  return fetchToken();\n+  inflight ??= fetchToken();\n+  return inflight;\n }",
      patchTruncated: false,
    },
    {
      filename: "src/auth/refresh.test.ts",
      status: "added",
      additions: 44,
      deletions: 26,
      patch: "@@ -0,0 +1,2 @@\n+test('one refresh at a time', () => {});\n+",
      patchTruncated: false,
    },
  ],
  filesTruncated: false,
  checksTruncated: false,
  checks: [
    { name: "build", state: "fail" },
    { name: "lint", state: "pass" },
  ],
};

const stubPullRequests = async (page: Page) => {
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET" ? route.fallback() : route.abort(),
  );
  await page.route(
    (url) => url.pathname === "/api/stream",
    (route) => route.abort(),
  );
  await page.route(
    (url) => url.pathname === "/api/board",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const snapshot = (await response.json()) as BoardSnapshot;
      await route.fulfill({
        response,
        json: {
          ...snapshot,
          enabledSources: ["github"],
          syncWarning: null,
          items: ITEMS,
        },
      });
    },
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: AVATAR_PNG }),
  );
  await page.route("**/api/sources/github/connection", (route) =>
    route.fulfill({ json: CONNECTION }),
  );
  await page.route("**/api/github/repos", (route) =>
    route.fulfill({ json: { repos: ["visual/app", "visual/web"] } }),
  );
  await page.route("**/api/github/pr/visual/app/12", (route) =>
    route.fulfill({ json: DETAIL }),
  );
};

const screens: {
  name: string;
  url: string;
  ready: (page: Page) => Promise<void>;
}[] = [
  {
    name: "pull-requests-list",
    url: `${seeded}/#/pull-requests`,
    ready: async (page) => {
      await expect(page.locator('[id^="pr-row-"]')).toHaveCount(4);
      if ((page.viewportSize()?.width ?? 0) >= 768)
        await expect(page.getByText("Select a pull request")).toBeVisible();
    },
  },
  {
    name: "pull-requests-detail",
    url: `${seeded}/#/pull-requests/github%3Avisual%2Fapp%2312`,
    ready: async (page) => {
      await expect(
        page.getByRole("tab", { name: "Overview" }).locator("visible=true"),
      ).toBeVisible();
    },
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
          }, theme);
          await stubPullRequests(page);
          const accounts = page.waitForResponse("**/api/accounts");
          await page.goto(screen.url);
          await accounts;
          await expect(page.locator("div.z-9999")).toHaveCount(0);
          await screen.ready(page);
          await page.evaluate(() => document.fonts.ready);
          await expect(page).toHaveScreenshot(
            `${screen.name}-${theme}-${width}.png`,
            {
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
