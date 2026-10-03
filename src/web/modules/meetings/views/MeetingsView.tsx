import type { ComponentProps } from "react";
import { MeetingsContainer } from "@/modules/meetings/containers/MeetingsContainer";

export function MeetingsView(props: ComponentProps<typeof MeetingsContainer>) {
  return <MeetingsContainer {...props} />;
}
