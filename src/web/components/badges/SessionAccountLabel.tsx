import { Badge } from "@/components/ui/badge";

interface SessionAccountLabelProps {
  name: string;
}

export function SessionAccountLabel({ name }: SessionAccountLabelProps) {
  return (
    <Badge
      tone="neutral"
      className="max-w-full"
      title={name}
      data-testid="session-account-label"
    >
      <span className="truncate">{name}</span>
    </Badge>
  );
}
