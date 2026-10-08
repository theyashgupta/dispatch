import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { PageHeaderActions } from "@/components/PageHeaderActions";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { EntryButton } from "@/modules/orchestrator/components/EntryButton";
import { entryModel } from "@/modules/orchestrator/domain/entry-model";
import { useBoardRecordQuery } from "@/modules/orchestrator/queries/orchestrator-queries";

export function OrchestratorEntryContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  const navigate = useNavigate();
  const entry = entryModel(useBoardRecordQuery(boardKey).data ?? null);
  if (entry === null) return null;
  return (
    <PageHeaderActions>
      <EntryButton
        entry={entry}
        onOpen={() =>
          void navigate({
            to: "/board/{-$id}",
            search: (prev) => ({ ...prev, panel: "orchestrator" as const }),
          })
        }
      />
    </PageHeaderActions>
  );
}
