import { useState } from "react";
import type { Card as CardModel } from "../../../../shared/types.js";
import { BlockedByField } from "@/modules/detail/components/BlockedByField";
import {
  blockedByErrorCopy,
  blockerOptions,
  blockerRows,
} from "@/modules/detail/domain/blocked-by-field";
import { useSetCardBlockedByMutation } from "@/modules/detail/queries/detail-queries";

interface BlockedByFieldContainerProps {
  card: CardModel;
  cards: readonly CardModel[];
}

export function BlockedByFieldContainer({
  card,
  cards,
}: BlockedByFieldContainerProps) {
  const { mutateAsync, isPending } = useSetCardBlockedByMutation();
  const [error, setError] = useState<string | null>(null);
  const current = card.blockedBy ?? [];

  const update = async (blockedBy: string[]) => {
    const result = await mutateAsync({ id: card.id, blockedBy });
    setError(result.ok ? null : blockedByErrorCopy(result));
  };

  return (
    <BlockedByField
      blockers={blockerRows(card, cards)}
      options={blockerOptions(card, cards)}
      pending={isPending}
      error={error}
      onAdd={(id) => void update([...current, id])}
      onRemove={(id) => void update(current.filter((x) => x !== id))}
    />
  );
}
