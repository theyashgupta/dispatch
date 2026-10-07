import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PanelAlertProps {
  icon?: boolean;
  children: ReactNode;
}

export function PanelAlert({ icon = false, children }: PanelAlertProps) {
  return (
    <Alert
      variant="destructive"
      className="items-center has-[>svg]:grid-cols-[--spacing(3)_1fr] has-[>svg]:gap-x-1 [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:translate-y-0"
    >
      {icon && <TriangleAlert aria-hidden="true" />}
      <AlertTitle className="line-clamp-none leading-(--line-label) font-semibold tracking-normal">
        {children}
      </AlertTitle>
    </Alert>
  );
}

interface PanelMutedNoticeProps {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}

export function PanelMutedNotice({
  label,
  action,
  children,
}: PanelMutedNoticeProps) {
  return (
    <Alert variant="muted" className="gap-y-(--space-xs)">
      <AlertTitle className="line-clamp-none leading-(--line-label) tracking-normal">
        {label}
      </AlertTitle>
      <AlertDescription className="block leading-(--line-body) [word-break:break-word] whitespace-pre-wrap">
        {children}
      </AlertDescription>
      {action != null && (
        <div className="col-start-2 flex flex-col">{action}</div>
      )}
    </Alert>
  );
}

export function PanelMonoNotice({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-stable-y max-h-60 overflow-y-auto rounded-md border border-border bg-card px-(--space-lg) py-(--space-xl) font-mono text-xs leading-(--line-label) font-normal [word-break:break-word] whitespace-pre-wrap text-muted-foreground">
      {children}
    </div>
  );
}
