import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";

const root = path.resolve(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: root });
const RULES = new Set(["no-restricted-syntax", "design/restricted-syntax"]);

const board = "src/web/modules/board/components/CardView.tsx";
const boardTs = "src/web/modules/board/domain/board-keys.ts";
const detail = "src/web/modules/detail/components/PanelFrame.tsx";
const ui = "src/web/components/ui/item.tsx";
const shared = "src/shared/agent-prompt.ts";

const shadowClass = "Do not write an arbitrary shadow class.";
const weightClass = "Do not write a weight 800 class.";
const readingSurface =
  "Do not use the reading-surface class in the board module.";
const lineBody = "Do not redefine --line-body in the board module.";
const focusShadow = "Do not draw keyboard focus with an accent box-shadow.";
const floatShadow = "Do not write the float shadow value.";
const weight800 = "Do not write font weight 800.";

/**
 * Lints one snippet as the content of an existing repo file and lists the design ban message openings.
 *
 * @remarks The type-aware parser needs a path the project service knows, so each case borrows a real file path; lintText never writes it.
 */
async function verdict(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, filePath),
  });
  assert.equal(result.fatalErrorCount, 0, filePath);
  return result.messages
    .filter((message) => message.ruleId && RULES.has(message.ruleId))
    .map((message) =>
      message.message.slice(0, message.message.indexOf(".") + 1),
    );
}

const cases: [string, string, string, string[]][] = [
  [
    "arbitrary shadow class",
    detail,
    `export const c = "shadow-[0_6px_16px_black]";\n`,
    [shadowClass],
  ],
  [
    "variant shadow class",
    detail,
    `export const c = "hover:shadow-[0_0_0_2px_var(--accent)]";\n`,
    [shadowClass],
  ],
  [
    "drop shadow class",
    detail,
    `export const c = "drop-shadow-[0_1px_1px_black]";\n`,
    [shadowClass],
  ],
  [
    "shadow class in a template",
    detail,
    "export const c = (x: string) => `shadow-[${x}]`;\n",
    [shadowClass],
  ],
  [
    "font-extrabold",
    detail,
    `export const c = "text-lg font-extrabold";\n`,
    [weightClass],
  ],
  ["font-[800]", detail, `export const c = "font-[800]";\n`, [weightClass]],
  [
    "token shadow and weight classes",
    detail,
    `export const c = "shadow-lg shadow-(--shadow-float) font-semibold";\n`,
    [],
  ],
  [
    "shadow class in components/ui",
    ui,
    `export const c = "shadow-[inset_0_0_0_1px_var(--accent)] font-extrabold";\n`,
    [],
  ],
  [
    "reading-surface in the board",
    board,
    `export const c = "reading-surface flex";\n`,
    [readingSurface],
  ],
  [
    "reading-surface outside the board",
    detail,
    `export const c = "reading-surface flex";\n`,
    [],
  ],
  [
    "--line-body class declaration in the board",
    board,
    `export const c = "[--line-body:1.6]";\n`,
    [lineBody],
  ],
  [
    "--line-body object key in the board",
    boardTs,
    `export const c = { "--line-body": "1.6" };\n`,
    [lineBody],
  ],
  [
    "--line-body read in the board",
    board,
    `export const c = "leading-(--line-body) [line-height:var(--line-body)]";\n`,
    [],
  ],
  [
    "accent focus shadow value in components/ui",
    ui,
    `export const c = { boxShadow: "0 0 0 2px var(--accent)" };\n`,
    [focusShadow],
  ],
  [
    "float shadow value in src/shared",
    shared,
    `export const c = "0 6px 16px rgba(0, 0, 0, 0.45)";\n`,
    [floatShadow],
  ],
  [
    "fontWeight 800 in components/ui",
    ui,
    `export const c = [{ fontWeight: 800 }, { fontWeight: "800" }];\n`,
    [weight800, weight800],
  ],
  [
    "other font weights",
    ui,
    `export const c = [{ fontWeight: 600 }, { fontWeight: 8000 }];\n`,
    [],
  ],
  [
    "fontWeight 800 behind as const or satisfies",
    ui,
    `export const c = [{ fontWeight: 800 as const }, { fontWeight: 800 satisfies number }];\n`,
    [weight800, weight800],
  ],
  [
    "fontWeight 800 under a quoted key",
    ui,
    `export const c = { "fontWeight": 800 };\n`,
    [weight800],
  ],
  [
    "800 on a sibling key of fontWeight",
    ui,
    `export const c = { fontWeight: 700, x: 800 };\n`,
    [],
  ],
];

for (const [name, filePath, code, expected] of cases) {
  void test(name, async () => {
    assert.deepEqual(await verdict(filePath, code), expected);
  });
}

void test("the board zone ban folder still exists", () => {
  assert.ok(
    fs.existsSync(path.join(root, "src/web/modules/board")),
    "eslint.config.ts bans reading-surface and --line-body under src/web/modules/board; move the ban with the folder",
  );
});
