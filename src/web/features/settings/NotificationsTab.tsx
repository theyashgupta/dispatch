import { useCallback, useEffect, useState } from "react";
import { playChime } from "../../lib/chime.js";
import {
  disablePush,
  enablePush,
  isIOSDevice,
  isPushSupported,
  readPushSubscription,
  type PushEnableResult,
} from "../../lib/push.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import {
  settingsBodyTextStyle,
  settingsMutedTextStyle,
  settingsRowStyle,
  settingsSectionStyle,
} from "./settings-styles.js";
import { StatusRow } from "./StatusRow.js";

type DesktopPermission = "granted" | "denied" | "default" | "unsupported";

function useDesktopPermission(): {
  status: DesktopPermission;
  request: () => void;
} {
  const [status, setStatus] = useState<DesktopPermission>(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );

  const request = useCallback(() => {
    if (!("Notification" in window)) return;
    void Notification.requestPermission().then((result) => {
      setStatus(result);
    });
  }, []);

  return { status, request };
}

type PushRowState =
  | "ios-needs-install"
  | "unsupported"
  | "default"
  | "enabling"
  | "enabled"
  | "disabling"
  | "denied";

function usePushSubscription(): {
  state: PushRowState;
  error: "cap" | "generic" | null;
  enable: () => void;
  disable: () => void;
} {
  const [permission, setPermission] = useState<DesktopPermission>(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [pending, setPending] = useState<"enabling" | "disabling" | null>(null);
  const [error, setError] = useState<"cap" | "generic" | null>(null);

  const standaloneMedia = useMediaQuery("(display-mode: standalone)");
  const standalone =
    standaloneMedia ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  useEffect(() => {
    let active = true;
    void readPushSubscription().then((subscription) => {
      if (!active) return;
      setHasSubscription(subscription != null);
    });
    return () => {
      active = false;
    };
  }, []);

  const enable = useCallback(() => {
    setPending("enabling");
    setError(null);
    void enablePush().then(async (result: PushEnableResult) => {
      const livePermission: DesktopPermission =
        "Notification" in window ? Notification.permission : "unsupported";
      setPermission(livePermission);
      const subscription = await readPushSubscription();
      setHasSubscription(subscription != null);
      setPending(null);
      if (livePermission === "denied") {
        setError(null);
      } else if (result.ok) {
        setError(null);
      } else {
        setError(result.error === "too-many-subscriptions" ? "cap" : "generic");
      }
    });
  }, []);

  const disable = useCallback(() => {
    setPending("disabling");
    setError(null);
    void disablePush().then(async (ok) => {
      const subscription = await readPushSubscription();
      setHasSubscription(subscription != null);
      setPending(null);
      if (!ok) setError("generic");
    });
  }, []);

  let state: PushRowState;
  if (isIOSDevice() && !standalone) {
    state = "ios-needs-install";
  } else if (!isPushSupported()) {
    state = "unsupported";
  } else if (pending === "enabling") {
    state = "enabling";
  } else if (pending === "disabling") {
    state = "disabling";
  } else if (permission === "denied") {
    state = "denied";
  } else if (permission === "granted" && hasSubscription === true) {
    state = "enabled";
  } else {
    state = "default";
  }

  return { state, error, enable, disable };
}

interface NotificationsTabSectionProps {
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
}

export function NotificationsTabSection({
  soundEnabled,
  onToggleSound,
}: NotificationsTabSectionProps) {
  const { status, request } = useDesktopPermission();
  const [soundFocus, setSoundFocus] = useState(false);
  const push = usePushSubscription();

  return (
    <div style={settingsSectionStyle}>
      <div style={settingsRowStyle}>
        <Field>Desktop notifications</Field>
        {status === "granted" && (
          <StatusRow
            color="var(--status-ok)"
            text="Enabled. You'll get a system notification when a card needs your input or an agent finishes."
          />
        )}
        {status === "denied" && (
          <StatusRow
            color="var(--status-down)"
            text="Blocked. Enable notifications for this site in your browser settings."
          />
        )}
        {status === "unsupported" && (
          <span style={settingsMutedTextStyle}>
            Not supported in this browser.
          </span>
        )}
        {status === "default" && (
          <>
            <span style={settingsBodyTextStyle}>
              Get a system notification when a card needs your input or an agent
              finishes.
            </span>
            <div>
              <Button variant="secondary" onClick={request}>
                Enable notifications
              </Button>
            </div>
          </>
        )}
      </div>

      <div style={settingsRowStyle}>
        <Field>Sound</Field>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={soundEnabled}
            onChange={() => onToggleSound(!soundEnabled)}
            onFocus={(e) =>
              setSoundFocus(e.currentTarget.matches(":focus-visible"))
            }
            onBlur={() => setSoundFocus(false)}
            style={{
              accentColor: "var(--accent)",
              borderRadius: "var(--radius)",
              ...focusRing(soundFocus),
              flex: "0 0 auto",
            }}
          />
          <span style={settingsBodyTextStyle}>
            Play a gentle chime for the same moments
          </span>
        </label>
        <div>
          <Button variant="secondary" onClick={() => playChime()}>
            Test sound
          </Button>
        </div>
      </div>

      <div style={settingsRowStyle}>
        {push.state === "ios-needs-install" ? (
          <Field>Add to your Home Screen to enable push</Field>
        ) : (
          <Field>Push notifications (this device)</Field>
        )}
        {push.state === "ios-needs-install" && (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <li style={settingsBodyTextStyle}>
              1. Tap the Share icon in Safari's toolbar.
            </li>
            <li style={settingsBodyTextStyle}>2. Tap "Add to Home Screen".</li>
            <li style={settingsBodyTextStyle}>
              3. Open Dispatch from your Home Screen.
            </li>
            <li style={settingsBodyTextStyle}>
              4. Enable push notifications from Settings there.
            </li>
          </ol>
        )}
        {push.state === "unsupported" && (
          <span style={settingsMutedTextStyle}>
            Not supported in this browser.
          </span>
        )}
        {push.state === "default" && (
          <>
            <span style={settingsBodyTextStyle}>
              {
                "Get a push notification when a card needs your input, even with the tab closed."
              }
            </span>
            <div>
              <Button variant="secondary" onClick={push.enable}>
                Enable push notifications
              </Button>
            </div>
          </>
        )}
        {push.state === "enabling" && (
          <div>
            <Button variant="secondary" loading disabled>
              Enabling...
            </Button>
          </div>
        )}
        {push.state === "enabled" && (
          <>
            <StatusRow
              color="var(--status-ok)"
              text="Push enabled - this device will get a push notification when a card needs your input, even with the tab closed."
            />
            <div>
              <Button variant="secondary" onClick={push.disable}>
                Disable push notifications
              </Button>
            </div>
          </>
        )}
        {push.state === "disabling" && (
          <>
            <StatusRow
              color="var(--status-ok)"
              text="Push enabled - this device will get a push notification when a card needs your input, even with the tab closed."
            />
            <div>
              <Button variant="secondary" loading disabled>
                Disabling...
              </Button>
            </div>
          </>
        )}
        {push.state === "denied" && (
          <StatusRow
            color="var(--status-down)"
            text="Blocked - enable notifications for this site in your browser settings."
          />
        )}
        {push.error != null && (
          <div
            role="alert"
            style={{
              ...settingsBodyTextStyle,
              color: "var(--destructive-text)",
            }}
          >
            {push.error === "cap"
              ? "This browser already has too many devices subscribed. Remove one from another Settings session first."
              : "Couldn't turn on push, try again."}
          </div>
        )}
      </div>
    </div>
  );
}
