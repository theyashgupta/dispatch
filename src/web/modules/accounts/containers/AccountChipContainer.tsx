import { useRef, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { pageLocation } from "../../../../shared/route.js";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { PageHeaderCount } from "@/components/PageHeaderCount";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useSidebar } from "@/components/ui/sidebar";
import { AccountSwitchContainer } from "./AccountSwitchContainer";
import { AccountChipFrame } from "@/modules/accounts/components/AccountChipFrame";
import { AccountPopover } from "@/modules/accounts/components/AccountPopover";
import { UsageChip } from "@/modules/accounts/components/UsageChip";
import { chipState } from "@/modules/accounts/domain/usage-format";
import { useNow } from "@/modules/accounts/hooks/use-now";
import { useRefreshAccountUsageMutation } from "@/modules/accounts/queries/accounts-queries";
import { useAccountsQuery } from "@/queries/accounts-queries";

const STATE_TICK_MS = 30_000;

export function AccountChipContainer() {
  const router = useRouter();
  const { appStore } = useRouteContext({ from: "__root__" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  const { isMobile, state } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const { data } = useAccountsQuery();
  const refreshUsage = useRefreshAccountUsageMutation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const now = useNow(STATE_TICK_MS);
  const [switchTarget, setSwitchTarget] = useState<ClaudeAccountSummary | null>(
    null,
  );

  const active =
    data?.accounts.find((a) => a.id === data.activeId) ?? data?.accounts[0];
  if (data === undefined || active === undefined) return null;
  const chip = chipState(active.usage);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setNotice(null);
      setSwitchOpen(false);
    }
    setOpen(next);
  };

  return (
    <AccountChipFrame collapsed={collapsed}>
      <UsageChip
        email={active.email}
        summary={chip.summary}
        label={chip.label}
        tone={chip.tone}
        open={open}
        triggerRef={triggerRef}
        onOpenChange={handleOpenChange}
      >
        <AccountPopover
          account={active}
          others={data.accounts.filter((a) => a.id !== active.id)}
          side={collapsed ? "right" : "top"}
          now={now}
          refreshing={refreshUsage.isPending}
          notice={notice}
          switchOpen={switchOpen}
          onToggleSwitch={() => setSwitchOpen((v) => !v)}
          onSwitch={(target) => {
            setOpen(false);
            setSwitchTarget(target);
          }}
          onRefresh={() =>
            refreshUsage.mutate(active.id, {
              onSuccess: (r) => setNotice(r.ok ? null : r.error),
              onError: () => setNotice("Couldn't refresh usage."),
            })
          }
          onOpenAccounts={() => {
            setOpen(false);
            void router.navigate({
              href: pageLocation({ page: "accounts" }, boardKey),
            });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (document.activeElement === document.body) {
              triggerRef.current?.focus();
            }
          }}
        />
      </UsageChip>
      {switchTarget && (
        <AccountSwitchContainer
          target={switchTarget}
          sessions={data.sessions}
          onClose={() => setSwitchTarget(null)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        />
      )}
    </AccountChipFrame>
  );
}

export function AccountsHeaderContainer() {
  const { data } = useAccountsQuery();
  const count = data?.accounts.length;
  return count != null ? <PageHeaderCount count={count} /> : null;
}
