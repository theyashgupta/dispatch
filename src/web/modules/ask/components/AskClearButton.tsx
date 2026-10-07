import { Button } from "@/components/ui/button";

interface AskClearButtonProps {
  disabled: boolean;
  onClear: () => void;
}

export function AskClearButton({ disabled, onClear }: AskClearButtonProps) {
  return (
    <Button
      variant="secondary-bordered"
      size="sm"
      disabled={disabled}
      onClick={onClear}
    >
      Clear
    </Button>
  );
}
