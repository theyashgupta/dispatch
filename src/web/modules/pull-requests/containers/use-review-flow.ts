import { useRef, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import type { PrRow } from "../../../../shared/pr-rows.js";
import { boardSearch } from "../../../../shared/board-select.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { actionApi } from "@/queries/action-services";
import { reviewPullRequestWithAgent } from "@/modules/pull-requests/domain/review-flow";
import {
  useOpenReviewCardMutation,
  usePullRequestLoader,
} from "@/modules/pull-requests/queries/pull-requests-queries";

interface ReviewFlow {
  reviewingKey: string | null;
  review: (row: PrRow) => Promise<void>;
}

/** Own the Review button of the Pull requests page. */
export function useReviewFlow(): ReviewFlow {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const boardKey = useAppStore(appStore, (s) => s.board);
  const loadDetail = usePullRequestLoader();
  const openCard = useOpenReviewCardMutation();
  const [reviewingKey, setReviewingKey] = useState<string | null>(null);
  const inFlight = useRef(false);

  const review = async (row: PrRow) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setReviewingKey(row.key);
    const ref = { owner: row.owner, repo: row.name, number: row.number };
    try {
      await reviewPullRequestWithAgent(
        {
          currentBoard: boardKey,
          loadDetail: () => loadDetail(ref),
          openReviewCard: () =>
            openCard.mutateAsync({ ...ref, board: boardKey }),
          switchBoard: (key) =>
            router.navigate({
              to: ".",
              search: (prev) => ({ ...prev, ...boardSearch(key) }),
            }),
          moveToTodo: (cardId, cardBoard) =>
            actionApi(cardBoard).moveCard(cardId, "todo"),
          openStart: appStore.openStart,
          openCard: (cardId) => appStore.selectCard(cardId, null),
          notice: appStore.notice,
        },
        row,
      );
    } finally {
      inFlight.current = false;
      setReviewingKey(null);
    }
  };

  return { reviewingKey, review };
}
