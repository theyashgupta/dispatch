import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "What needs me right now",
  "What did the agents finish this week",
];

interface AskSuggestionsProps {
  onPick: (question: string) => void;
}

export function AskSuggestions({ onPick }: AskSuggestionsProps) {
  return (
    <div className="flex flex-wrap gap-(--space-sm)">
      {SUGGESTIONS.map((question) => (
        <Button
          key={question}
          variant="secondary-bordered"
          size="sm"
          onClick={() => onPick(question)}
        >
          {question}
        </Button>
      ))}
    </div>
  );
}
