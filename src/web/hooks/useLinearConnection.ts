import {
  useSourceConnection,
  type SourceConnectionState,
} from "./useSourceConnection.js";

/** The Linear connection behind the Linear card. */
export function useLinearConnection(): SourceConnectionState {
  return useSourceConnection("linear");
}
