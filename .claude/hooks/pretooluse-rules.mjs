#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const RULE_DOC = "Rule: docs/standards/frontend-architecture.md";

const REASONS = {
  style: `Do not use an inline style object. Use Tailwind token classes. To change a primitive, add a cva variant in its components/ui file. ${RULE_DOC}, The only-shadcn rule.`,
  hex: `Do not write a hex colour. Add a token to src/web/styles/tokens.css. Use the Tailwind class of that token. ${RULE_DOC}, The only-shadcn rule.`,
  radix: `Do not import Radix outside src/web/components/ui/. Use the shadcn primitive in components/ui. Add a missing primitive with npx shadcn@latest add. ${RULE_DOC}, The only-shadcn rule.`,
  newTsx: `Do not create a .tsx file in this folder. Put it in src/web/modules/<feature>/views/, containers/ or components/, in src/web/components/ or in src/web/routes/. ${RULE_DOC}, Layer definitions.`,
  serverData: `Do not get server data outside a query file. A query file is in src/web/modules/<feature>/queries/ or src/web/queries/. Call fetch only in a query file or in src/web/lib/http.ts. Create an EventSource only in a query file. Import src/web/lib/http.ts only in a query file. Do not import src/web/lib/api.ts in the new tree. ${RULE_DOC}, Import matrix.`,
  moduleShape: `Do not put this file here. A module holds only the folders views, containers, components, hooks, domain and queries, and the file index.ts. Move the file into one of these folders. ${RULE_DOC}, Layer definitions.`,
};

