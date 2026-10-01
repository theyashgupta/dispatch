import { LINEAR_CONNECTION } from "../../../../shared/connection-meta.js";

/** Only Linear can be connected in the wizard, so no other source ever reads as connected. */
export function sourceConnected(
  source: string,
  linearConnected: boolean,
): boolean {
  return linearConnected && source === LINEAR_CONNECTION.source;
}
