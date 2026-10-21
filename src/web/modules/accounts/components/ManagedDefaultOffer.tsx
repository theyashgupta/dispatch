import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ManagedDefaultOfferProps {
  disabled: boolean;
  onLogin: () => void;
}

export function ManagedDefaultOffer({
  disabled,
  onLogin,
}: ManagedDefaultOfferProps) {
  return (
    <Alert
      role="region"
      aria-label="Move the Default account"
      className="flex flex-wrap items-center gap-2"
      data-testid="managed-default-offer"
    >
      <div className="flex min-w-0 flex-auto basis-40 flex-col gap-0.5">
        <AlertTitle className="line-clamp-none">
          Move the Default account to a Dispatch login
        </AlertTitle>
        <AlertDescription>
          One login here lets Dispatch track usage and move sessions for the
          Default account. Running sessions keep running.
        </AlertDescription>
      </div>
      <Button size="sm" onClick={onLogin} disabled={disabled}>
        Log in
      </Button>
    </Alert>
  );
}
