import type { ReactNode } from "react";
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
import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";

interface CentreToolbarProps {
  inline: boolean;
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
  staleBadge,
  switcher,
  controls,
  onSettings,
  alert,
}: CentreToolbarProps) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-(--space-sm)">
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
      {alert !== null && (
        <div
          className={
            inline
              ? "w-full"
              : "absolute top-full right-0 z-10 mt-(--space-xs) w-max max-w-120"
          }
        >
          <PanelAlertBar
            message={alert.message}
            retryDisabled={alert.retryDisabled}
            onRetry={alert.onRetry}
          />
        </div>
      )}
    </div>
  );
}
