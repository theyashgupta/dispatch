import { useCallback, useState } from "react";
import type { SlackThread } from "../../shared/types.js";
import { getSlackThread } from "../lib/api.js";

export type SlackThreadState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; thread: SlackThread }
  | {
      status: "error";
      reason: "rejected" | "unreachable";
      providerError?: string;
    };

/**
 * A Slack item's thread, loaded only when `load` is called.
 *
 * @remarks Never fetches on mount or on a timer, so expanding a row costs no Slack call.
 */
export function useSlackThread(itemId: string): {
  state: SlackThreadState;
  load: () => void;
} {
  const [state, setState] = useState<SlackThreadState>({ status: "idle" });
  const load = useCallback(() => {
    setState({ status: "loading" });
    void getSlackThread(itemId).then((result) => {
      setState(
        result.ok
          ? { status: "loaded", thread: result.thread }
          : { status: "error", ...result },
      );
    });
  }, [itemId]);
  return { state, load };
}
