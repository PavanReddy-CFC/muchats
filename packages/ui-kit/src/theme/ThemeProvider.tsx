import React, { createContext, ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { ChatTheme, darkTheme, lightTheme, mergeTheme, ThemeOverride } from './theme';

const ThemeContext = createContext<ChatTheme>(lightTheme);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Force light/dark instead of following the OS setting. */
  mode?: 'light' | 'dark' | 'system';
  /** White-label overrides layered on top of the light/dark base theme. */
  overrides?: ThemeOverride;
}

export function ThemeProvider({ children, mode = 'system', overrides }: ThemeProviderProps): JSX.Element {
  const systemScheme = useColorScheme();
  const resolvedMode = mode === 'system' ? (systemScheme ?? 'light') : mode;

  const theme = useMemo(
    () => mergeTheme(resolvedMode === 'dark' ? darkTheme : lightTheme, overrides),
    [resolvedMode, overrides],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useChatTheme(): ChatTheme {
  return useContext(ThemeContext);
}
