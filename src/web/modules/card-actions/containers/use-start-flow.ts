import { useCallback, useRef, useState, type RefObject } from "react";
import type { BoardKey } from "../../../../shared/types.js";
import { usePlaybookPicker, type PlaybookPicker } from "./use-playbook-picker";
import {
  useWorkspacePicker,
  type WorkspacePicker,
} from "./use-workspace-picker";
import {
  NETWORK_FAILURE_COPY,
  type Refusal,
  type StartFailure,
} from "@/modules/card-actions/domain/start-copy";
import {
  canStart,
  type RepoChoice,
} from "@/modules/card-actions/domain/start-request";

interface Picked {
  folder: string | null;
  chosen: RepoChoice[];
  noRepositoryBoard: boolean;
}

type StartOutcome = { ok: true } | ({ ok: false } & Refusal);

interface StartFlowInput {
  board: BoardKey;
  open: boolean;
  requestClose: () => void;
  pending: boolean;
  titled?: boolean;
  allowNoRepository?: boolean;
  playbookTag?: string;
  playbook?: string;
  preferredFolder?: string | null;
  focusRef: RefObject<HTMLElement | null>;
  send: (picks: {
    folder: string | null;
    repos: RepoChoice[];
    playbook: string | null;
  }) => Promise<StartOutcome>;
  toFailure: (refusal: Refusal) => StartFailure;
  onStarted?: () => void;
}

interface StartFlow {
  workspace: WorkspacePicker;
  playbook: PlaybookPicker;
  failure: StartFailure | null;
  canStart: boolean;
  start: () => Promise<void>;
}

/**
 * Own the pickers, the failure and the submit of a start dialog.
 *
 * @remarks
 * `submittingRef` closes the double-click window that the mutation's pending flag leaves until the next render. Only the request sits in the `try`, so an error in a callback is not shown as a network failure.
 */
export function useStartFlow(input: StartFlowInput): StartFlow {
  const {
    board,
    open,
    requestClose,
    pending,
    titled,
    allowNoRepository,
    playbookTag,
    playbook: preferredPlaybook,
    preferredFolder,
    focusRef,
    send,
    toFailure,
    onStarted,
  } = input;
  const [failure, setFailure] = useState<StartFailure | null>(null);
  const submittingRef = useRef(false);

  const clearFailure = useCallback(() => setFailure(null), []);
  const playbook = usePlaybookPicker(clearFailure, {
    tag: playbookTag,
    preferred: preferredPlaybook,
  });

  const startableWith = (picked: Picked) =>
    open &&
    canStart({
      pending,
      configError: failure?.variant === "config",
      titled,
      folder: picked.folder,
      repoCount: picked.chosen.length,
      noRepositoryBoard: picked.noRepositoryBoard,
    });

  const startWith = async (picked: Picked) => {
    if (!startableWith(picked) || submittingRef.current) return;
    submittingRef.current = true;
    focusRef.current?.focus();
    setFailure(null);
    let result: StartOutcome;
    try {
      result = await send({
        folder: picked.folder,
        repos: picked.chosen,
        playbook: playbook.selected,
      });
    } catch (err) {
      console.error(err);
      submittingRef.current = false;
      setFailure({ variant: null, text: NETWORK_FAILURE_COPY });
      return;
    }
    if (result.ok) {
      onStarted?.();
      requestClose();
      return;
    }
    submittingRef.current = false;
    const refusal = toFailure(result);
    setFailure(refusal);
    if (refusal.variant === "playbook") playbook.reload();
  };

  const workspace = useWorkspacePicker(
    board,
    clearFailure,
    allowNoRepository
      ? (picked) => {
          const noRepository = { ...picked, noRepositoryBoard: true };
          return {
            disabled: !startableWith(noRepository),
            pending,
            run: () => void startWith(noRepository),
          };
        }
      : undefined,
    preferredFolder ?? null,
  );
  const here = {
    folder: workspace.selectedFolder,
    chosen: workspace.chosen,
    noRepositoryBoard: workspace.noRepositoryBoard,
  };

  const creating = workspace.view.noRepository?.creating === true;

  return {
    workspace,
    playbook,
    failure,
    canStart: startableWith(here) && !creating,
    start: () => (creating ? Promise.resolve() : startWith(here)),
  };
}
