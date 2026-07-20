import { AlertTriangle, RotateCw } from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import { cleanupCard } from "../../lib/api.js";
import { MemberRow } from "../board/index.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Markdown } from "../../primitives/Markdown.js";
import { Notice } from "../../primitives/Notice.js";

interface ReferenceBlocksProps {
  card: CardModel | null;
  members?: CardModel[];
}

export function ReferenceBlocks({ card, members }: ReferenceBlocksProps) {
  const c = card;
  return (
    <>
      {c != null && c.source === "group" && members != null && (
        <div
          style={{
            marginBottom: "var(--space-lg)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>{`Members (${members.length})`}</Field>
          {members.map((member) => (
            <MemberRow key={member.id} member={member} />
          ))}
        </div>
      )}

      {c != null && c.description != null && c.description.trim() !== "" ? (
        <div
          style={{
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
            wordBreak: "break-word",
          }}
        >
          <Markdown source={c.description} />
        </div>
      ) : (
        <div
          style={{
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          No description.
        </div>
      )}

      {c?.statusReason != null && c.statusReason.trim() !== "" && (
        <Notice tone="muted" label="Status">
          {c.statusReason}
        </Notice>
      )}

      {c?.startWarning != null && c.startWarning.trim() !== "" && (
        <Notice tone="muted" label="Start warning">
          {c.startWarning}
        </Notice>
      )}

      {c?.cleanupWarning != null && c.cleanupWarning.trim() !== "" && (
        <Notice
          tone="muted"
          label="Cleanup"
          action={
            <Button
              variant="secondary"
              onClick={() => cleanupCard(c.id).catch(console.error)}
              style={{ alignSelf: "flex-start" }}
            >
              <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
              Retry cleanup
            </Button>
          }
        >
          {c.cleanupWarning}
        </Notice>
      )}

      {c?.startError != null && (
        <div
          style={{
            marginTop: "var(--space-lg)",
            paddingTop: "var(--space-lg)",
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
          }}
        >
          <Notice
            tone="destructive"
            icon={
              <AlertTriangle
                size={12}
                strokeWidth={2}
                aria-hidden="true"
                style={{ flex: "0 0 auto" }}
              />
            }
            label={`Provisioning error — ${c.startError.step}`}
          />
          <Notice tone="destructive" mono>
            {c.startError.stderr}
          </Notice>
        </div>
      )}
    </>
  );
}
