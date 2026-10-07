export const PANEL_MIN_WIDTH_PX = 360;
export const PANEL_MAX_WIDTH_RATIO = 0.9;
export const PANEL_KEYBOARD_STEP_PX = 16;

const MOUSE_TAP_PX = 3;
const TOUCH_TAP_PX = 8;

/**
 * Clamp a panel width to at least 360 px and at most 90 percent of the viewport.
 *
 * @remarks The maximum wins over the minimum, so a viewport under 400 px gets 90 percent of it.
 */
export function clampPanelWidth(px: number, viewportWidth: number): number {
  return Math.min(
    viewportWidth * PANEL_MAX_WIDTH_RATIO,
    Math.max(PANEL_MIN_WIDTH_PX, px),
  );
}

/**
 * The clamped width after an arrow key on the resize handle.
 *
 * @remarks The handle sits on the left edge, so ArrowLeft widens the panel and ArrowRight narrows it.
 */
export function keyboardStepWidth(
  key: "ArrowLeft" | "ArrowRight",
  current: number,
  viewportWidth: number,
): number {
  const step =
    key === "ArrowLeft" ? PANEL_KEYBOARD_STEP_PX : -PANEL_KEYBOARD_STEP_PX;
  return clampPanelWidth(current + step, viewportWidth);
}

/** Whether a drag that moved `delta` px is a tap: 3 px or less for a mouse, 8 px or less otherwise. */
export function isTapGesture(delta: number, pointerType: string): boolean {
  return (
    Math.abs(delta) <= (pointerType === "mouse" ? MOUSE_TAP_PX : TOUCH_TAP_PX)
  );
}

/**
 * Whether a pointer button may start a resize drag.
 *
 * @remarks A secondary press opens the native context menu and the browser then sends no end
 * event, so the drag overlay would never be removed.
 */
export function startsResizeDrag(button: number): boolean {
  return button === 0;
}

/** The CSS width of a persisted panel width, clamped again by the browser on every viewport change. */
export function persistedWidthCss(px: number): string {
  return `clamp(${PANEL_MIN_WIDTH_PX}px, ${px}px, ${PANEL_MAX_WIDTH_RATIO * 100}vw)`;
}
