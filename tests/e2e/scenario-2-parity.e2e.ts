import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium, type Page, type Request } from "@playwright/test";
import type { Card } from "../../src/shared/types.js";
import {
  EVIDENCE_DIR as OUT,
  MINUTE,
  makeNote,
  RELEASE_V420,
  SANDBOX_ROOT,
  sleep,
  startSandbox,
  V420_SKIP,
  type Sandbox,
} from "./harness/sandbox.js";

const SEED = "s2-seed";
const OLD = "s2-old";
const NEW = "s2-new";
const CARD_COLUMNS: [string, string][] = [
  ["LOCAL-3", "needs_input"],
  ["LOCAL-4", "needs_input"],
  ["LOCAL-5", "in_review"],
  ["LOCAL-6", "done"],
  ["LOCAL-7", "done"],
  ["LOCAL-8", "parked"],
];
const SWITCHER = 'button[aria-label^="Switch board"]';
const ALLOWED_EXTRA = new Set(["GET /api/boards", "GET /api/boards/counts"]);
const ROUTE_ALLOWED_EXTRA: Record<
  string,
  { ticket: string; requests: string[] }
> = { "/settings": { ticket: "LOCAL-82", requests: ["GET /api/slack/mcp"] } };
const SHADCN_RESTYLE =
  "LOCAL-74 to LOCAL-77: shadcn restyle (custom selects, buttons, inputs, badges)";
const PIXEL_ATTRIBUTION: Record<string, string> = {
  "/activity": SHADCN_RESTYLE,
  "/ask": SHADCN_RESTYLE,
  "/errors": SHADCN_RESTYLE,
  "/inbox": SHADCN_RESTYLE,
  "/meetings": SHADCN_RESTYLE,
  "/pull-requests": SHADCN_RESTYLE,
  "/sessions": SHADCN_RESTYLE,
  "/slack": SHADCN_RESTYLE,
  "/tickets": SHADCN_RESTYLE,
  "/today": SHADCN_RESTYLE,
  "/workspace": SHADCN_RESTYLE,
  "/workspaces": SHADCN_RESTYLE,
  "/flow": SHADCN_RESTYLE,
  "/board":
    "LOCAL-75: search width and column header; LOCAL-91: Add orchestrator button",
  "/accounts": "LOCAL-94 and LOCAL-80: account chain",
  "/playbooks": 'LOCAL-91: seeded "Board Orchestrator" playbook',
};
const UNLISTED_PIXEL_LIMIT = 32;
const STREAMS = new Set(["/api/stream"]);
const TIMESTAMP_VALUE = /^\d{9,}$|^\d{4}-\d\d-\d\dT/;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PixelResult {
  outside: number;
  inside: number;
  width: number;
  height: number;
  diffPng: string;
}

interface PixelArgs {
  a: string;
  b: string;
  allowed: Box | null;
}

interface PageLoad {
  requests: string[];
  detailed: string[];
  png: Buffer;
  switcher: Box | null;
}

interface RouteRow {
  route: string;
  oldRequests: number;
  newRequests: number;
  extra: string[];
  missing: string[];
  differing: number;
  insideBox: number;
  attribution: string;
  verdict: string;
}

/**
 * Decide one route: requests must match, and pixels may differ only on an attributed route or by at most 32 pixels.
 *
 * @remarks A listed route records its pixel count and never fails on it; an unlisted route fails above
 * {@link UNLISTED_PIXEL_LIMIT}. Any extra or missing request fails every route.
 */
function judgeRoute(
  route: string,
  differing: number,
  extra: string[],
  missing: string[],
): { attribution: string; verdict: "pass" | "FAIL" } {
  const attribution = PIXEL_ATTRIBUTION[route] ?? "none";
  const pixelsOk = attribution !== "none" || differing <= UNLISTED_PIXEL_LIMIT;
  const requestsOk = extra.length === 0 && missing.length === 0;
  return { attribution, verdict: pixelsOk && requestsOk ? "pass" : "FAIL" };
}

const note = makeNote("scenario-2");

/** Read the page routes of v4.2.0 as hash fragments from its generated route tree. */
function oldRoutes(): string[] {
  const tree = fs.readFileSync(
    path.join(RELEASE_V420, "src/web/routeTree.gen.ts"),
    "utf8",
  );
  const paths = new Set<string>();
  for (const m of tree.matchAll(/fullPath: '([^']+)'/g)) {
    paths.add(m[1].replace("/{-$id}", ""));
  }
  return [...paths].filter((p) => p !== "" && p !== "/").sort();
}

