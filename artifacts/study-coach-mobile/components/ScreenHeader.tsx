import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * The one header (D-165, Dan: "standardize navigation across pages. Make it concrete to the
 * user which page they're on"). Every screen and sheet draws the same strip: an optional
 * leading button (a back chevron on a pushed screen, an X on a sheet, nothing on a tab), a
 * kicker that names the kind of page ("Course", "Certification exam", "Lecture"), the title on
 * one line, and up to one action on the right. Same height, same type, same icon everywhere.
 */
export type ScreenHeaderProps = {
  title?: string;
  /** Small gray line above the title: what kind of page this is, or where it belongs. */
  kicker?: string;
  /** Small gray line under the title (a date, a course name). */
  subtitle?: string;
  /** Back on a pushed screen; close on a sheet; none on a tab. */
  leading?: 'back' | 'close' | 'down' | 'none';
  onLeading?: () => void;
  leadingLabel?: string;
  leadingDisabled?: boolean;
  leadingTestID?: string;
  /** One action on the right, 44 pt (an icon button or a text button). */
  right?: React.ReactNode;
  /** Something before the copy (the app mark on the coach screen). */
  mark?: React.ReactNode;
  titleLines?: number;
  /** A hairline under the header while the page is scrolled (D-171), so content has an edge to pass under. */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ScreenHeader({ title, kicker, subtitle, leading = 'none', onLeading, leadingLabel, leadingDisabled, leadingTestID, right, mark, titleLines = 1, divider, style, testID }: ScreenHeaderProps) {
  const colors = useColors();
  const icon = leading === 'close' ? 'x' : leading === 'down' ? 'chevron-down' : 'chevron-left';
  const label = leadingLabel ?? (leading === 'close' ? 'Close' : 'Back');
  return (
    <View style={[styles.header, leading === 'none' && !mark && styles.headerFlush, divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, style]} testID={testID}>
      {leading !== 'none' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={leadingDisabled} onPress={onLeading} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} testID={leadingTestID ?? (leading === 'close' ? 'button-close' : 'button-back')}>
          <Feather name={icon} size={24} color={leadingDisabled ? colors.mutedForeground : colors.foreground} />
        </Pressable>
      ) : null}
      {mark}
      <View style={styles.copy}>
        {kicker ? <Text numberOfLines={1} style={[styles.kicker, { color: colors.mutedForeground }]}>{kicker}</Text> : null}
        {title ? <Text numberOfLines={titleLines} accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{title}</Text> : null}
        {subtitle ? <Text numberOfLines={1} style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** The 44-pt icon button for the header's right side, so screens don't each restyle one. */
export function HeaderIconButton({ icon, label, onPress, disabled, testID }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} testID={testID}>
      <Feather name={icon} size={20} color={disabled ? colors.mutedForeground : colors.foreground} />
    </Pressable>
  );
}

/** A short text action on the right ("Add"), 44 pt high, in the accent text colour. */
export function HeaderTextButton({ icon, label, onPress, disabled, testID }: { icon?: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.textButton, pressed && styles.pressed]} testID={testID}>
      {icon ? <Feather name={icon} size={16} color={colors.primaryText} /> : null}
      <Text style={[styles.textButtonLabel, { color: colors.primaryText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  // With nothing on the left the copy lines up with the page content (16 pt), not the icon slot.
  headerFlush: { paddingLeft: 16 },
  copy: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  title: { fontSize: 20, lineHeight: 25, fontWeight: '700' },
  subtitle: { fontSize: 12, lineHeight: 16 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  textButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12 },
  textButtonLabel: { fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
