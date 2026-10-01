import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface RunSetupRowProps {
  onRunSetup: () => Promise<boolean>;
}

export function RunSetupRow({ onRunSetup }: RunSetupRowProps) {
  const [runSetup, setRunSetup] = useState<"idle" | "opening" | "failed">(
    "idle",
  );

  async function handleRunSetup(open: () => Promise<boolean>) {
    setRunSetup("opening");
    setRunSetup((await open()) ? "idle" : "failed");
  }

  return (
    <>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={runSetup === "opening"}
          aria-busy={runSetup === "opening"}
          onClick={() => void handleRunSetup(onRunSetup)}
        >
          Run setup guide
        </Button>
      </div>
      {runSetup === "failed" && (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">
            Couldn't load the setup checks. Try again.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
