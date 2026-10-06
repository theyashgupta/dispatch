import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_CHECK_COMMAND,
  isReservedBoardKey,
  parseBoardKey,
} from "../../shared/board-key.js";
import type { BoardKey } from "../../shared/types.js";
import { hasControlByte } from "../services/domain/claude-launch.js";
import { BoardValidationError } from "../services/domain/errors.js";
import { fieldsOf } from "./schema-primitives.js";

const INVALID_BOARD = "invalid-board";
const CHECK_COMMAND_MAX = 500;
const TEAM_KEY_RE = /^[A-Z][A-Z0-9]{0,9}$/;

/**
 * True when `ref` follows the git ref name rules that matter for a base branch.
 *
 * @remarks A subset of `git check-ref-format`: it refuses a leading dash (an option for git), control
 * bytes, spaces, the characters `~^:?*[\`, `..`, `@{`, an empty or dot-led component and a `.lock`
 * suffix.
 */
export function isGitRefName(ref: string): boolean {
  if (ref === "" || ref === "@" || ref.length > 255) return false;
  if (hasControlByte(ref) || /[\s~^:?*[\\]/.test(ref)) return false;
  if (ref.startsWith("-") || ref.includes("..") || ref.includes("@{")) {
    return false;
  }
  return (
    ref
      .split("/")
      .every(
        (part) =>
          part !== "" && !part.startsWith(".") && !part.endsWith(".lock"),
      ) && !ref.endsWith(".")
  );
}

/**
 * True when `text` holds a control byte or a newline.
 *
 * @remarks `hasControlByte` lets a newline through for shell arguments; a path or a check command
 * never needs one.
 */
function hasControlOrNewline(text: string): boolean {
  return hasControlByte(text) || text.includes("\n");
}

/**
 * True when `raw` is an absolute path below the root, with no `.` or `..` segment, a doubled slash
 * or control byte.
 *
 * @remarks A trailing slash is tolerated, and `/` is refused because it would make the whole disk
 * a viewer root. The check runs before any file system call, because a
 * relative path would resolve against the server's working folder.
 */
function isCleanAbsolutePath(raw: string): boolean {
  if (hasControlOrNewline(raw) || !path.isAbsolute(raw)) return false;
  const bare = raw.replace(/\/+$/, "");
  return bare !== "" && path.resolve(raw) === bare;
}

const folderPathSchema = z
  .string("folder-missing")
  .refine(isCleanAbsolutePath, "folder-missing")
  .transform((raw) => path.resolve(raw));

const repositorySchema = z.object(
  {
    path: folderPathSchema,
    baseBranch: z
      .string("invalid-base-branch")
      .refine(isGitRefName, "invalid-base-branch")
      .nullish()
      .transform((ref) => ref ?? null),
    checkCommand: z
      .string("invalid-check-command")
      .refine(
        (cmd) =>
          cmd.trim() !== "" &&
          cmd.length <= CHECK_COMMAND_MAX &&
          !hasControlOrNewline(cmd),
        "invalid-check-command",
      )
      .optional()
      .transform((cmd) => cmd ?? DEFAULT_CHECK_COMMAND),
  },
  "invalid-repository",
);

const repositoriesSchema = z
  .array(repositorySchema, "no-repositories")
  .transform((repos) => [
    ...new Map(repos.map((repo) => [repo.path, repo])).values(),
  ]);

const linearTeamKeysSchema = z
  .array(
    z
      .string("invalid-linear-team-keys")
      .regex(TEAM_KEY_RE, { error: "invalid-linear-team-keys" })
      .refine((teamKey) => !isReservedBoardKey(teamKey), "reserved-key"),
    "invalid-linear-team-keys",
  )
  .transform((keys) => [...new Set(keys)]);

/**
 * The `POST /boards` body.
 *
 * @remarks A schema message is a board variant (`missing-name`, `folder-missing`,
 * `no-repositories`, `reserved-key`) or a plain error code. The key rule and the name check stay in the service,
 * so one place decides them.
 */
export const createBoardBodySchema = z.preprocess(
  fieldsOf,
  z.object(
    {
      key: z.string("invalid-key"),
      name: z.string("missing-name"),
      workspaceRoot: folderPathSchema,
      repositories: repositoriesSchema,
      linearTeamKeys: linearTeamKeysSchema.optional().transform((k) => k ?? []),
    },
    "invalid-key",
  ),
);

/**
 * The `PATCH /boards/:key` body.
 *
 * @remarks Strict, so a `key`, a `policy` or any other field is refused: only these four fields
 * change in G17.
 */
export const patchBoardBodySchema = z.preprocess(
  fieldsOf,
  z.strictObject(
    {
      name: z.string("missing-name").optional(),
      workspaceRoot: folderPathSchema.optional(),
      repositories: repositoriesSchema.optional(),
      linearTeamKeys: linearTeamKeysSchema.optional(),
    },
    "unsupported-field",
  ),
);

const boardKeySchema = z
  .string(INVALID_BOARD)
  .transform((raw, ctx): BoardKey => {
    const key = parseBoardKey(raw);
    if (key === null) {
      ctx.addIssue({ code: "custom", message: INVALID_BOARD });
      return z.NEVER;
    }
    return key;
  });

/** The optional `board` query parameter of a collection route, shared by the REST and SSE routes. */
export const boardParamSchema = z.object({ board: boardKeySchema.optional() });

/**
 * Parse the optional `board` query parameter.
 *
 * @remarks A malformed or repeated `board` throws the typed `invalid-board` 400. An absent one
 * returns undefined, which the resolver reads as the default board.
 */
export function parseBoardParam(query: unknown): BoardKey | undefined {
  const parsed = boardParamSchema.safeParse(query);
  if (!parsed.success) throw new BoardValidationError(INVALID_BOARD);
  return parsed.data.board;
}

/** Parse the `:key` path parameter of a board route, or throw the typed `invalid-board` 400. */
export function parseBoardKeyParam(raw: unknown): BoardKey {
  const parsed = boardKeySchema.safeParse(raw);
  if (!parsed.success) throw new BoardValidationError(INVALID_BOARD);
  return parsed.data;
}
