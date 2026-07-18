import { AlertTriangle, RotateCw } from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import { ensureTerminal } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Notice } from "../../primitives/Notice.js";

interface TerminalRegionProps {
  card: CardModel;
}

export function TerminalRegion({ card }: TerminalRegionProps) {
  const c = card;
  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: "240px",
        display: "flex",
        flexDirection: "column",
        margin: "0 var(--space-xl) var(--space-xl)",
        paddingTop: "var(--space-lg)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        {c.terminalError != null ? (
          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              padding: "var(--space-xl)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-lg)",
            }}
          >
            <Notice
              tone="destructive"
              icon={
                <AlertTriangle
                  size={12}
                  strokeWidth={2}
                  aria-hidden="true"
                  style={{ flex: "0 0 auto" }}
                />
              }
              label={
                c.terminalError.variant === "spawn"
                  ? "Terminal unavailable — couldn't start"
                  : "Terminal disconnected"
              }
            />

            <div
              style={{
                fontSize: "var(--font-label)",
                lineHeight: "var(--line-label)",
                color: "var(--text-muted)",
              }}
            >
              The terminal process stopped. Reconnect to reopen it.
            </div>

            {c.terminalError.stderr != null &&
              c.terminalError.stderr.trim() !== "" && (
                <Notice tone="destructive" mono>
                  {c.terminalError.stderr}
                </Notice>
              )}

            <Button
              variant="secondary"
              onClick={() => ensureTerminal(c.id).catch(console.error)}
              style={{ alignSelf: "flex-start" }}
            >
              <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
              Reconnect
            </Button>
          </div>
        ) : c.ttydPort != null ? (
          <iframe
            src={`http://127.0.0.1:${c.ttydPort}`}
            title={`Live terminal for ${c.identifier}`}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            style={{ width: "100%", height: "100%", border: 0 }}
          />
        ) : (
          <div
            style={{
              padding: "var(--space-xl)",
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
            }}
          >
            Connecting to terminal…
          </div>
        )}
      </div>
    </div>
  );
}
