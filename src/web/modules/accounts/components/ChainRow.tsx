import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { chainStateBadge } from "@/modules/accounts/domain/chain-state";
import { formatCountdown } from "@/modules/accounts/domain/countdown-format";

interface ChainRowProps {
  account: ClaudeAccountSummary;
  name: string;
  now: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function ChainRow({
  account,
  name,
  now,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: ChainRowProps) {
  const badge = chainStateBadge(account.state);
  const countdown =
    account.state === "limited"
      ? formatCountdown(account.limitedUntil, now)
      : null;
  return (
    <>
      <div className="flex min-w-0 flex-auto basis-40 flex-col gap-1">
        <span
          className="truncate text-sm font-semibold"
          title={account.email || name}
          data-testid="chain-account-name"
        >
          {name}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge tone={badge.tone} data-testid="chain-state">
            {badge.label}
          </Badge>
          {account.inUse && (
            <Badge tone="accent" data-testid="chain-in-use">
              In use
            </Badge>
          )}
          {countdown && <span data-testid="chain-countdown">{countdown}</span>}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${name} up`}
          disabled={!canMoveUp}
          onClick={onMoveUp}
          data-testid="chain-move-up"
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${name} down`}
          disabled={!canMoveDown}
          onClick={onMoveDown}
          data-testid="chain-move-down"
        >
          <ArrowDownIcon aria-hidden="true" />
        </Button>
      </div>
    </>
  );
}
