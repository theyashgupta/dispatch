import type { Playbook } from "../../../../shared/types.js";
import { PlaybookDeleteDialog } from "@/modules/playbooks/components/PlaybookDeleteDialog";
import { useDeletePlaybookMutation } from "@/modules/playbooks/queries/playbooks-queries";
import { useSingleFlight } from "@/queries/single-flight";

interface PlaybookDeleteContainerProps {
  playbook: Playbook;
  onClose: () => void;
}

export function PlaybookDeleteContainer({
  playbook,
  onClose,
}: PlaybookDeleteContainerProps) {
  const remove = useDeletePlaybookMutation();
  const removeOnce = useSingleFlight(remove.mutate);

  const handleDelete = () => {
    if (playbook.slug === undefined) return;
    removeOnce(playbook.slug, {
      onSuccess: (result) => {
        if (result.ok) onClose();
      },
    });
  };

  return (
    <PlaybookDeleteDialog
      name={playbook.name}
      pending={remove.isPending}
      failed={remove.isError || remove.data?.ok === false}
      onClose={onClose}
      onDelete={handleDelete}
    />
  );
}
