import { createContext, useContext, type ReactNode } from "react";
import { useTheme } from "@/components/ui/hooks/use-theme";

type ThemeState = ReturnType<typeof useTheme>;

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext value={useTheme()}>{children}</ThemeContext>;
}

export function useThemeState(): ThemeState {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useThemeState must be used inside ThemeProvider");
  }
  return value;
}
