import { useState } from "react";
import { VaultPreviousValue } from "@/modules/vault/components/VaultPreviousValue";
import {
  useForgetVaultPrevious,
  useVaultPreviousQuery,
} from "@/modules/vault/queries/vault-queries";

interface VaultPreviousContainerProps {
  name: string;
}

export function VaultPreviousContainer({ name }: VaultPreviousContainerProps) {
  const [shown, setShown] = useState(false);
  const previous = useVaultPreviousQuery(name, shown);
  const forget = useForgetVaultPrevious();
  const read = previous.data;
  const loaded = shown && !previous.isFetching;
  const revealed = loaded && read?.ok ? read.value : null;
  return (
    <VaultPreviousValue
      name={name}
      revealed={revealed}
      error={loaded && (previous.isError || read?.ok === false)}
      pending={shown && previous.isFetching}
      onToggle={() => {
        if (revealed !== null) {
          forget(name);
          setShown(false);
        } else if (shown) {
          void previous.refetch();
        } else {
          setShown(true);
        }
      }}
    />
  );
}
