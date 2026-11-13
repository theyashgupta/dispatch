#!/usr/bin/env node
/**
 * Upload a video through GitHub's release editor and print the inline player URL.
 *
 * @remarks
 * GitHub renders an inline video player only for files dropped into its own markdown editor
 * (github.com/user-attachments), never for release assets. There is no API for that upload, so
 * this script drives a headless Chromium with a persistent profile that the user signs in once.
 *
 * Usage (run from the repository root, no cd needed; playwright loads from ~/.cache/record-flow):
 *   node .claude/skills/release-notes/gh-attach.js login                       opens a window; sign in to GitHub, then close it
 *   node .claude/skills/release-notes/gh-attach.js upload <release edit url> <file> [--save]
 * The upload mode prints ATTACHMENT_URL=<url> on success. With --save it also clicks the editor's
 * save button so the asset is referenced at least once before `gh release edit` rewrites the body.
 */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import fs from "node:fs";

const RECORD_FLOW = join(homedir(), ".cache/record-flow");
const PROFILE = join(RECORD_FLOW, "github-profile");
const [mode, ...rest] = process.argv.slice(2);

/**
 * Load playwright from the record-flow cache on first use.
 *
 * @remarks
 * Lazy so that usage errors and URL validation work without playwright installed.
 */
function chromium() {
  return createRequire(import.meta.url)(
    join(RECORD_FLOW, "node_modules/playwright"),
  ).chromium;
}

async function loggedIn(page) {
  const meta = await page.$('meta[name="user-login"]');
  return (await meta?.getAttribute("content")) || "";
}

async function login() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium().launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1200, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto("https://github.com/login");
  console.log(
    "Sign in to GitHub in the window. The script exits on its own once the session exists.",
  );
  for (let i = 0; i < 600; i++) {
    await page.waitForTimeout(1000);
    const user = await loggedIn(page).catch(() => "");
    if (user) {
      console.log(`LOGGED_IN=${user}`);
      await page.waitForTimeout(1500);
      await ctx.close();
      return;
    }
  }
  await ctx.close();
  throw new Error("no GitHub session after 10 minutes");
}

async function upload(editUrl, file, save) {
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/edit\//.test(editUrl)) {
    throw new Error(`not a release edit url: ${editUrl}`);
  }
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
  const ctx = await chromium().launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: 1400, height: 1000 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto(editUrl, { waitUntil: "domcontentloaded" });
    if (!(await loggedIn(page))) {
      throw new Error(
        "not signed in: run `node .claude/skills/release-notes/gh-attach.js login` first",
      );
    }
    const body = page
      .locator('textarea#release_body, textarea[name="release[body]"]')
      .first();
    await body.waitFor({ timeout: 20000 });
    const before = await body.inputValue();
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(file);
    const deadline = Date.now() + 10 * 60 * 1000;
    let url = "";
    while (Date.now() < deadline) {
      await page.waitForTimeout(1500);
      const value = await body.inputValue();
      const m = value.match(
        /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+/,
      );
      if (m && !before.includes(m[0])) {
        url = m[0];
        break;
      }
      if (/upload failed|something went wrong/i.test(value)) {
        throw new Error("GitHub reported an upload failure");
      }
    }
    if (!url) throw new Error("upload did not finish within 10 minutes");
    console.log(`ATTACHMENT_URL=${url}`);
    if (save) {
      const btn = page
        .getByRole("button", { name: /^(Save draft|Update release)$/ })
        .first();
      await btn.click();
      await page
        .waitForURL(/\/releases\/(tag|edit)\//, { timeout: 30000 })
        .catch(() => {});
      console.log("SAVED=yes");
    }
  } finally {
    await ctx.close();
  }
}

try {
  if (mode === "login") await login();
  else if (mode === "upload")
    await upload(rest[0], rest[1], rest.includes("--save"));
  else
    throw new Error(
      "usage: gh-attach.js login | upload <release edit url> <file> [--save]",
    );
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
