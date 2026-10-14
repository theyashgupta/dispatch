import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CENTRE_SETTINGS_BUTTON_ID } from "@/modules/orchestrator/domain/centre-page-state";
import { CentreAlertBar } from "@/modules/orchestrator/components/CentreAlertBar";

interface CentreToolbarProps {
  inline: boolean;
  alertSlot: HTMLElement | null;
  staleBadge: string | null;
  switcher: {
    options: readonly { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
  } | null;
  controls: ReactNode;
  onSettings: () => void;
  alert: {
    message: string;
    onRetry: () => void;
    retryDisabled: boolean;
  } | null;
}

export function CentreToolbar({
  inline,
  alertSlot,
  staleBadge,
  switcher,
  controls,
  onSettings,
  alert,
}: CentreToolbarProps) {
  const alertBar = alert !== null && (
    <CentreAlertBar
      message={alert.message}
      retryDisabled={alert.retryDisabled}
      onRetry={alert.onRetry}
    />
  );
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-(--space-sm)">
      {staleBadge !== null && (
        <Badge tone="neutral" role="status">
          {staleBadge}
        </Badge>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-(--space-sm)">
        {switcher !== null && (
          <>
            <Label htmlFor="centre-switcher" className="sr-only">
              Orchestrator
            </Label>
            <Select value={switcher.value} onValueChange={switcher.onChange}>
              <SelectTrigger id="centre-switcher" size="sm">
                <SelectValue placeholder="Orchestrator" />
              </SelectTrigger>
              <SelectContent>
                {switcher.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {controls}
        <Button
          id={CENTRE_SETTINGS_BUTTON_ID}
          type="button"
          variant="outline"
          size="sm"
          onClick={onSettings}
        >
          Settings
        </Button>
      </div>
      {alertBar &&
        (inline ? (
          <div className="w-full">{alertBar}</div>
        ) : (
          alertSlot !== null &&
          createPortal(
            <div className="px-(--space-lg) pb-(--space-sm)">{alertBar}</div>,
            alertSlot,
          )
        ))}
    </div>
  );
}
