import {
  BOARD_KEY_RE,
  deriveBoardKey,
  isReservedBoardKey,
} from "../../../../shared/board-key.js";
import type { Board, BoardKey } from "../../../../shared/types.js";
import type {
  BoardRefusal,
  CreateBoardInput,
  RepositoryInput,
} from "../../../../shared/board-create.js";

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
  keySuggestion?: string;
  name?: string;
  workspaceRoot?: string;
  repositories?: string;
  repositoryRows?: Record<number, string>;
}

export interface BoardFormContext {
  boards: readonly Pick<Board, "key" | "name">[];
  knownLinearTeamKeys: readonly string[];
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
  repositories: [],
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

/** The keys a new board cannot take: every board key and every known Linear team key. */
export function takenKeySet(
  boards: readonly Pick<Board, "key">[],
  knownLinearTeamKeys: readonly string[],
): Set<string> {
  return new Set([...boards.map((board) => board.key), ...knownLinearTeamKeys]);
}

/** The key the server derives for a name, or null for a blank name or when no key is free. */
export function previewKey(
  name: string,
  takenKeys: ReadonlySet<string>,
): BoardKey | null {
  return name.trim() === "" ? null : deriveBoardKey(name, takenKeys);
}

/** The folder a board gets when the folder field stays empty, or "" when there is no root or key. */
export function folderPlaceholder(
  root: string | null | undefined,
  key: string,
): string {
  const base = root?.replace(/\/+$/, "") ?? "";
  return base === "" || key === "" ? "" : `${base}/${key}`;
}

/**
 * Check the board form and return the field errors, empty when the form is valid.
 *
 * @remarks A key is checked only when typed, because an empty key means the server derives one.
 */
export function checkBoardForm(
  values: BoardFormValues,
  context: BoardFormContext,
): BoardFormErrors {
  const errors: BoardFormErrors = {};
  const key = values.key.trim();
  if (key !== "") {
    if (!BOARD_KEY_RE.test(key)) {
      errors.key =
        "Use 2 to 6 capital letters or digits, starting with a letter.";
    } else if (isReservedBoardKey(key)) {
      errors.key = "LOCAL and GROUP are reserved.";
    } else {
      const owner = context.boards.find((board) => board.key === key);
      const teamTaken = context.knownLinearTeamKeys.includes(key);
      if (owner !== undefined) {
        errors.key = `Board ${owner.name} uses this key.`;
      } else if (teamTaken) {
        errors.key = `Linear team ${key} uses this key.`;
      }
      if (errors.key !== undefined) {
        const free = deriveBoardKey(
          key,
          takenKeySet(context.boards, context.knownLinearTeamKeys),
        );
        if (free !== null) errors.keySuggestion = free;
      }
    }
  }
  if (values.name.trim() === "") errors.name = "Enter a name.";
  return errors;
}

/** The repository inputs of the filled rows: path only for the default board, else with branch and check command. */
export function repositoryInputs(
  values: Pick<BoardFormValues, "repositories">,
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

export function rowOfPath(
  repositories: readonly RepositoryValues[],
  path: string | undefined,
): number {
  return repositories.findIndex((repo) => repo.path.trim() === path);
}

export function addRepository<T extends { repositories: RepositoryValues[] }>(
  values: T,
): T {
  return {
    ...values,
    repositories: [...values.repositories, EMPTY_REPOSITORY],
  };
}

export function changeRepository<
  T extends { repositories: RepositoryValues[] },
>(values: T, index: number, patch: Partial<RepositoryValues>): T {
  return {
    ...values,
    repositories: values.repositories.map((repo, i) =>
      i === index ? { ...repo, ...patch } : repo,
    ),
  };
}

export function removeRepository<
  T extends { repositories: RepositoryValues[] },
>(values: T, index: number): T {
  return {
    ...values,
    repositories: values.repositories.filter((_, i) => i !== index),
  };
}

/** The POST body of a valid create form, with each optional field present only when filled. */
export function toCreateInput(values: BoardFormValues): CreateBoardInput {
  const input: CreateBoardInput = { name: values.name.trim() };
  const key = values.key.trim();
  if (key !== "") input.key = key;
  const workspaceRoot = values.workspaceRoot.trim();
  if (workspaceRoot !== "") input.workspaceRoot = workspaceRoot;
  const repositories = repositoryInputs(values, false);
  if (repositories.length > 0) input.repositories = repositories;
  const linearTeamKeys = parseTeamKeys(values.linearTeamKeys);
  if (linearTeamKeys.length > 0) input.linearTeamKeys = linearTeamKeys;
  return input;
}

interface RefusalFieldError {
  field: "key" | "name" | "workspaceRoot" | "repositories" | "form";
  message: string;
  suggestion?: string;
  path?: string;
}

/**
 * Map a create refusal to the form field it belongs to.
 */
export function refusalFieldError(refusal: BoardRefusal): RefusalFieldError {
  const message = refusal.error;
  switch (refusal.code) {
    case "duplicate-key":
      return {
        field: "key",
        message,
        ...(refusal.suggestion === undefined
          ? {}
          : { suggestion: refusal.suggestion }),
      };
    case "folder-missing":
      return refusal.field === "repositories"
        ? { field: "repositories", message, path: refusal.path }
        : { field: "workspaceRoot", message };
    case "missing-name":
    case "invalid-name":
      return { field: "name", message };
    default:
      return { field: "form", message };
  }
}

/**
 * Place a create refusal on the form: field errors, or the form-level text when it has no field.
 */
export function refusalErrors(
  refusal: BoardRefusal,
  values: BoardFormValues,
): { errors: BoardFormErrors; form: string | null } {
  const found = refusalFieldError(refusal);
  switch (found.field) {
    case "key":
      return {
        errors: {
          key: found.message,
          ...(found.suggestion === undefined
            ? {}
            : { keySuggestion: found.suggestion }),
        },
        form: null,
      };
    case "name":
      return { errors: { name: found.message }, form: null };
    case "workspaceRoot":
      return { errors: { workspaceRoot: found.message }, form: null };
    case "repositories": {
      const index = rowOfPath(values.repositories, found.path);
      return {
        errors:
          index === -1
            ? { repositories: found.message }
            : { repositoryRows: { [index]: found.message } },
        form: null,
      };
    }
    case "form":
      return { errors: {}, form: found.message };
  }
}

/**
 * The errors the create form shows.
 *
 * @remarks Refusals always show. The checked errors show after a submit attempt, or the key error alone
 * after the key field lost focus, and never while the form is hidden (submitting or done).
 */
export function visibleErrors(
  found: BoardFormErrors,
  refused: BoardFormErrors,
  state: { attempted: boolean; keyTouched: boolean; hidden: boolean },
): BoardFormErrors {
  let shown: BoardFormErrors = {};
  if (state.hidden) shown = {};
  else if (state.attempted) shown = found;
  else if (state.keyTouched && found.key !== undefined) {
    shown = { key: found.key, keySuggestion: found.keySuggestion };
  }
  return { ...shown, ...refused };
}

/** Join a failure prefix and a message, with one closing period. */
export function failureText(prefix: string, message: string): string {
  return `${prefix}: ${message.replace(/\.$/, "")}.`;
}
