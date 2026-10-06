import { useEffect, useState } from "react";
import type { Card as CardModel } from "../../../../shared/types.js";
import { useLinearWorkflowQuery } from "@/queries/linear-workflow-queries";
import { LinearSection } from "@/modules/detail/components/LinearSection";
import { shownComments } from "@/modules/detail/domain/shown-comments";
import {
  useAssignCardToMeMutation,
  useCardCommentsQuery,
  usePostCardCommentMutation,
  useSetCardLinearStateMutation,
} from "@/modules/detail/queries/detail-queries";

export function LinearSectionContainer({ card }: { card: CardModel }) {
  const comments = useCardCommentsQuery(
    card.id,
    card.commentCount,
    card.lastCommentId,
  );
  const [loaded, setLoaded] = useState<{
    cardId: string;
    comments: NonNullable<typeof comments.data>;
  } | null>(null);
  if (
    comments.isSuccess &&
    !comments.isPlaceholderData &&
    (loaded?.cardId !== card.id || loaded.comments !== comments.data)
  ) {
    setLoaded({ cardId: card.id, comments: comments.data });
  }
  useEffect(() => {
    if (comments.error !== null) {
      console.error("useCardComments: fetch failed", comments.error);
    }
  }, [comments.error]);
  const workflow = useLinearWorkflowQuery();
  const { mutateAsync: assign } = useAssignCardToMeMutation();
  const { mutateAsync: setState } = useSetCardLinearStateMutation();
  const { mutateAsync: post } = usePostCardCommentMutation();
  return (
    <LinearSection
      card={card}
      comments={shownComments(card.id, comments.data, loaded)}
      workflow={workflow.data}
      assignToMe={(id) => assign(id)}
      setLinearState={(id, stateId) => setState({ id, stateId })}
      postComment={(id, body) => post({ id, body })}
    />
  );
}
