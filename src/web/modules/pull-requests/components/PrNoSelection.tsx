import { DetailScroll } from "@/components/DetailPaneBody";
import { Kbd } from "@/components/ui/kbd";
import { PrEmpty } from "./PrEmpty";

export function PrNoSelection() {
  return (
    <DetailScroll>
      <PrEmpty
        title="Select a pull request"
        description={
          <>
            Use <Kbd>j</Kbd> and <Kbd>k</Kbd> to move and <Kbd>Enter</Kbd> to
            open.
          </>
        }
      />
    </DetailScroll>
  );
}
