import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { DecisionCard, PlanTable } from "@/components/attention/DecisionCard";
import { Badge } from "@/components/ui/badge";
import { Item, ItemContent } from "@/components/ui/item";
import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";
import type { ConversationEntry } from "@/modules/orchestrator/domain/conversation-view";

export interface DecisionFailure {
  message: string;
  onRetry: () => void;
}

interface ConversationListProps {
  entries: readonly ConversationEntry[];
  disabled: boolean;
  failures: Readonly<Record<string, DecisionFailure | null>>;
  onAnswer: (
    id: string,
    optionId: string,
    note: string | null,
  ) => Promise<boolean>;
}

function EntryTime({ at }: { at: string | null }) {
  if (at === null) return null;
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {formatAge(at, nowMs())}
    </span>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

export function ConversationList({
  entries,
  disabled,
  failures,
  onAnswer,
}: ConversationListProps) {
  return (
    <ol aria-label="Conversation" className="m-0 flex list-none flex-col p-0">
      {entries.map((entry) => {
        if (entry.kind === "message") {
          return (
            <li key={entry.id}>
              <Item size="sm">
                <ItemContent className="min-w-0">
                  <div className="flex items-center gap-(--space-sm)">
                    <Eyebrow>{entry.author}</Eyebrow>
                    <EntryTime at={entry.at} />
                  </div>
                  <p className="m-0 text-sm wrap-anywhere whitespace-pre-wrap">
                    {entry.text}
                  </p>
                </ItemContent>
              </Item>
            </li>
          );
        }
        const failure = failures[entry.id] ?? null;
        return (
          <li key={entry.id}>
            <Item size="sm">
              <ItemContent className="min-w-0">
                <div className="flex items-center gap-(--space-sm)">
                  <Badge tone="neutral">{entry.badge}</Badge>
                  <EntryTime at={entry.at} />
                </div>
                {entry.state === "open" ? (
                  <>
                    <DecisionCard
                      view={entry.view}
                      disabled={disabled}
                      onAnswer={(optionId, note) =>
                        onAnswer(entry.id, optionId, note)
                      }
                    />
                    {failure !== null && (
                      <PanelAlertBar
                        message={failure.message}
                        retryDisabled={disabled}
                        onRetry={failure.onRetry}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <p className="m-0 text-sm font-semibold wrap-anywhere">
                      {entry.view.question}
                    </p>
                    {entry.view.planRows.length > 0 && (
                      <PlanTable rows={entry.view.planRows} />
                    )}
                    <p className="m-0 text-sm wrap-anywhere">
                      {entry.answerLabel === null
                        ? "Answered"
                        : `Answered: ${entry.answerLabel}`}
                    </p>
                    {entry.answerNote !== null && (
                      <p className="m-0 text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                        {entry.answerNote}
                      </p>
                    )}
                  </>
                )}
              </ItemContent>
            </Item>
          </li>
        );
      })}
    </ol>
  );
}
