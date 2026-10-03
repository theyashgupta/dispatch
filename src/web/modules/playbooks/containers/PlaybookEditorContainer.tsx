import { useRef, useState } from "react";
import type { Playbook } from "../../../../shared/types.js";
import { hasDispatchMarker } from "../../../../shared/marker-key.js";
import { PlaybookEditorDialog } from "@/modules/playbooks/components/PlaybookEditorDialog";
import {
  useCreatePlaybookMutation,
  useGeneratePlaybookDraftMutation,
  useUpdatePlaybookMutation,
} from "@/modules/playbooks/queries/playbooks-queries";
import { useSingleFlight } from "@/queries/single-flight";
import { useFolderBrowser } from "@/queries/workspace-folders-queries";

const COLLISION_MESSAGE = "A playbook with that name already exists";

export type PlaybookEditorTarget =
  { mode: "create" } | { mode: "edit"; playbook: Playbook & { slug: string } };

interface PlaybookEditorContainerProps {
  target: PlaybookEditorTarget;
  existingNames: string[];
  onClose: () => void;
}

export function PlaybookEditorContainer({
  target,
  existingNames,
  onClose,
}: PlaybookEditorContainerProps) {
  const create = useCreatePlaybookMutation();
  const update = useUpdatePlaybookMutation();
  const generate = useGeneratePlaybookDraftMutation();
  const browser = useFolderBrowser();
  const discardRef = useRef<HTMLButtonElement>(null);
  const generateOnce = useSingleFlight(generate.mutate);
  const savingRef = useRef(false);
  const [name, setName] = useState(
    target.mode === "edit" ? target.playbook.name : "",
  );
  const [body, setBody] = useState(
    target.mode === "edit" ? target.playbook.body : "",
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [footgunError, setFootgunError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [direction, setDirection] = useState("");
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [draftNotice, setDraftNotice] = useState(false);

  const trimmedName = name.trim();
  const saving = create.isPending || update.isPending;
  const canSave = trimmedName !== "" && !saving && !hasDispatchMarker(body);

  const checkNameCollision = () => {
    const lower = trimmedName.toLowerCase();
    if (lower === "") return;
    const collides = existingNames.some((n) => n.toLowerCase() === lower);
    setNameError(collides ? COLLISION_MESSAGE : null);
  };

  const handleGenerate = () => {
    if (direction.trim() === "") return;
    generateOnce(
      { direction: direction.trim(), sourcePaths },
      {
        onSuccess: (result) => {
          if (!result.ok) return;
          setBody(result.draft);
          setFootgunError(false);
          setGenerateOpen(false);
          setDirection("");
          setSourcePaths([]);
          setDraftNotice(true);
        },
      },
    );
  };

  const handleSave = async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    discardRef.current?.focus();
    setSaveError(false);
    setFootgunError(false);
    try {
      const input = { name: trimmedName, body };
      const result =
        target.mode === "create"
          ? await create.mutateAsync(input)
          : await update.mutateAsync({ slug: target.playbook.slug, input });
      if (result.ok) {
        onClose();
        return;
      }
      if (result.error === "name-exists") setNameError(COLLISION_MESSAGE);
      else if (result.error === "footgun") setFootgunError(true);
      else setSaveError(true);
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <PlaybookEditorDialog
      ariaLabel={
        target.mode === "edit" ? `Edit ${target.playbook.name}` : "New playbook"
      }
      title={target.mode === "edit" ? target.playbook.name : "New playbook"}
      name={name}
      body={body}
      nameError={nameError}
      footgunError={footgunError}
      saveError={saveError}
      draftNotice={draftNotice}
      saving={saving}
      canSave={canSave}
      discardRef={discardRef}
      generate={{
        open: generateOpen,
        direction,
        sourcePaths,
        replacesBody: body.trim() !== "",
        generating: generate.isPending,
        failed: generate.data?.ok === false,
        onOpenChange: setGenerateOpen,
        onDirectionChange: setDirection,
        onAddSource: () => browser.onOpenChange(true),
        onRemoveSource: (path) =>
          setSourcePaths((prev) => prev.filter((p) => p !== path)),
        onGenerate: handleGenerate,
      }}
      browser={browser}
      onSourceSelected={(path) =>
        setSourcePaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
      }
      onNameChange={(value) => {
        setName(value);
        setNameError(null);
      }}
      onNameBlur={checkNameCollision}
      onBodyChange={(value) => {
        setBody(value);
        setFootgunError(false);
        setDraftNotice(false);
      }}
      onClose={onClose}
      onSave={() => void handleSave()}
    />
  );
}
