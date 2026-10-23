import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { PressScale } from '@/components/PressScale';

// Moved verbatim from app/(tabs)/courses.tsx (behavior-preserving refactor) so the
// material intake sheet and the chat-first home can share it.
export function ActionButton({ label, onPress, disabled, secondary, testID, icon, fill }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  testID?: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
  /** In a two-column grid (D-168): the button takes half the row, every button the same width. */
  fill?: boolean;
}) {
  const colors = useColors();
  return (
    <PressScale
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        { backgroundColor: secondary ? colors.card : colors.primary, borderColor: secondary ? colors.border : colors.primary },
        secondary && styles.secondaryAction,
        fill && styles.fill,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <Feather name={icon} size={16} color={secondary ? colors.foreground : colors.primaryForeground} /> : null}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.actionText, fill && styles.fillText, { color: secondary ? colors.foreground : colors.primaryForeground }]}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  actionButton: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 11, alignSelf: 'flex-start' },
  secondaryAction: {},
  // Two per row with the grid's 8-pt gap; an odd last one stretches across.
  fill: { flexBasis: '47%', flexGrow: 1, alignSelf: 'stretch', paddingHorizontal: 12 },
  fillText: { flexShrink: 1 },
  actionText: { fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.48 },
});
