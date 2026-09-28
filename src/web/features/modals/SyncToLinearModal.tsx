import { useRef, useState, type CSSProperties } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { useLinearWorkflow } from "../../hooks/useLinearWorkflow.js";
import { syncCardToLinear } from "../../lib/api.js";
import { defaultTeamId } from "../../lib/linear-state.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { Select } from "../../primitives/Select.js";
import { Spinner } from "../../primitives/Spinner.js";
import { WarningIcon } from "../../primitives/WarningIcon.js";

interface SyncToLinearModalProps {
  card: CardModel;
  cards: readonly CardModel[];
  onClose: () => void;
}

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  minWidth: 0,
};

export function SyncToLinearModal({
  card,
  cards,
  onClose,
}: SyncToLinearModalProps) {
  const modalRef = useRef<ModalControl>(null);
  const workflow = useLinearWorkflow();
  const [teamChoice, setTeamChoice] = useState<string | undefined>();
  const [stateId, setStateId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teams = workflow.status === "ready" ? workflow.workflow.teams : [];
  if (teamChoice === undefined && teams.length > 0) {
    setTeamChoice(defaultTeamId(cards, teams));
  }
  const teamId = teamChoice;
  const states = teams.find((t) => t.id === teamId)?.states ?? [];

  const handleSync = async () => {
    if (!teamId) return;
    setPending(true);
    setError(null);
    const result = await syncCardToLinear(card.id, {
      teamId,
      ...(stateId ? { stateId } : {}),
    });
    setPending(false);
    if (result.ok) {
      modalRef.current?.requestClose();
      return;
    }
    setError(
      result.error ??
        "Sync to Linear failed. Retrying is safe, no duplicate will be created.",
    );
  };

  return (
    <Modal ariaLabel="Sync to Linear" onClose={onClose} controlRef={modalRef}>
      <Modal.Header>Sync to Linear</Modal.Header>
      <Modal.Body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
          }}
        >
          {workflow.status === "loading" && <Spinner />}
          {workflow.status === "error" && (
            <Notice
              tone="destructive"
              icon={<WarningIcon />}
              label={workflow.error}
            />
          )}
          {workflow.status === "ready" && (
            <>
              <label style={fieldStyle}>
                <Field>Team</Field>
                <Select
                  label="Team"
                  value={teamId ?? ""}
                  onChange={(next) => {
                    setTeamChoice(next);
                    setStateId("");
                  }}
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label style={fieldStyle}>
                <Field>State</Field>
                <Select label="State" value={stateId} onChange={setStateId}>
                  <option value="">Team default</option>
                  {states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>
            </>
          )}
          {error != null && (
            <Notice tone="destructive" icon={<WarningIcon />} label={error} />
          )}
        </div>
      </Modal.Body>
      <Modal.Actions>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-sm)",
          }}
        >
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => modalRef.current?.requestClose()}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={workflow.status !== "ready" || !teamId || pending}
            onClick={() => void handleSync()}
          >
            {pending ? "Syncing…" : "Sync to Linear"}
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}
