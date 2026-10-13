import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Board } from "../../../../shared/types.js";
import type {
  BoardRefusal,
  UpdateBoardInput,
} from "../../../../shared/board-create.js";
import {
  parseTeamKeys,
  refusalFieldError,
  repositoryInputs,
  rowOfPath,
  type RepositoryValues,
} from "./board-form.js";

export type SettingsSection = "name" | "repositories" | "linearTeamKeys";

export interface BoardSettingsValues {
  name: string;
  repositories: RepositoryValues[];
  linearTeamKeys: string;
}

export interface BoardSettingsErrors {
  name?: string;
  repositories?: string;
  repositoryRows?: Record<number, string>;
  linearTeamKeys?: string;
}

function rowOf(repo: Board["repositories"][number]): RepositoryValues {
  return {
    path: repo.path,
    baseBranch: repo.baseBranch ?? "",
    checkCommand: repo.checkCommand,
  };
}

/** The settings form values of a board: one row for each repository, none for a board with no repository. */
export function settingsValuesFromBoard(board: Board): BoardSettingsValues {
  return {
    name: board.name,
    repositories: board.repositories.map(rowOf),
    linearTeamKeys: board.linearTeamKeys.join(", "),
  };
}

/**
 * The PATCH body of the fields of one section that differ from the board.
 *
 * @remarks The default board sends paths only and no team keys, because its page shows neither the
 * base branch, the check command nor the team keys.
 */
export function toPatch(
  values: BoardSettingsValues,
  board: Board,
  section: SettingsSection,
): UpdateBoardInput {
  const isDefault = board.key === DEFAULT_BOARD_KEY;
  const patch: UpdateBoardInput = {};
  if (section === "name") {
    const name = values.name.trim();
    if (name !== board.name) patch.name = name;
  }
  if (section === "repositories") {
    const next = repositoryInputs(values, isDefault);
    const current = repositoryInputs(settingsValuesFromBoard(board), isDefault);
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      patch.repositories = next;
    }
  }
  if (section === "linearTeamKeys" && !isDefault) {
    const next = parseTeamKeys(values.linearTeamKeys);
    if (JSON.stringify(next) !== JSON.stringify(board.linearTeamKeys)) {
      patch.linearTeamKeys = next;
    }
  }
  return patch;
}

/** True when a save of one section would change the board. */
export function isDirty(
  values: BoardSettingsValues,
  board: Board,
  section: SettingsSection,
): boolean {
  return Object.keys(toPatch(values, board, section)).length > 0;
}

export function checkBoardSettings(
  values: BoardSettingsValues,
): BoardSettingsErrors {
  return values.name.trim() === "" ? { name: "Enter a name." } : {};
}

/**
 * Place a refusal of a section save on the field it belongs to.
 */
export function placeRefusal(
  refusal: BoardRefusal,
  values: BoardSettingsValues,
  section: SettingsSection,
): BoardSettingsErrors {
  const found = refusalFieldError(refusal);
  if (found.field === "repositories" && found.path !== undefined) {
    const index = rowOfPath(values.repositories, found.path);
    if (index !== -1) return { repositoryRows: { [index]: found.message } };
  }
  return { [section]: found.message };
}

/** The form values with one section reset to what the saved board holds. */
export function applySaved(
  values: BoardSettingsValues,
  saved: Board,
  section: SettingsSection,
): BoardSettingsValues {
  return { ...values, [section]: settingsValuesFromBoard(saved)[section] };
}

/** The form values plus a row for each repository that the board gained since `before`. */
export function withNewRepositories(
  values: BoardSettingsValues,
  before: Board,
  after: Board,
): BoardSettingsValues {
  const known = new Set(before.repositories.map((repo) => repo.path));
  const added = after.repositories
    .filter((repo) => !known.has(repo.path))
    .map(rowOf);
  return { ...values, repositories: [...values.repositories, ...added] };
}
