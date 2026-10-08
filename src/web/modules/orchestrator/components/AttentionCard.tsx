import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  REPLY_COPY,
  type AttentionRow,
  type ReplyResult,
} from "@/modules/orchestrator/domain/decision-view";
import { sessionStateLabel } from "@/modules/orchestrator/domain/session-state-label";
import { StateBadge } from "./StateBadge";

interface AttentionCardProps {
  row: AttentionRow;
  result: ReplyResult | undefined;
  disabled: boolean;
  onReply: (text: string) => Promise<boolean>;
  onOpenTerminal: () => void;
}

export function AttentionCard({
  row,
  result,
  disabled,
  onReply,
  onOpenTerminal,
}: AttentionCardProps) {
  const [text, setText] = useState("");
  const typed = text.trim();
  const state = sessionStateLabel(row.kind);
  async function sendReply() {
    if (await onReply(typed)) setText("");
  }
  return (
    <Card className="gap-(--space-md) py-(--space-lg)">
      <CardHeader className="gap-(--space-xs)">
        <CardTitle className="flex items-center gap-(--space-sm) text-base font-semibold">
          <span className="min-w-0 truncate">{row.cardId}</span>
          {state !== null && <StateBadge state={state} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-(--space-sm)">
        {row.text !== null && (
          <p className="m-0 text-sm whitespace-pre-wrap text-foreground">
            {row.text}
          </p>
        )}
        {row.kind === "needs_input" ? (
          <>
            <Field>
              <Textarea
                id={`attention-${row.cardId}-reply`}
                aria-label={`Reply to ${row.cardId}`}
                value={text}
                placeholder="Type a reply"
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            <div className="flex items-center gap-(--space-sm)">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || typed === ""}
                onClick={() => void sendReply()}
              >
                Send reply
              </Button>
              {result !== undefined && (
                <span role="status" className="text-sm text-muted-foreground">
                  {REPLY_COPY[result]}
                </span>
              )}
            </div>
          </>
        ) : (
          <div>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={onOpenTerminal}
            >
              Open terminal
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
