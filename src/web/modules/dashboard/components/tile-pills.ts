import {
  Check,
  Circle,
  CircleAlert,
  MessageCircleQuestion,
  Play,
  type LucideIcon,
} from "lucide-react";
import type { TileState } from "@/modules/dashboard/domain/ticket-tiles";

export const TILE_PILLS: Record<
  TileState,
  {
    tone: "danger" | "warning" | "accent" | "success" | "neutral";
    Glyph: LucideIcon;
    label: string;
  }
> = {
  stuck: { tone: "danger", Glyph: CircleAlert, label: "stuck" },
  needs_input: {
    tone: "warning",
    Glyph: MessageCircleQuestion,
    label: "needs input",
  },
  current: { tone: "accent", Glyph: Play, label: "in progress" },
  not_started: { tone: "neutral", Glyph: Circle, label: "not started" },
  done: { tone: "success", Glyph: Check, label: "done" },
};
