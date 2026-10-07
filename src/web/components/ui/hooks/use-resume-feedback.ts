import { useEffect, useState } from "react";
import type { Card as CardModel } from "../../../../shared/types.js";
import {
  RESUME_WATCHDOG_MS,
  resumeFailureCopy,
} from "../../../../shared/resume-feedback.js";

export type ResumeOutcome = { ok: true } | { ok: false; status: number | null };

interface ResumeFeedback {
  resuming: boolean;
  resumeFailed: boolean;
  watchdogFired: boolean;
  failureCopy: string;
  onResume: () => void;
}

/**
 * Drive the Resume affordance state machine of a board card and the panel's session-lost section.
 *
 * @remarks
 * An optimistic `resuming` flips off through a server `resumeError`, a watchdog surfaces a
 * "still resuming" nudge after {@link RESUME_WATCHDOG_MS}, and a non-2xx response marks the
 * request failed. All feedback resets when `sessionLost` changes or the active session changes,
 * because the card outlives a session-lost episode.
 */
export function useResumeFeedback(
  card: CardModel,
  resume: (id: string) => Promise<ResumeOutcome>,
): ResumeFeedback {
  const [resuming, setResuming] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [resumeStatus, setResumeStatus] = useState<number | null>(null);
  const [watchdogFired, setWatchdogFired] = useState(false);

  const [prevResumeError, setPrevResumeError] = useState(card.resumeError);
  if (card.resumeError !== prevResumeError) {
    setPrevResumeError(card.resumeError);
    if (card.resumeError != null) setResuming(false);
  }

  const resetKey = `${card.sessionLost === true}:${card.activeSessionId ?? ""}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
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
    void resume(card.id).then((r) => {
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
