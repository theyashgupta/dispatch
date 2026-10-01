import { Bot, FileText, Layers, Tag } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { CalendarMark } from "@/components/icons/brands/CalendarMark";
import { GitHubMark } from "@/components/icons/brands/GitHubMark";
import { GranolaMark } from "@/components/icons/brands/GranolaMark";
import { LinearMark } from "@/components/icons/brands/LinearMark";
import { SentryMark } from "@/components/icons/brands/SentryMark";
import { SlackMark } from "@/components/icons/brands/SlackMark";

export type SourceMark = ComponentType<{ size?: number }>;

export const SOURCE_MARK: Record<string, SourceMark> = {
  github: GitHubMark,
  linear: LinearMark,
  slack: SlackMark,
  sentry: SentryMark,
  meeting: GranolaMark,
  calendar: CalendarMark,
  agent: Bot,
  local: FileText,
  group: Layers,
};

export const markSlotStyle: CSSProperties = {
  display: "inline-flex",
  flex: "0 0 auto",
};

/**
 * Resolves a source id to its mark, falling back to the tag glyph for an id outside the map.
 *
 * @remarks The lookup is an own-property check, so an id that names a prototype key (such as
 * `constructor`) gets the fallback and never a function of the prototype.
 */
export function sourceMark(source: string): SourceMark {
  return Object.hasOwn(SOURCE_MARK, source) ? SOURCE_MARK[source] : Tag;
}
