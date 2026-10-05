import { Sparkles, X } from "lucide-react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";
import { Textarea } from "@/components/ui/textarea";
import { LoadingButton } from "@/components/LoadingButton";

export interface PlaybookGenerateSectionProps {
  open: boolean;
  direction: string;
  sourcePaths: string[];
  replacesBody: boolean;
  generating: boolean;
  failed: boolean;
  onOpenChange: (open: boolean) => void;
  onDirectionChange: (direction: string) => void;
  onAddSource: () => void;
  onRemoveSource: (path: string) => void;
  onGenerate: () => void;
}

export function PlaybookGenerateSection({
  open,
  direction,
  sourcePaths,
  replacesBody,
  generating,
  failed,
  onOpenChange,
  onDirectionChange,
  onAddSource,
  onRemoveSource,
  onGenerate,
}: PlaybookGenerateSectionProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="flex flex-col gap-2"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
        >
          <Sparkles aria-hidden="true" />
          Generate with AI
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="gap-0 border-border py-0 shadow-none">
          <CardContent className="flex flex-col gap-2 p-2">
            <Textarea
              value={direction}
              disabled={generating}
              onChange={(e) => onDirectionChange(e.target.value)}
              aria-label="Playbook generation direction"
              placeholder="Describe what this playbook should do"
              className="min-h-18 resize-y text-base md:text-base"
            />

            {sourcePaths.length > 0 && (
              <div className="flex flex-col gap-1">
                {sourcePaths.map((p) => (
                  <Item
                    key={p}
                    variant="muted"
                    size="sm"
                    className="flex-nowrap gap-1 p-2"
                  >
                    <ItemContent className="min-w-0">
                      <span className="truncate font-mono text-sm text-foreground">
                        {p}
                      </span>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${p}`}
                        disabled={generating}
                        onClick={() => onRemoveSource(p)}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </div>
            )}

            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={generating}
                onClick={onAddSource}
              >
                Add source folder
              </Button>
            </div>

            {replacesBody && (
              <span className="text-base text-muted-foreground">
                This replaces the current body text.
              </span>
            )}

            <div>
              <LoadingButton
                loading={generating}
                disabled={direction.trim() === ""}
                onClick={onGenerate}
              >
                {generating ? "Generating…" : "Generate draft"}
              </LoadingButton>
            </div>

            {generating && (
              <span className="text-base text-muted-foreground">
                This can take a couple of minutes.
              </span>
            )}

            {failed && (
              <ErrorAlert>Couldn't generate a draft. Try again.</ErrorAlert>
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
