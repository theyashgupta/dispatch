import type { DiscoveredRepo } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";

interface WorkspaceReposProps {
  repos: DiscoveredRepo[];
}

export function WorkspaceRepos({ repos }: WorkspaceReposProps) {
  if (repos.length === 0) {
    return (
      <div className="font-mono text-xs text-muted-foreground">
        No repos discovered.
      </div>
    );
  }
  return (
    <div role="list">
      {repos.map((repo) => (
        <div
          key={repo.path}
          role="listitem"
          className="flex items-center gap-2 py-1"
        >
          <span className="shrink-0 text-base text-foreground">
            {repo.name}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
            title={repo.path}
          >
            {repo.path}
          </span>
          <Badge tone="neutral" title="Base branch">
            {repo.base}
          </Badge>
        </div>
      ))}
    </div>
  );
}
