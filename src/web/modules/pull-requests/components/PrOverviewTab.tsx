import type { PrDetail as PrDetailModel } from "../../../../shared/types.js";
import type { PrRow } from "../../../../shared/pr-rows.js";
import { Markdown } from "@/components/markdown/Markdown";
import { TabsContent } from "@/components/ui/tabs";
import { PrChips } from "./PrChips";
import { PrReviewActions, type PrReviewActionsProps } from "./PrReviewActions";

interface PrOverviewTabProps extends PrReviewActionsProps {
  row: PrRow;
  detail: PrDetailModel;
}

export function PrOverviewTab({ row, detail, ...actions }: PrOverviewTabProps) {
  return (
    <TabsContent value="overview" className="flex flex-col gap-(--space-md)">
      <div className="flex flex-wrap items-center gap-(--space-sm)">
        <PrChips row={row} />
        {row.cardId && (
          <span className="text-sm text-muted-foreground">
            Linked card {row.cardId}
          </span>
        )}
      </div>
      {detail.body.trim() ? (
        <Markdown source={detail.body} />
      ) : (
        <div className="text-base text-muted-foreground">No description</div>
      )}
      <PrReviewActions {...actions} />
    </TabsContent>
  );
}
