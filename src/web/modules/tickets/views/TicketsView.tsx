import type { ComponentProps } from "react";
import { TicketsContainer } from "@/modules/tickets/containers/TicketsContainer";

export function TicketsView(props: ComponentProps<typeof TicketsContainer>) {
  return <TicketsContainer {...props} />;
}
