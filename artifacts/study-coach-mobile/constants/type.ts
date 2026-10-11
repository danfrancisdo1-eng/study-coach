import { Platform } from 'react-native';

/**
 * Type scale for the question cards (D-053), measured from Dan's reference screens: a serif
 * for display (headings, the score), the sans for everything read, and smaller weights than
 * the rest of the app. Families: until the Source Serif / Source Sans packages are approved,
 * the serif is the system Georgia and the sans is the system face (San Francisco on iOS).
 */
export const FONT = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  sans: undefined as string | undefined,
};

export const TYPE = {
  /** Small uppercase label above a card or question: "PRACTICE · QUESTION 3 OF 10". */
  kicker: { fontFamily: FONT.sans, fontSize: 13, lineHeight: 18, letterSpacing: 0.8, fontWeight: '600' as const, textTransform: 'uppercase' as const },
  /** The question itself. */
  prompt: { fontFamily: FONT.sans, fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  /** An answer option. */
  option: { fontFamily: FONT.sans, fontSize: 17, lineHeight: 24, fontWeight: '400' as const },
  /** Explanations and other reading text on the card. */
  body: { fontFamily: FONT.sans, fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  /** Secondary lines: collapsed rows, notes, links. */
  small: { fontFamily: FONT.sans, fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  /** Section headings on the card, serif. */
  heading: { fontFamily: FONT.serif, fontSize: 30, lineHeight: 36, fontWeight: '600' as const, letterSpacing: -0.4 },
  /** The score, serif. */
  score: { fontFamily: FONT.serif, fontSize: 56, lineHeight: 62, fontWeight: '600' as const, letterSpacing: -1.5 },
};
