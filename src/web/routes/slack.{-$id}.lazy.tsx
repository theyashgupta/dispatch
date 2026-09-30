import { lazy } from "react";
import { createLazyFileRoute } from "@tanstack/react-router";
import { loadSlackPage } from "@/features/slack";
import { useAppState } from "@/components/AppState";

const SlackPage = lazy(loadSlackPage);

export const Route = createLazyFileRoute("/slack/{-$id}")({
  component: SlackRoute,
});

function SlackRoute() {
  const props = useAppState().slack;
  const { id } = Route.useParams();
  return <SlackPage {...props} selectedId={id ?? null} />;
}
