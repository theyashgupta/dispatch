import {
  BOARD_KEY_RE,
  DEFAULT_BOARD_KEY,
  isReservedBoardKey,
} from "../../../../shared/board-key.js";
import type { Board } from "../../../../shared/types.js";

export interface RepositoryValues {
  path: string;
  baseBranch: string;
  checkCommand: string;
}

export interface BoardFormValues {
  key: string;
  name: string;
  workspaceRoot: string;
  repositories: RepositoryValues[];
  linearTeamKeys: string;
}

export interface BoardFormErrors {
  key?: string;
  name?: string;
  workspaceRoot?: string;
  repositories?: string;
}

export interface BoardFormContext {
  mode: "create" | "edit";
  isDefault: boolean;
  boards: readonly Pick<Board, "key" | "name">[];
  knownLinearTeamKeys: readonly string[];
}

export interface RepositoryInput {
  path: string;
  baseBranch?: string | null;
  checkCommand?: string;
}

export interface CreateBoardInput {
  key: string;
  name: string;
  workspaceRoot: string;
  repositories: RepositoryInput[];
  linearTeamKeys: string[];
}

export interface UpdateBoardInput {
  name: string;
  workspaceRoot: string;
  repositories: RepositoryInput[];
  linearTeamKeys?: string[];
}

export const EMPTY_REPOSITORY: RepositoryValues = {
  path: "",
  baseBranch: "",
  checkCommand: "",
};

export const EMPTY_FORM: BoardFormValues = {
  key: "",
  name: "",
  workspaceRoot: "",
  repositories: [EMPTY_REPOSITORY],
  linearTeamKeys: "",
};

/** Split a comma list of Linear team keys into trimmed, upper-case, unique keys. */
export function parseTeamKeys(text: string): string[] {
  const keys = text
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part !== "");
  return [...new Set(keys)];
}

export function formValuesFromBoard(board: Board): BoardFormValues {
  return {
    key: board.key,
    name: board.name,
    workspaceRoot: board.workspaceRoot ?? "",
    repositories:
      board.repositories.length === 0
        ? [EMPTY_REPOSITORY]
        : board.repositories.map((repo) => ({
            path: repo.path,
            baseBranch: repo.baseBranch ?? "",
            checkCommand: repo.checkCommand,
          })),
    linearTeamKeys: board.linearTeamKeys.join(", "),
  };
}

/**
 * Check the board form and return the field errors, empty when the form is valid.
 *
 * @remarks Edit mode skips the key checks because the key is read-only there, and the sessions
 * folder check because the default board has none. The default board skips the repository check
 * because its folders come from Settings.
 */
export function checkBoardForm(
  values: BoardFormValues,
  context: BoardFormContext,
): BoardFormErrors {
  const errors: BoardFormErrors = {};
  if (context.mode === "create") {
    const key = values.key.trim();
    if (!BOARD_KEY_RE.test(key)) {
      errors.key =
        "Use 2 to 6 capital letters or digits, starting with a letter.";
    } else if (isReservedBoardKey(key)) {
      errors.key = "LOCAL and GROUP are reserved.";
    } else {
      const owner = context.boards.find((board) => board.key === key);
      if (owner !== undefined) {
        errors.key = `Board ${owner.name} uses this key.`;
      } else if (context.knownLinearTeamKeys.includes(key)) {
        errors.key = `Linear team ${key} uses this key.`;
      }
    }
  }
  if (values.name.trim() === "") errors.name = "Enter a name.";
  if (context.mode === "create" && values.workspaceRoot.trim() === "") {
    errors.workspaceRoot = "Enter the sessions folder.";
  }
  if (
    !context.isDefault &&
    values.repositories.every((repo) => repo.path.trim() === "")
  ) {
    errors.repositories = "Add at least one repository.";
  }
  return errors;
}

function repositoryInputs(
  values: BoardFormValues,
  isDefault: boolean,
): RepositoryInput[] {
  return values.repositories
    .filter((repo) => repo.path.trim() !== "")
    .map((repo) => {
      const path = repo.path.trim();
      if (isDefault) return { path };
      const checkCommand = repo.checkCommand.trim();
      return {
        path,
        baseBranch: repo.baseBranch.trim() || null,
        ...(checkCommand === "" ? {} : { checkCommand }),
      };
    });
}

/** The POST body of a valid create form. */
export function toCreateInput(values: BoardFormValues): CreateBoardInput {
  return {
    key: values.key.trim(),
    name: values.name.trim(),
    workspaceRoot: values.workspaceRoot.trim(),
    repositories: repositoryInputs(values, false),
    linearTeamKeys: parseTeamKeys(values.linearTeamKeys),
  };
}

/**
 * The PATCH body of a valid edit form.
 *
 * @remarks The default board sends paths only and no Linear team keys, because its form shows
 * neither the base branch, the check command nor the team keys.
 */
export function toUpdateInput(
  values: BoardFormValues,
  boardKey: string,
): UpdateBoardInput {
  const isDefault = boardKey === DEFAULT_BOARD_KEY;
  const input: UpdateBoardInput = {
    name: values.name.trim(),
    workspaceRoot: values.workspaceRoot.trim(),
    repositories: repositoryInputs(values, isDefault),
  };
  if (!isDefault) input.linearTeamKeys = parseTeamKeys(values.linearTeamKeys);
  return input;
}

/** Join a failure prefix and a message, with one closing period. */
export function failureText(prefix: string, message: string): string {
  return `${prefix}: ${message.replace(/\.$/, "")}.`;
}
