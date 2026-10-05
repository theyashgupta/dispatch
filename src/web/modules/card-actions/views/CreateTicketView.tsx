import {
  CreateTicketContainer,
  type CreateTicketContainerProps,
} from "@/modules/card-actions/containers/CreateTicketContainer";

export function CreateTicketView(props: CreateTicketContainerProps) {
  return <CreateTicketContainer {...props} />;
}
