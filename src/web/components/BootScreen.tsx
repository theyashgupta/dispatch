import type { ConnectionStatus } from "../../shared/types.js";
import { Glyph } from "@/components/icons/Glyph";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/utils";

export function BootScreen({ connection }: { connection: ConnectionStatus }) {
  const disconnected = connection === "disconnected";
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-(--space-xl) text-foreground select-none">
      <div className="flex flex-col items-center gap-(--space-sm)">
        <Glyph size={44} />
        <Wordmark />
      </div>
      <div
        className={cn(
          "text-sm font-semibold",
          disconnected ? "text-destructive-text" : "text-muted-foreground",
        )}
      >
        {disconnected ? "Disconnected, reconnecting…" : "Connecting…"}
      </div>
    </div>
  );
}
