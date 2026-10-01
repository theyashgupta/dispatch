import type { ReactNode } from "react";
import type { SetupStep } from "../../../../shared/setup-wizard.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SetupFooter } from "@/modules/setup/components/SetupFooter";
import { SetupMap } from "@/modules/setup/components/SetupMap";
import { StepProgressBar } from "@/modules/setup/components/StepProgressBar";
import { STEP_TITLE, stepProgress } from "@/modules/setup/domain/step-progress";

interface SetupDialogProps {
  step: SetupStep;
  linearConnected: boolean;
  onClose: () => void;
  onBack: () => void;
  onSkipConnection: () => void;
  onNext: () => void;
  children: ReactNode;
}

export function SetupDialog({
  step,
  linearConnected,
  onClose,
  onBack,
  onSkipConnection,
  onNext,
  children,
}: SetupDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-[min(45rem,calc(100%-2rem))]"
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-8">{STEP_TITLE[step]}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-none flex-col gap-4">
          <StepProgressBar progress={stepProgress(step)} />
          <SetupMap linearConnected={linearConnected} />
        </div>
        <div className="scroll-stable-y flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {children}
        </div>
        <SetupFooter
          step={step}
          linearConnected={linearConnected}
          onClose={onClose}
          onBack={onBack}
          onSkipConnection={onSkipConnection}
          onNext={onNext}
        />
      </DialogContent>
    </Dialog>
  );
}
