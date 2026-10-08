import { ExternalLink } from "lucide-react";
import type { Card, PrInfo } from "../../../../shared/types.js";
import { cardPrs } from "../../../../shared/card-prs.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import {
  prCiDotColor,
  prStateLabel,
  prStyleFor,
} from "@/components/badges/pr-style";
import { unknownProbeCopy } from "@/components/badges/unknown-probe-copy";
import { Button } from "@/components/ui/button";
import { useCssVars } from "@/components/ui/hooks/use-css-vars";
import { Item } from "@/components/ui/item";

function PrListRow({ pr }: { pr: PrInfo }) {
  const { icon: Icon, color } = prStyleFor(pr);
  const showCiDot = !pr.isDraft && pr.state === "open" && pr.ci != null;
  const vars = useCssVars({
    "--pr-tone": color,
    "--pr-ci": showCiDot ? prCiDotColor(pr.ci) : undefined,
  });
  return (
    <Item
      ref={vars}
      size="sm"
      className="flex-nowrap gap-(--space-xs) rounded-none border-0 px-0 py-(--space-xs)"
    >
      <Icon className="size-3 flex-none text-(--pr-tone)" aria-hidden="true" />
      <span className="flex-none text-sm font-semibold text-(--pr-tone)">
        {prStateLabel(pr)}
      </span>
      <span className="flex-none font-mono text-xs text-muted-foreground">
        {`#${pr.number}`}
      </span>
      <span className="min-w-0 flex-auto truncate text-base font-normal text-foreground">
        {pr.title}
      </span>
      {showCiDot && (
        <span className="size-[5px] flex-none rounded-full bg-(--pr-ci)" />
      )}
      <Button
        variant="ghost"
        size="icon-md"
        className="text-muted-foreground hover:text-muted-foreground"
        aria-label={`Open PR #${pr.number} in GitHub`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (isWebUrl(pr.url))
            window.open(pr.url, "_blank", "noopener,noreferrer");
        }}
      >
        <ExternalLink className="size-3" aria-hidden="true" />
      </Button>
    </Item>
  );
}

export function PrList({ card }: { card: Card }) {
  const prs = cardPrs(card);
  const unknown =
    card.prsUnknown ??
    (card.sessionSummaries ?? []).find(
      (s) => s.lost !== true && s.prsUnknown != null,
    )?.prsUnknown;
  if (prs.length === 0 && unknown == null) return null;

  const repoOrder: string[] = [];
  let everyPrStamped = true;
  for (const pr of prs) {
    if (pr.repo == null || pr.repo === "") {
      everyPrStamped = false;
      continue;
    }
    if (!repoOrder.includes(pr.repo)) repoOrder.push(pr.repo);
  }
  const grouped = repoOrder.length >= 2 && everyPrStamped;

  let diagnosticText: string | null = null;
  if (unknown != null) {
    const { detail } = unknownProbeCopy("pr", unknown.category, prs.length > 0);
    const age =
      unknown.checkedAt != null ? formatAge(unknown.checkedAt, nowMs()) : "";
    diagnosticText = age !== "" ? `${detail}, Last checked ${age}` : detail;
  }

  return (
    <div className="flex flex-col gap-(--space-xs)">
      <span className="text-sm leading-(--line-label) font-medium text-muted-foreground">
        {`Pull Requests (${prs.length})`}
      </span>
      {grouped
        ? repoOrder.map((repo) => (
            <div key={repo}>
              <span className="font-mono text-xs leading-(--line-label) font-semibold text-muted-foreground">
                {repo}
              </span>
              {prs
                .filter((pr) => pr.repo === repo)
                .map((pr) => (
                  <PrListRow key={pr.url} pr={pr} />
                ))}
            </div>
          ))
        : prs.map((pr) => <PrListRow key={pr.url} pr={pr} />)}
      {diagnosticText != null && (
        <div className="mt-(--space-xs) truncate text-sm font-normal text-muted-foreground">
          {diagnosticText}
        </div>
      )}
    </div>
  );
}
