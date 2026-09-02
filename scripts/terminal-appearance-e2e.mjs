/**
 * Browser end-to-end suite for the terminal appearance feature (dev/ops tooling, not unit test
 * code): boots a sandboxed production build under a throwaway HOME, seeds one card with a live
 * tmux session so the server spawns a real ttyd, drives headless Chrome over raw CDP (Node's
 * global WebSocket and fetch, zero new dependency, same lineage as panel-92.mjs), and asserts
 * every client-side branch that has no node:test runner: the translucent default paint, live
 * BroadcastChannel apply with refit, malformed payloads ignored, the opacity-1 and unsupported-rgba
 * solid fallbacks, persisted changes on reload, the mobile zoom base recompute, and the Settings
 * Terminal tab's save, validation, double-click guard, and failure notices.
 *
 * Requirements: Google Chrome, tmux, ttyd. Ports are checked before use and never killed; a held
 * port is a hard error naming the port so another instance is never touched.
 *
 * Run: `npm run terminal-e2e`. Exit 0 with one PASS line per case, exit 1 on the first failure.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { strict as assert } from "node:assert";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SANDBOX_PORT = 47866;
const CDP_PORT = 9369;
const PREFIX = "dispatch-term-e2e-";
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const DEFAULTS = {
  background: "#111111",
  opacity: 0.93,
  foreground: "#e8e9ea",
  cursor: "#e8e9ea",
  fontFamily: "JetBrains Mono Nerd Font Mono",
  fontSize: 14,
};
const BASE = `http://127.0.0.1:${SANDBOX_PORT}`;
const CARD_TITLE = "Terminal appearance e2e card";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertPortFree(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.trim())
      throw new Error(
        `port ${port} is held by another process; pick a free port, never kill it:\n${out}`,
      );
  } catch (err) {
    if (err.status === 1) return;
    throw err;
  }
}

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found)
    throw new Error(
      `No Chrome binary found at ${CHROME_CANDIDATES.join(", ")}`,
    );
  return found;
}

function requireBinary(name) {
  execFileSync("which", [name], { stdio: "ignore" });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() {
    this.ws.close();
  }
}

async function connectCDP() {
  const info = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
  ).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new CDP(ws);
}

async function evalIn(cdp, sid, fn) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(${fn.toString()})()`,
      returnByValue: true,
      awaitPromise: true,
    },
    sid,
  );
  if (exceptionDetails) {
    throw new Error(
      `page evaluation failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
    );
  }
  return result.value;
}

async function navigate(cdp, sid, url) {
  await cdp.send("Page.navigate", { url }, sid);
  await sleep(1500);
}

function killAndWait(child) {
  if (child == null || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const escalate = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(escalate);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function waitFor(fn, what, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function bootServer(home) {
  return spawn("node", [join(REPO_ROOT, "dist/server/bootstrap/index.js")], {
    env: { ...process.env, HOME: home, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

async function putAppearance(body) {
  const res = await fetch(`${BASE}/api/config/terminal`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

const TERMINAL_READ = () => {
  const cs = (e) => getComputedStyle(e);
  const rows = document.querySelector(".xterm-rows");
  return {
    body: cs(document.body).backgroundColor,
    bodyInline: document.body.style.background,
    viewport: cs(document.querySelector(".xterm-viewport")).backgroundColor,
    fg: cs(rows).color,
    font: cs(rows).fontFamily,
    size: cs(rows).fontSize,
    rows: document.querySelectorAll(".xterm-rows > div").length,
    screenW: document.querySelector(".xterm-screen").getBoundingClientRect()
      .width,
    hostW: document.querySelector("#terminal").getBoundingClientRect().width,
    blink: !!document.querySelector(".xterm-cursor-blink"),
    rgbaInside: [...document.querySelectorAll("#terminal, #terminal *")]
      .map((e) => cs(e).backgroundColor)
      .filter((v) => v.startsWith("rgba(") && !v.endsWith(", 0)")),
  };
};

const results = [];
function pass(name) {
  results.push(name);
  console.log(`PASS ${name}`);
}

async function main() {
  requireBinary("tmux");
  requireBinary("ttyd");
  assertPortFree(SANDBOX_PORT);
  assertPortFree(CDP_PORT);
  execFileSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "ignore" });

  const home = mkdtempSync(join(tmpdir(), PREFIX));
  const tmuxSession = `${PREFIX}${process.pid}`;
  const chromeDir = join(tmpdir(), `${PREFIX}chrome-${process.pid}`);
  let server = null;
  let chrome = null;
  let cdp = null;
  try {
    mkdirSync(join(home, ".dispatch"), { recursive: true });
    writeFileSync(
      join(home, ".dispatch", "config.json"),
      JSON.stringify({
        port: SANDBOX_PORT,
        workspaceRoot: join(home, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
        sources: { linear: { apiKey: "terminal-e2e-fake-key" } },
      }),
      { mode: 0o600 },
    );
    server = bootServer(home);
    await waitFor(
      async () => (await fetch(`${BASE}/api/board`)).status === 200,
      "sandbox boot",
    );
    await killAndWait(server);

    execFileSync("tmux", [
      "new-session",
      "-d",
      "-s",
      tmuxSession,
      "-x",
      "120",
      "-y",
      "40",
    ]);
    const now = new Date().toISOString();
    const card = {
      id: "E2E-6",
      issueId: "E2E-6",
      identifier: "E2E-6",
      title: CARD_TITLE,
      description: "",
      priority: 0,
      column: "in_progress",
      updatedAt: now,
      promotedAt: now,
      source: "local",
      sessions: [
        {
          id: "e2e-session",
          createdAt: now,
          updatedAt: now,
          workspace: { folder: join(home, "workspaces"), repos: [] },
          workspacePath: join(home, "workspaces", "E2E-6"),
          tmuxSession,
          branch: "E2E-6",
        },
      ],
      activeSessionId: "e2e-session",
      tmuxSession,
      workspacePath: join(home, "workspaces", "E2E-6"),
      workspace: { folder: join(home, "workspaces"), repos: [] },
      branch: "E2E-6",
      provisioningStep: null,
      startError: null,
      sessionLost: false,
      resumeError: null,
    };
    const db = new DatabaseSync(join(home, ".dispatch", "board.db"));
    db.prepare(
      "INSERT INTO cards (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run(card.id, JSON.stringify(card));
    db.close();

    server = bootServer(home);
    await waitFor(
      async () => (await fetch(`${BASE}/api/board`)).status === 200,
      "sandbox reboot",
    );
    await fetch(`${BASE}/api/cards/E2E-6/terminal`, { method: "POST" });
    await waitFor(
      async () =>
        (await fetch(`${BASE}/sessions/e2e-session/terminal/`)).status === 200,
      "live ttyd",
    );

    chrome = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${chromeDir}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    await waitFor(
      async () =>
        (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).status ===
        200,
      "chrome",
    );
    cdp = await connectCDP();
    const open = async (url) => {
      const { targetId } = await cdp.send("Target.createTarget", { url });
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      return sessionId;
    };
    const termUrl = `${BASE}/sessions/e2e-session/terminal/`;
    const term = await open(termUrl);
    await sleep(2500);

    let r = await evalIn(cdp, term, TERMINAL_READ);
    assert.equal(r.body, "rgba(0, 0, 0, 0)");
    assert.equal(r.viewport, "rgba(17, 17, 17, 0.93)");
    assert.equal(r.fg, "rgb(232, 233, 234)");
    assert.equal(r.font, '"JetBrains Mono Nerd Font Mono", monospace');
    assert.equal(r.size, "14px");
    assert.equal(r.blink, false);
    const rowsAt14 = r.rows;
    pass("T1 default translucent paint");

    r = await evalIn(cdp, term, async () => {
      window.__marker = 1;
      const ch = new BroadcastChannel("dsp.terminal-appearance");
      ch.postMessage({
        background: "#ff0000",
        opacity: 0.5,
        foreground: "#00ff00",
        cursor: "#e8e9ea",
        fontFamily: "Menlo",
        fontSize: 18,
      });
      ch.close();
      await new Promise((res) => setTimeout(res, 900));
      const cs = (e) => getComputedStyle(e);
      const rows = document.querySelector(".xterm-rows");
      return {
        viewport: cs(document.querySelector(".xterm-viewport")).backgroundColor,
        fg: cs(rows).color,
        font: cs(rows).fontFamily,
        size: cs(rows).fontSize,
        marker: window.__marker,
        screenW: document.querySelector(".xterm-screen").getBoundingClientRect()
          .width,
        hostW: document.querySelector("#terminal").getBoundingClientRect()
          .width,
      };
    });
    assert.equal(r.viewport, "rgba(255, 0, 0, 0.5)");
    assert.equal(r.fg, "rgb(0, 255, 0)");
    assert.equal(r.font, 'Menlo, "JetBrains Mono Nerd Font Mono", monospace');
    assert.equal(r.size, "18px");
    assert.equal(r.marker, 1);
    assert.ok(
      r.hostW - r.screenW < 40,
      `terminal refit after apply (host ${r.hostW}, screen ${r.screenW})`,
    );
    assert.deepEqual(
      await (await fetch(`${BASE}/api/config/terminal`)).json(),
      DEFAULTS,
      "a broadcast never writes",
    );
    pass("T2 live apply restyles without reload and refits");

    r = await evalIn(cdp, term, async () => {
      const errors = [];
      window.addEventListener("error", (e) => errors.push(String(e.message)));
      const ch = new BroadcastChannel("dsp.terminal-appearance");
      for (const p of [
        "hello",
        null,
        42,
        { opacity: 3 },
        {
          background: "#111111",
          opacity: 0.93,
          foreground: "#e8e9ea",
          cursor: "#e8e9ea",
          fontFamily: "Comic Sans",
          fontSize: 14,
        },
      ])
        ch.postMessage(p);
      ch.close();
      await new Promise((res) => setTimeout(res, 700));
      return {
        viewport: getComputedStyle(document.querySelector(".xterm-viewport"))
          .backgroundColor,
        size: getComputedStyle(document.querySelector(".xterm-rows")).fontSize,
        errors,
      };
    });
    assert.equal(r.viewport, "rgba(255, 0, 0, 0.5)");
    assert.equal(r.size, "18px");
    assert.deepEqual(r.errors, []);
    pass("T3 malformed broadcasts are ignored");

    r = await evalIn(cdp, term, async () => {
      const ch = new BroadcastChannel("dsp.terminal-appearance");
      ch.postMessage({
        background: "#223344",
        opacity: 1,
        foreground: "#e8e9ea",
        cursor: "#e8e9ea",
        fontFamily: "JetBrains Mono Nerd Font Mono",
        fontSize: 14,
      });
      ch.close();
      await new Promise((res) => setTimeout(res, 700));
      return (() => {
        const cs = (e) => getComputedStyle(e);
        return {
          body: document.body.style.background,
          viewport: cs(document.querySelector(".xterm-viewport"))
            .backgroundColor,
          rgbaInside: [...document.querySelectorAll("#terminal, #terminal *")]
            .map((e) => cs(e).backgroundColor)
            .filter((v) => v.startsWith("rgba(") && !v.endsWith(", 0)")),
        };
      })();
    });
    assert.equal(r.body, "rgb(34, 51, 68)");
    assert.equal(r.viewport, "rgb(34, 51, 68)");
    assert.deepEqual(r.rgbaInside, []);
    pass("T4 opacity 1 takes the solid hex path");

    const { identifier: stub } = await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source:
          "const real = CSS.supports.bind(CSS); CSS.supports = (a, b) => (a === 'background-color' && /rgba\\(/.test(String(b))) ? false : real(a, b);",
      },
      term,
    );
    await navigate(cdp, term, termUrl);
    await sleep(1500);
    r = await evalIn(cdp, term, TERMINAL_READ);
    assert.equal(r.bodyInline, "rgb(17, 17, 17)");
    assert.equal(r.viewport, "rgb(17, 17, 17)");
    assert.deepEqual(r.rgbaInside, []);
    await cdp.send(
      "Page.removeScriptToEvaluateOnNewDocument",
      { identifier: stub },
      term,
    );
    pass("T5 unsupported rgba falls back to a solid body and terminal");

    assert.equal(
      await putAppearance({ ...DEFAULTS, background: "#223344", fontSize: 18 }),
      200,
    );
    await navigate(cdp, term, termUrl);
    await sleep(1500);
    r = await evalIn(cdp, term, TERMINAL_READ);
    assert.equal(r.viewport, "rgba(34, 51, 68, 0.93)");
    assert.equal(r.size, "18px");
    assert.ok(
      r.rows < rowsAt14,
      `rows ${r.rows} should be fewer than ${rowsAt14} at 14px`,
    );
    assert.equal(await putAppearance(DEFAULTS), 200);
    pass("T6 a persisted change is painted on reload");

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      term,
    );
    await cdp.send(
      "Emulation.setTouchEmulationEnabled",
      { enabled: true, maxTouchPoints: 5 },
      term,
    );
    await cdp.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "pointer", value: "coarse" }] },
      term,
    );
    await evalIn(cdp, term, () =>
      localStorage.setItem("dsp.terminal.zoom", "1"),
    );
    await navigate(cdp, term, termUrl);
    await sleep(1500);
    r = await evalIn(cdp, term, async () => {
      const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms));
      const cs = (e) => getComputedStyle(e);
      const rows = () => document.querySelector(".xterm-rows");
      const chip = document.querySelector(".dsp-zoom-chip");
      const term = document.querySelector("#terminal");
      const out = {
        coarse: matchMedia("(pointer: coarse)").matches,
        chipHidden: chip.getAttribute("data-visible") === null,
        touchAction: cs(term).touchAction,
        base: cs(rows()).fontSize,
      };
      const mk = (id, x, y) =>
        new Touch({
          identifier: id,
          target: term,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          radiusX: 1,
          radiusY: 1,
          force: 1,
        });
      const fire = (type, touches, changed) =>
        term.dispatchEvent(
          new TouchEvent(type, {
            touches,
            targetTouches: touches,
            changedTouches: changed || touches,
            bubbles: true,
            cancelable: true,
          }),
        );
      fire("touchstart", [mk(1, 150, 400), mk(2, 250, 400)]);
      await sleepMs(50);
      for (let i = 1; i <= 10; i++) {
        fire("touchmove", [mk(1, 150 - i * 5, 400), mk(2, 250 + i * 5, 400)]);
        await sleepMs(30);
      }
      fire("touchend", [], [mk(1, 100, 400), mk(2, 300, 400)]);
      await sleepMs(800);
      out.afterPinch = {
        chipVisible: chip.getAttribute("data-visible"),
        label: chip.querySelector(".dsp-zoom-chip__level").textContent,
        size: cs(rows()).fontSize,
        zoom: localStorage.getItem("dsp.terminal.zoom"),
      };
      const sel = String(getSelection()).length;
      fire("touchstart", [mk(3, 200, 600)]);
      for (let i = 1; i <= 8; i++) {
        fire("touchmove", [mk(3, 200, 600 - i * 15)]);
        await sleepMs(30);
      }
      fire("touchend", [], [mk(3, 200, 480)]);
      await sleepMs(400);
      out.afterDrag = { selection: String(getSelection()).length - sel };
      const ch = new BroadcastChannel("dsp.terminal-appearance");
      ch.postMessage({
        background: "#004400",
        opacity: 0.93,
        foreground: "#e8e9ea",
        cursor: "#e8e9ea",
        fontFamily: "JetBrains Mono Nerd Font Mono",
        fontSize: 20,
      });
      ch.close();
      await sleepMs(900);
      out.afterApply = {
        label: chip.querySelector(".dsp-zoom-chip__level").textContent,
        size: cs(rows()).fontSize,
        viewport: cs(document.querySelector(".xterm-viewport")).backgroundColor,
        zoom: localStorage.getItem("dsp.terminal.zoom"),
      };
      return out;
    });
    assert.equal(r.coarse, true);
    assert.equal(r.chipHidden, true);
    assert.equal(r.touchAction, "none");
    assert.equal(r.base, "14px");
    assert.equal(r.afterPinch.chipVisible, "true");
    assert.equal(r.afterPinch.label, "140%");
    assert.equal(r.afterPinch.size, "19.6px");
    assert.equal(r.afterDrag.selection, 0);
    assert.equal(r.afterApply.label, "140%");
    assert.equal(r.afterApply.zoom, "1.4");
    assert.equal(r.afterApply.size, "28px");
    assert.equal(r.afterApply.viewport, "rgba(0, 68, 0, 0.93)");
    pass("T7 mobile: pinch, chip, drag, and live apply keep the zoom base");

    const app = await open(`${BASE}/`);
    await sleep(2000);
    const APP_HELPERS = `
      const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms));
      const openCard = async () => {
        localStorage.setItem('dsp.terminal.zoom', '1'); const el = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent === ${JSON.stringify(CARD_TITLE)}); el.click(); await sleepMs(2500); };
      const iframe = () => document.querySelector('iframe[title="Live terminal for E2E-6"]');
      const readIframe = () => { const d = iframe().contentDocument, w = iframe().contentWindow; const cs = (e) => w.getComputedStyle(e); const rows = d.querySelector('.xterm-rows'); return { viewport: cs(d.querySelector('.xterm-viewport')).backgroundColor, fg: cs(rows).color, size: cs(rows).fontSize, font: cs(rows).fontFamily, marker: w.__marker }; };
      const openTab = async () => { if (!document.querySelector('[role=dialog][aria-label=Settings]')) { [...document.querySelectorAll('button,[role=button]')].find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === 'Sync filters').click(); await sleepMs(800); } const dlg = document.querySelector('[role=dialog][aria-label=Settings]'); [...dlg.querySelectorAll('nav[aria-label="Settings sections"] button')].find((b) => b.textContent.trim() === 'Terminal').click(); await sleepMs(600); return dlg; };
      const closeTab = async (dlg) => { [...dlg.querySelectorAll('button')].find((b) => /Back to app/.test(b.textContent)).click(); await sleepMs(500); };
      const setNative = (dlg, label, value, tag = 'input') => { const el = dlg.querySelector('[aria-label="' + label + '"]'); const proto = tag === 'select' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const vals = (dlg) => [...dlg.querySelectorAll('input,select')].map((i) => i.value);
      const saveBtn = (dlg) => [...dlg.querySelectorAll('button')].find((b) => /Save terminal appearance|Saving/.test(b.textContent));
      const cfg = async () => await (await window.__realFetch('/api/config/terminal')).text();
      window.__realFetch = window.__realFetch || window.fetch;
    `;
    const evalApp = (body) =>
      cdp
        .send(
          "Runtime.evaluate",
          {
            expression: `(async () => { ${APP_HELPERS} ${body} })()`,
            returnByValue: true,
            awaitPromise: true,
          },
          app,
        )
        .then(({ result, exceptionDetails }) => {
          if (exceptionDetails)
            throw new Error(
              exceptionDetails.exception?.description ?? exceptionDetails.text,
            );
          return result.value;
        });

    r = await evalApp(`
      await openCard();
      const before = readIframe();
      const dlg = await openTab();
      const prefilled = vals(dlg);
      iframe().contentWindow.__marker = 1;
      setNative(dlg, 'Terminal background color', '#223344'); setNative(dlg, 'Terminal background opacity', '0.8'); setNative(dlg, 'Terminal foreground color', '#ffffff'); setNative(dlg, 'Terminal cursor color', '#00ff00'); setNative(dlg, 'Terminal font family', 'Menlo', 'select'); setNative(dlg, 'Terminal font size in pixels', '16');
      await sleepMs(150);
      const pct = (dlg.textContent.match(/\\d+%/) || [])[0];
      saveBtn(dlg).click();
      await sleepMs(1500);
      return { before, prefilled, pct, closed: !document.querySelector('[role=dialog][aria-label=Settings]'), cfg: JSON.parse(await cfg()), after: readIframe() };
    `);
    assert.equal(r.before.viewport, "rgba(17, 17, 17, 0.93)");
    assert.deepEqual(r.prefilled, [
      "#111111",
      "0.93",
      "#e8e9ea",
      "#e8e9ea",
      "JetBrains Mono Nerd Font Mono",
      "14",
    ]);
    assert.equal(r.pct, "80%");
    assert.equal(r.closed, true);
    assert.deepEqual(r.cfg, {
      background: "#223344",
      opacity: 0.8,
      foreground: "#ffffff",
      cursor: "#00ff00",
      fontFamily: "Menlo",
      fontSize: 16,
    });
    assert.equal(r.after.viewport, "rgba(34, 51, 68, 0.8)");
    assert.equal(r.after.fg, "rgb(255, 255, 255)");
    assert.equal(r.after.size, "16px");
    assert.equal(r.after.marker, 1);
    pass(
      "T8 Settings tab prefills, saves, and restyles the open terminal live",
    );

    r = await evalApp(`
      let dlg = await openTab();
      const prefilled = vals(dlg);
      let puts = 0;
      window.fetch = (u, i) => { if (i && i.method === 'PUT' && String(u).includes('/api/config/terminal')) puts++; return window.__realFetch(u, i); };
      setNative(dlg, 'Terminal font size in pixels', '18');
      await sleepMs(100);
      const b = saveBtn(dlg); b.click(); b.click(); b.click();
      await sleepMs(1500);
      window.fetch = window.__realFetch;
      const doubleClick = { puts, cfgFontSize: JSON.parse(await cfg()).fontSize, size: readIframe().size };
      dlg = await openTab();
      const before = await cfg();
      let reqs = 0;
      window.fetch = (u, i) => { if (i && i.method === 'PUT') reqs++; return window.__realFetch(u, i); };
      setNative(dlg, 'Terminal font size in pixels', '40');
      await sleepMs(150);
      const btn = saveBtn(dlg); btn.click(); await sleepMs(400);
      window.fetch = window.__realFetch;
      const invalid = { alert: dlg.querySelector('[role=alert]')?.textContent || null, disabled: btn.disabled, reqs, unchanged: (await cfg()) === before };
      setNative(dlg, 'Terminal font size in pixels', '14');
      window.fetch = (u, i) => (String(u).includes('/api/config/terminal') && i?.method === 'PUT') ? Promise.resolve(new Response(JSON.stringify({ error: 'simulated rejection' }), { status: 400, headers: { 'Content-Type': 'application/json' } })) : window.__realFetch(u, i);
      const t0 = JSON.stringify(readIframe());
      setNative(dlg, 'Terminal background color', '#445566'); await sleepMs(100); saveBtn(dlg).click(); await sleepMs(1000);
      const forced400 = { notice: [...dlg.querySelectorAll('*')].map((e) => e.textContent.trim()).includes('simulated rejection'), open: !!document.querySelector('[role=dialog][aria-label=Settings]'), terminalUnchanged: JSON.stringify(readIframe()) === t0, unchanged: (await cfg()) === before };
      window.fetch = (u, i) => (String(u).includes('/api/config/terminal') && i?.method === 'PUT') ? Promise.reject(new TypeError('Failed to fetch')) : window.__realFetch(u, i);
      saveBtn(dlg).click(); await sleepMs(1000);
      const network = { notice: [...dlg.querySelectorAll('*')].map((e) => e.textContent.trim()).includes("Couldn't save terminal appearance. Try again."), enabled: !saveBtn(dlg).disabled, unchanged: (await cfg()) === before };
      window.fetch = window.__realFetch;
      await closeTab(dlg);
      window.fetch = (u, i) => (String(u).includes('/api/config/terminal') && (!i || !i.method || i.method === 'GET')) ? Promise.resolve(new Response('boom', { status: 500 })) : window.__realFetch(u, i);
      dlg = await openTab(); await sleepMs(500);
      const getFail = { notice: /Couldn't load the terminal appearance\\. Reopen settings to retry\\./.test(dlg.textContent), saveDisabled: saveBtn(dlg).disabled };
      window.fetch = window.__realFetch;
      await closeTab(dlg); dlg = await openTab();
      getFail.recovered = !/Couldn't load/.test(dlg.textContent) && !saveBtn(dlg).disabled;
      await closeTab(dlg);
      return { prefilled, doubleClick, invalid, forced400, network, getFail };
    `);
    assert.deepEqual(r.prefilled, [
      "#223344",
      "0.8",
      "#ffffff",
      "#00ff00",
      "Menlo",
      "16",
    ]);
    assert.equal(r.doubleClick.puts, 1);
    assert.equal(r.doubleClick.cfgFontSize, 18);
    assert.equal(r.doubleClick.size, "18px");
    assert.equal(
      r.invalid.alert,
      "fontSize must be a whole number between 8 and 32",
    );
    assert.equal(r.invalid.disabled, true);
    assert.equal(r.invalid.reqs, 0);
    assert.equal(r.invalid.unchanged, true);
    assert.deepEqual(r.forced400, {
      notice: true,
      open: true,
      terminalUnchanged: true,
      unchanged: true,
    });
    assert.deepEqual(r.network, {
      notice: true,
      enabled: true,
      unchanged: true,
    });
    assert.deepEqual(r.getFail, {
      notice: true,
      saveDisabled: true,
      recovered: true,
    });
    pass(
      "T9 Settings tab: reopen prefilled, one PUT per burst, invalid disables Save, 400, network, and GET failures leave state untouched",
    );

    console.log(JSON.stringify({ ok: true, passed: results.length }));
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chrome);
    await killAndWait(server);
    try {
      execFileSync("tmux", ["kill-session", "-t", tmuxSession], {
        stdio: "ignore",
      });
    } catch {}
    rmSync(home, { recursive: true, force: true });
    rmSync(chromeDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(
    `FAIL after ${results.length} passing case(s): ${err.stack ?? err}`,
  );
  process.exit(1);
});
