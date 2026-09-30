#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const CONFIG_FILE =
  /^(?:\.prettierrc.*|prettier\.config\..*|package\.(?:json|yaml)|eslint\.config\..*)$/;

/**
 * Format one edited file with the project prettier.
 *
 * @remarks
 * Config files and `.claude/` are skipped, because an edit there can change what prettier loads on the next run.
 */
function format(payload, projectDir) {
  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) return;
  const abs = resolve(projectDir, filePath);
  const rel = relative(projectDir, abs).split(sep).join("/");
  if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(abs)) return;
  if (rel === ".claude" || rel.startsWith(".claude/")) return;
  if (CONFIG_FILE.test(basename(abs))) return;
  spawnSync(
    join(projectDir, "node_modules", ".bin", "prettier"),
    ["--write", "--ignore-unknown", abs],
    { cwd: projectDir, stdio: "ignore", timeout: 25000 },
  );
}

try {
  format(
    JSON.parse(readFileSync(0, "utf8")),
    process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  );
} finally {
  process.exit(0);
}
