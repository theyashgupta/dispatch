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
import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";

interface CentreToolbarProps {
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
  staleBadge,
  switcher,
  controls,
  onSettings,
  alert,
}: CentreToolbarProps) {
  return (
    <div className="flex flex-col gap-(--space-sm) border-b border-border px-(--space-lg) py-(--space-sm)">
      <div className="flex flex-wrap items-start gap-(--space-sm)">
        {staleBadge !== null && (
          <Badge tone="neutral" role="status" className="self-center">
            {staleBadge}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-start justify-end gap-(--space-sm)">
          {switcher !== null && (
            <>
              <Label htmlFor="centre-switcher" className="sr-only">
                Orchestrator
              </Label>
              <Select value={switcher.value} onValueChange={switcher.onChange}>
                <SelectTrigger id="centre-switcher" size="sm">
                  <SelectValue />
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
            type="button"
            variant="outline"
            size="sm"
            onClick={onSettings}
          >
            Settings
          </Button>
        </div>
      </div>
      {alert !== null && (
        <PanelAlertBar
          message={alert.message}
          retryDisabled={alert.retryDisabled}
          onRetry={alert.onRetry}
        />
      )}
    </div>
  );
}
