import { useState, type KeyboardEventHandler } from "react";
import {
  CircleCheck,
  CircleDashed,
  Gauge,
  GitMerge,
  MessageCircleQuestionMark,
  Play,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelAlertBar } from "@/modules/orchestrator/components/PanelAlertBar";
import { ToneBadge } from "@/modules/orchestrator/components/ToneBadge";
import type {
  BranchAction,
  BranchState,
  CentreBranch,
} from "@/modules/orchestrator/domain/centre-graph";
import {
  ACTION_LABELS,
  playbookText,
  tileMeters,
} from "@/modules/orchestrator/domain/centre-page-state";

const GLYPHS = {
  planned: CircleDashed,
  running: Play,
  needs_input: MessageCircleQuestionMark,
  usage_limit: Gauge,
  done: CircleCheck,
  shipped: GitMerge,
  attention: TriangleAlert,
} satisfies Record<BranchState, unknown>;

export interface TileFeedback {
  result: string | null;
  failure: string | null;
}

export interface TileBehaviour {
  disabled: boolean;
  reasonId: string | null;
  feedback: (branch: CentreBranch) => TileFeedback;
  register: (id: string) => (element: HTMLElement | null) => void;
  onKeyDown: (id: string) => KeyboardEventHandler<HTMLElement>;
  onOpen: (branch: CentreBranch) => void;
  onReply: (branch: CentreBranch, text: string) => Promise<boolean>;
  onAction: (branch: CentreBranch, kind: "resume" | "retry_resume") => void;
  onOpenTerminal: () => void;
  onRetry: (branch: CentreBranch) => void;
}

interface BranchTileProps {
  branch: CentreBranch;
  tile: TileBehaviour;
}

const BODY_CLASS =
  "flex w-full flex-col gap-(--space-xs) rounded-md p-(--space-md) text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function BranchTile({ branch, tile }: BranchTileProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const feedback = tile.feedback(branch);
  const label = branch.identifier ?? branch.cardId;
  const meters = tileMeters(branch);
  const has = (action: BranchAction) => branch.actions.includes(action);
  const inline = branch.actions.some((a) => a !== "open");
  const typed = draft.trim();
  const replyId = `reply-${branch.id}`;
  const blocked = tile.disabled;

  async function send() {
    setSending(true);
    try {
      if (await tile.onReply(branch, typed)) setDraft("");
    } finally {
      setSending(false);
    }
  }

  const body = (
    <>
      <span className="flex flex-wrap items-center gap-(--space-sm)">
        {label !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            {label}
          </span>
        )}
        <ToneBadge
          label={branch.label}
          tone={branch.tone}
          glyph={GLYPHS[branch.state]}
        />
      </span>
      <span className="text-sm font-semibold wrap-anywhere">
        {branch.title}
      </span>
      {branch.detail !== null && (
        <span className="text-sm text-muted-foreground">{branch.detail}</span>
      )}
      <span className="flex flex-wrap gap-x-(--space-md) text-xs text-muted-foreground">
        {branch.playbook !== null && (
          <span>{playbookText(branch.playbook)}</span>
        )}
        {meters.map((meter) => (
          <span key={meter}>{meter}</span>
        ))}
      </span>
    </>
  );

  return (
    <li data-edge-tile={branch.id} className="list-none">
      <div className="rounded-md border border-border bg-card">
        {has("open") ? (
          <button
            type="button"
            ref={tile.register(branch.id)}
            onKeyDown={tile.onKeyDown(branch.id)}
            onClick={() => tile.onOpen(branch)}
            className={BODY_CLASS}
          >
            {body}
          </button>
        ) : (
          <div
            tabIndex={0}
            ref={tile.register(branch.id)}
            onKeyDown={tile.onKeyDown(branch.id)}
            className={BODY_CLASS}
          >
            {body}
          </div>
        )}
        {inline && (
          <div className="flex flex-col gap-(--space-sm) border-t border-border p-(--space-md)">
            {has("reply") && (
              <Field>
                <Label htmlFor={replyId} className="sr-only">
                  {`Reply to ${label ?? branch.title}`}
                </Label>
                <Textarea
                  id={replyId}
                  value={draft}
                  placeholder={`Reply to ${label ?? branch.title}`}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <FieldDescription>
                  {draft.length} of 500 characters. A longer reply goes as a
                  file.
                </FieldDescription>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={blocked || sending || typed === ""}
                    aria-describedby={tile.reasonId ?? undefined}
                    onClick={() => void send()}
                  >
                    Send reply
                  </Button>
                </div>
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-(--space-sm)">
              {has("resume") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={blocked}
                  aria-describedby={tile.reasonId ?? undefined}
                  onClick={() => tile.onAction(branch, "resume")}
                >
                  {ACTION_LABELS.resume}
                </Button>
              )}
              {has("retry_resume") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={blocked}
                  aria-describedby={tile.reasonId ?? undefined}
                  onClick={() => tile.onAction(branch, "retry_resume")}
                >
                  {ACTION_LABELS.retry_resume}
                </Button>
              )}
              {has("open_terminal") && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={tile.onOpenTerminal}
                >
                  {ACTION_LABELS.open_terminal}
                </Button>
              )}
              {feedback.result !== null && (
                <span role="status" className="text-sm text-muted-foreground">
                  {feedback.result}
                </span>
              )}
            </div>
            {feedback.failure !== null && (
              <PanelAlertBar
                message={feedback.failure}
                retryDisabled={blocked}
                onRetry={() => tile.onRetry(branch)}
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}
