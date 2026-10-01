import type { ReactNode } from "react";
import type { CardSearchResult } from "../../../../shared/search.js";
import { Toaster } from "@/components/ui/sonner";
import { ActivityDrawer } from "@/modules/shell/components/ActivityDrawer";
import {
  CheatSheet,
  type ShortcutGroup,
} from "@/modules/shell/components/CheatSheet";
import {
  CommandPaletteContainer,
  type CommandPaletteContainerProps,
} from "@/modules/shell/containers/CommandPaletteContainer";
import {
  ShellContainer,
  type ShellContainerProps,
} from "@/modules/shell/containers/ShellContainer";
import { UpdateBannerContainer } from "@/modules/shell/containers/UpdateBannerContainer";

type ShellViewProps = Omit<ShellContainerProps, "banner"> & {
  onCloseActivity: () => void;
  activityList: ReactNode;
  paletteOpen: boolean;
  onClosePalette: (ran: boolean) => void;
  commands: CommandPaletteContainerProps["commands"];
  onOpenSearchResult: (result: CardSearchResult) => void;
  shortcutsOpen: boolean;
  onCloseShortcuts: () => void;
  shortcutGroups: readonly ShortcutGroup[];
  theme: "light" | "dark";
};

export function ShellView({
  onCloseActivity,
  activityList,
  paletteOpen,
  onClosePalette,
  commands,
  onOpenSearchResult,
  shortcutsOpen,
  onCloseShortcuts,
  shortcutGroups,
  theme,
  children,
  ...shell
}: ShellViewProps) {
  return (
    <ShellContainer {...shell} banner={<UpdateBannerContainer />}>
      <ActivityDrawer open={shell.activityOpen} onClose={onCloseActivity}>
        {activityList}
      </ActivityDrawer>
      {children}
      {shortcutsOpen && (
        <CheatSheet groups={shortcutGroups} onClose={onCloseShortcuts} />
      )}
      {paletteOpen && (
        <CommandPaletteContainer
          commands={commands}
          onClose={onClosePalette}
          onOpenCard={onOpenSearchResult}
        />
      )}
      <Toaster
        theme={theme}
        position="bottom-center"
        offset="var(--space-xl)"
        mobileOffset="var(--space-xl)"
        toastOptions={{
          closeButtonAriaLabel: "Dismiss",
          classNames: {
            description: "text-destructive-text!",
            actionButton: "bg-primary! text-primary-foreground!",
          },
        }}
      />
    </ShellContainer>
  );
}
