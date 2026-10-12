import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInRight } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Tour page 5 (D-049): the four ways material comes in, the same four the + button offers,
 * sliding in from the right one after another with one short settle (Dan: no zig-zag), then the one rule that matters about them.
 */
const SOURCES: { icon: React.ComponentProps<typeof Feather>['name']; label: string; note: string }[] = [
  { icon: 'camera', label: 'Photos', note: 'notes, a whiteboard, a textbook page' },
  { icon: 'file-text', label: 'Files', note: 'PDF, Word, a syllabus, slides' },
  { icon: 'link', label: 'Website link', note: 'one public page, read once' },
  { icon: 'mic', label: 'Record a lecture', note: 'transcribed; audio stays on your phone' },
];

export function MaterialHero() {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.wrap} testID="hero-material">
      {SOURCES.map((source, i) => (
        <Animated.View key={source.label} entering={SlideInRight.delay(200 + i * 160).duration(320).easing(Easing.out(Easing.back(1.15)))} style={styles.row}>
          <View style={styles.iconWrap}><Feather name={source.icon} size={18} color={colors.primaryText} /></View>
          <View style={styles.copy}>
            <Text style={styles.label}>{source.label}</Text>
            <Text style={styles.note}>{source.note}</Text>
          </View>
        </Animated.View>
      ))}
      <Animated.Text entering={FadeIn.delay(950).duration(400)} style={styles.caption}>The extracted text is yours to edit before it saves. Duplicates are skipped.</Animated.Text>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 8 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.chipBorder },
  copy: { flex: 1, gap: 1 },
  label: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  note: { color: colors.mutedForeground, fontSize: 12.5 },
  caption: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 17, marginTop: 4 },
});
