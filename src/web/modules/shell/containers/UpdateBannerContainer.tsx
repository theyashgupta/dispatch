import { useRef } from "react";
import { UpdateBanner } from "@/modules/shell/components/UpdateBanner";
import { useDismissedUpdate } from "@/modules/shell/hooks/use-dismissed-update";
import {
  useRunUpdateMutation,
  useUpdateStatusQuery,
} from "@/queries/update-queries";

export function UpdateBannerContainer() {
  const { data: status } = useUpdateStatusQuery();
  const update = useRunUpdateMutation();
  const { dismissedVersion, dismiss } = useDismissedUpdate();
  const inFlight = useRef(false);
  return (
    <UpdateBanner
      status={status ?? null}
      dismissedVersion={dismissedVersion}
      onDismiss={dismiss}
      onRunUpdate={() => {
        if (inFlight.current) return;
        inFlight.current = true;
        update.mutate(undefined, {
          onSettled: () => {
            inFlight.current = false;
          },
        });
      }}
      pending={update.isPending}
      result={update.data}
      failed={update.isError}
    />
  );
}
