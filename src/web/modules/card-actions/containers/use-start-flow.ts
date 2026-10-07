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

type StartOutcome = { ok: true } | ({ ok: false } & Refusal);

interface StartFlowInput {
  board: BoardKey;
  open: boolean;
  requestClose: () => void;
  pending: boolean;
  titled?: boolean;
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
    focusRef,
    send,
    toFailure,
    onStarted,
  } = input;
  const [failure, setFailure] = useState<StartFailure | null>(null);
  const submittingRef = useRef(false);

  const clearFailure = useCallback(() => setFailure(null), []);
  const workspace = useWorkspacePicker(board, clearFailure);
  const playbook = usePlaybookPicker(clearFailure);

  const startable =
    open &&
    canStart({
      pending,
      configError: failure?.variant === "config",
      folder: workspace.selectedFolder,
      repoCount: workspace.chosen.length,
      titled,
    });

  const start = async () => {
    if (!startable || submittingRef.current) return;
    submittingRef.current = true;
    focusRef.current?.focus();
    setFailure(null);
    let result: StartOutcome;
    try {
      result = await send({
        folder: workspace.selectedFolder,
        repos: workspace.chosen,
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

  return { workspace, playbook, failure, canStart: startable, start };
}
