import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { HOLD_MS, termSegments, termTokens, type Term } from '@/lib/term-segments';

/**
 * D-226 (Dan: "Can we highlight that word ... hold down on it and a box pops up and gives you the definition. And
 * when you let go, the box disappears"): a question's text with its specialist words highlighted. Press and hold a
 * word: its definition shows in a box under the question until you let go. A quick tap keeps the box open until the
 * next tap (for anyone who can't hold). VoiceOver: the question is one item with a "Define …" action per word.
 * D-227 (Dan on build #114: "the holding on the word or clicking not working"): a term inside one long Text got no
 * press-down / let-go on iPhone, so the question is now laid out word by word in a wrapping row and each term is a
 * real Pressable.
 */
export function TermText({ text, terms, style, testID }: { text: string; terms?: readonly Term[] | null; style?: StyleProp<TextStyle>; testID?: string }) {
  const colors = useColors();
  const styles = createStyles(colors);
  const [open, setOpen] = useState<Term | null>(null);
  const pressedAt = useRef(0);
  // The word that was open when this press began: a quick tap on it closes it.
  const wasOpen = useRef<string | null>(null);
  const segments = termSegments(text, terms);
  const marked = segments.flatMap((s) => (s.term ? [s.term] : []));
  if (!marked.length) return <Text maxFontSizeMultiplier={1} style={style} testID={testID}>{text}</Text>;

  const pressIn = (term: Term) => { wasOpen.current = open?.term ?? null; pressedAt.current = Date.now(); setOpen(term); };
  const pressOut = (term: Term) => {
    if (Date.now() - pressedAt.current >= HOLD_MS) { setOpen(null); return; } // a hold: letting go hides it
    if (wasOpen.current === term.term) setOpen(null); // a tap on the word already open closes it
  };

  return (
    <View testID={testID}>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={text}
        accessibilityHint="Highlighted words have definitions. Swipe up or down for them."
        accessibilityActions={marked.map((t) => ({ name: `define:${t.term}`, label: `Define ${t.term}` }))}
        onAccessibilityAction={(event) => {
          const name = event.nativeEvent.actionName.replace(/^define:/, '');
          setOpen(marked.find((t) => t.term === name) ?? null);
        }}>
        {termTokens(segments).map((piece, i) => {
          if (!piece.term) return <Text key={i} maxFontSizeMultiplier={1} style={style}>{piece.text}</Text>;
          const term = piece.term;
          const word = piece.text.trimEnd();
          return (
            <Pressable key={i} onPressIn={() => pressIn(term)} onPressOut={() => pressOut(term)} hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }} style={styles.pressable} testID={`term-${term.term}`}>
              <Text maxFontSizeMultiplier={1} style={[style, styles.term, open?.term === term.term && styles.termOpen]}>{word}</Text>
              <Text maxFontSizeMultiplier={1} style={style}>{piece.text.slice(word.length)}</Text>
            </Pressable>
          );
        })}
      </View>
      {open ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={styles.box} accessibilityLiveRegion="polite" testID="term-definition">
          <Text maxFontSizeMultiplier={1} style={styles.boxText}><Text style={styles.boxTerm}>{open.term}</Text>{'  '}{open.definition}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' },
  pressable: { flexDirection: 'row' },
  term: { backgroundColor: colors.hookBg, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.highlightText, borderRadius: 4 },
  termOpen: { backgroundColor: colors.highlight, color: colors.highlightForeground },
  box: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.hookBg, borderWidth: 1, borderColor: colors.highlight },
  boxText: { color: colors.foreground, fontSize: 15, lineHeight: 21 },
  boxTerm: { fontWeight: '800' },
});
