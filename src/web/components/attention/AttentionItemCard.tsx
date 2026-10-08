import { SessionStateBadge } from "@/components/badges/SessionStateBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SupervisorState } from "../../../shared/types.js";

interface AttentionItemCardProps {
  title: string | null;
  badge:
    | { kind: "state"; state: SupervisorState }
    | { kind: "label"; label: string }
    | null;
  waiting: string;
  body: string | null;
  action: { label: string; onClick: () => void } | null;
  changeBudgetHref: string | null;
  disabled: boolean;
  onOpenTerminal: (() => void) | null;
}

export function AttentionItemCard({
  title,
  badge,
  waiting,
  body,
  action,
  changeBudgetHref,
  disabled,
  onOpenTerminal,
}: AttentionItemCardProps) {
  return (
    <Card className="gap-(--space-md) py-(--space-lg) wrap-anywhere">
      <CardHeader className="gap-(--space-xs)">
        <CardTitle className="flex flex-wrap items-center gap-(--space-sm) text-base font-semibold">
          {title !== null && <span className="min-w-0 truncate">{title}</span>}
          {badge?.kind === "state" && <SessionStateBadge state={badge.state} />}
          {badge?.kind === "label" && (
            <Badge tone="neutral">{badge.label}</Badge>
          )}
          <span className="ml-auto shrink-0 text-xs font-normal whitespace-nowrap text-muted-foreground tabular-nums">
            {waiting}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-(--space-sm)">
        {body !== null && <p className="m-0 text-sm text-foreground">{body}</p>}
        <div className="flex flex-wrap items-center gap-(--space-sm)">
          {action !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {changeBudgetHref !== null && (
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <a href={changeBudgetHref}>Change budget</a>
            </Button>
          )}
          {onOpenTerminal !== null && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={onOpenTerminal}
            >
              Open terminal
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
