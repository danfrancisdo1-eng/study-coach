import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { HOLD_MS, termSegments, type Term } from '@/lib/term-segments';

/**
 * D-226 (Dan: "Can we highlight that word ... hold down on it and a box pops up and gives you the definition. And
 * when you let go, the box disappears"): a question's text with its specialist words highlighted. Press and hold a
 * word: its definition shows in a box under the question until you let go. A quick tap keeps the box open until the
 * next tap (for anyone who can't hold). VoiceOver: each word is a "Define …" action on the question.
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

  const pressIn = (term: Term) => { pressedAt.current = Date.now(); setOpen(term); };
  const pressOut = (term: Term) => {
    const held = Date.now() - pressedAt.current >= HOLD_MS;
    if (held) { setOpen(null); return; }
    // A tap: the press-in just opened it; a tap on the word already open closes it.
    setOpen((now) => (now?.term === term.term && wasOpen.current === term.term ? null : now));
  };

  return (
    <View testID={testID}>
      <Text
        maxFontSizeMultiplier={1}
        style={style}
        accessibilityHint="Highlighted words have definitions. Swipe up or down for them."
        accessibilityActions={marked.map((t) => ({ name: `define:${t.term}`, label: `Define ${t.term}` }))}
        onAccessibilityAction={(event) => {
          const name = event.nativeEvent.actionName.replace(/^define:/, '');
          setOpen(marked.find((t) => t.term === name) ?? null);
        }}>
        {segments.map((s, i) => s.term ? (
          <Text key={i} suppressHighlighting
            onPressIn={() => { wasOpen.current = open?.term ?? null; pressIn(s.term!); }}
            onPressOut={() => pressOut(s.term!)}
            style={[styles.term, open?.term === s.term.term && styles.termOpen]}
            testID={`term-${s.term.term}`}>{s.text}</Text>
        ) : <Text key={i}>{s.text}</Text>)}
      </Text>
      {open ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={styles.box} accessibilityLiveRegion="polite" testID="term-definition">
          <Text maxFontSizeMultiplier={1} style={styles.boxText}><Text style={styles.boxTerm}>{open.term}</Text>{'  '}{open.definition}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  term: { backgroundColor: colors.hookBg, color: colors.foreground, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.highlightText },
  termOpen: { backgroundColor: colors.highlight, color: colors.highlightForeground },
  box: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.hookBg, borderWidth: 1, borderColor: colors.highlight },
  boxText: { color: colors.foreground, fontSize: 15, lineHeight: 21 },
  boxTerm: { fontWeight: '800' },
});
