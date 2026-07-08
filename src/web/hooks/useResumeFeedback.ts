import { useEffect, useState } from "react";
import type { Card as CardModel } from "../../shared/types.js";
import { resumeCard } from "../lib/api.js";
import {
  RESUME_WATCHDOG_MS,
  resumeFailureCopy,
} from "../lib/resumeFeedback.js";

interface ResumeFeedback {
  resuming: boolean;
  resumeFailed: boolean;
  watchdogFired: boolean;
  failureCopy: string;
  onResume: () => void;
}

/**
 * Drive the Resume-affordance state machine shared by the board card and the
 * panel's session-lost section.
 *
 * @remarks
 * Single source of truth for the resume feedback lifecycle so the two
 * affordances cannot drift: optimistic `resuming` flips off via a server
 * `resumeError` (derive-from-props, no effect), a watchdog surfaces a
 * "still resuming" nudge after {@link RESUME_WATCHDOG_MS}, and a non-2xx POST
 * response marks the request failed. All feedback state resets when
 * `sessionLost` transitions — the board card persists across session-lost
 * episodes, so stale watchdog/failure notices must not survive a recovery.
 */
export function useResumeFeedback(card: CardModel): ResumeFeedback {
  const [resuming, setResuming] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [resumeStatus, setResumeStatus] = useState<number | null>(null);
  const [watchdogFired, setWatchdogFired] = useState(false);

  const [prevResumeError, setPrevResumeError] = useState(card.resumeError);
  if (card.resumeError !== prevResumeError) {
    setPrevResumeError(card.resumeError);
    if (card.resumeError != null) setResuming(false);
  }

  const sessionLost = card.sessionLost === true;
  const [prevSessionLost, setPrevSessionLost] = useState(sessionLost);
  if (sessionLost !== prevSessionLost) {
    setPrevSessionLost(sessionLost);
    setResuming(false);
    setRequestFailed(false);
    setResumeStatus(null);
    setWatchdogFired(false);
  }

  useEffect(() => {
    if (!resuming) return;
    const id = setTimeout(() => {
      setResuming(false);
      setWatchdogFired(true);
    }, RESUME_WATCHDOG_MS);
    return () => clearTimeout(id);
  }, [resuming]);

  const onResume = () => {
    setResuming(true);
    setRequestFailed(false);
    setResumeStatus(null);
    setWatchdogFired(false);
    void resumeCard(card.id).then((r) => {
      if (!r.ok) {
        setResumeStatus(r.status);
        setRequestFailed(true);
        setResuming(false);
      }
    });
  };

  return {
    resuming,
    resumeFailed: !resuming && (requestFailed || card.resumeError != null),
    watchdogFired: watchdogFired && !resuming,
    failureCopy: resumeFailureCopy(card.resumeError, resumeStatus),
    onResume,
  };
}
