import { createModuleState } from "@/components/ui/hooks/module-state";
import type { WorkspacesSummary } from "@/modules/workspaces/domain/workspace-rows";

export const useWorkspacesSummary = createModuleState<
  WorkspacesSummary | undefined
>(undefined);
