import { useRef, useState } from "react";
import type { ClaudeAccountSummary } from "../../../../shared/types.js";
import { AccountSwitchContainer } from "./AccountSwitchContainer";
import { AccountPopover } from "@/modules/accounts/components/AccountPopover";
import { UsageChip } from "@/modules/accounts/components/UsageChip";
import { chipState } from "@/modules/accounts/domain/usage-format";
import {
  useAccountsQuery,
  useRefreshAccountUsageMutation,
} from "@/modules/accounts/queries/accounts-queries";

interface AccountChipContainerProps {
  onOpenSettings: () => void;
}

export function AccountChipContainer({
  onOpenSettings,
}: AccountChipContainerProps) {
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
    <>
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
            onOpenSettings();
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
    </>
  );
}
