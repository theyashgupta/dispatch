import fs from "node:fs";
import path from "node:path";

const FAKE_CLAUDE_SCRIPT = String.raw`import fs from "node:fs";

const scenarioPath = process.env.FAKE_CLAUDE_SCENARIO;
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

function loadScenario() {
  let text = "";
  try {
    text = fs.readFileSync(scenarioPath, "utf8");
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
  const status = [...(scenario.statusRows ?? [])];
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
  if (text === "/clear") return clearConversation();
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

function keysOf(chunk) {
  const arrows = { A: "up", B: "down", C: "right", D: "left" };
  const keys = [];
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (c === "\x1b") {
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
  try {
    const st = fs.statSync(scenarioPath);
    next = st.mtimeMs + ":" + st.size;
  } catch {
    next = "";
  }
  const warm = isWarming();
  if (next !== stamp) {
    stamp = next;
    loadScenario();
    lastWarm = isWarming();
    render();
  } else if (warm !== lastWarm) {
    lastWarm = warm;
    render();
  }
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
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
 * Write a fake interactive `claude` driven by the scenario file named in `FAKE_CLAUDE_SCENARIO`.
 *
 * @remarks Writes a Node script and an sh launcher named `claude` into `binDir` and returns the
 * launcher path. A scenario file that is not a JSON object is read as the two status rows.
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
