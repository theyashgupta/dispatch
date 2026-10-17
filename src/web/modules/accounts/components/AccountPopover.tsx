import { ChevronRight, RefreshCw } from "lucide-react";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { UsageDot } from "./UsageDot";
import { UsageWindowRow } from "./UsageWindowRow";
import { cn } from "@/lib/utils";
import {
  accountStateLine,
  findWindow,
  popoverWindows,
} from "@/modules/accounts/domain/usage-format";

interface AccountPopoverProps {
  account: ClaudeAccountSummary;
  others: ClaudeAccountSummary[];
  side: "top" | "right";
  now: number;
  refreshing: boolean;
  notice: string | null;
  switchOpen: boolean;
  onToggleSwitch: () => void;
  onRefresh: () => void;
  onSwitch: (account: ClaudeAccountSummary) => void;
  onOpenAccounts: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function AccountPopover({
  account,
  others,
  side,
  now,
  refreshing,
  notice,
  switchOpen,
  onToggleSwitch,
  onRefresh,
  onSwitch,
  onOpenAccounts,
  onCloseAutoFocus,
}: AccountPopoverProps) {
  const bars = popoverWindows(account.usage);
  const line = accountStateLine(account, now);
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
      <div className="flex min-w-0 items-center gap-1">
        <span
          className="min-w-0 flex-auto truncate font-semibold"
          title={account.email}
        >
          {account.email}
        </span>
        <Button
          variant="ghost"
          size="icon-md"
          aria-label="Refresh usage"
          title="Refresh usage"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      {notice && (
        <div role="alert" className="text-destructive-text">
          {notice}
        </div>
      )}
      {bars.length > 0 && (
        <div className="flex flex-col gap-1">
          {bars.map((w) => (
            <UsageWindowRow key={w.kind} usageWindow={w} />
          ))}
        </div>
      )}
      {line && (
        <div
          data-testid="account-state-line"
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <UsageDot tone={line.tone} />
          <span>{line.text}</span>
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-col">
          <Button
            variant="ghost"
            size="sm"
            className="justify-between"
            aria-expanded={switchOpen}
            aria-controls="account-switch-list"
            onClick={onToggleSwitch}
          >
            Switch account
            <ChevronRight
              className={cn("size-3.5", switchOpen && "rotate-90")}
              aria-hidden="true"
            />
          </Button>
          {switchOpen && (
            <ul
              id="account-switch-list"
              role="list"
              aria-label="Other accounts"
              className="flex list-none flex-col p-0"
            >
              {others.map((a) => {
                const weekly = findWindow(a.usage, "weekly_all");
                const label = `Switch to ${a.email}, weekly ${weekly ? `${weekly.percent}%` : "n/a"}`;
                return (
                  <li key={a.id}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between"
                      aria-label={label}
                      onClick={() => onSwitch(a)}
                    >
                      <span
                        className="min-w-0 flex-auto truncate text-left"
                        title={a.email}
                      >
                        {a.email}
                      </span>
                      <span className="text-muted-foreground">
                        {weekly ? `${weekly.percent}%` : "n/a"}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
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
