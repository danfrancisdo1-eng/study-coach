/**
 * Theme tokens (D-043, direction A "Night desk", decided in D-028). Dark-first with a proper
 * light mode; useColors() picks the palette from the device appearance. One accent only, a
 * highlighter yellow, for the primary action, progress and the selected course. The review
 * card stays black in both modes (Dan, 2026-10-06) and the memory-hook chip stays navy.
 *
 * primary is a FILL (yellow with ink text on it); primaryText is the yellow/amber for text and
 * icons on surfaces, which needs a darker amber in light mode to keep 4.5:1 contrast.
 */

const shared = {
  // Dan's review card and hook chip, fixed in both modes.
  reviewBg: '#101418',
  reviewText: '#eef2f6',
  reviewMuted: '#aab6c3',
  hookBg: '#1f2f4f',
  hookText: '#b9d0ff',
};

const light = {
  ...shared,
  // Legacy aliases (kept for older screens)
  text: '#15192a',
  tint: '#8a5a00',

  background: '#f6f7fa',
  foreground: '#15192a',
  card: '#ffffff',
  cardForeground: '#15192a',

  primary: '#f2b544',
  primaryForeground: '#15192a',
  primaryText: '#8a5a00',

  secondary: '#e9edf4',
  secondaryForeground: '#15192a',
  muted: '#eef1f6',
  mutedForeground: '#5b6578',
  accent: '#e6eefb',
  accentForeground: '#1f2f4f',

  destructive: '#c0392b',
  destructiveForeground: '#ffffff',
  correct: '#2f9e5b',
  wrong: '#d6453a',

  chipBg: '#fff6df',
  chipBorder: '#e9cf8a',

  border: '#d9dee7',
  input: '#d9dee7',
};

const dark: typeof light = {
  ...shared,
  text: '#e9eef6',
  tint: '#f2b544',

  background: '#0f1726',
  foreground: '#e9eef6',
  card: '#182235',
  cardForeground: '#e9eef6',

  primary: '#f2b544',
  primaryForeground: '#15192a',
  primaryText: '#f2b544',

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

  chipBg: '#1c2740',
  chipBorder: '#3a4a6a',

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
