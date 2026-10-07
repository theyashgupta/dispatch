import { useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { routeHash } from "../../../../shared/route.js";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { PageHeaderCount } from "@/components/PageHeaderCount";
import { useSidebar } from "@/components/ui/sidebar";
import { AccountSwitchContainer } from "./AccountSwitchContainer";
import { AccountChipFrame } from "@/modules/accounts/components/AccountChipFrame";
import { AccountPopover } from "@/modules/accounts/components/AccountPopover";
import { UsageChip } from "@/modules/accounts/components/UsageChip";
import { chipState } from "@/modules/accounts/domain/usage-format";
import {
  useAccountsQuery,
  useRefreshAccountUsageMutation,
} from "@/modules/accounts/queries/accounts-queries";

export function AccountChipContainer() {
  const router = useRouter();
  const { isMobile, state } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const { data } = useAccountsQuery();
  const refreshUsage = useRefreshAccountUsageMutation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      setBusyId(null);
    }
    setOpen(next);
  };

  const settle = {
    onSuccess: (result: { ok: true } | { ok: false; error: string }) =>
      setNotice(result.ok ? null : result.error),
    onSettled: () => setBusyId(null),
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
          accounts={data.accounts}
          activeId={data.activeId}
          busyId={busyId}
          notice={notice}
          onSwitch={(id) => {
            const target = data.accounts.find((a) => a.id === id);
            if (target === undefined) return;
            setOpen(false);
            setSwitchTarget(target);
          }}
          onRefresh={(id) => {
            setBusyId(id);
            refreshUsage.mutate(id, {
              ...settle,
              onError: () => setNotice("Couldn't refresh usage."),
            });
          }}
          onOpenSettings={() => {
            setOpen(false);
            void router.navigate({
              href: routeHash({ page: "accounts" }).slice(1),
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
