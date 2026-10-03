import type { ComponentProps } from "react";
import { SlackThreadContainer } from "@/modules/slack/containers/SlackThreadContainer";

export function SlackThreadView(
  props: ComponentProps<typeof SlackThreadContainer>,
) {
  return <SlackThreadContainer {...props} />;
}
