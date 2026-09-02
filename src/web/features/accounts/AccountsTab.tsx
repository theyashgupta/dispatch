import { useRef, useState, type CSSProperties } from "react";
import type { ClaudeAccountSummary } from "../../../shared/types.js";
import type { ClaudeAccountsState } from "../../hooks/useClaudeAccounts.js";
import { removeAccount } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";
import { AddAccountModal } from "./AddAccountModal.js";
import {
  formatReset,
  statusCopy,
  tightestWindow,
  toneColor,
  toneFor,
} from "./usage-format.js";

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-sm)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "var(--surface-card)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
};

const identityStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  flex: "1 1 auto",
  minWidth: 0,
};

const emailStyle: CSSProperties = {
  fontWeight: "var(--weight-semibold)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const metaStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--font-micro)",
};

const badgeStyle: CSSProperties = {
  flex: "0 0 auto",
  padding: "0 var(--space-xs)",
  borderRadius: "var(--radius-sm)",
  background: "color-mix(in srgb, var(--accent) 16%, var(--surface-column))",
  color: "var(--accent)",
  fontSize: "var(--font-micro)",
  fontWeight: "var(--weight-semibold)",
};

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

function usageLine(account: ClaudeAccountSummary): string {
  const { usage } = account;
  const copy = statusCopy(usage);
  if (copy !== null || usage.windows.length === 0) {
    return copy ?? "Usage unavailable, sign in to see it";
  }
  return usage.windows
    .map((w) => {
      const reset = formatReset(w.resetsAt);
      return `${w.label} ${w.percent}%${reset ? ` (resets ${reset})` : ""}`;
    })
    .join(" · ");
}

interface RemoveConfirmProps {
  account: ClaudeAccountSummary;
  onClose: () => void;
  onRemoved: () => void;
}

function RemoveConfirm({ account, onClose, onRemoved }: RemoveConfirmProps) {
  const modalRef = useRef<ModalControl>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await removeAccount(account.id);
    setPending(false);
    if (result.ok) {
      onRemoved();
      return;
    }
    setError(result.error);
  };

  return (
    <Modal
      ariaLabel={`Remove ${account.email}`}
      onClose={onClose}
      controlRef={modalRef}
      initialFocusRef={keepRef}
    >
      <Modal.Header>{account.email}</Modal.Header>
      <Modal.Body>
        <div style={headingStyle}>
          Remove this account from Dispatch? Its Claude login is signed out and
          its config directory is deleted. Sessions already running on it keep
          going.
        </div>
        {error && <Notice tone="destructive" label={error} />}
      </Modal.Body>
      <Modal.Actions>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-sm)",
            flex: "0 0 auto",
          }}
        >
          <Button
            ref={keepRef}
            variant="secondary"
            onClick={() => modalRef.current?.requestClose()}
          >
            Keep account
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() => void handleRemove()}
          >
            {pending ? "Removing…" : "Remove account"}
          </Button>
        </div>
      </Modal.Actions>
    </Modal>
  );
}

interface AccountsTabProps {
  claudeAccounts: ClaudeAccountsState;
}

export function AccountsTab({ claudeAccounts }: AccountsTabProps) {
  const { accounts, activeId, loaded, error, reload } = claudeAccounts;
  const [adding, setAdding] = useState(false);
  const [reloginTarget, setReloginTarget] =
    useState<ClaudeAccountSummary | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ClaudeAccountSummary | null>(
    null,
  );

  return (
    <div
      className="scroll-stable-y"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
        flex: "1 1 auto",
        minHeight: 0,
        overflowY: "auto",
      }}
      data-testid="accounts-tab"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--space-sm)",
        }}
      >
        <span style={headingStyle}>
          Claude logins Dispatch can launch sessions on. The Default account is
          your own login on this Mac; added accounts keep their own Claude
          config directory.
        </span>
        <Button
          variant="primary"
          onClick={() => setAdding(true)}
          disabled={reloginTarget !== null}
          style={{ flex: "0 0 auto" }}
        >
          Add account
        </Button>
      </div>

      {!loaded && <span style={metaStyle}>Loading…</span>}
      {error && <Notice tone="destructive" label={error} />}

      {loaded && (
        <div style={listStyle}>
          {accounts.map((account) => {
            const tightest =
              account.usage.status === "ok"
                ? tightestWindow(account.usage.windows)
                : null;
            return (
              <div
                key={account.id}
                style={rowStyle}
                data-account-id={account.id}
              >
                <div style={identityStyle}>
                  <span style={emailStyle} title={account.email}>
                    {account.email}
                  </span>
                  <span style={metaStyle}>
                    {[
                      account.isDefault
                        ? "Default (your home login)"
                        : account.orgName,
                      account.subscriptionType,
                      account.lastLoginAt
                        ? `signed in ${new Date(account.lastLoginAt).toLocaleString()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span style={metaStyle}>
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        marginRight: "var(--space-xs)",
                        background: tightest
                          ? toneColor(toneFor(tightest.percent))
                          : "var(--text-muted)",
                      }}
                    />
                    {usageLine(account)}
                  </span>
                </div>
                {account.id === activeId && (
                  <span style={badgeStyle}>Active</span>
                )}
                {!account.isDefault && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={adding || reloginTarget !== null}
                      onClick={() => setReloginTarget(account)}
                    >
                      Re-login
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setRemoveTarget(account)}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <AddAccountModal
          onClose={() => {
            setAdding(false);
            void reload();
          }}
          onAdded={() => void reload()}
        />
      )}
      {reloginTarget && (
        <AddAccountModal
          accountId={reloginTarget.id}
          accountEmail={reloginTarget.email}
          onClose={() => {
            setReloginTarget(null);
            void reload();
          }}
          onAdded={() => void reload()}
        />
      )}
      {removeTarget && (
        <RemoveConfirm
          account={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setRemoveTarget(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