const LAYERS = new Set([
  "views",
  "containers",
  "components",
  "hooks",
  "domain",
  "queries",
]);
const ENTRY_FILES = new Set([
  "src/web/main.tsx",
  "src/web/App.tsx",
  "src/web/AppShell.tsx",
  "src/web/viewer-main.tsx",
  "src/web/gallery-main.tsx",
]);
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const STYLE = /\bstyle=\{/;
const FETCH = /(?:^|[^\w.$])(?:(?:window|globalThis|self)\s*\.\s*)?fetch\s*\(/;
const EVENT_SOURCE =
  /\bnew\s+(?:(?:window|globalThis|self)\s*\.\s*)?EventSource\b/;
const IMPORT_SPEC = /\b(?:from|import|require)\s*\(?\s*["'`]([^"'`]+)["'`]/g;
const RADIX_SPEC = /^(?:@radix-ui\/|radix-ui(?:\/|$))/;
const API_SPEC = /(?:^|\/)lib\/api(?:\.[cm]?[jt]sx?)?$/;
const HTTP_SPEC = /(?:^|\/)lib\/http(?:\.[cm]?[jt]sx?)?$/;

/**
 * Tell if a project-relative path is in the new frontend tree.
 *
 * @remarks
 * The list is the new tree in the "Status and scope" section of the standard. The Radix rule and the new .tsx rule also cover the legacy tree.
 */
function isNewTree(rel) {
  return (
    /^src\/web\/(?:routes|modules|components|queries|styles)\//.test(rel) ||
    /^src\/web\/lib\/(?:http|utils|query-client)\.ts$/.test(rel)
  );
}

/**
 * Return the deny reasons for one tool call.
 *
 * @param rel - The project-relative file path with forward slashes.
 * @param text - Only the text that the tool adds.
 * @param creates - True when a Write creates a file that does not exist.
 */
function denyReasons(rel, text, creates) {
  if (!rel.startsWith("src/web/")) return [];
  const reasons = [];
  const inUi = rel.startsWith("src/web/components/ui/");
  const inQuery =
    /^src\/web\/modules\/[^/]+\/queries\//.test(rel) ||
    rel.startsWith("src/web/queries/");
  const newTree = isNewTree(rel);
  const specs = [...text.matchAll(IMPORT_SPEC)].map((m) => m[1]);

  if (
    rel.endsWith(".tsx") &&
    /^src\/web\/(?:modules|routes|components)\//.test(rel) &&
    !inUi &&
    !/^src\/web\/modules\/[^/]+\/components\/dnd\//.test(rel) &&
    STYLE.test(text)
  ) {
    reasons.push(REASONS.style);
  }
  if (newTree && rel !== "src/web/styles/tokens.css" && HEX.test(text)) {
    reasons.push(REASONS.hex);
  }
  if (!inUi && specs.some((s) => RADIX_SPEC.test(s))) {
    reasons.push(REASONS.radix);
  }
  if (
    creates &&
    rel.endsWith(".tsx") &&
    !/\.test\.tsx$/.test(rel) &&
    !ENTRY_FILES.has(rel) &&
    !/^src\/web\/modules\/[^/]+\/(?:views|containers|components)\//.test(rel) &&
    !/^src\/web\/(?:components|routes|features|primitives)\//.test(rel)
  ) {
    reasons.push(REASONS.newTsx);
  }
  if (
    newTree &&
    ((!inQuery && rel !== "src/web/lib/http.ts" && FETCH.test(text)) ||
      (!inQuery && EVENT_SOURCE.test(text)) ||
      specs.some((s) => API_SPEC.test(s)) ||
      (!inQuery && specs.some((s) => HTTP_SPEC.test(s))))
  ) {
    reasons.push(REASONS.serverData);
  }
  const moduleParts = rel.startsWith("src/web/modules/")
    ? rel.split("/").slice(3)
    : null;
  if (
    moduleParts &&
    !(moduleParts.length > 2 && LAYERS.has(moduleParts[1])) &&
    !(moduleParts.length === 2 && moduleParts[1] === "index.ts")
  ) {
    reasons.push(REASONS.moduleShape);
  }
  return reasons;
}

/**
 * Return the pointer text for a path that has no deny reason.
 */
function pointer(rel) {
  let text = "";
  if (rel.startsWith("src/server/routes/")) {
    text =
      "Transport layer: validate synchronously before async work; routes never import adapters/exec|git|tmux, see docs/standards/backend-design.md (layer rules) and docs/standards/code-review-rules.md.";
  } else if (rel.startsWith("src/server/services/")) {
    text =
      "Services layer: orchestration/ = sagas, domain/ = pure logic, infra/ = plumbing, see docs/standards/backend-design.md.";
  } else if (
    rel.startsWith("src/server/adapters/") ||
    rel.startsWith("src/server/store/")
  ) {
    text =
      "Adapter/store layer: all subprocess calls go through adapters/exec.ts (run/runInherit); store writes go through the single writer, see docs/standards/backend-design.md and docs/standards/architecture.md (exec-chokepoint rulings).";
  } else if (rel.startsWith("src/server/") || rel.startsWith("src/shared/")) {
    text = "Backend layering rules: see docs/standards/backend-design.md.";
  } else if (isNewTree(rel)) {
    text =
      "New frontend tree: layer folders, import matrix and the only-shadcn rule, see docs/standards/frontend-architecture.md.";
  } else if (
    rel.startsWith("src/web/primitives/") ||
    rel.startsWith("src/web/hooks/") ||
    rel.startsWith("src/web/lib/")
  ) {
    text =
      "Import direction is primitives -> hooks/lib -> features -> App; lib/ stays React-free, see docs/standards/folder-structure.md.";
  } else if (rel.startsWith("src/web/")) {
    text =
      "Cross-feature imports go through the feature's index.ts barrel; component anatomy per docs/standards/frontend-design-system.md, see docs/standards/folder-structure.md.";
  }
  return text
    ? `${text} Comments: JSDoc-only, WHY not WHAT, see docs/standards/comments.md.`
    : "";
}

/**
 * Decide the hook output for one PreToolUse payload.
 */
function decide(payload, projectDir) {
  const input = payload?.tool_input;
  const filePath = input?.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) return null;

  const abs = resolve(projectDir, filePath);
  const relNative = relative(projectDir, abs);
  if (relNative.startsWith("..") || isAbsolute(relNative)) return null;
  const rel = relNative.split(sep).join("/");

  const added = [input.new_string, input.content];
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) added.push(edit?.new_string);
  }
  const text = added.filter((t) => typeof t === "string").join("\n");
  const creates = payload.tool_name === "Write" && !existsSync(abs);

  const reasons = denyReasons(rel, text, creates);
  if (reasons.length > 0) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reasons.join(" "),
      },
    };
  }
  const context = pointer(rel);
  return context
    ? {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: context,
        },
      }
    : null;
}

try {
  const output = decide(
    JSON.parse(readFileSync(0, "utf8")),
    process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  );
  if (!output) process.exit(0);
  process.stdout.write(JSON.stringify(output), () => process.exit(0));
} catch {
  process.exit(0);
}
