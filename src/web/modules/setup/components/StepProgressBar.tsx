import { Progress } from "@/components/ui/progress";
import type { StepProgress } from "@/modules/setup/domain/step-progress";

interface StepProgressBarProps {
  progress: StepProgress;
}

export function StepProgressBar({ progress }: StepProgressBarProps) {
  return (
    <>
      <p className="text-base text-muted-foreground" aria-live="polite">
        Setup, step {progress.stepNumber} of {progress.total}
      </p>
      <div className="grid grid-cols-5 gap-1" aria-hidden="true">
        {progress.segments.map((segment) => (
          <Progress
            key={segment.step}
            value={segment.value}
            className="h-1 rounded-sm"
          />
        ))}
      </div>
    </>
  );
}
