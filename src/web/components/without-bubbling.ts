import type { MouseEvent } from "react";

/**
 * Wrap a click action so the click does not reach the row that holds the button.
 */
export function withoutBubbling(run: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    run();
  };
}
