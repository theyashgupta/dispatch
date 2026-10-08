import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleStop,
  CircleX,
  GitCompare,
  GitMerge,
  GitPullRequest,
  ListChecks,
  LoaderCircle,
  Minus,
  Play,
  ShieldCheck,
  Upload,
  UserCheck,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const GLYPHS: Record<string, LucideIcon> = {
  CircleDashed,
  GitCompare,
  ListChecks,
  Upload,
  LoaderCircle,
  GitPullRequest,
  GitMerge,
  UserCheck,
  CircleCheck,
  CircleX,
  CircleStop,
  Play,
  Minus,
  Check,
  X,
  CircleMinus,
  ShieldCheck,
  UserX,
};

interface ShipGlyphBadgeProps {
  label: string;
  glyph: string;
  tone: "success" | "danger" | "neutral";
}

export function ShipGlyphBadge({ label, glyph, tone }: ShipGlyphBadgeProps) {
  const Glyph = GLYPHS[glyph];
  return (
    <Badge tone={tone}>
      {Glyph !== undefined && <Glyph aria-hidden="true" />}
      {label}
    </Badge>
  );
}
