import { useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { sentryFixPrompt } from "../../../../shared/agent-prompt.js";
import {
  SNOOZE_LABELS,
  snoozeUntil,
  type SnoozePreset,
} from "../../../../shared/snooze.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import {
  usePromoteItemMutation,
  useSnoozeItemMutation,
} from "@/queries/item-actions-queries";
import { useSingleFlight } from "@/queries/single-flight";
import { ErrorDetail } from "@/modules/errors/components/ErrorDetail";
import type { ErrorRow } from "@/modules/errors/domain/error-rows";
import { sentryFailureText } from "@/modules/errors/domain/sentry-error-copy";
import { sentryContext } from "@/modules/errors/domain/sentry-context";
import {
  useResolveSentryIssueMutation,
  useSentryIssueQuery,
} from "@/modules/errors/queries/errors-queries";

interface ErrorDetailContainerProps {
  row: ErrorRow;
  onBack?: () => void;
  onStartAgent: (row: ErrorRow, prompt: string, context: string) => void;
  onNotice: (text: string) => void;
}

export function ErrorDetailContainer({
  row,
  onBack,
  onStartAgent,
  onNotice,
}: ErrorDetailContainerProps) {
  const [error, setError] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const { data: result } = useSentryIssueQuery(row.issueId);
  const detail = result?.ok ? result.detail : null;
  const loadError =
    result && !result.ok ? sentryFailureText(result.error) : null;

  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useAppStore(appStore, (s) => s.board);
  const promote = usePromoteItemMutation(board, {
    onSuccess: ({ card }) => onNotice(`Created ${card.identifier}`),
    onError: () => setError("Couldn't create the ticket. Try again."),
  });
  const resolve = useResolveSentryIssueMutation((outcome) => {
    if (outcome.ok) onNotice("Resolved in Sentry");
    else setError(sentryFailureText(outcome.error));
  });
  const snooze = useSnoozeItemMutation<{
    itemId: string;
    until: string;
    preset: SnoozePreset;
  }>({
    onSuccess: (_, vars) => {
      setSnoozeOpen(false);
      onNotice(
        `${row.shortId || row.title} snoozed for ${SNOOZE_LABELS[vars.preset]}`,
      );
    },
    onError: () => setError("Couldn't snooze this error. Try again."),
  });
  const submitPromote = useSingleFlight(promote.mutate);
  const submitResolve = useSingleFlight(resolve.mutate);
  const submitSnooze = useSingleFlight(snooze.mutate);

  const busy = promote.isPending
    ? "ticket"
    : resolve.isPending
      ? "resolve"
      : snooze.isPending
        ? "snooze"
        : null;

  function handleSnooze(preset: SnoozePreset) {
    setError(null);
    let until: string;
    try {
      until = snoozeUntil(preset, new Date()).toISOString();
    } catch {
      setError("Couldn't snooze this error. Try again.");
      return;
    }
    submitSnooze({ itemId: row.itemId, until, preset });
  }

  return (
    <ErrorDetail
      row={row}
      detail={detail}
      loading={result === undefined}
      loadError={loadError}
      busy={busy}
      error={error}
      snoozeOpen={snoozeOpen}
      onBack={onBack}
      onFixWithAgent={() =>
        detail &&
        onStartAgent(row, sentryFixPrompt(detail), sentryContext(detail))
      }
      onCreateTicket={() => {
        if (!detail) return;
        setError(null);
        submitPromote({ itemId: row.itemId, context: sentryContext(detail) });
      }}
      onResolve={() => {
        setError(null);
        submitResolve({ issueId: row.issueId });
      }}
      onToggleSnooze={() => setSnoozeOpen((open) => !open)}
      onSnooze={handleSnooze}
      onOpenInSentry={() => {
        if (isWebUrl(row.url)) window.open(row.url, "_blank", "noopener");
      }}
    />
  );
}
