import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Caption } from "@/modules/settings/components/Caption";
import { LoadingButton } from "@/components/LoadingButton";
import { StatusRow } from "@/modules/settings/components/StatusRow";
import type {
  DesktopPermission,
  PushError,
  PushRowState,
} from "@/modules/settings/domain/push-row-state";

interface NotificationsSectionProps {
  desktopPermission: DesktopPermission;
  pushState: PushRowState;
  pushError: PushError | null;
  soundEnabled: boolean;
  onRequestDesktop: () => void;
  onToggleSound: (enabled: boolean) => void;
  onPlayChime: () => void;
  onEnablePush: () => void;
  onDisablePush: () => void;
}

const PUSH_ENABLED_TEXT =
  "Push enabled - this device will get a push notification when a card needs your input, even with the tab closed.";

export function NotificationsSection({
  desktopPermission,
  pushState,
  pushError,
  soundEnabled,
  onRequestDesktop,
  onToggleSound,
  onPlayChime,
  onEnablePush,
  onDisablePush,
}: NotificationsSectionProps) {
  return (
    <>
      <Field className="gap-1">
        <Caption>Desktop notifications</Caption>
        {desktopPermission === "granted" && (
          <StatusRow
            tone="ok"
            text="Enabled. You'll get a system notification when a card needs your input or an agent finishes."
          />
        )}
        {desktopPermission === "denied" && (
          <StatusRow
            tone="down"
            text="Blocked. Enable notifications for this site in your browser settings."
          />
        )}
        {desktopPermission === "unsupported" && (
          <span className="text-sm text-muted-foreground">
            Not supported in this browser.
          </span>
        )}
        {desktopPermission === "default" && (
          <>
            <span className="text-base text-foreground">
              Get a system notification when a card needs your input or an agent
              finishes.
            </span>
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onRequestDesktop}
              >
                Enable notifications
              </Button>
            </div>
          </>
        )}
      </Field>

      <Field className="gap-1">
        <Caption>Sound</Caption>
        <Label className="cursor-pointer gap-2 text-base font-normal">
          <Switch
            checked={soundEnabled}
            onCheckedChange={() => onToggleSound(!soundEnabled)}
          />
          Play a gentle chime for the same moments
        </Label>
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onPlayChime}
          >
            Test sound
          </Button>
        </div>
      </Field>

      <Field className="gap-1">
        <Caption>
          {pushState === "ios-needs-install"
            ? "Add to your Home Screen to enable push"
            : "Push notifications (this device)"}
        </Caption>
        {pushState === "ios-needs-install" && (
          <ol className="m-0 list-none p-0 text-base text-foreground">
            <li>1. Tap the Share icon in Safari's toolbar.</li>
            <li>2. Tap "Add to Home Screen".</li>
            <li>3. Open Dispatch from your Home Screen.</li>
            <li>4. Enable push notifications from Settings there.</li>
          </ol>
        )}
        {pushState === "unsupported" && (
          <span className="text-sm text-muted-foreground">
            Not supported in this browser.
          </span>
        )}
        {pushState === "default" && (
          <>
            <span className="text-base text-foreground">
              Get a push notification when a card needs your input, even with
              the tab closed.
            </span>
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onEnablePush}
              >
                Enable push notifications
              </Button>
            </div>
          </>
        )}
        {pushState === "enabling" && (
          <div>
            <LoadingButton variant="secondary" loading>
              Enabling...
            </LoadingButton>
          </div>
        )}
        {pushState === "enabled" && (
          <>
            <StatusRow tone="ok" text={PUSH_ENABLED_TEXT} />
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onDisablePush}
              >
                Disable push notifications
              </Button>
            </div>
          </>
        )}
        {pushState === "disabling" && (
          <>
            <StatusRow tone="ok" text={PUSH_ENABLED_TEXT} />
            <div>
              <LoadingButton variant="secondary" loading>
                Disabling...
              </LoadingButton>
            </div>
          </>
        )}
        {pushState === "denied" && (
          <StatusRow
            tone="down"
            text="Blocked - enable notifications for this site in your browser settings."
          />
        )}
        {pushError !== null && (
          <Alert variant="destructive">
            <AlertDescription className="text-base text-destructive-text">
              {pushError === "cap"
                ? "This browser already has too many devices subscribed. Remove one from another Settings session first."
                : "Couldn't turn on push, try again."}
            </AlertDescription>
          </Alert>
        )}
      </Field>
    </>
  );
}
