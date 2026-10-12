/**
 * Type scale for the question cards (D-053), from the reference flow Dan built with Grok
 * ("Microsoft AZ-731 Quiz", the sizes it reported for a phone): Source Sans 3 for everything
 * read, Fraunces for the big titles and the score, smaller than the rest of the app. A loaded
 * font is addressed by its exact face name (RN does not pick a bold file from fontWeight), so
 * each style names its face and sets no fontWeight. The faces are loaded in app/_layout.tsx;
 * until they are, RN falls back to the system font.
 */
export const FONT = {
  sans: 'SourceSans3_400Regular',
  sansSemi: 'SourceSans3_600SemiBold',
  sansBold: 'SourceSans3_700Bold',
  serif: 'Fraunces_600SemiBold',
};

export const TYPE = {
  /** Small uppercase label: the domain, "practice · topic". 14 in the reference. */
  kicker: { fontFamily: FONT.sansSemi, fontSize: 14, lineHeight: 18, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  /** The question itself: 18, semibold. */
  prompt: { fontFamily: FONT.sansSemi, fontSize: 18, lineHeight: 26 },
  /** An answer choice: 16. */
  option: { fontFamily: FONT.sans, fontSize: 16, lineHeight: 23 },
  /** The A B C D letter: 14, bold. */
  letter: { fontFamily: FONT.sansBold, fontSize: 14, lineHeight: 28 },
  /** Explanations and other reading text on the card: 16. */
  body: { fontFamily: FONT.sans, fontSize: 16, lineHeight: 23 },
  bodySemi: { fontFamily: FONT.sansSemi, fontSize: 16, lineHeight: 23 },
  /** Secondary lines ("3 of 20", collapsed rows, notes, links): 14. */
  small: { fontFamily: FONT.sans, fontSize: 14, lineHeight: 20 },
  smallSemi: { fontFamily: FONT.sansSemi, fontSize: 14, lineHeight: 20 },
  /** Next, Check, Grade: 16 on a 48-pt button. */
  button: { fontFamily: FONT.sansSemi, fontSize: 16, lineHeight: 22 },
  /** A big title in Fraunces: 36 on a phone. */
  title: { fontFamily: FONT.serif, fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  /** A section heading on the card, Fraunces. */
  heading: { fontFamily: FONT.serif, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  /** The score: 48, with the "/20" beside it at 30. */
  score: { fontFamily: FONT.serif, fontSize: 48, lineHeight: 54, letterSpacing: -1 },
  scoreOf: { fontFamily: FONT.serif, fontSize: 30, lineHeight: 54, letterSpacing: -0.5 },
};
