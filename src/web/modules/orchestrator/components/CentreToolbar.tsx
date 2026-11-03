import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  isCentreView,
  type CentreView,
} from "../../../../shared/orchestrator-settings.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CENTRE_SETTINGS_BUTTON_ID,
  CENTRE_TERMINAL_BUTTON_ID,
} from "@/modules/orchestrator/domain/centre-page-state";
import { CentreAlertBar } from "@/modules/orchestrator/components/CentreAlertBar";

interface CentreToolbarProps {
  inline: boolean;
  alertSlot: HTMLElement | null;
  staleBadge: string | null;
  view: {
    value: CentreView;
    onChange: (value: CentreView) => void;
  } | null;
  switcher: {
    options: readonly { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
  } | null;
  controls: ReactNode;
  onTerminal: (() => void) | null;
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
  view,
  switcher,
  controls,
  onTerminal,
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
        {view !== null && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Centre view"
            value={view.value}
            onValueChange={(next) => {
              if (isCentreView(next)) view.onChange(next);
            }}
          >
            <ToggleGroupItem value="bands">Bands</ToggleGroupItem>
            <ToggleGroupItem value="tree">Tree</ToggleGroupItem>
          </ToggleGroup>
        )}
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
        {onTerminal !== null && (
          <Button
            id={CENTRE_TERMINAL_BUTTON_ID}
            type="button"
            variant="outline"
            size="sm"
            onClick={onTerminal}
          >
            Terminal
          </Button>
        )}
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
        (inline || alertSlot === null ? (
          <div className="w-full">{alertBar}</div>
        ) : (
          createPortal(
            <div className="px-(--space-lg) pb-(--space-sm)">{alertBar}</div>,
            alertSlot,
          )
        ))}
    </div>
  );
}
