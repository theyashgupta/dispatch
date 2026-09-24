import { Button } from "../../primitives/Button.js";
import { FloatBar } from "../../primitives/FloatBar.js";

interface SessionsBulkBarProps {
  count: number;
  tickets: number;
  cleanup: boolean;
  resume: boolean;
  onCleanup: () => void;
  onResume: () => void;
  onClear: () => void;
}

export function SessionsBulkBar({
  count,
  tickets,
  cleanup,
  resume,
  onCleanup,
  onResume,
  onClear,
}: SessionsBulkBarProps) {
  if (count === 0) return null;
  return (
    <FloatBar count={count} onClear={onClear} testId="sessions-bulk-bar">
      <Button variant="primary" disabled={!cleanup} onClick={onCleanup}>
        {`Clean up (${tickets})`}
      </Button>
      <Button variant="secondary" disabled={!resume} onClick={onResume}>
        {`Resume lost (${tickets})`}
      </Button>
    </FloatBar>
  );
}
