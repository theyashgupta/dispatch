import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL(".", import.meta.url);
const stringLiteral = /"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const cancelToken = /^(?:[^\s:]+:)*!?outline-(?:none|hidden)!?$/;
const paintToken = /^((?:[^\s:]+:)*)!?outline(?:-\d+)?!?$/;

/**
 * Lists class string literals whose keyboard outline never paints.
 *
 * @remarks
 * Tailwind v4 `outline-none` and `outline-hidden` set the Tailwind outline-style variable to none, and an outline
 * width utility reads that variable, so the width applies with no visible style. Each paint
 * token needs an exact `<variant>outline-solid` token in the same literal, including when
 * the class string spans several lines.
 */
function cancelledOutlines(): string[] {
  const hits: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    for (const match of source.matchAll(stringLiteral)) {
      const tokens = match[0].slice(1, -1).split(/\s+/);
      if (!tokens.some((token) => cancelToken.test(token))) continue;
      for (const token of tokens) {
        const variant = paintToken.exec(token)?.[1];
        if (
          variant !== undefined &&
          !tokens.includes(`${variant}outline-solid`)
        ) {
          const line = source.slice(0, match.index).split("\n").length;
          hits.push(`${file}:${line} ${token}`);
        }
      }
    }
  }
  return hits;
}

test("every primitive that hides the outline restores a solid one on focus-visible", () => {
  assert.deepEqual(cancelledOutlines(), []);
});

const ringToken = /^(?:[^\s:]+:)*!?ring(?:-[\w/[\]().%-]+)?!?$/;
const focusShadowToken =
  /^(?:[^\s:]+:)*!?focus(?:-visible)?:!?shadow-(?!none!?$)/;

/**
 * Lists class tokens in `components/ui` that paint focus with a ring or a box-shadow.
 *
 * @remarks
 * The design system draws keyboard focus with an outline only. A shadcn add ships ring
 * utilities and `focus-visible:shadow-*` by default, so this scan stops them from returning.
 */
function ringFocusTokens(): string[] {
  const hits: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    for (const match of source.matchAll(stringLiteral)) {
      for (const token of match[0].slice(1, -1).split(/\s+/)) {
        if (ringToken.test(token) || focusShadowToken.test(token)) {
          const line = source.slice(0, match.index).split("\n").length;
          hits.push(`${file}:${line} ${token}`);
        }
      }
    }
  }
  return hits;
}

test("no primitive paints focus with a ring or a focus box-shadow", () => {
  assert.deepEqual(ringFocusTokens(), []);
});

const focusPoints = [
  ["button.tsx", "const buttonVariants = cva(", "\n);"],
  ["select.tsx", "function SelectTrigger(", "\n}\n"],
  ["dialog.tsx", "function DialogContent(", "\n}\n"],
  ["command.tsx", "function CommandInput(", "\n}\n"],
  ["sidebar.tsx", "const sidebarMenuButtonVariants = cva(", "\n);"],
] as const;

test("the five PRD focus points keep the two pixel accent outline", () => {
  for (const [file, from, to] of focusPoints) {
    const source = readFileSync(new URL(file, dir), "utf8");
    const start = source.indexOf(from);
    assert.ok(start >= 0, `${file} lost ${from}`);
    const region = source.slice(start, source.indexOf(to, start));
    const kept = [...region.matchAll(stringLiteral)].some((match) => {
      const tokens = match[0].slice(1, -1).split(/\s+/);
      return (
        tokens.includes("focus-visible:outline-2") &&
        tokens.includes("focus-visible:outline-ring")
      );
    });
    assert.ok(kept, `${file} ${from} lacks the outline focus tokens`);
  }
});
