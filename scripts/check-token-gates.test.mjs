import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { reconcile, scanFile } from "./check-token-gates.mjs";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-token-gates.mjs",
);
const scratch = [];

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * Make a scratch directory that the `after` hook removes.
 */
function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), "check-token-gates-test-"));
  scratch.push(dir);
  return dir;
}

/**
 * Reduce violations to the kind and match pairs a fixture asserts on.
 */
function hits(path, text) {
  return scanFile(path, text).map(({ kind, match }) => ({ kind, match }));
}

const failCases = [
  ["a.css", "a { color: #fff; }", "colour-literal", "#fff"],
  ["a.css", "a { background: rgba(0, 0, 0, 0.4); }", "colour-literal", "rgba("],
  ["a.tsx", '<div className="p-[13px]" />', "value-bracket", "p-[13px]"],
  ["a.tsx", '<div className="[--x:0px]" />', "value-bracket", "[--x:0px]"],
  [
    "a.tsx",
    '<div className="data-[state=open]:animate-[spin_1s_linear]" />',
    "value-bracket",
    "animate-[spin_1s_linear]",
  ],
  ["a.css", "a { font-size: 13px; }", "raw-font-size", "font-size: 13px"],
  ["a.css", ".v { --font-body: 15px; }", "raw-font-size", "--font-body: 15px"],
  ["a.tsx", '<p className="text-[13px]" />', "raw-font-size", "text-[13px]"],
  ["a.css", "a { transition: color 150ms ease; }", "raw-motion", "150ms"],
  [
    "a.css",
    "a { transition-timing-function: cubic-bezier(0, 0, 1, 1); }",
    "raw-motion",
    "cubic-bezier(",
  ],
  ["a.ts", 'const t = "200ms";', "raw-motion", "200ms"],
  ["a.tsx", '<div className="duration-150" />', "raw-motion", "duration-150"],
  ["a.css", "a { color: hsl(0 0% 0%); }", "colour-literal", "hsl("],
  ["a.css", "a { color: oklch(0.5 0.1 200); }", "colour-literal", "oklch("],
  ["a.css", "a { color: color(srgb 1 0 0); }", "colour-literal", "color("],
  [
    "a.tsx",
    '<div className="bg-[#fff]/50" />',
    "value-bracket",
    "bg-[#fff]/50",
  ],
  [
    "a.tsx",
    '<div className="bg-black/[0.5]" />',
    "value-bracket",
    "bg-black/[0.5]",
  ],
  ["a.css", "a { font: 13px/1.4 x; }", "raw-font-size", "font: 13px/1.4 x"],
  [
    "a.css",
    "a { font-size: clamp(12px, 2vw, 16px); }",
    "raw-font-size",
    "font-size: clamp(12px, 2vw, 16px)",
  ],
  [
    "a.tsx",
    '<div className="duration-[150ms]" />',
    "value-bracket",
    "duration-[150ms]",
  ],
];

for (const [path, text, kind, match] of failCases) {
  test(`flags ${match} as ${kind} in ${path}`, () => {
    assert.deepEqual(hits(path, text), [{ kind, match }]);
  });
}

test("flags a colour inside an html style block with the file line", () => {
  const html =
    "<html>\n<head>\n<style>body { color: #e8e9ea; }</style>\n</head>";
  assert.deepEqual(scanFile("a.html", html), [
    { path: "a.html", line: 3, kind: "colour-literal", match: "#e8e9ea" },
  ]);
});

test("reports the line of a class string in a tsx file", () => {
  const tsx = 'const a = 1;\nconst b = <div className="p-[13px]" />;\n';
  assert.equal(scanFile("a.tsx", tsx)[0].line, 2);
});

test("reports the line of a token inside a multi-line template literal", () => {
  const tsx = "const a = `p-2\nm-[2px]`;\n";
  assert.deepEqual(scanFile("a.tsx", tsx), [
    { path: "a.tsx", line: 2, kind: "value-bracket", match: "m-[2px]" },
  ]);
});

const passCases = [
  ["a.css", "a { color: transparent; }"],
  ["a.css", "a { color: currentColor; }"],
  ["a.css", "a { color: inherit; }"],
  ["a.css", "a { font-size: 0; }"],
  ["a.css", ":root { --font-weight-bold: 700; }"],
  ["a.css", "a:not(#add) { margin: 0; }"],
  ["a.css", ".a:hover #face-menu { margin: 0; }"],
  ["a.css", "a { background: url(#abc); }"],
  ["a.css", 'a::before { content: "#fff"; }'],
  ["src/web/styles/tokens.css", ":root { --x: #fff; }"],
  ["a.tsx", '<div className="data-[state=open]:p-2" />'],
  ["a.tsx", '<div className="[&>svg]:size-4" />'],
  ["a.tsx", '<div className="p-(--space-sm)" />'],
  ["a.tsx", '<p className="text-(length:--font-display)" />'],
  ["a.tsx", '<div className="has-[>svg]:px-2.5" />'],
  ["a.ts", "// #fff 200ms\nconst a = 1;"],
  ["a.ts", "/* #fff 200ms */\nconst a = 1;"],
  ["a.ts", "setTimeout(fn, 200);"],
  ["a.css", "#root { margin: 0; }"],
  ["a.css", "a { background: color-mix(in srgb, var(--a) 16%, transparent); }"],
  ["a.css", "a { font-size: var(--font-body); }"],
];

