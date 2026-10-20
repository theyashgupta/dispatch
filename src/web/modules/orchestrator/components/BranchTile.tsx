import { useState, type KeyboardEventHandler } from "react";
import {
  CircleCheck,
  CircleDashed,
  Gauge,
  MessageCircleQuestionMark,
  Play,
  TriangleAlert,
} from "lucide-react";
import { ACTION_LABELS } from "../../../../shared/decision-view.js";
import { ReplyField } from "@/components/attention/ReplyField";
import { ToneBadge } from "@/components/badges/ToneBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CentreAlertBar } from "@/modules/orchestrator/components/CentreAlertBar";
import type {
  BranchAction,
  BranchState,
  CentreBranch,
} from "@/modules/orchestrator/domain/centre-graph";
import {
  OPEN_TERMINAL_LABEL,
  playbookText,
  tileMeters,
} from "@/modules/orchestrator/domain/centre-page-state";

const GLYPHS = {
  planned: CircleDashed,
  running: Play,
  needs_input: MessageCircleQuestionMark,
  usage_limit: Gauge,
  done: CircleCheck,
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
  draftOf: (branch: CentreBranch) => string;
  setDraft: (branch: CentreBranch, text: string) => void;
  onReply: (branch: CentreBranch, text: string) => Promise<void>;
  onAction: (branch: CentreBranch, kind: "resume" | "retry_resume") => void;
  onOpenTerminal: () => void;
  onRetry: (branch: CentreBranch) => void;
}

interface BranchTileProps {
  branch: CentreBranch;
  tile: TileBehaviour;
}

const RESUME_ACTIONS = ["resume", "retry_resume"] as const;

const BODY_CLASS =
  "flex w-full flex-col gap-(--space-xs) rounded-md p-(--space-md) text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function BranchTile({ branch, tile }: BranchTileProps) {
  const [sending, setSending] = useState(false);
  const draft = tile.draftOf(branch);
  const feedback = tile.feedback(branch);
  const label = branch.identifier ?? branch.cardId;
  const meters = tileMeters(branch);
  const has = (action: BranchAction) => branch.actions.includes(action);
  const inline = branch.actions.some((a) => a !== "open");
  const typed = draft.trim();
  const replyId = `reply-${branch.id}`;

  async function send() {
    setSending(true);
    try {
      await tile.onReply(branch, typed);
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
      <div
        className={cn(
          "rounded-md border border-border",
          branch.tone === "error" ? "bg-danger-soft" : "bg-card",
        )}
      >
        {has("open") ? (
          <button
            type="button"
            ref={tile.register(branch.id)}
            onKeyDown={tile.onKeyDown(branch.id)}
            onClick={() => tile.onOpen(branch)}
            data-slot="branch-tile"
            className={BODY_CLASS}
          >
            {body}
          </button>
        ) : (
          <div
            tabIndex={0}
            ref={tile.register(branch.id)}
            onKeyDown={tile.onKeyDown(branch.id)}
            data-slot="branch-tile"
            className={BODY_CLASS}
          >
            {body}
          </div>
        )}
        {inline && (
          <div className="flex flex-col gap-(--space-sm) border-t border-border p-(--space-md)">
            {has("reply") && (
              <ReplyField
                id={replyId}
                label={`Reply to ${label ?? branch.title}`}
                value={draft}
                onChange={(text) => tile.setDraft(branch, text)}
                onSend={() => void send()}
                disabled={tile.disabled}
                sending={sending}
                describedBy={tile.reasonId}
              />
            )}
            <div className="flex flex-wrap items-center gap-(--space-sm)">
              {RESUME_ACTIONS.filter(has).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tile.disabled}
                  aria-describedby={tile.reasonId ?? undefined}
                  onClick={() => tile.onAction(branch, kind)}
                >
                  {ACTION_LABELS[kind]}
                </Button>
              ))}
              {has("open_terminal") && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={tile.onOpenTerminal}
                >
                  {OPEN_TERMINAL_LABEL}
                </Button>
              )}
              {feedback.result !== null && (
                <span role="status" className="text-sm text-muted-foreground">
                  {feedback.result}
                </span>
              )}
            </div>
            {feedback.failure !== null && (
              <CentreAlertBar
                message={feedback.failure}
                retryDisabled={tile.disabled}
                onRetry={() => tile.onRetry(branch)}
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}
