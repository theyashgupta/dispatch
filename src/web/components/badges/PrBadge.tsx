import type { PrInfo } from "../../../shared/types.js";
import { isWebUrl } from "../../../shared/web-url.js";
import { Badge } from "@/components/ui/badge";
import { prCiDotClass, prStateLabel, prStyleFor } from "./pr-style.js";

export function PrBadge({ pr, showRepo }: { pr: PrInfo; showRepo?: boolean }) {
  const { icon: Icon, className } = prStyleFor(pr);
  const showCiDot = !pr.isDraft && pr.state === "open" && pr.ci != null;
  const showRepoTag = showRepo === true && pr.repo != null && pr.repo !== "";
  const repoPrefix = showRepoTag ? `${pr.repo} ` : "";
  const ciLabel =
    pr.ci != null
      ? ` · Checks ${pr.ci === "pass" ? "passing" : pr.ci === "fail" ? "failing" : "pending"}`
      : "";
  const label = `PR ${repoPrefix}#${pr.number}: ${prStateLabel(pr)}${ciLabel}`;
  return (
    <Badge
      asChild
      className={`h-auto cursor-pointer text-sm hover:opacity-85 ${className}`}
    >
      <button
        type="button"
        title={label}
        aria-label={label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (isWebUrl(pr.url))
            window.open(pr.url, "_blank", "noopener,noreferrer");
        }}
      >
        <Icon size={12} strokeWidth={2} aria-hidden="true" />
        {showRepoTag && <span className="font-mono text-xs">{pr.repo}</span>}
        {`#${pr.number}`}
        {showCiDot && (
          <span
            className={`size-[5px] shrink-0 rounded-full ${prCiDotClass(pr.ci)}`}
          />
        )}
      </button>
    </Badge>
  );
}
