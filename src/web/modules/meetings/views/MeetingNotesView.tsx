import type { ComponentProps } from "react";
import { MeetingNotesContainer } from "@/modules/meetings/containers/MeetingNotesContainer";

export function MeetingNotesView(
  props: ComponentProps<typeof MeetingNotesContainer>,
) {
  return <MeetingNotesContainer {...props} />;
}