/** Build the request key used for comparison: the method and the path, with no query. */
const keyOf = (method: string, url: URL): string => `${method} ${url.pathname}`;

/** Build the request key with its sorted query values, and show a time value as `<time>`. */
function detailOf(method: string, url: URL): string {
  const params = [...url.searchParams.entries()]
    .map(([k, v]) => `${k}=${TIMESTAMP_VALUE.test(v) ? "<time>" : v}`)
    .sort();
  return `${keyOf(method, url)}${params.length > 0 ? `?${params.join("&")}` : ""}`;
}

/**
 * Make a seed data folder through the v4.2.0 API: cards in To Do, Needs input, In review, Done and Parked.
 *
 * @remarks Every column move uses a manual move the v4.2.0 route allows. No session is started, so both
 * copies show the same cards and neither build has a pane to adopt or lose.
 */
async function seedOldBuild(seed: Sandbox): Promise<number> {
  for (let n = 1; n <= 8; n++) {
    const made = await seed.api("POST", "/api/cards", {
      title: `Parity card ${n}: ${["fix the login redirect", "add the export button", "tidy the settings page", "review the token rename", "document the API", "remove the old cache", "check the nightly job", "plan the next release"][n - 1]}`,
      description: `Card ${n} made on v4.2.0 for the parity check.\n\nIt has a second paragraph so the card detail shows more than one line.`,
    });
    assert.equal(made.status, 201);
  }
  for (const [id, column] of CARD_COLUMNS) {
    const moved = await seed.api("POST", `/api/cards/${id}/move`, { column });
    assert.equal(moved.status, 204);
  }
  const snapshot = await seed.api<{ cards: Card[] }>("GET", "/api/board");
  const latest = Math.max(
    ...snapshot.body.cards.map((c) => Date.parse(c.updatedAt)),
  );
  return latest + 5 * MINUTE;
}

/**
 * Wait until no API request except the event stream has been in flight for one second.
 *
 * @remarks The event stream never ends, so network idle never comes. A request that stays open for 30 s
 * is a failure that names it.
 */
async function settle(pending: Set<Request>, route: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let quietSince = Date.now();
  while (Date.now() - quietSince < 1000) {
    if (Date.now() > deadline) {
      const open = [...pending].map((r) => r.url()).join(", ");
      throw new Error(`${route} still has requests in flight: ${open}`);
    }
    await sleep(100);
    if (pending.size > 0) quietSince = Date.now();
  }
}

/**
 * Take viewport screenshots until two in a row are the same bytes, and return the last.
 *
 * @remarks A page can still paint a late value after its requests end, most of all when two servers and a
 * browser share one machine. Ten tries with 300 ms between them is the limit; a page that never settles
 * returns its last shot and the pixel comparison reports it.
 */
async function stableScreenshot(page: Page): Promise<Buffer> {
  let previous: Buffer | null = null;
  let shot: Buffer = Buffer.alloc(0);
  for (let attempt = 0; attempt < 10; attempt++) {
    shot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      mask: [
        page.locator("iframe"),
        page.getByRole("button", { name: /^Claude account/ }),
      ],
    });
    if (previous !== null && previous.equals(shot)) return shot;
    previous = shot;
    await sleep(300);
  }
  return shot;
}

/** Load one route on one build with a fixed clock and record its API requests and a screenshot. */
async function loadRoute(
  page: Page,
  baseUrl: string,
  route: string,
  now: number,
): Promise<PageLoad> {
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.addInitScript(() => {
    localStorage.setItem("dsp.theme", "light");
  });
  await page.route("**/api/**", (r) =>
    r.request().method() === "GET" ? r.fallback() : r.abort(),
  );
  await page.route("**/api/update", async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const real = await r.fetch();
    const status = (await real.json()) as Record<string, unknown>;
    return r.fulfill({
      response: real,
      json: { ...status, updateAvailable: false, latest: null },
    });
  });
  const requests = new Set<string>();
  const detailed = new Set<string>();
  const pending = new Set<Request>();
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return;
    requests.add(keyOf(req.method(), url));
    detailed.add(detailOf(req.method(), url));
    if (!STREAMS.has(url.pathname)) pending.add(req);
  });
  page.on("requestfinished", (req) => pending.delete(req));
  page.on("requestfailed", (req) => pending.delete(req));
  await page.goto(`${baseUrl}/#${route}`);
  await page.waitForSelector("div.z-9999", { state: "detached" });
  await settle(pending, route);
  await page.evaluate(() => document.fonts.ready);
  const shown = page.locator(SWITCHER);
  const switcher = (await shown.count()) > 0 ? await shown.boundingBox() : null;
  const png = await stableScreenshot(page);
  return {
    requests: [...requests].sort(),
    detailed: [...detailed].sort(),
    png,
    switcher,
  };
}

