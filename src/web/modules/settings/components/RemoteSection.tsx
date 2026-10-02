import { ChevronRight, Copy } from "lucide-react";
import type { TunnelState } from "../../../../shared/types.js";
import { QrCode } from "@/components/icons/QrCode";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field } from "@/components/ui/field";
import { Caption } from "@/modules/settings/components/Caption";
import { LoadingButton } from "@/components/LoadingButton";
import { StatusRow } from "@/modules/settings/components/StatusRow";
import { useCopyFlash } from "@/modules/settings/hooks/use-copy-flash";

interface RemoteSectionProps {
  tunnelState: TunnelState;
  pending: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

const MONO_TEXT = "truncate font-mono text-sm text-foreground";

interface CopyRowProps {
  value: string;
  copyLabel: string;
  href?: string;
}

function CopyRow({ value, copyLabel, href }: CopyRowProps) {
  const [copied, copy] = useCopyFlash();
  return (
    <div className="flex items-center gap-1">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-mono text-sm text-(--accent-text) no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {value}
        </a>
      ) : (
        <span className={MONO_TEXT}>{value}</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied" : copyLabel}
        onClick={() => copy(value)}
      >
        <Copy aria-hidden="true" />
      </Button>
    </div>
  );
}

export function RemoteSection({
  tunnelState,
  pending,
  onEnable,
  onDisable,
}: RemoteSectionProps) {
  if (tunnelState.status === "off") {
    return (
      <>
        <div className="text-base text-foreground">
          Reach this board, including live terminals, from any device over a
          temporary public link, guarded by an access code.
        </div>
        <div>
          <LoadingButton loading={pending} onClick={onEnable}>
            {pending ? "Starting…" : "Enable remote access"}
          </LoadingButton>
        </div>
        <span className="text-sm text-muted-foreground">
          Uses an on-demand Cloudflare tunnel. Requires cloudflared.
        </span>
      </>
    );
  }

  if (tunnelState.status === "starting") {
    return (
      <>
        <StatusRow tone="stale" text="Starting tunnel…" />
        <div>
          <LoadingButton loading>Enable remote access</LoadingButton>
        </div>
      </>
    );
  }

  if (tunnelState.status === "on") {
    return (
      <>
        <StatusRow tone="ok" text="Remote access on" />
        <Field className="gap-1">
          <Caption>Public URL</Caption>
          <CopyRow
            value={tunnelState.url}
            href={tunnelState.url}
            copyLabel="Copy public URL"
          />
        </Field>
        <Collapsible>
          <CollapsibleTrigger className="group/qr flex w-full cursor-pointer items-center gap-1 rounded-md py-1 text-left text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-data-[state=open]/qr:rotate-90"
            />
            QR code
          </CollapsibleTrigger>
          <CollapsibleContent>
            <QrCode
              value={`${tunnelState.url}?code=${encodeURIComponent(tunnelState.code)}`}
            />
          </CollapsibleContent>
        </Collapsible>
        <Field className="gap-1">
          <Caption>Access code: enter this on a device without the QR</Caption>
          <CopyRow value={tunnelState.code} copyLabel="Copy access code" />
        </Field>
        <div>
          <LoadingButton
            variant="secondary"
            loading={pending}
            onClick={onDisable}
          >
            {pending ? "Disabling…" : "Disable remote access"}
          </LoadingButton>
        </div>
      </>
    );
  }

  if (tunnelState.status === "error") {
    return (
      <>
        <StatusRow tone="down" text={tunnelState.message} />
        <div>
          <LoadingButton loading={pending} onClick={onEnable}>
            {pending ? "Starting…" : "Enable remote access"}
          </LoadingButton>
        </div>
      </>
    );
  }

  return (
    <>
      <StatusRow tone="down" text="cloudflared not found" />
      <div className="text-base text-foreground">{tunnelState.installHint}</div>
      <Field className="gap-1">
        <Caption>Install command</Caption>
        <CopyRow
          value="brew install cloudflared"
          copyLabel="Copy install command"
        />
      </Field>
    </>
  );
}
