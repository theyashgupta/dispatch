import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeLoginView } from "../../shared/types.js";
import {
  isForeignLogin,
  sameLoginView,
  viewAccountId,
} from "../lib/login-view.js";
import {
  cancelLogin,
  getLoginState,
  startLogin,
  submitLoginCode,
} from "../lib/api.js";

const POLL_MS = 1000;
const FOREIGN_NOTICE =
  "Another Claude login is in progress in a different window. Finish or cancel it there first.";

export interface ClaudeLoginState {
  state: ClaudeLoginView;
  notice: string | null;
  submitting: boolean;
  foreign: boolean;
  submit: (code: string) => Promise<void>;
  retry: () => Promise<void>;
  cancel: () => Promise<void>;
}

/**
 * Drive one Claude login from the browser: start it on mount, poll the server view once a second
 * while it is in flight, forward the pasted code, and cancel or retry on request.
 * @remarks The server runs one login at a time. The hook remembers the id its own start received
 * (or the re-login target) and treats a view carrying a different id as foreign, so a second
 * window can never adopt, submit into, or report success for another window's login. A start that
 * is still unanswered keeps the hook from mistaking its own echo for a foreign login, which is
 * what React's dev double-effect produces. Polling is keyed on the view's phase, not its object
 * identity, so a poll that changes nothing does not re-arm the timer.
 */
export function useClaudeLogin(accountId?: string): ClaudeLoginState {
  const [state, setState] = useState<ClaudeLoginView>({ state: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [foreign, setForeign] = useState(false);
  const ownIdRef = useRef<string | null>(accountId ?? null);
  const pendingStartsRef = useRef(0);

  const begin = useCallback(async () => {
    pendingStartsRef.current += 1;
    try {
      const result = await startLogin(accountId);
      if (result.ok) {
        ownIdRef.current = result.accountId ?? ownIdRef.current;
      } else if (!result.inFlight) {
        setNotice(result.error);
      }
    } finally {
      pendingStartsRef.current -= 1;
    }
  }, [accountId]);

  useEffect(() => {
    void begin();
  }, [begin]);

  const phase = state.state;
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const next = await getLoginState();
        if (!active) return;
        const seen = viewAccountId(next);
        if (
          isForeignLogin(ownIdRef.current, seen, pendingStartsRef.current > 0)
        ) {
          setForeign(true);
          setNotice(FOREIGN_NOTICE);
          return;
        }
        setForeign(false);
        setState((prev) => (sameLoginView(prev, next) ? prev : next));
      } catch {}
    };
    void tick();
    if (phase === "done" || phase === "error") return undefined;
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [phase]);

  const submit = useCallback(
    async (code: string) => {
      if (foreign) return;
      setSubmitting(true);
      const result = await submitLoginCode(code.trim());
      setSubmitting(false);
      setNotice(result.ok ? null : result.error);
      if (result.ok) setState(await getLoginState());
    },
    [foreign],
  );

  const retry = useCallback(async () => {
    if (foreign) return;
    await cancelLogin();
    setNotice(null);
    await begin();
    setState(await getLoginState());
  }, [begin, foreign]);

  const cancel = useCallback(async () => {
    if (foreign) return;
    await cancelLogin();
  }, [foreign]);

  return {
    state,
    notice,
    submitting,
    foreign,
    submit,
    retry,
    cancel,
  };
}
