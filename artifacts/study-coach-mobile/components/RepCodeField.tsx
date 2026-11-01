import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCheckRepCode } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { PENDING_REP_CODE_KEY, isCheckableRepCode, normalizeRepCode, repCodeLine } from '@/lib/rep-code';

/**
 * "Got a code from a campus rep? (optional)" on the sign-up screen (D-219; the mock Dan approved). The code is
 * checked as it is typed and kept on the phone, so Apple and Google sign-in (which leave this screen) still credit
 * the rep; the app claims it for the new account once it exists (useClaimPendingRepCode).
 */
export function RepCodeField() {
  const colors = useColors();
  const styles = createStyles(colors);
  const [typed, setTyped] = useState('');
  const [debounced, setDebounced] = useState('');
  const code = normalizeRepCode(debounced);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(typed), 400);
    return () => clearTimeout(timer);
  }, [typed]);
  const check = useCheckRepCode({ code }, { query: { enabled: isCheckableRepCode(code), staleTime: 60_000, retry: false } });
  const line = repCodeLine(code, check.data);
  // Only what the student typed here changes the kept code: coming back to this screen (empty field) keeps it.
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current) return;
    if (check.data?.valid) AsyncStorage.setItem(PENDING_REP_CODE_KEY, code).catch(() => {});
    else if (!isCheckableRepCode(code) || check.data) AsyncStorage.removeItem(PENDING_REP_CODE_KEY).catch(() => {});
  }, [check.data, code]);
  return (
    <View style={styles.card} testID="panel-rep-code">
      <Text style={styles.label}>Got a code from a campus rep? <Text style={styles.optional}>(optional)</Text></Text>
      <TextInput value={typed} onChangeText={(text) => { edited.current = true; setTyped(text); }} placeholder="e.g. JANE-OM" placeholderTextColor={colors.mutedForeground}
        autoCapitalize="characters" autoCorrect={false} maxLength={30} accessibilityLabel="Campus rep code, optional"
        style={styles.input} testID="input-rep-code" />
      {line ? <Text accessibilityLiveRegion="polite" style={[styles.line, { color: line.kind === 'ok' ? colors.correct : colors.destructive }]} testID={`text-rep-code-${line.kind}`}>{line.kind === 'ok' ? '✓ ' : ''}{line.text}</Text> : null}
      <Text style={styles.caption}>The code only tells us which rep invited you. They see counts, never your name.</Text>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { gap: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  label: { fontSize: 15, fontWeight: '700', color: colors.foreground },
  optional: { fontWeight: '500', color: colors.mutedForeground },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, letterSpacing: 0.5, borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground },
  line: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 18, color: colors.mutedForeground },
});
