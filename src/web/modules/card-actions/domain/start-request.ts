export interface RepoChoice {
  path: string;
  base: string;
}

export interface StartCardRequest {
  id: string;
  extraDirection: string;
  folder: string | undefined;
  repos: RepoChoice[];
  playbook: string | undefined;
  newSession: boolean;
  inheritFrom: string | undefined;
}

export interface StartGroupRequest {
  title: string;
  memberIds: string[];
  folder: string;
  repos: RepoChoice[];
  playbook: string | undefined;
  extraDirection: string;
}

/**
 * Tell whether the Start button is enabled.
 *
 * @remarks A start needs a workspace and one ticked repo, and a selected playbook is not required. A missing-repo refusal keeps it off until the user changes the form.
 */
export function canStart(input: {
  pending: boolean;
  configError: boolean;
  folder: string | null;
  repoCount: number;
  titled?: boolean;
}): boolean {
  return (
    !input.pending &&
    !input.configError &&
    input.folder !== null &&
    input.repoCount > 0 &&
    (input.titled ?? true)
  );
}

/**
 * Build the request that starts one card.
 *
 * @remarks A session to build on is sent only for a new session on a card that has an active one.
 */
export function buildStartCardRequest(input: {
  cardId: string;
  extraDirection: string;
  folder: string | null;
  repos: RepoChoice[];
  playbook: string | null;
  newSession: boolean;
  inherit: boolean;
  activeSessionId: string | undefined;
}): StartCardRequest {
  return {
    id: input.cardId,
    extraDirection: input.extraDirection,
    folder: input.folder ?? undefined,
    repos: input.repos,
    playbook: input.playbook ?? undefined,
    newSession: input.newSession,
    inheritFrom:
      input.inherit && input.newSession ? input.activeSessionId : undefined,
  };
}

/** Build the request that creates and starts a group. */
export function buildStartGroupRequest(input: {
  title: string;
  memberIds: string[];
  folder: string | null;
  repos: RepoChoice[];
  playbook: string | null;
  extraDirection: string;
}): StartGroupRequest {
  return {
    title: input.title.trim(),
    memberIds: input.memberIds,
    folder: input.folder ?? "",
    repos: input.repos,
    playbook: input.playbook ?? undefined,
    extraDirection: input.extraDirection,
  };
}
