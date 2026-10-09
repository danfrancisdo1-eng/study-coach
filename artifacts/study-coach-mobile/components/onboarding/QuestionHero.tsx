import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInRight, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Tour page 2 (D-049): a question card in the app's own style. The options arrive one by one,
 * the right one is marked, then the memory trick lands under it. Reanimated's entering
 * animations follow the system Reduce Motion setting on their own.
 */
const STEM = 'A project’s actual cost is higher than its earned value. The cost variance is:';
const OPTIONS = ['Positive', 'Negative', 'Zero', 'Cannot be determined'];
const CORRECT = 1;

export function QuestionHero() {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.card} testID="hero-question">
      <Text style={styles.kicker}>Question 7 of 20</Text>
      <Text style={styles.stem}>{STEM}</Text>
      {OPTIONS.map((option, i) => (
        <Animated.View key={option} entering={FadeInRight.delay(250 + i * 130).duration(380)} style={[styles.option, i === CORRECT && styles.optionCorrect]}>
          <View style={[styles.letter, i === CORRECT && styles.letterCorrect]}><Text style={[styles.letterText, i === CORRECT && styles.letterTextCorrect]}>{'ABCD'[i]}</Text></View>
          <Text style={[styles.optionText, i === CORRECT && styles.optionTextCorrect]}>{option}</Text>
          {i === CORRECT ? (
            <Animated.View entering={ZoomIn.delay(1050).springify().damping(14)}>
              <Feather name="check-circle" size={18} color={colors.correct} />
            </Animated.View>
          ) : null}
        </Animated.View>
      ))}
      <Animated.View entering={FadeInUp.delay(1350).duration(420)} style={styles.trick}>
        <Feather name="zap" size={14} color={colors.hookText} />
        <Text style={styles.trickText}><Text style={styles.trickLabel}>CV = EV − AC. </Text>Negative means over budget.</Text>
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { alignSelf: 'stretch', padding: 16, gap: 9, borderRadius: colors.radius, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  stem: { color: colors.foreground, fontSize: 15, lineHeight: 21, fontWeight: '600', marginBottom: 2 },
  option: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  optionCorrect: { borderColor: colors.correct },
  letter: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary },
  letterCorrect: { backgroundColor: colors.correct },
  letterText: { color: colors.foreground, fontSize: 12, fontWeight: '700' },
  letterTextCorrect: { color: '#ffffff' },
  optionText: { flex: 1, color: colors.foreground, fontSize: 14 },
  optionTextCorrect: { fontWeight: '600' },
  trick: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 12, backgroundColor: colors.hookBg, marginTop: 2 },
  trickText: { flex: 1, color: colors.hookText, fontSize: 13, lineHeight: 18 },
  trickLabel: { fontWeight: '700', color: colors.reviewText },
});
