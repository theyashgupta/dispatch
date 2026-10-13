import { isHiddenCard } from "../../../shared/hidden-card.js";
import {
  CROSS_SESSION_INBOUND_VALUES,
  type Card,
  type CrossSessionInbound,
} from "../../../shared/types.js";

/**
 * Whether a launch is guarded: an orchestrator card or a Roadmap Loop start.
 *
 * @remarks The name match is a case-insensitive prefix, so "Roadmap Loop (autonomous)" matches and
 * "Roadmap + PRD + Ralph Loop" does not.
 */
export function isGuardedLaunch(
  card: Pick<Card, "source" | "startIntent">,
): boolean {
  if (isHiddenCard(card)) return true;
  return /^roadmap loop/i.test(card.startIntent?.playbook?.trim() ?? "");
}

function known(value: unknown): CrossSessionInbound | undefined {
  return CROSS_SESSION_INBOUND_VALUES.find((v) => v === value);
}

/**
 * Pick the inbound value for one launch: the start intent wins, then the board policy (or
 * `refuse`) for a guarded launch, then the config value.
 *
 * @remarks The value becomes part of a file name, so an intent or policy outside
 * `CROSS_SESSION_INBOUND_VALUES` counts as unset.
 */
export function resolveCrossSessionInbound(args: {
  intent: CrossSessionInbound | null | undefined;
  guarded: boolean;
  policy: CrossSessionInbound | null | undefined;
  config: CrossSessionInbound;
}): CrossSessionInbound {
  const intent = known(args.intent);
  if (intent) return intent;
  if (args.guarded) return known(args.policy) ?? "refuse";
  return args.config;
}
