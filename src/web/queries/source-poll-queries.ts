import { useMutation } from "@tanstack/react-query";
import { pollSource } from "./source-poll-api.js";

export const pollSourceMutationOptions = {
  mutationFn: pollSource,
};

/** Poll one source now: resolves on a 2xx and rejects with the server's reason otherwise. */
export function usePollSourceMutation() {
  return useMutation(pollSourceMutationOptions);
}
