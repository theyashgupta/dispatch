import { createLazyFileRoute } from "@tanstack/react-router";
import { ErrorsView } from "@/modules/errors";

export const Route = createLazyFileRoute("/errors/{-$id}")({
  component: ErrorsRoute,
});

function ErrorsRoute() {
  const { id } = Route.useParams();
  return <ErrorsView selectedKey={id ?? null} />;
}