const PIXEL_SCRIPT = `
async ({ a, b, allowed }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("image did not load"));
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const width = Math.max(ia.width, ib.width);
      const height = Math.max(ia.height, ib.height);
      const draw = (img) => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx === null) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0);
        return { c, ctx, data: ctx.getImageData(0, 0, width, height).data };
      };
      const left = draw(ia);
      const right = draw(ib);
      const out = right.ctx.getImageData(0, 0, width, height);
      let outside = 0;
      let inside = 0;
      for (let i = 0; i < left.data.length; i += 4) {
        const same =
          left.data[i] === right.data[i] &&
          left.data[i + 1] === right.data[i + 1] &&
          left.data[i + 2] === right.data[i + 2] &&
          left.data[i + 3] === right.data[i + 3];
        const px = (i / 4) % width;
        const py = Math.floor(i / 4 / width);
        const inBox =
          allowed !== null &&
          px >= Math.floor(allowed.x) &&
          px < Math.ceil(allowed.x + allowed.width) &&
          py >= Math.floor(allowed.y) &&
          py < Math.ceil(allowed.y + allowed.height);
        if (same) {
          for (let k = 0; k < 3; k++) {
            out.data[i + k] = 255 - (255 - (out.data[i + k])) * 0.25;
          }
          continue;
        }
        const colour = inBox ? [0, 90, 255] : [255, 0, 0];
        out.data[i] = colour[0];
        out.data[i + 1] = colour[1];
        out.data[i + 2] = colour[2];
        out.data[i + 3] = 255;
        if (inBox) inside++;
        else outside++;
      }
      right.ctx.putImageData(out, 0, 0);
      return {
        outside,
        inside,
        width,
        height,
        diffPng: right.c.toDataURL("image/png"),
      };
    }
`;

/**
 * Compare two PNGs pixel by pixel in a browser page and render a diff image.
 *
 * @remarks The page code is the text `PIXEL_SCRIPT`, because the test runner adds a name helper to function
 * bodies that the page does not have. The diff image shows the new screenshot faded, red where a pixel differs outside the allowed box
 * and blue where it differs inside the box.
 */
async function comparePixels(
  page: Page,
  oldPng: Buffer,
  newPng: Buffer,
  box: Box | null,
): Promise<PixelResult> {
  const args: PixelArgs = {
    a: `data:image/png;base64,${oldPng.toString("base64")}`,
    b: `data:image/png;base64,${newPng.toString("base64")}`,
    allowed: box,
  };
  return page.evaluate<PixelResult>(
    `(${PIXEL_SCRIPT})(${JSON.stringify(args)})`,
  );
}

/** Return the requests only the new build made outside the global and per-route allowed lists, and the requests only the old build made. */
function diffRequests(
  route: string,
  oldRequests: string[],
  newRequests: string[],
): { extra: string[]; missing: string[] } {
  return {
    extra: newRequests.filter(
      (r) =>
        !oldRequests.includes(r) &&
        !ALLOWED_EXTRA.has(r) &&
        !ROUTE_ALLOWED_EXTRA[route]?.requests.includes(r),
    ),
    missing: oldRequests.filter((r) => !newRequests.includes(r)),
  };
}

