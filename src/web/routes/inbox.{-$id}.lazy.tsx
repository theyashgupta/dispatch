import { createLazyFileRoute } from "@tanstack/react-router";
import { InboxView } from "@/modules/inbox";
import { SlackThreadView } from "@/modules/slack";

export const Route = createLazyFileRoute("/inbox/{-$id}")({
  component: InboxRoute,
});

function InboxRoute() {
  return (
    <InboxView renderSlackThread={(args) => <SlackThreadView {...args} />} />
  );
}
