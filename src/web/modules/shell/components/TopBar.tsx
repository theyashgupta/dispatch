import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons/Glyph";
import { useSidebar } from "@/components/ui/sidebar";
import { SHELL_IDS } from "@/modules/shell/domain/shell-ids";

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <div className="flex h-(--page-header-height) shrink-0 items-center gap-2 border-b border-border bg-(--surface-column) px-4 select-none">
      <Glyph size={16} title="Dispatch" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {title}
      </span>
      <Button
        id={SHELL_IDS.navMenu}
        variant="ghost"
        size="icon-md"
        className="text-muted-foreground hover:text-muted-foreground"
        aria-label="Open navigation"
        aria-expanded={openMobile}
        onClick={() => setOpenMobile(true)}
      >
        <Menu size={16} strokeWidth={2} aria-hidden="true" />
      </Button>
    </div>
  );
}
