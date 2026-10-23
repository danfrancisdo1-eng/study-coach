/**
 * Theme tokens (D-043, direction A "Night desk", decided in D-028). Dark-first with a proper
 * light mode; useColors() picks the palette from the device appearance.
 *
 * D-170 (Dan, 2026-10-22, "indigo with amber highlights"): the primary is now the indigo of the
 * app icon, used for the one primary action on a screen, progress, the selected course and the
 * active tab. The highlighter amber stays as a HIGHLIGHT: memory hooks, the coach's suggestion
 * chips, the Resume chip and the premium screen. It no longer marks buttons. The review card
 * stays black in both modes (Dan, 2026-10-06).
 *
 * primary is a FILL (indigo with a white label in light mode, a light indigo with an ink label in
 * dark mode); primaryText is the indigo for text and icons on surfaces. highlight / highlightText
 * are the amber pair with the same shape; chipBg / chipBorder are the soft amber surface;
 * hookBg / hookText are the memory-trick ("Remember it") box, amber-tinted per mode (D-171).
 * navyBg / navyText are the old fixed navy, kept for the Pop Quiz card in the chat and the
 * flashcard back. Every text pair here is at least 4.5:1 on the surface it is meant for
 * (checked 2026-10-22).
 */

const shared = {
  // Dan's review card, fixed in both modes, and the navy of the Pop Quiz card and flashcard back.
  reviewBg: '#101418',
  reviewText: '#eef2f6',
  reviewMuted: '#aab6c3',
  navyBg: '#1f2f4f',
  navyText: '#b9d0ff',
};

const light = {
  ...shared,
  // Legacy aliases (kept for older screens)
  text: '#15192a',
  tint: '#2548b8',

  background: '#f6f7fa',
  foreground: '#15192a',
  card: '#ffffff',
  cardForeground: '#15192a',

  // Indigo (D-170): 6.5:1 with the white label; primaryText 7.8:1 on white, 7.3:1 on the background.
  primary: '#2b4fd8',
  primaryForeground: '#ffffff',
  primaryText: '#2548b8',
  // D-179: primary buttons are a diagonal gradient from `primary` to this lighter end; the
  // label keeps 5.2:1 against the light end (the worst case).
  primaryGradientEnd: '#3d5fe8',
  // The amber, demoted to a highlight (D-170): 9.6:1 with ink on the fill; highlightText 5.5:1 on chipBg.
  highlight: '#f2b544',
  highlightForeground: '#15192a',
  highlightText: '#8a5a00',

  secondary: '#e9edf4',
  secondaryForeground: '#15192a',
  muted: '#eef1f6',
  mutedForeground: '#5b6578',
  accent: '#e6eefb',
  accentForeground: '#1f2f4f',

  destructive: '#c0392b',
  destructiveForeground: '#ffffff',
  correct: '#17693a', // D-157 (Dan: Option B): 6.7:1 on white; was #2f9e5b (3.4:1)
  wrong: '#9f2a22', // D-157 (Dan: Option B): 7.4:1 on white; was #d6453a (4.4:1)
  // The exam clock at 5 minutes left (D-115): an orange, not the amber highlight, so a warning never
  // looks like a brand colour (D-170); 5.2:1 on white. Red at 1 minute uses wrong.
  timerAmber: '#c2410c',

  chipBg: '#fff6df',
  chipBorder: '#e9cf8a',
  // The memory-trick box (D-171): 9.2:1.
  hookBg: '#fff6df',
  hookText: '#5c3d00',

  border: '#d9dee7',
  input: '#d9dee7',
};

const dark: typeof light = {
  ...shared,
  text: '#e9eef6',
  tint: '#7c9bff',

  background: '#0f1726',
  foreground: '#e9eef6',
  card: '#182235',
  cardForeground: '#e9eef6',

  // Light indigo on navy (D-170): 6.8:1 with the ink label; 6.1:1 as text on the card.
  primary: '#7c9bff',
  primaryForeground: '#0f1726',
  primaryText: '#7c9bff',
  // D-179: the gradient runs from `primary` to this deeper end; the ink label keeps 4.8:1 on it.
  primaryGradientEnd: '#5b7cf0',
  highlight: '#f2b544',
  highlightForeground: '#15192a',
  highlightText: '#f2b544',

  secondary: '#243049',
  secondaryForeground: '#e9eef6',
  muted: '#1c2740',
  mutedForeground: '#93a1b8',
  accent: '#1f2f4f',
  accentForeground: '#b9d0ff',

  destructive: '#ff6b61',
  destructiveForeground: '#15192a',
  correct: '#4cd964',
  wrong: '#ff6b61',
  timerAmber: '#fb923c', // 7.0:1 on the card; an orange apart from the amber highlight (D-170)

  chipBg: '#1c2740',
  chipBorder: '#3a4a6a',
  hookBg: '#3a2e12', // 9.3:1 (D-171)
  hookText: '#ffd27a',

  border: '#2a3650',
  input: '#2a3650',
};

const colors = {
  light,
  dark,
  // Corner radius scale: cards 16, buttons and inputs 12, chips 20.
  radius: 16,
};

export default colors;
