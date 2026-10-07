import type { AskTurn } from "../../../../shared/types.js";
import { Markdown } from "@/components/markdown/Markdown";
import { Card } from "@/components/ui/card";

interface AskMessageProps {
  turn: AskTurn;
}

export function AskMessage({ turn }: AskMessageProps) {
  if (turn.role === "user") {
    return (
      <Card className="max-w-[85%] gap-0 self-end px-4 py-2 text-base wrap-anywhere whitespace-pre-wrap shadow-none">
        {turn.text}
      </Card>
    );
  }
  return (
    <div className="min-w-0 self-stretch wrap-anywhere">
      <Markdown source={turn.text} />
    </div>
  );
}
