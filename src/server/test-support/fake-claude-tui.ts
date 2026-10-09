import fs from "node:fs";
import path from "node:path";

const FAKE_CLAUDE_SCRIPT = String.raw`import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

if (process.argv[2] === "--version") {
  process.stdout.write("2.1.999 (fake)\n");
  process.exit(0);
}

if (process.argv[2] === "auth") {
  process.stdout.write(JSON.stringify({ loggedIn: false }) + "\n");
  process.exit(0);
}

if (process.argv[2] === "mcp" && process.argv[3] === "list") {
  process.stdout.write("No MCP servers configured. Use \`claude mcp add\` to add a server.\n");
  process.exit(0);
}

process.stdout._handle?.setBlocking?.(false);

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => process.exit(0));
}

const startedAt = Date.now();
let scenario = {};
let stamp = "";
let input = "";
let shown = [];
let dialog = null;
let lastWarm = null;
let droppedEnters = 0;
let transcriptFile = null;
let clearedAt = 0;
let statusOverride = null;
let replayStage = 0;
let wasCleared = false;
let replayChain = Promise.resolve();
let replayStopped = false;
let replayStep = 0;
let mcp = null;
const saved = {};
const waiters = [];

function scenarioPath() {
  const dir = process.env.FAKE_CLAUDE_SCENARIO_DIR;
  if (dir) {
    const card = process.env.DISPATCH_CARD_ID;
    const own = card && path.basename(card) === card ? path.join(dir, card + ".json") : "";
    if (own && fs.existsSync(own)) return own;
    const fallback = path.join(dir, "default.json");
    if (fs.existsSync(fallback)) return fallback;
  }
  return process.env.FAKE_CLAUDE_SCENARIO;
}

function loadScenario(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    scenario = parsed;
  } else {
    const trimmed = text.replace(/\n+$/, "");
    scenario = { statusRows: trimmed === "" ? [] : trimmed.split("\n") };
  }
  const d = scenario.dialog;
  dialog = d
    ? { title: d.title, rows: d.rows, cursor: d.cursor ?? 0, jumpTo: d.jumpTo }
    : null;
}

function isWarming() {
  return Date.now() - startedAt < (scenario.warmingUpMs ?? 0);
}

function render() {
  const status = [...(statusOverride ?? scenario.statusRows ?? [])];
  if (isWarming()) status[0] = "warming up";
  const lines = [...(scenario.transcript ?? []), ...shown];
  if (dialog) {
    lines.push(dialog.title);
    dialog.rows.forEach((row, i) => {
      lines.push((i === dialog.cursor ? "❯ " : "  ") + row);
    });
  } else {
    lines.push("");
  }
  lines.push((scenario.prompt ?? "❯ ") + input, "", ...status);
  process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n"));
}

function logKey(key) {
  if (!scenario.keyLogPath) return;
  const row = dialog ? dialog.rows[dialog.cursor] ?? "" : "";
  const entry = { key, row, at: new Date().toISOString() };
  fs.appendFileSync(scenario.keyLogPath, JSON.stringify(entry) + "\n");
}

function logStatus(rows) {
  if (!scenario.statusLogPath) return;
  const entry = { rows, at: new Date().toISOString() };
  fs.appendFileSync(scenario.statusLogPath, JSON.stringify(entry) + "\n");
}

function clearConversation() {
  shown = [];
  input = "";
  if (scenario.transcriptDir) {
    transcriptFile =
      scenario.transcriptDir + "/" + Date.now().toString(36) + "-fresh.jsonl";
    clearedAt = 1;
  }
}

function writeEngineSessionId() {
  const file = transcriptFile ?? scenario.transcriptPath;
  if (!scenario.engineFile || !file) return;
  const id = file.split("/").pop().replace(/\.jsonl$/, "");
  const text = fs.readFileSync(scenario.engineFile, "utf8");
  fs.writeFileSync(
    scenario.engineFile,
    text.replace(/^session_id:.*$/m, "session_id: " + id),
  );
}

function submit() {
  const text = input;
  if (text === "") return;
  notifyWaiters(text);
  if (text === "/clear") {
    wasCleared = true;
    return clearConversation();
  }
  const reply = scenario.reply ?? "ok";
  const file = transcriptFile ?? scenario.transcriptPath;
  if (file) {
    const user = {
      type: "user",
      message: { role: "user", content: text },
      timestamp: new Date().toISOString(),
    };
    const assistant = {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: reply }] },
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(
      file,
      JSON.stringify(user) + "\n" + JSON.stringify(assistant) + "\n",
    );
  }
  shown.push("> " + text, "● " + reply);
  input = "";
  if (clearedAt === 1) {
    clearedAt = 2;
    writeEngineSessionId();
  }
  triggerReplay();
}

function mcpConfigArg() {
  const at = process.argv.indexOf("--mcp-config");
  return at === -1 ? undefined : process.argv[at + 1];
}

function triggerReplay() {
  const replay = mcpConfigArg() && scenario.replay ? scenario.replay : scenario.loop;
  if (!replay || typeof replay !== "object") return;
  if (replayStage === 0) {
    replayStage = 1;
    queueSteps("onStart", replay.onStart);
  } else if (replayStage === 1 && wasCleared) {
    replayStage = 2;
    queueSteps("afterClear", replay.afterClear);
  }
}

function queueSteps(phase, steps) {
  if (!Array.isArray(steps) || steps.length === 0) return;
  replayChain = replayChain.then(() => runSteps(phase, steps));
}

function replayLog(entry) {
  if (!scenario.replayLogPath) return;
  const row = { ...entry, at: new Date().toISOString() };
  fs.appendFileSync(scenario.replayLogPath, JSON.stringify(row) + "\n");
}

function lookup(ref) {
  const [name, ...path] = ref.split(".");
  if (name === "env") return process.env["REPLAY_" + path.join(".")];
  let value = saved[name];
  for (const seg of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = value[seg];
  }
  return value;
}

const REF = /\$([A-Za-z_]\w*(?:\.\w+)+)/g;

function expand(value) {
  if (typeof value === "string") {
    const whole = value.match(/^\$([A-Za-z_]\w*(?:\.\w+)+)$/);
    const need = (ref) => {
      const found = lookup(ref);
      if (found === undefined) throw new Error("unresolved reference $" + ref);
      return found;
    };
    if (whole) return need(whole[1]);
    return value.replace(REF, (_, ref) => String(need(ref)));
  }
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, expand(v)]),
    );
  }
  return value;
}

function notifyWaiters(text) {
  for (const waiter of waiters.splice(0)) {
    if (waiter.re.test(text)) waiter.resolve();
    else waiters.push(waiter);
  }
}

function waitForKeys(step) {
  const re = new RegExp(step.waitKeys);
  const timeoutMs = step.timeoutMs ?? 60000;
  return new Promise((resolve, reject) => {
    const waiter = {
      re,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      const at = waiters.indexOf(waiter);
      if (at !== -1) waiters.splice(at, 1);
      reject(new Error("waitKeys timed out after " + timeoutMs + " ms"));
    }, timeoutMs);
    waiters.push(waiter);
  });
}

function writeFileStep(step, append) {
  const rel = append ? step.appendFile : step.writeFile;
  if (typeof rel !== "string" || rel === "") {
    throw new Error("path must be a non-empty string");
  }
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, rel);
  if (path.isAbsolute(rel) || path.relative(cwd, resolved).startsWith("..")) {
    throw new Error("path leaves the working folder: " + rel);
  }
  const content = String(expand(step.content ?? ""));
  const realCwd = fs.realpathSync(cwd);
  let walked = cwd;
  for (const part of path.relative(cwd, resolved).split(path.sep)) {
    walked = path.join(walked, part);
    let stat;
    try {
      stat = fs.lstatSync(walked);
    } catch {
      break;
    }
    if (!stat.isSymbolicLink()) continue;
    let real;
    try {
      real = fs.realpathSync(walked);
    } catch {
      throw new Error("path leaves the working folder: " + rel);
    }
    if (path.relative(realCwd, real).startsWith("..")) {
      throw new Error("path leaves the working folder: " + rel);
    }
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  if (append) fs.appendFileSync(resolved, content);
  else fs.writeFileSync(resolved, content);
  return { path: rel, bytes: Buffer.byteLength(content) };
}

async function reportStep(step) {
  const port = process.env.DISPATCH_HOOK_PORT;
  const token = process.env.DISPATCH_HOOK_TOKEN;
  if (!port || !token) {
    throw new Error("DISPATCH_HOOK_PORT and DISPATCH_HOOK_TOKEN are required");
  }
  const res = await fetch("http://127.0.0.1:" + port + "/api/loops/report", {
    method: "POST",
    headers: { "content-type": "application/json", "x-dispatch-token": token },
    body: JSON.stringify(step.report),
    signal: AbortSignal.timeout(5000),
  });
  if (res.status !== 202) throw new Error("report answered " + res.status);
  return { status: res.status };
}

const ACTIONS = {
  writeFile: (step) => writeFileStep(step, false),
  appendFile: (step) => writeFileStep(step, true),
  report: reportStep,
  waitKeys: waitForKeys,
};

async function actionStep(type, step) {
  const entry = { step: ++replayStep, type };
  try {
    const detail = await ACTIONS[type](step);
    replayLog({ ...entry, ok: true, ...detail });
    shown.push("⏺ " + type + " ok");
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    replayLog({ ...entry, ok: false, reason: reason.slice(0, 300) });
    shown.push("⏺ " + type + " FAILED " + reason);
    return false;
  }
}

function mcpSend(client, method, params, timeoutMs) {
  const id = client.nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id);
      reject(new Error(method + " timed out after " + timeoutMs + " ms"));
    }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    client.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
  });
}

function openMcp() {
  if (mcp) return mcp;
  mcp = (async () => {
    const config = JSON.parse(fs.readFileSync(mcpConfigArg(), "utf8"));
    const server = config.mcpServers.dispatch;
    const child = spawn(server.command, server.args ?? [], {
      env: process.env,
      cwd: scenario.replay.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    const client = { child, nextId: 1, pending: new Map() };
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const waiting = client.pending.get(message.id);
        if (!waiting) continue;
        client.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new Error(message.error.message));
        else waiting.resolve(message.result);
      }
    });
    child.on("exit", () => {
      for (const waiting of client.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("mcp server exited"));
      }
      client.pending.clear();
    });
    child.stdin.on("error", () => undefined);
    process.on("exit", () => child.kill());
    await mcpSend(
      client,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "fake-claude", version: "1" },
      },
      scenario.replay.initTimeoutMs ?? 30000,
    );
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    return client;
  })();
  return mcp;
}

function expectationMet(expect, isError, text) {
  const want = expect?.isError ?? false;
  if (isError !== want) return false;
  return expect?.contains === undefined || text.includes(expect.contains);
}

async function callStep(step) {
  const n = ++replayStep;
  const entry = { step: n, tool: step.tool };
  let text = "";
  try {
    const args = expand(step.args ?? {});
    const expect = step.expect ? expand(step.expect) : undefined;
    const client = await openMcp();
    const result = await mcpSend(
      client,
      "tools/call",
      { name: step.tool, arguments: args },
      step.timeoutMs ?? 70000,
    );
    text = result.content?.find((c) => c.type === "text")?.text ?? "";
    const isError = result.isError === true;
    let met = expectationMet(expect, isError, text);
    let reason = met ? "" : "expectation not met";
    if (met && step.saveAs) {
      try {
        saved[step.saveAs] = JSON.parse(text);
      } catch {
        met = false;
        reason = "saveAs needs a JSON result";
      }
    }
    replayLog({
      ...entry,
      ok: true,
      isError,
      expectMet: met,
      excerpt: text.slice(0, 300),
    });
    shown.push("⏺ " + step.tool + (met ? " ok" : " FAILED " + reason));
    return met;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    replayLog({
      ...entry,
      ok: false,
      isError: true,
      expectMet: false,
      excerpt: reason.slice(0, 300),
    });
    shown.push("⏺ " + step.tool + " FAILED " + reason);
    return false;
  }
}

async function runSteps(phase, steps) {
  if (replayStopped) return;
  for (const step of steps) {
    if (step.tool) {
      const met = await callStep(step);
      render();
      if (!met) return halt(phase);
    } else if (typeof step.print === "string") {
      shown.push(step.print);
      render();
    } else if (Array.isArray(step.statusRows)) {
      statusOverride = step.statusRows;
      logStatus(step.statusRows);
      render();
    } else if (typeof step.sleepMs === "number") {
      await new Promise((r) => setTimeout(r, step.sleepMs));
    } else {
      const type = Object.keys(ACTIONS).find((name) => name in step);
      if (!type) continue;
      const ok = await actionStep(type, step);
      render();
      if (!ok) return halt(phase);
    }
  }
  replayLog({ done: true, phase });
}

function halt(phase) {
  replayStopped = true;
  replayLog({ done: true, phase, stopped: true });
}

function handleKey(key) {
  if (key === "ctrl-c") process.exit(0);
  if (scenario.logAllKeys && !dialog) logKey(key);
  if (isWarming()) return;
  if (dialog) {
    if (key === "up") dialog.cursor = Math.max(0, dialog.cursor - 1);
    if (key === "down") {
      dialog.cursor = Math.min(dialog.rows.length - 1, dialog.cursor + 1);
    }
    if ((key === "up" || key === "down") && dialog.jumpTo !== undefined) {
      dialog.cursor = dialog.jumpTo;
    }
    logKey(key);
    if (key === "enter") dialog = null;
    return;
  }
  if (key === "enter") {
    if (droppedEnters < (scenario.dropEnters ?? 0)) droppedEnters++;
    else submit();
  } else if (key === "ctrl:21") input = "";
  else if (key === "backspace") input = input.slice(0, -1);
  else if (key.startsWith("char:")) input += key.slice(5);
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
let pasting = false;
let carry = "";

function keysOf(data) {
  const arrows = { A: "up", B: "down", C: "right", D: "left" };
  const keys = [];
  let chunk = carry + data;
  carry = "";
  const marker = pasting ? PASTE_END : PASTE_START;
  for (let n = marker.length - 1; n >= (pasting ? 1 : 3); n--) {
    if (chunk.endsWith(marker.slice(0, n))) {
      carry = chunk.slice(-n);
      chunk = chunk.slice(0, -n);
      break;
    }
  }
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (chunk.startsWith(pasting ? PASTE_END : PASTE_START, i)) {
      pasting = !pasting;
      i += PASTE_START.length - 1;
    } else if (pasting) keys.push("char:" + (c === "\r" ? "\n" : c));
    else if (c === "\x1b") {
      const arrow = chunk[i + 1] === "[" ? arrows[chunk[i + 2]] : undefined;
      if (arrow) {
        keys.push(arrow);
        i += 2;
      } else {
        keys.push("esc");
      }
    } else if (c === "\r" || c === "\n") keys.push("enter");
    else if (c === "\x7f" || c === "\b") keys.push("backspace");
    else if (c === "\x03") keys.push("ctrl-c");
    else if (c === "\t") keys.push("tab");
    else if (c < " ") keys.push("ctrl:" + c.charCodeAt(0));
    else keys.push("char:" + c);
  }
  return keys;
}

function tick() {
  let next = "";
  const file = scenarioPath();
  try {
    const st = fs.statSync(file);
    next = file + ":" + st.mtimeMs + ":" + st.size;
  } catch {
    next = "";
  }
  const warm = isWarming();
  if (next !== stamp) {
    stamp = next;
    loadScenario(file);
    lastWarm = isWarming();
    render();
  } else if (warm !== lastWarm) {
    lastWarm = warm;
    render();
  }
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write("\x1b[?2004h");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const key of keysOf(chunk)) handleKey(key);
  render();
});
process.stdin.resume();
tick();
setInterval(tick, 300);
`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Write a fake interactive `claude` that reads its scenario from `FAKE_CLAUDE_SCENARIO_DIR` or `FAKE_CLAUDE_SCENARIO`.
 *
 * @remarks Lookup order is `<dir>/<DISPATCH_CARD_ID>.json`, `<dir>/default.json`, then the variable. A `loop` scenario writes only inside its cwd and reports to the hook port, and the fake is test-only. The fake sets its stdout non-blocking because a blocking write stalls on a full pty during a large paste.
 */
export function writeFakeClaudeTui(binDir: string): string {
  const script = path.join(binDir, "fake-claude-tui.mjs");
  fs.writeFileSync(script, FAKE_CLAUDE_SCRIPT);
  const launcher = path.join(binDir, "claude");
  fs.writeFileSync(
    launcher,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)} "$@"\n`,
    { mode: 0o755 },
  );
  return launcher;
}