for (const [path, text] of passCases) {
  test(`passes ${text}`, () => {
    assert.deepEqual(scanFile(path, text), []);
  });
}

const violation = {
  path: "src/web/a.tsx",
  line: 1,
  kind: "value-bracket",
  match: "p-[3px]",
};

test("reconcile drops an allowlisted violation", () => {
  const result = reconcile([violation], "src/web/a.tsx\tp-[3px]\twhy\n");
  assert.deepEqual(result, { remaining: [], stale: [], errors: [] });
});

test("reconcile keeps an unlisted violation", () => {
  const result = reconcile([violation], "");
  assert.deepEqual(result.remaining, [violation]);
});

test("reconcile reports an entry that matches nothing as stale", () => {
  const result = reconcile([], "src/web/a.tsx\tp-[3px]\twhy\n");
  assert.deepEqual(result.stale, [
    { line: 1, path: "src/web/a.tsx", match: "p-[3px]" },
  ]);
});

test("reconcile reports an empty reason", () => {
  const result = reconcile([violation], "src/web/a.tsx\tp-[3px]\t \n");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 1);
});

test("reconcile reports a line without three fields", () => {
  const result = reconcile([], "src/web/a.tsx\tp-[3px]\n");
  assert.equal(result.errors.length, 1);
});

test("reconcile reports a duplicate entry", () => {
  const text = "src/web/a.tsx\tp-[3px]\twhy\nsrc/web/a.tsx\tp-[3px]\tagain\n";
  const result = reconcile([violation], text);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
});

test("reconcile ignores comment and blank lines", () => {
  const text = "# header\n\nsrc/web/a.tsx\tp-[3px]\twhy\n";
  assert.deepEqual(reconcile([violation], text), {
    remaining: [],
    stale: [],
    errors: [],
  });
});

/**
 * Build a scratch repo with one component, an exempt tokens file, an exempt test file and an allowlist.
 */
function makeTree(component, allowlist) {
  const dir = scratchDir();
  mkdirSync(join(dir, "src/web/styles"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "src/web/a.tsx"), component);
  writeFileSync(join(dir, "src/web/styles/tokens.css"), ":root { --x: #fff; }");
  writeFileSync(join(dir, "src/web/a.test.tsx"), '<div className="p-[9px]" />');
  writeFileSync(join(dir, "scripts/check-token-gates.allowlist"), allowlist);
  return dir;
}

function runGate(dir) {
  return spawnSync(process.execPath, [scriptPath, "--root", dir], {
    encoding: "utf8",
  });
}

const bracketComponent =
  'export const A = () => <div className="p-[3px]" />;\n';

test("cli passes when the allowlist covers every violation", () => {
  const dir = makeTree(
    bracketComponent,
    "# header\nsrc/web/a.tsx\tp-[3px]\twhy\n",
  );
  const run = runGate(dir);
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /^PASS: token-gates clean/m);
});

test("cli fails with a path:line report when the allowlist is empty", () => {
  const run = runGate(makeTree(bracketComponent, ""));
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^src\/web\/a\.tsx:1: value-bracket: p-\[3px\]$/m);
  assert.match(run.stdout, /^FAIL: token-gates/m);
});

test("cli fails on a stale entry", () => {
  const dir = makeTree(
    bracketComponent,
    "src/web/a.tsx\tp-[3px]\twhy\nsrc/web/a.tsx\tp-[7px]\twhy\n",
  );
  const run = runGate(dir);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /stale: src\/web\/a\.tsx p-\[7px\]/);
});

test("cli fails on an empty reason", () => {
  const run = runGate(makeTree(bracketComponent, "src/web/a.tsx\tp-[3px]\t\n"));
  assert.equal(run.status, 1);
  assert.match(run.stdout, /error: empty reason/);
});

test("cli fails on a new violation beside an allowlisted one", () => {
  const dir = makeTree(
    'export const A = () => <div className="p-[3px] m-[5px]" />;\n',
    "src/web/a.tsx\tp-[3px]\twhy\n",
  );
  const run = runGate(dir);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /value-bracket: m-\[5px\]/);
  assert.doesNotMatch(run.stdout, /p-\[3px\]/);
});

test("cli reports every violation class", () => {
  const dir = makeTree(
    'export const A = () => <div className="m-[5px] duration-150 text-[13px]" />;\n',
    "",
  );
  writeFileSync(join(dir, "src/web/b.css"), "a { color: #fff; }");
  const run = runGate(dir);
  assert.equal(run.status, 1);
  for (const kind of [
    "colour-literal",
    "value-bracket",
    "raw-font-size",
    "raw-motion",
  ])
    assert.match(run.stdout, new RegExp(kind));
});

test("cli exits 2 with usage when --root has no value", () => {
  const run = spawnSync(process.execPath, [scriptPath, "--root"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^usage: node scripts\/check-token-gates\.mjs/);
});

test("cli exits 2 when --root is not an existing directory", () => {
  const run = runGate(join(scratchDir(), "missing"));
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^usage:/);
});
