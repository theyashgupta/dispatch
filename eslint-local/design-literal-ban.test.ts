import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lintWithOxlint } from "./oxlint-json.ts";

const root = path.resolve(import.meta.dirname, "..");
const RULES = new Set([
  "syntax/restricted-syntax",
  "syntax/design-restricted-syntax",
]);

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

const fixtureFiles = cases.map(
  ([, filePath], index) =>
    `${path.dirname(filePath)}/__design-ban-${index}${path.extname(filePath)}`,
);

/**
 * Writes each snippet next to its borrowed file, lints them in one oxlint run and removes them again.
 *
 * @remarks Oxlint reads files from disk and picks its rules by path, so each case borrows the folder of a real file. A fixture name that already exists makes the write fail, so a real file is never replaced.
 */
function lintFixtures(): ReturnType<typeof lintWithOxlint> {
  const written: string[] = [];
  try {
    for (const [index, [, , code]] of cases.entries()) {
      fs.writeFileSync(path.join(root, fixtureFiles[index]), code, {
        flag: "wx",
      });
      written.push(fixtureFiles[index]);
    }
    return lintWithOxlint(fixtureFiles);
  } finally {
    for (const file of written)
      fs.rmSync(path.join(root, file), { force: true });
  }
}

const found = lintFixtures();

/**
 * Lists the design ban message openings reported for one fixture file.
 */
function verdict(file: string): string[] {
  const findings = found.get(file) ?? [];
  assert.deepEqual(
    findings.filter((finding) => finding.ruleId === "parse-error"),
    [],
    file,
  );
  return findings
    .filter((finding) => RULES.has(finding.ruleId))
    .map((finding) =>
      finding.message.slice(0, finding.message.indexOf(".") + 1),
    );
}

for (const [index, [name, , , expected]] of cases.entries()) {
  void test(name, () => {
    assert.deepEqual(verdict(fixtureFiles[index]), expected);
  });
}

void test("the board zone ban folder still exists", () => {
  assert.ok(
    fs.existsSync(path.join(root, "src/web/modules/board")),
    "oxlint.config.ts bans reading-surface and --line-body under src/web/modules/board; move the ban with the folder",
  );
});
