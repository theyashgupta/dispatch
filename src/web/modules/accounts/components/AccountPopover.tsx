import { RefreshCw } from "lucide-react";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import type { UsageThresholds } from "../../../../shared/usage-thresholds.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { UsageDot } from "./UsageDot";
import { UsageWindowRow } from "./UsageWindowRow";
import {
  accountStateLine,
  pacedAtFor,
} from "@/modules/accounts/domain/usage-format";

interface AccountPopoverProps {
  accounts: ClaudeAccountSummary[];
  activeId: string;
  side: "top" | "right";
  now: number;
  thresholds: UsageThresholds;
  refreshingId: string | null;
  notice: string | null;
  onRefresh: (id: string) => void;
  onSwitch: (account: ClaudeAccountSummary) => void;
  onOpenAccounts: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function AccountPopover({
  accounts,
  activeId,
  side,
  now,
  thresholds,
  refreshingId,
  notice,
  onRefresh,
  onSwitch,
  onOpenAccounts,
  onCloseAutoFocus,
}: AccountPopoverProps) {
  return (
    <PopoverContent
      id="account-popover"
      role="dialog"
      aria-label="Claude accounts and usage"
      side={side}
      align={side === "top" ? "start" : "end"}
      sideOffset={4}
      onCloseAutoFocus={onCloseAutoFocus}
      className="flex max-h-[40vh] w-80 max-w-(--radix-popover-content-available-width) flex-col gap-2 overflow-y-auto bg-card p-2 text-sm text-foreground"
    >
      {notice && (
        <div role="alert" className="text-destructive-text">
          {notice}
        </div>
      )}
      {accounts.map((account) => {
        const isActive = account.id === activeId;
        const line = accountStateLine(account, now);
        const pacedAt = pacedAtFor(account.usage);
        const lineText = [line?.text, account.subscriptionType]
          .filter(Boolean)
          .join(" · ");
        return (
          <section
            key={account.id}
            aria-label={account.email}
            data-account-id={account.id}
            className="flex shrink-0 flex-col gap-1 rounded-md border border-border px-2 py-1"
          >
            <div className="flex min-w-0 items-center gap-1">
              <span
                className="min-w-0 flex-auto truncate font-semibold"
                title={account.email}
              >
                {account.email}
              </span>
              {isActive && <Badge tone="accent">Active</Badge>}
              <Button
                variant="ghost"
                size="icon-md"
                aria-label={`Refresh usage for ${account.email}`}
                title="Refresh usage"
                disabled={refreshingId === account.id}
                onClick={() => onRefresh(account.id)}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
              </Button>
              {!isActive && (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Switch to ${account.email}`}
                  onClick={() => onSwitch(account)}
                >
                  Switch
                </Button>
              )}
            </div>
            {account.usage.windows.map((w) => (
              <UsageWindowRow
                key={`${w.kind}:${w.label}`}
                usageWindow={w}
                pacedAt={pacedAt}
                thresholds={thresholds}
              />
            ))}
            {lineText && (
              <div
                data-testid="account-state-line"
                className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
              >
                {line && <UsageDot tone={line.tone} />}
                <span className="truncate">{lineText}</span>
              </div>
            )}
          </section>
        );
      })}
      <div className="border-t border-border pt-2">
        <Button
          variant="link"
          size="sm"
          className="h-auto justify-start px-0"
          onClick={onOpenAccounts}
        >
          Accounts and Usage
        </Button>
      </div>
    </PopoverContent>
  );
}
