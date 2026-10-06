import {
  WorkspaceContainer,
  type WorkspaceContainerProps,
} from "@/modules/workspace/containers/WorkspaceContainer";

export function WorkspaceView(props: WorkspaceContainerProps) {
  return (
    <div className="flex min-h-0 flex-auto">
      <WorkspaceContainer {...props} />
    </div>
  );
}