const slug = (route: string): string => route.replace(/^\//, "");

/** Write the parity report: one table row per route, then the request detail of the routes that differ. */
function writeReport(rows: RouteRow[], box: Box | null, now: number): void {
  const list = (items: string[]): string =>
    items.length === 0 ? "none" : items.join("<br>");
  const lines = [
    "# Scenario 2 parity report",
    "",
    `Build old: v4.2.0 (${RELEASE_V420}/dist). Build new: this branch. Viewport 1440x900, light theme, fixed clock ${new Date(now).toISOString()}.`,
    "",
    `Allowed pixel region (board switcher on the new build): ${box === null ? "empty, the switcher is hidden while the data has one board" : `x ${box.x}, y ${box.y}, width ${box.width}, height ${box.height}`}.`,
    `Allowed extra requests on the new build: ${[...ALLOWED_EXTRA].join(" and ")}.`,
    ...Object.entries(ROUTE_ALLOWED_EXTRA).map(
      ([route, { ticket, requests }]) =>
        `Allowed extra requests on ${route} only, ${ticket}: ${requests.join(" and ")}.`,
    ),
    `Pixel rule: a route in the attribution list records its count and does not fail on it; any other route fails above ${UNLISTED_PIXEL_LIMIT} differing pixels.`,
    "",
    "| Route | Requests old | Requests new | Extra requests (new) | Missing requests (old) | Differing pixels outside the box | Differing pixels inside the box | Attribution | Verdict |",
    "|-|-|-|-|-|-|-|-|-|",
    ...rows.map(
      (r) =>
        `| ${r.route} | ${r.oldRequests} | ${r.newRequests} | ${list(r.extra)} | ${list(r.missing)} | ${r.differing} | ${r.insideBox} | ${r.attribution} | ${r.verdict} |`,
    ),
    "",
  ];
  fs.writeFileSync(path.join(OUT, "parity-report.md"), `${lines.join("\n")}\n`);
}

void test(
  "scenario 2: a traditional board matches v4.2.0 except the attributed changes and the board switcher",
  { timeout: 30 * MINUTE, skip: V420_SKIP },
  async () => {
    fs.mkdirSync(OUT, { recursive: true });
    for (const file of fs.readdirSync(OUT)) {
      if (/^parity-.*\.png$/.test(file)) fs.rmSync(path.join(OUT, file));
    }
    const sandboxes: Sandbox[] = [];
    const rows: RouteRow[] = [];
    const detail: Record<string, { old: string[]; new: string[] }> = {};
    let box: Box | null = null;
    let now = 0;
    const browser = await chromium.launch({ headless: true });
    try {
      const seed = await startSandbox({ name: SEED, buildRoot: RELEASE_V420 });
      sandboxes.push(seed);
      now = await seedOldBuild(seed);
      await seed.stop();
      for (const name of [OLD, NEW]) {
        const root = path.join(SANDBOX_ROOT, name);
        fs.rmSync(root, { recursive: true, force: true });
        fs.mkdirSync(root, { recursive: true });
        fs.cpSync(seed.dir, path.join(root, "dispatch-dir"), {
          recursive: true,
        });
      }
      const oldBuild = await startSandbox({
        name: OLD,
        buildRoot: RELEASE_V420,
        reuseDir: true,
      });
      sandboxes.push(oldBuild);
      const newBuild = await startSandbox({ name: NEW, reuseDir: true });
      sandboxes.push(newBuild);
      assert.notEqual(oldBuild.port, newBuild.port);
      for (const sb of [oldBuild, newBuild]) {
        const snapshot = await sb.api<{ cards: Card[] }>("GET", "/api/board");
        assert.equal(snapshot.body.cards.length, 8);
      }
      note("both builds booted on copies of the seed folder");

      const comparer = await browser.newPage();
      const routes = oldRoutes();
      assert.ok(routes.length >= 19, `routes found: ${routes.length}`);
      for (const route of routes) {
        const contexts = await Promise.all(
          [oldBuild, newBuild].map((sb) =>
            browser.newContext({
              viewport: { width: 1440, height: 900 },
              colorScheme: "light",
              reducedMotion: "reduce",
              deviceScaleFactor: 1,
              baseURL: sb.url,
            }),
          ),
        );
        try {
          const [oldPage, newPage] = await Promise.all(
            contexts.map((c) => c.newPage()),
          );
          const oldLoad = await loadRoute(oldPage, oldBuild.url, route, now);
          const newLoad = await loadRoute(newPage, newBuild.url, route, now);
          box ??= newLoad.switcher;
          detail[route] = { old: oldLoad.detailed, new: newLoad.detailed };
          const { extra, missing } = diffRequests(
            route,
            oldLoad.requests,
            newLoad.requests,
          );
          const pixels = await comparePixels(
            comparer,
            oldLoad.png,
            newLoad.png,
            box,
          );
          const name = slug(route);
          fs.writeFileSync(
            path.join(OUT, `parity-${name}-old.png`),
            oldLoad.png,
          );
          fs.writeFileSync(
            path.join(OUT, `parity-${name}-new.png`),
            newLoad.png,
          );
          const differs =
            pixels.outside > 0 ||
            pixels.inside > 0 ||
            extra.length + missing.length > 0;
          if (differs) {
            fs.writeFileSync(
              path.join(OUT, `parity-${name}-diff.png`),
              Buffer.from(pixels.diffPng.split(",")[1], "base64"),
            );
          }
          const judged = judgeRoute(route, pixels.outside, extra, missing);
          rows.push({
            route,
            oldRequests: oldLoad.requests.length,
            newRequests: newLoad.requests.length,
            extra,
            missing,
            differing: pixels.outside,
            insideBox: pixels.inside,
            attribution: judged.attribution,
            verdict: judged.verdict,
          });
          note(
            `${route}: ${judged.verdict} (${pixels.outside} pixels outside the box, ${extra.length} extra, ${missing.length} missing requests)`,
          );
        } finally {
          await Promise.all(contexts.map((c) => c.close()));
        }
      }
      await comparer.close();
    } finally {
      const cleanup: (() => unknown)[] = [
        () => writeReport(rows, box, now),
        () =>
          fs.writeFileSync(
            path.join(OUT, "parity-requests.json"),
            JSON.stringify(detail, null, 2),
          ),
        () => browser.close(),
        ...sandboxes.reverse().map((sb) => () => sb.stop()),
      ];
      for (const step of cleanup) {
        try {
          await step();
        } catch (err) {
          note(
            `cleanup step failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    const failures = rows.filter((r) => r.verdict === "FAIL");
    assert.deepEqual(
      failures.map(
        (r) =>
          `${r.route}: ${r.differing} pixels outside the box, extra [${r.extra.join(", ")}], missing [${r.missing.join(", ")}]`,
      ),
      [],
      "every route matches v4.2.0 within the attribution list and the pixel limit",
    );
    assert.ok(rows.length > 0);
  },
);

/** Draw a white 40 by 40 PNG with one black pixel at each of `dots` in the page. */
async function dotsPng(page: Page, dots: [number, number][]): Promise<Buffer> {
  const url = await page.evaluate<string>(
    `(() => {
      const c = document.createElement("canvas");
      c.width = 40;
      c.height = 40;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 40, 40);
      ctx.fillStyle = "#000";
      for (const [x, y] of ${JSON.stringify(dots)}) ctx.fillRect(x, y, 1, 1);
      return c.toDataURL("image/png");
    })()`,
  );
  return Buffer.from(url.split(",")[1], "base64");
}

void test("scenario 2: the comparison flags a changed pixel and a changed request outside the allowed list", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const base = await dotsPng(page, []);
    const box: Box = { x: 10, y: 10, width: 10, height: 10 };
    const outside = await comparePixels(
      page,
      base,
      await dotsPng(page, [[30, 30]]),
      box,
    );
    assert.equal(outside.outside, 1);
    assert.equal(outside.inside, 0);
    assert.ok(outside.diffPng.startsWith("data:image/png;base64,"));
    const inside = await comparePixels(
      page,
      base,
      await dotsPng(page, [[12, 12]]),
      box,
    );
    assert.equal(inside.outside, 0);
    assert.equal(inside.inside, 1);
    const same = await comparePixels(page, base, base, null);
    assert.equal(same.outside + same.inside, 0);
  } finally {
    await browser.close();
  }
  assert.deepEqual(
    diffRequests(
      "/board",
      ["GET /api/board"],
      ["GET /api/board", "GET /api/boards"],
    ),
    { extra: [], missing: [] },
  );
  assert.deepEqual(
    diffRequests(
      "/board",
      ["GET /api/board", "GET /api/ask"],
      ["GET /api/board", "GET /api/boards/counts", "GET /api/novel"],
    ),
    { extra: ["GET /api/novel"], missing: ["GET /api/ask"] },
  );
  assert.deepEqual(diffRequests("/settings", [], ["GET /api/slack/mcp"]), {
    extra: [],
    missing: [],
  });
  assert.deepEqual(diffRequests("/board", [], ["GET /api/slack/mcp"]), {
    extra: ["GET /api/slack/mcp"],
    missing: [],
  });
  assert.equal(judgeRoute("/vault", 32, [], []).verdict, "pass");
  assert.equal(judgeRoute("/vault", 33, [], []).verdict, "FAIL");
  assert.equal(judgeRoute("/vault", 0, ["GET /api/novel"], []).verdict, "FAIL");
  assert.equal(judgeRoute("/vault", 0, [], ["GET /api/ask"]).verdict, "FAIL");
  assert.deepEqual(judgeRoute("/board", 38467, [], []), {
    attribution: PIXEL_ATTRIBUTION["/board"],
    verdict: "pass",
  });
  assert.equal(judgeRoute("/board", 5, ["GET /api/novel"], []).verdict, "FAIL");
});
