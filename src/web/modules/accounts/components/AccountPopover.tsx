import { RefreshCw } from "lucide-react";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { UsageWindowRow } from "./UsageWindowRow";
import { pacedAtFor, statusCopy } from "@/modules/accounts/domain/usage-format";

interface AccountPopoverProps {
  accounts: ClaudeAccountSummary[];
  activeId: string;
  busyId: string | null;
  notice: string | null;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onOpenSettings: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function AccountPopover({
  accounts,
  activeId,
  busyId,
  notice,
  onSwitch,
  onRefresh,
  onOpenSettings,
  onCloseAutoFocus,
}: AccountPopoverProps) {
  return (
    <PopoverContent
      id="account-popover"
      role="dialog"
      aria-label="Claude accounts and usage"
      side="top"
      align="start"
      sideOffset={0}
      avoidCollisions={false}
      onCloseAutoFocus={onCloseAutoFocus}
      className="flex max-h-[70vh] w-(--radix-popover-trigger-width) flex-col gap-2 overflow-y-auto bg-card p-2 text-sm text-foreground"
    >
      {notice && (
        <div role="alert" className="text-destructive-text">
          {notice}
        </div>
      )}
      {accounts.map((account) => {
        const copy = statusCopy(account.usage);
        const pacedAt = pacedAtFor(account.usage);
        const isActive = account.id === activeId;
        return (
          <div
            key={account.id}
            className="flex flex-col gap-1 rounded-md border border-border px-2 py-1"
            data-account-id={account.id}
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
                disabled={busyId === account.id}
                onClick={() => onRefresh(account.id)}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
              </Button>
              {!isActive && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyId === account.id}
                  onClick={() => onSwitch(account.id)}
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
              />
            ))}
            <span className="text-xs text-muted-foreground">
              {copy ??
                (account.usage.fetchedAt
                  ? `Checked ${new Date(account.usage.fetchedAt).toLocaleTimeString()}`
                  : "")}
              {account.subscriptionType ? ` · ${account.subscriptionType}` : ""}
            </span>
          </div>
        );
      })}
      <Button
        variant="secondary"
        size="sm"
        className="justify-start"
        onClick={onOpenSettings}
      >
        Manage accounts
      </Button>
    </PopoverContent>
  );
}
