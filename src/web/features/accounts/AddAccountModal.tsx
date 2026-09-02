import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useClaudeLogin } from "../../hooks/useClaudeLogin.js";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { Spinner } from "../../primitives/Spinner.js";
import { isSubmittableCode } from "../../lib/login-view.js";

interface AddAccountModalProps {
  accountId?: string;
  accountEmail?: string;
  onClose: () => void;
  onAdded: () => void;
}

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

const spinnerRowStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-sm)",
  alignItems: "center",
};

const linkStyle: CSSProperties = {
  color: "var(--accent)",
  wordBreak: "break-all",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-column)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  outline: "none",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "var(--space-sm)",
  flex: "0 0 auto",
};

export function AddAccountModal({
  accountId,
  accountEmail,
  onClose,
  onAdded,
}: AddAccountModalProps) {
  const login = useClaudeLogin(accountId);
  const [code, setCode] = useState("");
  const modalRef = useRef<ModalControl>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const { state } = login;
  const title = accountId
    ? `Re-login ${accountEmail ?? "account"}`
    : "Add a Claude account";

  useEffect(() => {
    if (state.state === "done") onAdded();
  }, [state.state, onAdded]);

  useEffect(() => {
    if (state.state === "awaiting-code") codeRef.current?.focus();
  }, [state.state]);

  const handleSubmit = async () => {
    if (login.submitting || !isSubmittableCode(code)) return;
    await login.submit(code);
    setCode("");
  };

  const handleClose = async () => {
    if (!login.foreign && state.state !== "done" && state.state !== "idle") {
      await login.cancel();
    }
    onClose();
  };

  const handleRetry = async () => {
    setCode("");
    await login.retry();
  };

  return (
    <Modal
      ariaLabel={title}
      onClose={() => void handleClose()}
      controlRef={modalRef}
      initialFocusRef={codeRef}
    >
      <Modal.Header>{title}</Modal.Header>
      <Modal.Body>
        <div style={bodyStyle} data-testid="add-account-body">
          {login.notice && <Notice tone="destructive" label={login.notice} />}
          {!login.foreign &&
            (state.state === "starting" || state.state === "idle") && (
              <div style={spinnerRowStyle}>
                <Spinner />
                <span>Starting the Claude sign-in…</span>
              </div>
            )}
          {!login.foreign && state.state === "awaiting-code" && (
            <>
              <span>
                Sign in on the Claude page, then paste the code it shows you
                here. The page also opened in your browser on this Mac.
              </span>
              <a
                href={state.url}
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
                data-testid="login-link"
              >
                {state.url}
              </a>
              <input
                ref={codeRef}
                type="text"
                aria-label="Sign-in code"
                placeholder="Paste the code here"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleSubmit();
                }}
                style={inputStyle}
              />
            </>
          )}
          {state.state === "finishing" && (
            <div style={spinnerRowStyle}>
              <Spinner />
              <span>Checking the code with Claude…</span>
            </div>
          )}
          {state.state === "done" && (
            <Notice
              tone="muted"
              label={`${state.account.email} is ready to use.`}
            />
          )}
          {state.state === "error" && (
            <Notice tone="destructive" label={state.message} />
          )}
        </div>
      </Modal.Body>
      <Modal.Actions>
        <div style={actionsStyle}>
          {state.state === "error" && (
            <Button variant="secondary" onClick={() => void handleRetry()}>
              Try again
            </Button>
          )}
          {!login.foreign && state.state === "awaiting-code" && (
            <Button
              variant="primary"
              disabled={!isSubmittableCode(code) || login.submitting}
              loading={login.submitting}
              onClick={() => void handleSubmit()}
            >
              Submit code
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => modalRef.current?.requestClose()}
          >
            {state.state === "done" ? "Close" : "Cancel"}
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}
