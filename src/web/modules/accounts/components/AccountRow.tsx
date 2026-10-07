import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent } from "@/components/ui/item";
import { UsageDot } from "./UsageDot";
import {
  tightestWindow,
  toneFor,
  usageLine,
} from "@/modules/accounts/domain/usage-format";

interface AccountRowProps {
  account: ClaudeAccountSummary;
  active: boolean;
  reloginDisabled: boolean;
  onSwitch: () => void;
  onRelogin: () => void;
  onRemove: () => void;
}

export function AccountRow({
  account,
  active,
  reloginDisabled,
  onSwitch,
  onRelogin,
  onRemove,
}: AccountRowProps) {
  const tightest =
    account.usage.status === "ok"
      ? tightestWindow(account.usage.windows)
      : null;
  const meta = [
    account.isDefault ? "Default (your home login)" : account.orgName,
    account.subscriptionType,
    account.lastLoginAt
      ? `signed in ${new Date(account.lastLoginAt).toLocaleString()}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Item
      variant="outline"
      size="sm"
      className="gap-2 bg-card p-2 text-foreground"
      data-account-id={account.id}
    >
      <ItemContent className="min-w-40 flex-auto gap-1">
        <span className="truncate text-sm font-semibold" title={account.email}>
          {account.email}
        </span>
        <span className="text-xs text-muted-foreground">{meta}</span>
        <span className="text-xs text-muted-foreground">
          <UsageDot
            tone={tightest ? toneFor(tightest.percent) : "muted"}
            className="mr-1 inline-block"
          />
          {usageLine(account.usage)}
        </span>
      </ItemContent>
      {active && <Badge tone="accent">Active</Badge>}
      {!active && (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Switch to ${account.email}`}
          onClick={onSwitch}
        >
          Switch
        </Button>
      )}
      {!account.isDefault && (
        <>
          <Button
            variant="secondary"
            size="sm"
            disabled={reloginDisabled}
            onClick={onRelogin}
          >
            Re-login
          </Button>
          <Button variant="secondary" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </>
      )}
    </Item>
  );
}
