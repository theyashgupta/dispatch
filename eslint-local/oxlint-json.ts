import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

interface OxlintDiagnostic {
  message: string;
  help?: string;
  code?: string;
  filename: string;
  labels?: { span: { line: number } }[];
}

/**
 * Lint files with the repo oxlint config and group the findings by repo-relative path.
 */
export function lintWithOxlint(
  files: string[],
): Map<string, { ruleId: string; message: string; line: number }[]> {
  const run = spawnSync(
    path.join(root, "node_modules/.bin/oxlint"),
    ["-f", "json", "--", ...files],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0 && run.status !== 1) {
    throw new Error(`oxlint exited ${run.status}: ${run.stderr}`);
  }
  const parsed = JSON.parse(run.stdout) as {
    diagnostics: OxlintDiagnostic[];
    number_of_files: number;
  };
  if (parsed.number_of_files !== files.length) {
    throw new Error(
      `oxlint linted ${parsed.number_of_files} of ${files.length} files; a fixture is ignored`,
    );
  }
  const byFile = new Map<
    string,
    { ruleId: string; message: string; line: number }[]
  >();
  for (const diagnostic of parsed.diagnostics) {
    const ruleId = toRuleId(diagnostic.code);
    const finding = {
      ruleId,
      message:
        ruleId === "no-restricted-imports"
          ? `${diagnostic.message} ${diagnostic.help ?? ""}`
          : diagnostic.message,
      line: diagnostic.labels?.[0]?.span.line ?? 0,
    };
    const list = byFile.get(diagnostic.filename) ?? [];
    list.push(finding);
    byFile.set(diagnostic.filename, list);
  }
  return byFile;
}

function toRuleId(code: string | undefined): string {
  const match = /^([\w-]+)\((.+)\)$/.exec(code ?? "");
  if (!match) return "parse-error";
  const [, plugin, rule] = match;
  if (plugin === "eslint") return rule;
  if (plugin === "typescript") return `@typescript-eslint/${rule}`;
  return `${plugin}/${rule}`;
}
