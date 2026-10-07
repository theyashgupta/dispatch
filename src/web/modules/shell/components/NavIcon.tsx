import {
  Activity,
  Archive,
  ClipboardList,
  HardDrive,
  Inbox,
  Kanban,
  KeyRound,
  LayoutGrid,
  MessageCircleQuestion,
  PanelLeft,
  Settings,
  SquareTerminal,
  Sun,
  Users,
  Workflow,
} from "lucide-react";
import type { ComponentType } from "react";
import type { Page } from "../../../../shared/route.js";
import { sourceAccent, sourceMark } from "@/components/badges";
import { Badge } from "@/components/ui/badge";

export const NAV_ICON: Record<Page, ComponentType<{ size?: number }>> = {
  today: Sun,
  inbox: Inbox,
  ask: MessageCircleQuestion,
  board: Kanban,
  sessions: SquareTerminal,
  workspace: PanelLeft,
  activity: Activity,
  tickets: sourceMark("linear"),
  accounts: Users,
  playbooks: ClipboardList,
  vault: KeyRound,
  archive: Archive,
  "pull-requests": sourceMark("github"),
  errors: sourceMark("sentry"),
  meetings: sourceMark("meeting"),
  calendar: sourceMark("calendar"),
  slack: sourceMark("slack"),
  workspaces: HardDrive,
  flow: Workflow,
  boards: LayoutGrid,
  settings: Settings,
};

interface NavIconProps {
  page: Page;
  brand?: string;
}

export function NavIcon({ page, brand }: NavIconProps) {
  const Icon = NAV_ICON[page];
  if (brand === undefined) return <Icon size={16} />;
  return (
    <Badge
      stateColor={sourceAccent(brand)}
      className="h-auto border-0 bg-transparent p-0 text-(--badge-state) [&>svg]:size-4"
    >
      <Icon size={16} />
    </Badge>
  );
}
