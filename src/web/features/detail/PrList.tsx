import { ExternalLink } from "lucide-react";
import type { Card, PrInfo } from "../../../shared/types.js";
import { useCardPrs } from "../board/index.js";
import { unknownProbeCopy } from "../badges/index.js";
import { prCiDotColor, prStateLabel, prStyleFor } from "../badges/pr-style.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Notice } from "../../primitives/Notice.js";

function PrListRow({ pr }: { pr: PrInfo }) {
  const { icon: Icon, color } = prStyleFor(pr);
  const showCiDot = !pr.isDraft && pr.state === "open" && pr.ci != null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        padding: "var(--space-xs) 0",
      }}
    >
      <Icon
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        style={{ flex: "0 0 auto", color }}
      />
      <span
        style={{
          flex: "0 0 auto",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          color,
        }}
      >
        {prStateLabel(pr)}
      </span>
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-label)",
          color: "var(--text-muted)",
        }}
      >
        {`#${pr.number}`}
      </span>
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          fontSize: "var(--font-body)",
          fontWeight: "var(--weight-regular)",
          lineHeight: "var(--line-body)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {pr.title}
      </span>
      {showCiDot && (
        <span
          style={{
            flex: "0 0 auto",
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: prCiDotColor(pr.ci),
          }}
        />
      )}
      <IconButton
        aria-label={`Open PR #${pr.number} in GitHub`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          window.open(pr.url, "_blank", "noopener,noreferrer");
        }}
      >
        <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

export function PrList({ card }: { card: Card }) {
  const prs = useCardPrs(card);
  const unknown = card.prsUnknown;
  if (prs.length === 0 && unknown == null) return null;

  const repoOrder: string[] = [];
  for (const pr of prs) {
    if (!repoOrder.includes(pr.repo)) repoOrder.push(pr.repo);
  }
  const grouped = repoOrder.length >= 2;

  let diagnosticText: string | null = null;
  if (unknown != null) {
    const { detail } = unknownProbeCopy("pr", unknown.category, prs.length > 0);
    const age =
      unknown.checkedAt != null ? formatAge(unknown.checkedAt, nowMs()) : "";
    diagnosticText = age !== "" ? `${detail}, Last checked ${age}` : detail;
  }

  return (
    <div
      style={{
        marginBottom: "var(--space-lg)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
      }}
    >
      <Field section>{`Pull Requests (${prs.length})`}</Field>
      {grouped
        ? repoOrder.map((repo) => (
            <div key={repo}>
              <Field mono>{repo}</Field>
              {prs
                .filter((pr) => pr.repo === repo)
                .map((pr) => (
                  <PrListRow key={pr.url} pr={pr} />
                ))}
            </div>
          ))
        : prs.map((pr) => <PrListRow key={pr.url} pr={pr} />)}
      {diagnosticText != null && <Notice tone="muted">{diagnosticText}</Notice>}
    </div>
  );
}
