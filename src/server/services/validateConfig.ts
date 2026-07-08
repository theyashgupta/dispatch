import fs from "node:fs";
import path from "node:path";
import type { Config } from "../../shared/types.js";

/**
 * Validate the orchestration-relevant config fields. Returns a field-naming error string when
 * unusable, or null when the config can drive a start. Field names only — never values.
 *
 * Rules (02-RESEARCH assumption A4, locked N-repo interpretation):
 *   - repoPaths present and non-empty
 *   - baseBranches index-aligned with repoPaths (equal length)
 *   - every repoPath is an existing directory
 *   - every baseBranch entry is a non-empty string
 *   - workspaceRoot present and non-empty
 */
export function validateOrchestrationConfig(config: Config): string | null {
  const repoPaths = config.repoPaths ?? [];
  const baseBranches = config.baseBranches ?? [];

  if (repoPaths.length === 0) {
    return "repoPaths is not configured — set at least one repo path in config.json";
  }
  if (baseBranches.length !== repoPaths.length) {
    return "baseBranches must be index-aligned with repoPaths (equal length) in config.json";
  }

  for (const repoPath of repoPaths) {
    if (typeof repoPath !== "string" || repoPath.trim() === "") {
      return "repoPaths contains an empty entry in config.json";
    }
    let isDir = false;
    try {
      isDir = fs.existsSync(repoPath) && fs.statSync(repoPath).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      return "a configured repoPaths entry is not an existing directory";
    }
  }

  const basenames = repoPaths.map((repoPath) => path.basename(repoPath));
  const collision = basenames.find((name, i) => basenames.indexOf(name) !== i);
  if (collision !== undefined) {
    return `repoPaths has two repos with the same folder name ("${collision}") — their worktrees would collide; rename or relocate one in config.json`;
  }

  for (const base of baseBranches) {
    if (typeof base !== "string" || base.trim() === "") {
      return "baseBranches contains an empty entry in config.json";
    }
  }

  const workspaceRoot = config.workspaceRoot;
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    return "workspaceRoot is not configured in config.json";
  }

  return null;
}
