import { AttentionCard } from "@/components/attention/AttentionCard";
import { AttentionItemCard } from "@/components/attention/AttentionItemCard";
import { DecisionCard } from "@/components/attention/DecisionCard";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  ACTION_LABELS,
  type AttentionAction,
  type AttentionRow,
} from "@/modules/dashboard/domain/attention-rows";
import type { SectionState } from "@/modules/dashboard/domain/section-state";
import { DashboardSection } from "./DashboardSection";

interface AttentionQueueSectionProps {
  state: SectionState;
  rows: AttentionRow[];
  disabled: boolean;
  disabledReason: string | null;
  replyResults: Readonly<Record<string, string>>;
  onRetry: () => void;
  onReply: (cardId: string, text: string) => Promise<boolean>;
  onAnswer: (
    id: string,
    optionId: string,
    note: string | null,
  ) => Promise<boolean>;
  onAction: (action: AttentionAction, cardId: string) => void;
  onOpenTerminal: (cardId: string) => void;
}

export function AttentionQueueSection({
  state,
  rows,
  disabled,
  disabledReason,
  replyResults,
  onRetry,
  onReply,
  onAnswer,
  onAction,
  onOpenTerminal,
}: AttentionQueueSectionProps) {
  function itemCard(row: Extract<AttentionRow, { type: "item" }>) {
    const { action, cardId } = row;
    return (
      <AttentionItemCard
        title={row.title}
        badge={row.badge}
        waiting={row.waiting}
        body={row.body}
        action={
          action === null || cardId === null
            ? null
            : {
                label: ACTION_LABELS[action],
                onClick: () => onAction(action, cardId),
              }
        }
        changeBudgetHref={row.changeBudgetHref}
        disabled={disabled}
        onOpenTerminal={cardId === null ? null : () => onOpenTerminal(cardId)}
      />
    );
  }

  return (
    <DashboardSection
      title="Attention queue"
      count={rows.length}
      state={state}
      onRetry={onRetry}
    >
      {rows.length === 0 ? (
        <Empty className="rounded-md border border-border bg-card py-8">
          <EmptyHeader>
            <EmptyTitle className="text-base font-semibold">
              Nothing needs you.
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-(--space-md)">
          {disabledReason !== null && (
            <p className="m-0 text-sm text-muted-foreground">
              {disabledReason}
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-(--space-md) p-0">
            {rows.map((row) => (
              <li key={row.id}>
                {row.type === "decision" && (
                  <DecisionCard
                    view={row.view}
                    disabled={disabled}
                    onAnswer={(optionId, note) =>
                      onAnswer(row.view.id, optionId, note)
                    }
                  />
                )}
                {row.type === "reply" && (
                  <AttentionCard
                    kind={row.kind}
                    title={row.title}
                    text={row.text}
                    waiting={row.waiting}
                    resultText={replyResults[row.cardId] ?? null}
                    disabled={disabled}
                    onReply={(text) => onReply(row.cardId, text)}
                    onOpenTerminal={() => onOpenTerminal(row.cardId)}
                  />
                )}
                {row.type === "item" && itemCard(row)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardSection>
  );
}
