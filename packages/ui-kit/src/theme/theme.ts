export interface ChatTheme {
  colors: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    primary: string;
    bubbleMine: string;
    bubbleMineText: string;
    bubbleTheirs: string;
    bubbleTheirsText: string;
    border: string;
    danger: string;
  };
  spacing: (multiplier: number) => number;
  radius: { sm: number; md: number; lg: number; full: number };
  typography: {
    body: { fontSize: number; lineHeight: number };
    caption: { fontSize: number; lineHeight: number };
    heading: { fontSize: number; lineHeight: number; fontWeight: '600' };
  };
}

const spacing = (unit: number) => (multiplier: number) => unit * multiplier;

// WhatsApp-inspired palette: teal header/primary, green outgoing bubbles, warm-white
// background. `bubbleMine`/`bubbleTheirs` drive the actual message bubble colors here.
export const lightTheme: ChatTheme = {
  colors: {
    background: '#ECE5DD',
    surface: '#F7F3EE',
    text: '#111B21',
    textMuted: '#667781',
    primary: '#075E54',
    bubbleMine: '#DCF8C6',
    bubbleMineText: '#111B21',
    bubbleTheirs: '#FFFFFF',
    bubbleTheirsText: '#111B21',
    border: '#D9D3CC',
    danger: '#D32F2F',
  },
  spacing: spacing(4),
  radius: { sm: 6, md: 12, lg: 18, full: 999 },
  typography: {
    body: { fontSize: 15, lineHeight: 20 },
    caption: { fontSize: 12, lineHeight: 16 },
    heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  },
};

export const darkTheme: ChatTheme = {
  ...lightTheme,
  colors: {
    background: '#0B141A',
    surface: '#111B21',
    text: '#E9EDEF',
    textMuted: '#8696A0',
    primary: '#00A884',
    bubbleMine: '#005C4B',
    bubbleMineText: '#E9EDEF',
    bubbleTheirs: '#202C33',
    bubbleTheirsText: '#E9EDEF',
    border: '#2A3942',
    danger: '#EF5350',
  },
};

export type ThemeOverride = Partial<ChatTheme> & { colors?: Partial<ChatTheme['colors']> };

export function mergeTheme(base: ChatTheme, override?: ThemeOverride): ChatTheme {
  if (!override) return base;
  return {
    ...base,
    ...override,
    colors: { ...base.colors, ...override.colors },
  };
}
