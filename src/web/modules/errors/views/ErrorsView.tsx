import type { ComponentProps } from "react";
import { ErrorsContainer } from "@/modules/errors/containers/ErrorsContainer";

export function ErrorsView(props: ComponentProps<typeof ErrorsContainer>) {
  return <ErrorsContainer {...props} />;
}
