import { useState } from "react";
import { SessionStateBadge } from "@/components/badges/SessionStateBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

interface AttentionCardProps {
  kind: "needs_input" | "stale" | "permission_prompt";
  title: string;
  text: string | null;
  waiting: string | null;
  resultText: string | null;
  disabled: boolean;
  onReply: (text: string) => Promise<boolean>;
  onOpenTerminal: () => void;
}

export function AttentionCard({
  kind,
  title,
  text,
  waiting,
  resultText,
  disabled,
  onReply,
  onOpenTerminal,
}: AttentionCardProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const typed = draft.trim();
  async function sendReply() {
    setSending(true);
    try {
      if (await onReply(typed)) setDraft("");
    } finally {
      setSending(false);
    }
  }
  return (
    <Card className="gap-(--space-md) py-(--space-lg) wrap-anywhere">
      <CardHeader className="gap-(--space-xs)">
        <CardTitle className="flex flex-wrap items-center gap-(--space-sm) text-base font-semibold">
          <span className="min-w-0 truncate">{title}</span>
          <SessionStateBadge state={kind} />
          {waiting !== null && (
            <span className="ml-auto shrink-0 text-xs font-normal whitespace-nowrap text-muted-foreground tabular-nums">
              {waiting}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-(--space-sm)">
        {kind !== "permission_prompt" ? (
          <>
            {text !== null && (
              <p className="m-0 text-sm whitespace-pre-wrap text-foreground">
                {text}
              </p>
            )}
            <Field>
              <Textarea
                aria-label={`Reply to ${title}`}
                value={draft}
                placeholder={`Reply to ${title}`}
                onChange={(event) => setDraft(event.target.value)}
              />
              <FieldDescription>
                {draft.length} of 500 characters. A longer reply goes as a file.
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap items-center gap-(--space-sm)">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || sending || typed === ""}
                onClick={() => void sendReply()}
              >
                Send reply
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={onOpenTerminal}
              >
                Open terminal
              </Button>
              {resultText !== null && (
                <span role="status" className="text-sm text-muted-foreground">
                  {resultText}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            {text !== null && (
              <>
                <span className="text-xs font-medium text-muted-foreground">
                  Prompt from the pane
                </span>
                <pre className="m-0 overflow-x-auto rounded-md border border-border bg-muted p-2 font-mono text-sm whitespace-pre-wrap text-foreground">
                  <code>{text}</code>
                </pre>
              </>
            )}
            <p className="m-0 text-sm text-muted-foreground">
              Answer this prompt in the terminal.
            </p>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
