import { NETWORK_FAILURE_COPY } from "./start-copy.js";

export const GENERATE_FAILED_COPY = "Couldn't generate a ticket. Try again.";

/**
 * Map the error code of a refused ticket save to the copy the dialog shows.
 *
 * @remarks Any code that is not a known validation code, including no code, reads as a network failure.
 */
export function acceptErrorCopy(error: string | null): string {
  switch (error) {
    case "invalid-title":
      return "Title is too long (max 300 characters).";
    case "invalid-description":
      return "Description is too long (max 20,000 characters).";
    case "content contains the DISPATCH_STATUS marker":
      return "The ticket can't contain the reserved DISPATCH_STATUS marker.";
    case "invalid-images":
      return "Only PNG, JPEG, GIF, and WebP images can be attached (up to 10, 10 MB each).";
    default:
      return NETWORK_FAILURE_COPY;
  }
}
