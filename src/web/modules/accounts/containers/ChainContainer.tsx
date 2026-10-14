import { useState } from "react";
import type {
  ChainView,
  ClaudeAccountSummary,
} from "../../../../shared/types.js";
import { ChainPanel } from "@/modules/accounts/components/ChainPanel";
import { moveChainOrder } from "@/modules/accounts/domain/chain-order";
import {
  parseHysteresis,
  parseThreshold,
} from "@/modules/accounts/domain/chain-settings";
import { useChainNumberSetting } from "@/modules/accounts/hooks/use-chain-number-setting";
import { accountName } from "../../../../shared/session-account-view.js";
import { useNow } from "@/modules/accounts/hooks/use-now";
import {
  useSetChainOrderMutation,
  useSetChainSettingsMutation,
  useSwitchNowMutation,
} from "@/modules/accounts/queries/accounts-queries";
import { useSingleFlight } from "@/queries/single-flight";

const COUNTDOWN_TICK_MS = 30_000;

interface ChainContainerProps {
  accounts: ClaudeAccountSummary[];
  chain: ChainView;
}

export function ChainContainer({ accounts, chain }: ChainContainerProps) {
  const now = useNow(COUNTDOWN_TICK_MS);
  const order = useSetChainOrderMutation();
  const settings = useSetChainSettingsMutation();
  const switchNow = useSwitchNowMutation();
  const orderOnce = useSingleFlight(order.mutate);
  const settingsOnce = useSingleFlight(settings.mutate);
  const switchOnce = useSingleFlight(switchNow.mutate);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [autoMoveError, setAutoMoveError] = useState<string | null>(null);
  const [switchNote, setSwitchNote] = useState<{
    tone: "error" | "info";
    text: string;
  } | null>(null);

  const threshold = useChainNumberSetting({
    field: "thresholdPercent",
    saved: chain.settings.thresholdPercent,
    parse: (draft) => parseThreshold(draft, chain.settings.hysteresisPercent),
    settingsOnce,
    saving: settings.isPending,
  });
  const hysteresis = useChainNumberSetting({
    field: "hysteresisPercent",
    saved: chain.settings.hysteresisPercent,
    parse: (draft) => parseHysteresis(draft, chain.settings.thresholdPercent),
    settingsOnce,
    saving: settings.isPending,
  });

  const changeOrder = (from: number, to: number) => {
    const ids = accounts.map((account) => account.id);
    const next = moveChainOrder(ids, from, to);
    if (next.every((id, index) => id === ids[index])) return;
    orderOnce(next, {
      onSuccess: (result) => setOrderError(result.ok ? null : result.error),
      onError: () => setOrderError("Couldn't save the account order."),
    });
  };

  const changeAutoMove = (autoMove: boolean) =>
    settingsOnce(
      { autoMove },
      {
        onSuccess: (result) =>
          setAutoMoveError(result.ok ? null : result.error),
        onError: () => setAutoMoveError("Couldn't save the setting."),
      },
    );

  const runSwitchNow = () => {
    setSwitchNote(null);
    switchOnce(undefined, {
      onSuccess: (result) =>
        setSwitchNote(
          result.ok
            ? {
                tone: "info",
                text: `Switched to ${accountName(accounts, result.to)}`,
              }
            : { tone: "error", text: result.error },
        ),
      onError: () =>
        setSwitchNote({ tone: "error", text: "Couldn't switch the account." }),
    });
  };

  return (
    <ChainPanel
      accounts={accounts}
      exhausted={chain.exhausted}
      history={chain.history}
      now={now}
      autoMove={chain.settings.autoMove}
      orderSaving={order.isPending}
      orderErrorText={orderError}
      autoMovePending={settings.isPending}
      autoMoveErrorText={autoMoveError}
      threshold={threshold}
      hysteresis={hysteresis}
      switchNow={{
        pending: switchNow.isPending,
        note: switchNote,
        onSwitchNow: runSwitchNow,
      }}
      onOrderChange={changeOrder}
      onAutoMoveChange={changeAutoMove}
    />
  );
}
