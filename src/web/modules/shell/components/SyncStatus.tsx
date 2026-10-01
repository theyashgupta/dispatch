import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  syncStatusView,
  type SyncSnapshot,
  type SyncTone,
} from "@/modules/shell/domain/sync-status";

interface SyncStatusProps {
  sync: SyncSnapshot;
  collapsed: boolean;
}

const DOT_TONE: Record<SyncTone, string> = {
  down: "bg-(--status-down)",
  reconnecting: "bg-(--accent)",
  stale: "bg-(--status-stale)",
  ok: "bg-(--status-ok)",
};

export function SyncStatus({ sync, collapsed }: SyncStatusProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = syncStatusView({ ...sync, now });
  if (status === null) return <div role="status" aria-live="polite" />;

  return (
    <div
      role="status"
      aria-live="polite"
      title={collapsed ? status.text : undefined}
      className={cn(
        "flex h-8 min-w-0 items-center overflow-hidden px-2 text-sm font-medium whitespace-nowrap",
        collapsed && "justify-center",
        sync.connection === "disconnected"
          ? "text-destructive-text"
          : "text-muted-foreground",
      )}
    >
      <span
        title={status.dotTitle}
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          !collapsed && "mr-1",
          DOT_TONE[status.tone],
        )}
      />
      <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>
        {status.text}
      </span>
    </div>
  );
}
