import { createLazyFileRoute } from "@tanstack/react-router";
import { ErrorsPage } from "@/features/errors";
import { useAppState } from "@/components/AppState";

export const Route = createLazyFileRoute("/errors/{-$id}")({
  component: ErrorsRoute,
});

function ErrorsRoute() {
  const props = useAppState().errors;
  const { id } = Route.useParams();
  return <ErrorsPage {...props} selectedKey={id ?? null} />;
}
