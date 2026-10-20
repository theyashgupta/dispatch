import { RotateCw } from "lucide-react";
import type { Card as CardModel } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { PanelAlert, PanelMonoNotice } from "./PanelNotice";

interface TerminalRegionProps {
  card: CardModel;
  onReconnect: (id: string) => void;
}

export function TerminalRegion({ card, onReconnect }: TerminalRegionProps) {
  const c = card;
  return (
    <div className="mx-(--space-xl) my-(--space-sm) flex min-h-60 flex-auto flex-col">
      <div className="flex min-h-0 flex-auto flex-col overflow-hidden rounded-md border border-border bg-background">
        {c.terminalError != null ? (
          <div className="scroll-stable-y flex min-h-0 flex-auto flex-col gap-(--space-lg) overflow-y-auto p-(--space-xl)">
            <PanelAlert icon>
              {c.terminalError.variant === "spawn"
                ? "Terminal unavailable: couldn't start"
                : "Terminal disconnected"}
            </PanelAlert>

            <div className="text-sm text-muted-foreground">
              The terminal process stopped. Reconnect to reopen it.
            </div>

            {c.terminalError.stderr != null &&
              c.terminalError.stderr.trim() !== "" && (
                <PanelMonoNotice>{c.terminalError.stderr}</PanelMonoNotice>
              )}

            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => onReconnect(c.id)}
            >
              <RotateCw className="size-3" aria-hidden="true" />
              Reconnect
            </Button>
          </div>
        ) : c.ttydPort != null && c.activeSessionId != null ? (
          <iframe
            src={`/sessions/${c.activeSessionId}/terminal/`}
            title={`Live terminal for ${c.identifier}`}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="min-h-0 w-full flex-auto border-0"
          />
        ) : (
          <div className="p-(--space-xl) text-sm text-muted-foreground">
            Connecting to terminal…
          </div>
        )}
      </div>
    </div>
  );
}
