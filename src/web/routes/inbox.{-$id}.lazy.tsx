import { createLazyFileRoute } from "@tanstack/react-router";
import { SlackThread } from "@/features/slack";
import { InboxView } from "@/modules/inbox";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/inbox/{-$id}")({
  component: InboxRoute,
});

function InboxRoute() {
  const props = useAppState().inbox;
  return (
    <InboxView
      {...props}
      renderSlackThread={(args) => <SlackThread {...args} />}
    />
  );
}
