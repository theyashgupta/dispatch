import { Send } from "lucide-react";
import { ASK_LIMITS } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AskComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  pending: boolean;
}

export function AskComposer({
  value,
  onChange,
  onSend,
  pending,
}: AskComposerProps) {
  const canSend = !pending && value.trim() !== "";
  return (
    <div className="flex items-end gap-(--space-sm)">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) {
            return;
          }
          if (!canSend) return;
          e.preventDefault();
          onSend();
        }}
        aria-label="Ask a question about your board"
        placeholder="Ask about your tickets, inbox and agents"
        rows={2}
        maxLength={ASK_LIMITS.question}
        variant="surface"
        className="field-sizing-fixed max-h-50 min-h-16 min-w-0 flex-auto resize-y p-2 text-base md:text-base"
      />
      <Button
        size="sm"
        className="gap-(--space-xs) px-4 font-semibold has-[>svg]:px-4"
        disabled={!canSend}
        onClick={onSend}
      >
        <Send className="size-3.5" aria-hidden={true} />
        Send
      </Button>
    </div>
  );
}
