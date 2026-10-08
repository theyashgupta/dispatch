import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { DecisionView } from "@/modules/orchestrator/domain/decision-view";

interface DecisionCardProps {
  view: DecisionView;
  disabled: boolean;
  onAnswer: (optionId: string, note: string | null) => Promise<boolean>;
}

export function DecisionCard({ view, disabled, onAnswer }: DecisionCardProps) {
  const [text, setText] = useState("");
  const typed = text.trim();
  const canSend = !disabled && typed !== "" && view.otherOptionId !== null;
  async function sendAnswer() {
    if (view.otherOptionId === null) return;
    if (await onAnswer(view.otherOptionId, typed)) setText("");
  }
  return (
    <Card className="gap-(--space-md) py-(--space-lg)">
      <CardHeader className="gap-(--space-xs)">
        <CardTitle className="text-base font-semibold">
          {view.question}
        </CardTitle>
        <CardDescription>{view.meta}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-(--space-sm)">
        {view.proposalTitles.length > 0 && (
          <ul className="m-0 flex list-disc flex-col gap-(--space-xs) pl-(--space-xl) text-sm text-foreground">
            {view.proposalTitles.map((title, index) => (
              <li key={index}>{title}</li>
            ))}
          </ul>
        )}
        {view.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-between"
            onClick={() => void onAnswer(option.id, null)}
          >
            <span className="min-w-0 truncate">{option.label}</span>
            {option.recommended && <Badge tone="neutral">Recommended</Badge>}
          </Button>
        ))}
        {view.otherOptionId !== null && (
          <>
            <Field>
              <Textarea
                id={`decision-${view.id}-other`}
                aria-label={`Your answer to ${view.question}`}
                value={text}
                placeholder="Or type an answer"
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canSend}
                onClick={() => void sendAnswer()}
              >
                Send answer
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
