import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { TunnelState } from "../../../shared/types.js";
import { disableRemote, enableRemote } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { QrCode } from "../../primitives/QrCode.js";
import {
  settingsBodyTextStyle,
  settingsMutedTextStyle,
  settingsRowStyle,
  settingsSectionStyle,
} from "./settings-styles.js";
import { StatusRow } from "./StatusRow.js";

interface RemoteTab {
  pending: boolean;
  handleEnable: () => Promise<void>;
  handleDisable: () => Promise<void>;
}

export function useRemoteTab(): RemoteTab {
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleEnable() {
    if (pending) return;
    setPending(true);
    try {
      await enableRemote();
    } catch (err) {
      console.error("enableRemote failed", err);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }

  async function handleDisable() {
    if (pending) return;
    setPending(true);
    try {
      await disableRemote();
    } catch (err) {
      console.error("disableRemote failed", err);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }

  return { pending, handleEnable, handleDisable };
}

function useCopyFlash(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };
  return [copied, copy];
}

const remoteMonoRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
} as const;

const remoteMonoTextStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const remoteMonoLinkStyle = {
  ...remoteMonoTextStyle,
  color: "var(--accent)",
  textDecoration: "none",
} as const;

interface RemoteTabSectionProps {
  tunnelState: TunnelState;
  remoteTab: RemoteTab;
}

export function RemoteTabSection({
  tunnelState,
  remoteTab,
}: RemoteTabSectionProps) {
  const { pending, handleEnable, handleDisable } = remoteTab;
  const [urlCopied, copyUrl] = useCopyFlash();
  const [codeCopied, copyCode] = useCopyFlash();
  const [brewCopied, copyBrew] = useCopyFlash();

  if (tunnelState.status === "off") {
    return (
      <div style={settingsSectionStyle}>
        <div style={settingsBodyTextStyle}>
          Reach this board, including live terminals, from any device over a
          temporary public link, guarded by an access code.
        </div>
        <div>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => void handleEnable()}
          >
            {pending ? "Starting…" : "Enable remote access"}
          </Button>
        </div>
        <span style={settingsMutedTextStyle}>
          Uses an on-demand Cloudflare tunnel. Requires cloudflared.
        </span>
      </div>
    );
  }

  if (tunnelState.status === "starting") {
    return (
      <div style={settingsSectionStyle}>
        <StatusRow color="var(--status-stale)" text="Starting tunnel…" />
        <div>
          <Button variant="primary" disabled loading>
            Enable remote access
          </Button>
        </div>
      </div>
    );
  }

  if (tunnelState.status === "on") {
    return (
      <div style={settingsSectionStyle}>
        <StatusRow color="var(--status-ok)" text="Remote access on" />
        <div style={settingsRowStyle}>
          <Field>Public URL</Field>
          <div style={remoteMonoRowStyle}>
            <a
              href={tunnelState.url}
              target="_blank"
              rel="noopener noreferrer"
              style={remoteMonoLinkStyle}
            >
              {tunnelState.url}
            </a>
            <IconButton
              aria-label={urlCopied ? "Copied" : "Copy public URL"}
              onClick={() => copyUrl(tunnelState.url)}
            >
              <Copy size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <Collapsible title="QR code">
          <QrCode
            value={`${tunnelState.url}?code=${encodeURIComponent(tunnelState.code)}`}
          />
        </Collapsible>
        <div style={settingsRowStyle}>
          <Field>Access code: enter this on a device without the QR</Field>
          <div style={remoteMonoRowStyle}>
            <span style={remoteMonoTextStyle}>{tunnelState.code}</span>
            <IconButton
              aria-label={codeCopied ? "Copied" : "Copy access code"}
              onClick={() => copyCode(tunnelState.code)}
            >
              <Copy size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <div>
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => void handleDisable()}
          >
            {pending ? "Disabling…" : "Disable remote access"}
          </Button>
        </div>
      </div>
    );
  }

  if (tunnelState.status === "error") {
    return (
      <div style={settingsSectionStyle}>
        <StatusRow color="var(--status-down)" text={tunnelState.message} />
        <div>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => void handleEnable()}
          >
            {pending ? "Starting…" : "Enable remote access"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={settingsSectionStyle}>
      <StatusRow color="var(--status-down)" text="cloudflared not found" />
      <div style={settingsBodyTextStyle}>{tunnelState.installHint}</div>
      <div style={settingsRowStyle}>
        <Field>Install command</Field>
        <div style={remoteMonoRowStyle}>
          <span style={remoteMonoTextStyle}>brew install cloudflared</span>
          <IconButton
            aria-label={brewCopied ? "Copied" : "Copy install command"}
            onClick={() => copyBrew("brew install cloudflared")}
          >
            <Copy size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
