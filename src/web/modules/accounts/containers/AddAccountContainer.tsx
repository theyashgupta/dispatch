import { useCallback, useEffect, useState } from "react";
import type { ClaudeLoginView } from "../../../../shared/types.js";
import { AddAccountDialog } from "@/modules/accounts/components/AddAccountDialog";
import {
  isForeignLogin,
  isSubmittableCode,
  viewAccountId,
} from "@/modules/accounts/domain/login-view";
import {
  useCancelLoginMutation,
  useLoginStateQuery,
  usePendingLoginStarts,
  useStartLoginMutation,
  useSubmitLoginCodeMutation,
} from "@/modules/accounts/queries/accounts-queries";
import { useSingleFlight } from "@/queries/single-flight";

const START_FAILED = "Couldn't start the Claude login.";
const SUBMIT_FAILED = "Couldn't submit the code.";
const FOREIGN_NOTICE =
  "Another Claude login is in progress in a different window. Finish or cancel it there first.";

interface AddAccountContainerProps {
  accountId?: string;
  accountEmail?: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AddAccountContainer({
  accountId,
  accountEmail,
  onClose,
  onAdded,
}: AddAccountContainerProps) {
  const { mutateAsync: startLogin } = useStartLoginMutation();
  const pendingStarts = usePendingLoginStarts();
  const [ownStart, setOwnStart] = useState(false);
  const [answered, setAnswered] = useState(false);
  const login = useLoginStateQuery(answered && pendingStarts === 0);
  const submit = useSubmitLoginCodeMutation();
  const submitOnce = useSingleFlight(submit.mutate);
  const cancel = useCancelLoginMutation();
  const [ownId, setOwnId] = useState<string | null>(accountId ?? null);
  const [view, setView] = useState<ClaudeLoginView>({ state: "idle" });
  const [foreign, setForeign] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [read, setRead] = useState<ClaudeLoginView | undefined>(undefined);

  if (login.data !== undefined && login.data !== read) {
    setRead(login.data);
    const seen = viewAccountId(login.data);
    if (isForeignLogin(ownId, seen, pendingStarts > 0)) {
      setForeign(true);
      setNotice(FOREIGN_NOTICE);
    } else {
      setForeign(false);
      setView(login.data);
    }
  }

  const begin = useCallback(
    () =>
      startLogin(accountId)
        .then(
          (result) => {
            if (result.ok) {
              setOwnStart(true);
              setOwnId((id) => result.accountId ?? id);
            } else if (!result.inFlight) {
              setNotice(result.error);
            }
          },
          () => setNotice(START_FAILED),
        )
        .finally(() => setAnswered(true)),
    [startLogin, accountId],
  );

  useEffect(() => {
    void begin();
  }, [begin]);

  useEffect(() => {
    if (view.state === "done") onAdded();
  }, [view.state, onAdded]);

  const handleSubmit = () => {
    if (foreign || !isSubmittableCode(code)) return;
    submitOnce(code.trim(), {
      onSuccess: (result) => {
        setNotice(result.ok ? null : result.error);
        setCode("");
      },
      onError: () => setNotice(SUBMIT_FAILED),
    });
  };

  const handleRetry = () => {
    setCode("");
    if (foreign) return;
    cancel.mutate(undefined, {
      onSettled: () => {
        setNotice(null);
        void begin();
      },
    });
  };

  const handleClose = () => {
    const running = view.state !== "idle" || pendingStarts > 0 || ownStart;
    if (!foreign && view.state !== "done" && running) {
      cancel.mutate(undefined, { onSettled: onClose });
      return;
    }
    onClose();
  };

  return (
    <AddAccountDialog
      title={
        accountId
          ? `Re-login ${accountEmail ?? "account"}`
          : "Add a Claude account"
      }
      view={view}
      notice={notice}
      foreign={foreign}
      code={code}
      canSubmit={isSubmittableCode(code)}
      submitting={submit.isPending}
      onCodeChange={setCode}
      onSubmit={handleSubmit}
      onRetry={handleRetry}
      onClose={handleClose}
    />
  );
}
