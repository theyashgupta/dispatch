import type { ComponentProps } from "react";
import { SlackContainer } from "@/modules/slack/containers/SlackContainer";

export function SlackView(props: ComponentProps<typeof SlackContainer>) {
  return <SlackContainer {...props} />;
}
