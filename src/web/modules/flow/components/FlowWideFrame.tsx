import type { ReactNode } from "react";
import { useCssVars } from "@/components/ui/hooks/use-css-vars";
import { STAGE_WIDTH } from "@/modules/flow/domain/flow-model";

interface FlowWideFrameProps {
  children: ReactNode;
}

export function FlowWideFrame({ children }: FlowWideFrameProps) {
  const vars = useCssVars({ "--flow-stage-w": `${STAGE_WIDTH}px` });
  return (
    <div className="scroll-stable-y min-h-0 flex-auto overflow-y-auto">
      <div
        ref={vars}
        className="mx-auto flex max-w-[calc(var(--flow-stage-w)+2*var(--space-lg))] flex-col gap-(--space-lg) p-(--space-lg)"
      >
        {children}
      </div>
    </div>
  );
}
