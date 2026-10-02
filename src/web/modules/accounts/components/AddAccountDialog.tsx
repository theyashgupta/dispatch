import { useEffect, useRef } from "react";
import type { ClaudeLoginView } from "../../../../shared/types.js";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { LoadingButton } from "@/components/LoadingButton";
import { useReturnFocus } from "@/components/ui/hooks/use-return-focus";

interface AddAccountDialogProps {
  title: string;
  view: ClaudeLoginView;
  notice: string | null;
  foreign: boolean;
  code: string;
  canSubmit: boolean;
  submitting: boolean;
  onCodeChange: (code: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onClose: () => void;
}

export function AddAccountDialog({
  title,
  view,
  notice,
  foreign,
  code,
  canSubmit,
  submitting,
  onCodeChange,
  onSubmit,
  onRetry,
  onClose,
}: AddAccountDialogProps) {
  const codeRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(true);
  const awaitingCode = !foreign && view.state === "awaiting-code";

  useEffect(() => {
    if (awaitingCode) codeRef.current?.focus();
  }, [awaitingCode]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={returnFocus}
        aria-label={title}
        aria-labelledby={undefined}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          if (codeRef.current === null) return;
          event.preventDefault();
          codeRef.current.focus();
        }}
        className="flex max-h-[80vh] flex-col sm:max-w-120"
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-8">{title}</DialogTitle>
        </DialogHeader>
        <div
          className="flex flex-col gap-2 text-base text-foreground"
          data-testid="add-account-body"
        >
          {notice && <ErrorAlert>{notice}</ErrorAlert>}
          {!foreign && (view.state === "starting" || view.state === "idle") && (
            <div className="flex items-center gap-2">
              <Spinner aria-hidden="true" />
              <span>Starting the Claude sign-in…</span>
            </div>
          )}
          {awaitingCode && (
            <>
              <span>
                Sign in on the Claude page, then paste the code it shows you
                here. The page also opened in your browser on this Mac.
              </span>
              <a
                href={view.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm break-all text-(--accent-text)"
                data-testid="login-link"
              >
                {view.url}
              </a>
              <Input
                ref={codeRef}
                type="text"
                aria-label="Sign-in code"
                placeholder="Paste the code here"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(event) => onCodeChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSubmit();
                }}
                className="h-8 font-mono text-sm md:text-sm"
              />
            </>
          )}
          {view.state === "finishing" && (
            <div className="flex items-center gap-2">
              <Spinner aria-hidden="true" />
              <span>Checking the code with Claude…</span>
            </div>
          )}
          {view.state === "done" && (
            <Alert variant="muted" role="status">
              <AlertTitle>{`${view.account.email} is ready to use.`}</AlertTitle>
            </Alert>
          )}
          {view.state === "error" && <ErrorAlert>{view.message}</ErrorAlert>}
        </div>
        <DialogFooter>
          {view.state === "error" && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
          {awaitingCode && (
            <LoadingButton
              disabled={!canSubmit}
              loading={submitting}
              onClick={onSubmit}
            >
              Submit code
            </LoadingButton>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            {view.state === "done" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
