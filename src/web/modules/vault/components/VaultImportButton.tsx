import { Button } from "@/components/ui/button";

interface VaultImportButtonProps {
  onClick: () => void;
}

export function VaultImportButton({ onClick }: VaultImportButtonProps) {
  return (
    <div className="flex justify-end">
      <Button variant="secondary" size="sm" onClick={onClick}>
        Import from env-vault
      </Button>
    </div>
  );
}
