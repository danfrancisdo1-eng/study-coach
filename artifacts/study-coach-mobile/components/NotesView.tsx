import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * Read-only Markdown notes written by the coach (D-123/D-124): headings bold, bullets as "•".
 * Students never edit notes by hand; corrections go through the coach.
 */
export function NotesView({ notes, testID }: { notes: string; testID?: string }) {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.wrap} testID={testID}>
      {notes.split('\n').filter((line) => line.trim()).map((line, i) => (
        /^#{1,6}\s/.test(line)
          ? <Text key={i} selectable style={[styles.heading, i > 0 && styles.spaced]}>{line.replace(/^#+\s*/, '')}</Text>
          : <Text key={i} selectable style={styles.line}>{line.replace(/^\s*[-*]\s+/, '• ').replace(/\*\*(.+?)\*\*/g, '$1')}</Text>
      ))}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  wrap: { gap: 3 },
  heading: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  spaced: { marginTop: 8 },
  line: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
});
