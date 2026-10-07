import { PageColumn } from "@/components/PageColumn";
import { WorkspacesContainer } from "@/modules/workspaces/containers/WorkspacesContainer";

export function WorkspacesView() {
  return (
    <PageColumn>
      <WorkspacesContainer />
    </PageColumn>
  );
}
