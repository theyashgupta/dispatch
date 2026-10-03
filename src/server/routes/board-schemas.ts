import { z } from "zod";
import {
  ARCHIVE_RETENTION_MAX_DAYS,
  type SourceFilters,
} from "../../shared/types.js";
import { parseDoneLimit } from "../../shared/done-limit.js";
import { SEARCH_QUERY_MAX, SEARCH_QUERY_MIN } from "../../shared/search.js";
import { validateTerminalAppearance } from "../../shared/terminal-appearance.js";
import { hasControlByte } from "../services/domain/claude-launch.js";
import { fromResult } from "./schema-primitives.js";

const DONE_LIMIT_CODE = "doneLimit must be a whole number between 1 and 5000";
const Q_REQUIRED = "q is required";
const PATH_REQUIRED = "path is required";
const INVALID_FILTERS = "invalid filters";
const CLEANUP_CODE =
  "cleanup delay must be a whole number of days between 0 and 90";
const RETENTION_CODE =
  "archive retention must be a whole number of days between 0 and 365";
const CLAUDE_ARGS_MAX = 4000;
const CLAUDE_ARGS_CODE = `claude arguments must be a string of ${CLAUDE_ARGS_MAX} characters or fewer with no control characters`;

/**
 * Check an untrusted filter body has exactly the `SourceFilters` fields with the right types.
 *
 * @remarks An unknown key is refused, so an unknown dimension can never be persisted to config or
 * forwarded to Linear.
 */
function isValidFilters(x: unknown): x is SourceFilters {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const allowed = new Set([
    "assignees",
    "projects",
    "teams",
    "currentCycle",
    "includeActive",
  ]);
  if (Object.keys(o).some((k) => !allowed.has(k))) return false;
  const isStrArray = (v: unknown): boolean =>
    Array.isArray(v) && v.every((s) => typeof s === "string");
  return (
    isStrArray(o.assignees) &&
    isStrArray(o.projects) &&
    isStrArray(o.teams) &&
    typeof o.currentCycle === "boolean" &&
    typeof o.includeActive === "boolean"
  );
}

/** Whole days in `[0, max]` (`LIFE-04`), with `code` as the issue. */
const wholeDaysSchema = (max: number, code: string) =>
  z.number(code).refine((n) => Number.isInteger(n) && n >= 0 && n <= max, code);

/** A non-blank path, kept untrimmed for `expandPath`. */
const requiredPathSchema = z
  .string(PATH_REQUIRED)
  .refine((raw) => raw.trim() !== "", PATH_REQUIRED);

/** The `GET /board` query; an absent `doneLimit` stays undefined for the route's default. */
export const boardQuerySchema = z.object(
  {
    doneLimit: z
      .string(DONE_LIMIT_CODE)
      .transform((raw, ctx) => {
        const limit = parseDoneLimit(raw);
        if (limit === null) {
          ctx.addIssue({ code: "custom", message: DONE_LIMIT_CODE });
          return z.NEVER;
        }
        return limit;
      })
      .optional(),
  },
  DONE_LIMIT_CODE,
);

/** The `GET /search` query; `q` comes out trimmed and bounded in UTF-16 units. */
export const searchQuerySchema = z.object(
  {
    q: z
      .string(Q_REQUIRED)
      .transform((raw) => raw.trim())
      .refine(
        (q) => q.length >= SEARCH_QUERY_MIN && q.length <= SEARCH_QUERY_MAX,
        `q must be between ${SEARCH_QUERY_MIN} and ${SEARCH_QUERY_MAX} characters`,
      ),
  },
  Q_REQUIRED,
);

/** The workspace folder add and remove bodies and the discover query. */
export const workspacePathSchema = z.object(
  { path: requiredPathSchema },
  PATH_REQUIRED,
);

/** The `GET /fs/dirs` query; an absent path means the home folder. */
export const dirsQuerySchema = z.object(
  { path: z.string("invalid path").optional() },
  "invalid path",
);

export const optionsQuerySchema = z.object(
  {
    dimension: z.enum(["assignees", "projects", "teams"], "invalid dimension"),
  },
  "invalid dimension",
);

/**
 * The source filter preview and save body.
 *
 * @remarks `z.custom` passes the client's object through untouched, so the saved and echoed filters
 * keep the client's key order.
 */
export const filtersBodySchema = z.object(
  { filters: z.custom<SourceFilters>(isValidFilters, INVALID_FILTERS) },
  INVALID_FILTERS,
);

export const cleanupDelayBodySchema = z.object(
  { cleanupDelayDays: wholeDaysSchema(90, CLEANUP_CODE) },
  CLEANUP_CODE,
);

export const archiveRetentionBodySchema = z.object(
  {
    archiveRetentionDays: wholeDaysSchema(
      ARCHIVE_RETENTION_MAX_DAYS,
      RETENTION_CODE,
    ),
  },
  RETENTION_CODE,
);

/** The `PUT /config/terminal` body, normalized by `validateTerminalAppearance` with its own message. */
export const terminalBodySchema = fromResult(validateTerminalAppearance);

/**
 * The `PUT /config/claude-args` body (Settings ▸ Models).
 *
 * @remarks Bounded length only: any string tokenizes into a valid argv (`parseClaudeArgs`), including
 * empty.
 */
export const claudeArgsBodySchema = z.object(
  {
    claudeArgs: z
      .string(CLAUDE_ARGS_CODE)
      .refine(
        (args) => args.length <= CLAUDE_ARGS_MAX && !hasControlByte(args),
        CLAUDE_ARGS_CODE,
      ),
  },
  CLAUDE_ARGS_CODE,
);
