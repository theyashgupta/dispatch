import { Button } from "../../primitives/Button.js";
import { FloatBar } from "../../primitives/FloatBar.js";

interface SelectionBarProps {
  count: number;
  onStartGroup: () => void;
  onClear: () => void;
}

export function SelectionBar({
  count,
  onStartGroup,
  onClear,
}: SelectionBarProps) {
  if (count < 2) return null;
  return (
    <FloatBar count={count} onClear={onClear}>
      <Button variant="primary" onClick={onStartGroup}>
        {`Start ${count} as group`}
      </Button>
    </FloatBar>
  );
}
