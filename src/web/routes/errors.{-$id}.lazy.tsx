import { createLazyFileRoute } from "@tanstack/react-router";
import { ErrorsView } from "@/modules/errors";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/errors/{-$id}")({
  component: ErrorsRoute,
});

function ErrorsRoute() {
  const props = useAppState().errors;
  const { id } = Route.useParams();
  return <ErrorsView {...props} selectedKey={id ?? null} />;
}
