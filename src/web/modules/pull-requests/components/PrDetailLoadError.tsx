import { CircleAlert } from "lucide-react";
import { LoadingButton } from "@/components/LoadingButton";
import { PrEmpty } from "./PrEmpty";

interface PrDetailLoadErrorProps {
  message: string;
  retrying: boolean;
  onRetry: () => void;
  onOpenOnGithub: () => void;
}

export function PrDetailLoadError({
  message,
  retrying,
  onRetry,
  onOpenOnGithub,
}: PrDetailLoadErrorProps) {
  return (
    <PrEmpty
      title="Couldn't load this pull request"
      description={message}
      icon={<CircleAlert aria-hidden="true" />}
      actions={
        <>
          <LoadingButton
            variant="secondary"
            size="default"
            loading={retrying}
            onClick={onRetry}
          >
            Try again
          </LoadingButton>
          <LoadingButton
            variant="secondary"
            size="default"
            onClick={onOpenOnGithub}
          >
            Open on GitHub
          </LoadingButton>
        </>
      }
    />
  );
}
