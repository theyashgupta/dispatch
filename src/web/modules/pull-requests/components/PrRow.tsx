import { Sparkles } from "lucide-react";
import type { PrRow as PrRowData } from "../../../../shared/pr-rows.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { ListItemRow } from "@/components/ListItemRow";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { withoutBubbling } from "@/components/without-bubbling";
import { PrAuthorAvatar } from "./PrAuthorAvatar";
import { PrChips } from "./PrChips";

interface PrRowProps {
  row: PrRowData;
  selected: boolean;
  narrow: boolean;
  reviewingKey: string | null;
  onSelect: () => void;
  onReview: () => void;
}

export function PrRow({
  row,
  selected,
  narrow,
  reviewingKey,
  onSelect,
  onReview,
}: PrRowProps) {
  const detail = [
    `${row.repo} #${row.number}`,
    formatAge(row.createdAt, nowMs()),
    row.author,
  ]
    .filter((part) => part !== "")
    .join(" · ");

  return (
    <ListItemRow
      id={`pr-row-${row.key}`}
      selected={selected}
      unread={row.unread}
      onSelect={onSelect}
      leading={
        <PrAuthorAvatar author={row.author} authorAvatar={row.authorAvatar} />
      }
      title={row.title}
      detail={detail}
      footer={<PrChips row={row} className="pt-0.5" />}
      meta={
        narrow ? null : (
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            disabled={reviewingKey !== null}
            aria-label={`Review #${row.number} with Claude`}
            onClick={withoutBubbling(onReview)}
          >
            {reviewingKey === row.key ? (
              <Spinner aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
          </Button>
        )
      }
    />
  );
}
