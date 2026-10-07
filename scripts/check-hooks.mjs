import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(root, ".claude", "hooks", "pretooluse-rules.mjs");
const stopHook = join(root, ".claude", "hooks", "stop-static-check.mjs");
const formatHook = join(root, ".claude", "hooks", "format-edited-file.mjs");
const DOC = "docs/standards/frontend-architecture.md";

const edit = (path, newString) => ({
  tool_name: "Edit",
  tool_input: {
    file_path: join(root, path),
    old_string: "x",
    new_string: newString,
  },
});

const fixtures = [
  {
    name: "deny: inline style object in a module component",
    payload: edit(
      "src/web/modules/demo/components/X.tsx",
      '<div style={{ gap: 4 }} className="flex" />',
    ),
    deny: ["Tailwind", "The only-shadcn rule"],
  },
  {
    name: "deny: hex colour in a module component",
    payload: edit(
      "src/web/modules/demo/components/Badge.tsx",
      '<span className="text-[#ff0000]" />',
    ),
    deny: ["tokens.css", "The only-shadcn rule"],
  },
  {
    name: "deny: Radix import outside components/ui",
    payload: edit(
      "src/web/modules/demo/components/Menu.tsx",
      'import { DropdownMenu } from "@radix-ui/react-dropdown-menu";',
    ),
    deny: ["Radix", "The only-shadcn rule"],
  },
  {
    name: "deny: new .tsx file outside the allowed folders",
    payload: {
      tool_name: "Write",
      tool_input: {
        file_path: join(root, "src/web/widgets/Panel.tsx"),
        content: "export function Panel() {\n  return null;\n}\n",
      },
    },
    deny: ["routes", "Layer definitions"],
  },
  {
    name: "deny: window.fetch outside a query file",
    payload: edit(
      "src/web/modules/demo/containers/BoardContainer.tsx",
      'const res = await window.fetch("/api/board");',
    ),
    deny: ["query file", "Import matrix"],
  },
  {
    name: "deny: module file outside the six layer folders",
    payload: edit(
      "src/web/modules/demo/utils/format.ts",
      "export const one = 1;",
    ),
    deny: ["index.ts", "Layer definitions"],
  },
  {
    name: "deny: style prop in a web root .tsx file",
    payload: edit("src/web/main.tsx", "<div style={{ gap: 4 }} />"),
    deny: ["Tailwind", "The only-shadcn rule"],
  },
  {
    name: "allow: style prop in a viewer file",
    payload: edit("src/web/viewer/ViewerDoc.tsx", "<h1 style={h1Style} />"),
    pointer: DOC,
  },
  {
    name: "allow: style prop in viewer-main.tsx",
    payload: edit("src/web/viewer-main.tsx", "<p style={bodyStyle} />"),
    pointer: DOC,
  },
  {
    name: "allow: fetch and hex colour in terminal-main.ts",
    payload: edit(
      "src/web/terminal-main.ts",
      'const res = await fetch("/api/terminal"); const bg = "#0b0b0c";',
    ),
    pointer: DOC,
  },
  {
    name: "allow: style prop in a components/ui file",
    payload: edit(
      "src/web/components/ui/progress.tsx",
      "<div style={{ width: 4 }} />",
    ),
    pointer: DOC,
  },
  {
    name: "allow: style prop in a dnd component",
    payload: edit(
      "src/web/modules/board/components/dnd/Overlay.tsx",
      "<div style={{ width: 4 }} />",
    ),
    pointer: DOC,
  },
  {
    name: "allow: hex colour in the web app manifest",
    payload: edit("src/web/public/manifest.json", '"theme_color": "#0b0b0c"'),
    pointer: DOC,
  },
  {
    name: "allow: Radix import inside components/ui",
    payload: edit(
      "src/web/components/ui/dropdown-menu.tsx",
      'import { DropdownMenu } from "radix-ui";',
    ),
    pointer: DOC,
  },
];

/**
 * Run the hook on one payload and return the error list for its fixture.
 */
function check({ payload, deny, pointer }) {
  const run = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  if (run.status !== 0) return [`exit ${run.status}: ${run.stderr}`];
  const out = run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : {};
  const errors = [];
  if (deny) {
    if (out.permissionDecision !== "deny") errors.push("expected deny");
    for (const word of [...deny, DOC]) {
      if (!out.permissionDecisionReason?.includes(word)) {
        errors.push(`reason does not name "${word}"`);
      }
    }
  } else {
    if (out.permissionDecision) {
      errors.push(`expected allow, got ${out.permissionDecision}`);
    }
    if (!out.additionalContext?.includes(pointer)) {
      errors.push(`pointer text does not name "${pointer}"`);
    }
  }
  return errors;
}

