import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent } from "@/components/ui/item";
import { UsageDot } from "./UsageDot";
import { chainStateBadge } from "@/modules/accounts/domain/chain-state";
import {
  tightestWindow,
  loginExpiryView,
  toneFor,
  usageLine,
} from "@/modules/accounts/domain/usage-format";

interface AccountRowProps {
  account: ClaudeAccountSummary;
  active: boolean;
  now: number;
  reloginDisabled: boolean;
  onSwitch: () => void;
  onRelogin: () => void;
  onRemove: () => void;
  onRemoveDuplicate: () => void;
}

export function AccountRow({
  account,
  active,
  now,
  reloginDisabled,
  onSwitch,
  onRelogin,
  onRemove,
  onRemoveDuplicate,
}: AccountRowProps) {
  const tightest =
    account.usage.status === "ok"
      ? tightestWindow(account.usage.windows)
      : null;
  const expiry = loginExpiryView(account.usage.loginExpiresAt, now);
  const shadowed = account.state === "shadowed-by-home";
  const meta = [
    account.managedDefault
      ? "Default (Dispatch login)"
      : account.isDefault
        ? "Default (your home login)"
        : account.orgName,
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
        {expiry && (
          <span
            className={
              expiry.tone === "warning"
                ? "text-xs text-(--status-stale)"
                : "text-xs text-muted-foreground"
            }
            data-testid="account-login-expiry"
            data-tone={expiry.tone}
          >
            {expiry.text}
          </span>
        )}
      </ItemContent>
      {active && <Badge tone="accent">Active</Badge>}
      {(shadowed || account.state === "needs-login") && (
        <Badge tone={chainStateBadge(account.state).tone}>
          {chainStateBadge(account.state).label}
        </Badge>
      )}
      {!active && !shadowed && (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Switch to ${account.email}`}
          onClick={onSwitch}
        >
          Switch
        </Button>
      )}
      {shadowed && (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Remove duplicate ${account.email}`}
          onClick={onRemoveDuplicate}
        >
          Remove duplicate
        </Button>
      )}
      {!account.isDefault && !shadowed && (
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
