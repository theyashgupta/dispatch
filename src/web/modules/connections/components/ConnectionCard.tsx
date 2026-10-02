import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { SourceCardStatus } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/modules/connections/components/StatusBadge";

export interface ConnectionToggle {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

interface ConnectionCardProps {
  badge: ReactNode;
  name: string;
  status: SourceCardStatus;
  credentialLabel: string;
  steps?: ReactNode[];
  scopes?: string[];
  tokenPageUrl?: string;
  children?: ReactNode;
  footer?: ReactNode;
  details?: ReactNode;
  defaultOpen?: boolean;
  toggle?: ConnectionToggle;
}

const SECTION_LABEL = "text-sm font-semibold text-muted-foreground";

function HeaderToggle({ toggle }: { toggle: ConnectionToggle }) {
  const id = useId();
  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex-none cursor-pointer gap-1 text-sm font-normal",
        toggle.disabled && "cursor-default opacity-50",
      )}
    >
      <Switch
        id={id}
        size="sm"
        checked={toggle.checked}
        disabled={toggle.disabled}
        onCheckedChange={toggle.onChange}
      />
      {toggle.label}
    </Label>
  );
}

export function ConnectionCard({
  badge,
  name,
  status,
  credentialLabel,
  steps = [],
  scopes = [],
  tokenPageUrl,
  children,
  footer,
  details,
  defaultOpen = false,
  toggle,
}: ConnectionCardProps) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const soon = status.kind === "soon";
  const open = !soon && (toggled ?? defaultOpen);

  const heading = (
    <>
      {badge}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-semibold">{name}</span>
          <StatusBadge status={status} />
        </span>
        <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
          {credentialLabel}
        </span>
      </span>
    </>
  );

  if (soon) {
    return (
      <Card className="min-w-0 shrink-0 gap-0 py-0">
        <div className="flex w-full items-center gap-2 p-4 text-left">
          {heading}
        </div>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 shrink-0 gap-0 py-0">
      <Collapsible open={open} onOpenChange={setToggled}>
        <div className={cn(toggle && "flex items-center gap-2 pr-4")}>
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-md p-4 text-left text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {heading}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          {toggle && <HeaderToggle toggle={toggle} />}
        </div>
        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          <div className="flex flex-col gap-4 border-t border-border p-4">
            {steps.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className={SECTION_LABEL}>Setup guide</span>
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                  {steps.map((step, index) => (
                    <li
                      key={index}
                      className="relative grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2"
                    >
                      {index < steps.length - 1 && (
                        <span
                          aria-hidden="true"
                          className="absolute top-5 -bottom-2 left-2.5 w-px bg-muted-foreground/40"
                        />
                      )}
                      <span
                        aria-hidden="true"
                        className="relative z-10 inline-flex size-5 items-center justify-center rounded-full border border-muted-foreground/40 bg-card text-xs font-semibold text-muted-foreground"
                      >
                        {index + 1}
                      </span>
                      <span className="pt-px text-base text-foreground">
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {scopes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className={SECTION_LABEL}>Scopes</span>
                {scopes.map((scope) => (
                  <Badge key={scope} tone="neutral" className="font-mono">
                    {scope}
                  </Badge>
                ))}
              </div>
            )}
            {tokenPageUrl && (
              <a
                href={tokenPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 self-start text-sm [overflow-wrap:anywhere] text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ExternalLink aria-hidden="true" className="size-3" />
                {tokenPageUrl.replace(/^https:\/\//, "")}
              </a>
            )}
            {children}
            {footer && (
              <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                {footer}
              </span>
            )}
          </div>
          {details && (
            <div className="flex flex-col gap-4 border-t border-border p-4">
              {details}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