const stopCases = [
  {
    name: "stop skip: DISPATCH_SKIP_STOP_CHECK=1",
    env: { DISPATCH_SKIP_STOP_CHECK: "1" },
    payload: { stop_hook_active: false },
    dirty: true,
    block: false,
  },
  {
    name: "stop skip: stop_hook_active is true",
    env: {},
    payload: { stop_hook_active: true },
    dirty: true,
    block: false,
  },
  {
    name: "stop skip: bad input exits 0 and runs no check",
    env: {},
    payload: "not json",
    dirty: true,
    block: false,
  },
  {
    name: "stop skip: working tree has no changes",
    env: {},
    payload: { stop_hook_active: false },
    dirty: false,
    block: false,
  },
  {
    name: "stop skip: a check past the timeout is killed and allows the stop",
    env: { DISPATCH_STOP_CHECK_TIMEOUT_MS: "500" },
    payload: { stop_hook_active: false },
    dirty: true,
    block: false,
    scripts: { "format:check": "sleep 5; exit 1" },
  },
  {
    name: "stop block: changes and no skip run the failing check",
    env: {},
    payload: { stop_hook_active: false },
    dirty: true,
    block: true,
  },
];

/**
 * Run the Stop hook in a scratch git repository and return the error list for one case.
 *
 * @remarks
 * The scratch repository has no npm scripts, so a guard that does not skip makes the hook exit 2.
 */
function checkStop({ env, payload, dirty, block, scripts }) {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-stop-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    if (scripts) {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
    }
    if (dirty) writeFileSync(join(dir, "change.txt"), "x\n");
    const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: dir };
    delete childEnv.DISPATCH_SKIP_STOP_CHECK;
    const run = spawnSync(process.execPath, [stopHook], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
      env: { ...childEnv, ...env },
    });
    if (block) {
      return run.status === 2 && run.stderr.includes("static checks failed")
        ? []
        : [`expected exit 2 with the check tail, got exit ${run.status}`];
    }
    return run.status === 0 && !run.stdout && !run.stderr
      ? []
      : [`expected a silent exit 0, got exit ${run.status}: ${run.stderr}`];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run the formatter hook on a config file, a `.claude/` file and a control source file in a scratch project.
 *
 * @remarks
 * The scratch project links the repo `node_modules`, so the control file proves prettier ran and the skipped files prove the skip list.
 */
function checkFormatter() {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-format-"));
  try {
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    mkdirSync(join(dir, ".claude"));
    const files = [
      ["package.yaml", "a:   1\n", false],
      [".claude/x.mjs", "const  a =  1\n", false],
      ["src.ts", "const  a =  1\n", true],
    ];
    const errors = [];
    for (const [path, text, formatted] of files) {
      writeFileSync(join(dir, path), text);
      const run = spawnSync(process.execPath, [formatHook], {
        input: JSON.stringify({
          tool_name: "Edit",
          tool_input: { file_path: join(dir, path) },
        }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      });
      const changed = readFileSync(join(dir, path), "utf8") !== text;
      if (run.status !== 0) errors.push(`${path}: exit ${run.status}`);
      if (changed !== formatted) {
        errors.push(
          `${path}: expected ${formatted ? "formatted" : "untouched"}`,
        );
      }
    }
    return errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let failed = 0;
const cases = [
  ...fixtures.map((fixture) => [fixture, check]),
  ...stopCases.map((stopCase) => [stopCase, checkStop]),
  [
    {
      name: "format skip: config and .claude files untouched, source formatted",
    },
    checkFormatter,
  ],
];
for (const [fixture, run] of cases) {
  const errors = run(fixture);
  if (errors.length > 0) failed += 1;
  console.log(
    `${errors.length ? "FAIL" : "ok  "} ${fixture.name}${errors.length ? `: ${errors.join("; ")}` : ""}`,
  );
}
console.log(
  failed
    ? `FAIL: ${failed} of ${cases.length} hook cases`
    : `PASS: ${fixtures.length} PreToolUse fixtures, ${stopCases.length} Stop cases, 1 formatter case`,
);
process.exit(failed ? 1 : 0);
