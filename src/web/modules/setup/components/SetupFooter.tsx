import { useEffect, useRef } from "react";
import { canGoNext, type SetupStep } from "../../../../shared/setup-wizard.js";
import { Button } from "@/components/ui/button";

interface SetupFooterProps {
  step: SetupStep;
  linearConnected: boolean;
  onClose: () => void;
  onBack: () => void;
  onSkipConnection: () => void;
  onNext: () => void;
}

export function SetupFooter({
  step,
  linearConnected,
  onClose,
  onBack,
  onSkipConnection,
  onNext,
}: SetupFooterProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const skipConnectionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const primary = primaryRef.current;
    (primary && !primary.disabled
      ? primary
      : skipConnectionRef.current
    )?.focus();
  }, [step]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
      {step !== "finish" && (
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Skip for now
        </Button>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {step !== "welcome" && (
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
        {step === "linear" && (
          <Button
            ref={skipConnectionRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onSkipConnection}
          >
            Skip this connection
          </Button>
        )}
        <Button
          ref={primaryRef}
          type="button"
          size="sm"
          disabled={!canGoNext(step, linearConnected)}
          onClick={onNext}
        >
          {step === "finish" ? "Done" : "Next"}
        </Button>
      </div>
    </div>
  );
}
