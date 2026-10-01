import { SidebarProvider } from "@/components/ui/sidebar";
import {
  ShellFrame,
  type ShellFrameProps,
} from "@/modules/shell/components/ShellFrame";
import { sidebarOpen } from "@/modules/shell/domain/nav-open";
import { useNavPreference } from "@/modules/shell/hooks/use-nav-preference";
import { useViewportNav } from "@/modules/shell/hooks/use-viewport-nav";

export type ShellContainerProps = Omit<ShellFrameProps, "carousel">;

export function ShellContainer(props: ShellContainerProps) {
  const { preference, setPreference } = useNavPreference();
  const { carousel } = useViewportNav();
  return (
    <SidebarProvider
      open={sidebarOpen(preference, carousel)}
      onOpenChange={(next) => {
        if (!carousel) setPreference(next ? "expanded" : "collapsed");
      }}
      className="h-svh min-h-0 overflow-hidden [--sidebar-width-icon:var(--nav-width-collapsed)]! [--sidebar-width:var(--nav-width)]!"
    >
      <ShellFrame {...props} carousel={carousel} />
    </SidebarProvider>
  );
}
