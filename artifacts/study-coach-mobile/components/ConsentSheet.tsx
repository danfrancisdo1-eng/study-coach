import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { PressScale, withTap } from '@/components/PressScale';
import { useColors } from '@/hooks/useColors';
import { AI_NOTICE } from '@/lib/ai-consent';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';

/**
 * The AI agreement asked where the student is (D-211; the mock Dan approved): an AI button tapped
 * before agreeing slides this card up instead of sending the request and showing an error. The
 * same notice as the Coach tab; "I understand and consent" saves it and the tapped action carries on;
 * "Not now" (or a tap above the card) closes it and nothing is sent.
 */
export function ConsentSheet({ visible, reason, busy, error, onAgree, onClose }: {
  visible: boolean;
  reason: string;
  busy: boolean;
  error: string;
  onAgree: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.shade} accessibilityRole="button" accessibilityLabel="Not now" onPress={onClose} testID="button-consent-shade" />
        <Animated.View entering={SlideInDown.duration(320)} style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]} testID="sheet-ai-consent">
          <View style={styles.grabber} />
          <View style={styles.heading}>
            <Feather name="shield" size={19} color={colors.primaryText} />
            <Text style={styles.title} accessibilityRole="header">Your choice before AI</Text>
          </View>
          <Text style={styles.reason}>{reason}</Text>
          {AI_NOTICE.map((line) => (
            <View key={line.icon} style={styles.line}>
              <Feather name={line.icon} size={16} color={colors.mutedForeground} style={styles.lineIcon} />
              <Text style={styles.body}>{line.text}</Text>
            </View>
          ))}
          {PRIVACY_URL ? <Text style={styles.link} accessibilityRole="link" onPress={withTap(openPrivacy)} testID="link-privacy-sheet">Read the privacy policy</Text> : null}
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <PressScale gradient accessibilityRole="button" disabled={busy} onPress={onAgree} style={[styles.primary, busy && styles.disabled]} testID="button-ai-consent-sheet">
            {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <><Feather name="check" size={16} color={colors.primaryForeground} /><Text style={styles.primaryText}>I understand and consent</Text></>}
          </PressScale>
          <PressScale accessibilityRole="button" disabled={busy} onPress={onClose} style={styles.secondary} testID="button-consent-not-now">
            <Text style={styles.secondaryText}>Not now</Text>
          </PressScale>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10, 12, 24, 0.4)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 4 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { color: colors.foreground, fontSize: 20, fontWeight: '800' },
  reason: { color: colors.mutedForeground, fontSize: 15, lineHeight: 21 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lineIcon: { marginTop: 3 },
  body: { flex: 1, color: colors.foreground, fontSize: 15, lineHeight: 21 },
  link: { color: colors.primaryText, fontSize: 15, textDecorationLine: 'underline', paddingVertical: 6 },
  error: { color: colors.wrong, fontSize: 14, lineHeight: 20 },
  primary: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.mutedForeground, fontSize: 16, fontWeight: '600' },
});
