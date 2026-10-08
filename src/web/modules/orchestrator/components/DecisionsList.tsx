import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionCard } from "@/components/attention/AttentionCard";
import { DecisionCard } from "@/components/attention/DecisionCard";
import {
  REPLY_COPY,
  type DecisionView,
  type ReplyResult,
} from "../../../../shared/decision-view.js";
import type { AttentionRow } from "@/modules/orchestrator/domain/decision-view";

function replyText(result: ReplyResult | undefined): string | null {
  return result === undefined ? null : REPLY_COPY[result];
}

interface DecisionsListProps {
  views: readonly DecisionView[];
  rows: readonly AttentionRow[];
  results: Readonly<Record<string, ReplyResult>>;
  loading: boolean;
  disabled: boolean;
  disabledReason: string | null;
  onAnswer: (
    id: string,
    optionId: string,
    note: string | null,
  ) => Promise<boolean>;
  onReply: (cardId: string, text: string) => Promise<boolean>;
  onOpenTerminal: (cardId: string) => void;
}

export function DecisionsList({
  views,
  rows,
  results,
  loading,
  disabled,
  disabledReason,
  onAnswer,
  onReply,
  onOpenTerminal,
}: DecisionsListProps) {
  if (loading) return <Skeleton className="h-16 w-full" />;
  if (views.length + rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyDescription>No open decisions.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-(--space-md)">
      {disabledReason !== null && (
        <p className="m-0 text-sm text-muted-foreground">{disabledReason}</p>
      )}
      {views.map((view) => (
        <DecisionCard
          key={view.id}
          view={view}
          disabled={disabled}
          onAnswer={(optionId, note) => onAnswer(view.id, optionId, note)}
        />
      ))}
      {rows.map((row) => (
        <AttentionCard
          key={row.cardId}
          kind={row.kind}
          title={row.cardId}
          text={row.text}
          waiting={null}
          resultText={replyText(results[row.cardId])}
          disabled={disabled}
          onReply={(text) => onReply(row.cardId, text)}
          onOpenTerminal={() => onOpenTerminal(row.cardId)}
        />
      ))}
    </div>
  );
}
