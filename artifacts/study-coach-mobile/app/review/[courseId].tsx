import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useCreateReviewSheet, type ReviewSheet } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { friendlyError } from '@/lib/friendly-error';
import { premiumCode } from '@/lib/premium-ui';
import { reviewHtml } from '@/lib/review-html';
import { goBack } from '@/lib/nav';

/**
 * The review sheet (D-101, spec C): the course's key points, memory tricks and the student's
 * own misses by section, shown here first, then shared or saved as a PDF through the iPhone
 * share sheet (Files, Mail, AirDrop, Print). Written once per visit; counts as one set.
 */
export default function ReviewSheetScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn } = useAuth();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const create = useCreateReviewSheet();
  const [sheet, setSheet] = useState<ReviewSheet | null>(null);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);

  const build = async () => {
    if (!courseId) return;
    setError('');
    try {
      setSheet(await create.mutateAsync({ courseId }));
    } catch (problem) {
      // The plain sentence hides the cause; the preview log keeps it (development builds only).
      if (__DEV__) { const p = problem as { status?: number; data?: unknown; message?: string }; console.warn('Review sheet failed', p?.status, JSON.stringify(p?.data ?? null).slice(0, 300), String(p?.message ?? problem).slice(0, 300)); }
      setError(friendlyError(problem));
      const code = premiumCode(problem);
      if (code) router.push({ pathname: '/premium', params: { reason: code } });
    }
  };
  useEffect(() => { if (isSignedIn && courseId) void build(); }, [isSignedIn, courseId]);

  if (isLoaded && !isSignedIn) return <Redirect href="/" />;

  const share = async () => {
    if (!sheet || sharing) return;
    setSharing(true); setError('');
    try {
      const { uri } = await Print.printToFileAsync({ html: reviewHtml(sheet) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: sheet.title });
      else setError('Sharing is not available on this device.');
    } catch (problem) {
      setError(friendlyError(problem));
    } finally { setSharing(false); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-review-sheet">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBack()} style={styles.iconButton} testID="button-back"><Feather name="chevron-left" size={24} color={colors.foreground} /></Pressable>
        <View style={styles.headerCopy}><Text style={styles.title} numberOfLines={1}>Review sheet</Text></View>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}>
        {create.isPending && !sheet ? (
          <View style={styles.waiting} testID="status-review-writing">
            <ActivityIndicator color={colors.primaryText} />
            <Text style={styles.muted}>Writing your review sheet from your material and results… this takes about 20 seconds.</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.waiting}>
            <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
            {!sheet ? <Pressable accessibilityRole="button" onPress={() => void build()} style={styles.secondary} testID="button-retry-review"><Text style={styles.secondaryText}>Try again</Text></Pressable> : null}
          </View>
        ) : null}
        {sheet ? <>
          <Text style={styles.sheetTitle} accessibilityRole="header">{sheet.title}</Text>
          <Text style={styles.muted}>Built from {sheet.basedOn.materials ? 'your material' : 'general knowledge (no material yet)'}{sheet.basedOn.misses ? `, ${sheet.basedOn.misses} of your misses` : ''}{sheet.basedOn.memoryRows ? ` and your memory sheet` : ''}.</Text>
          {sheet.sections.map((s, i) => (
            <View key={`${i}-${s.name}`} style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">{i + 1}. {s.name}</Text>
              {s.points.map((p, k) => <View key={k} style={styles.bulletRow}><Text style={styles.body}>•</Text><Text style={[styles.body, styles.flex]}>{p}</Text></View>)}
              {s.tricks.length ? <View style={styles.tricks}>{s.tricks.map((t, k) => <Text key={k} style={styles.trick}>⚡ {t}</Text>)}</View> : null}
              {s.misses.length ? (
                <View style={styles.misses}>
                  <Text style={styles.kicker}>You missed these</Text>
                  {s.misses.map((m, k) => <View key={k} style={styles.miss}><Text style={styles.missQ}>{m.question}</Text><Text style={styles.missA}>Answer: {m.answer}</Text></View>)}
                </View>
              ) : null}
            </View>
          ))}
        </> : null}
      </ScrollView>
      {sheet ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable accessibilityRole="button" disabled={sharing} onPress={() => void share()} style={({ pressed }) => [styles.primary, pressed && styles.pressed, sharing && styles.disabled]} testID="button-share-pdf">
            {sharing ? <ActivityIndicator color={colors.primaryForeground} /> : <><Feather name="share" size={18} color={colors.primaryForeground} /><Text style={styles.primaryText}>Share or save as PDF</Text></>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.foreground, fontSize: 20, fontWeight: '700' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  content: { paddingHorizontal: 18, gap: 10 },
  waiting: { gap: 12, paddingVertical: 30, alignItems: 'center' },
  sheetTitle: { color: colors.foreground, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  section: { gap: 6, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6 },
  sectionTitle: { color: colors.foreground, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  bulletRow: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  body: { color: colors.foreground, fontSize: 15, lineHeight: 21 },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, textAlign: 'left' },
  kicker: { color: colors.mutedForeground, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  tricks: { gap: 4, padding: 10, borderRadius: 12, backgroundColor: colors.hookBg, marginTop: 4 },
  trick: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  misses: { gap: 6, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: colors.wrong, marginTop: 4 },
  miss: { gap: 2 },
  missQ: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  missA: { color: colors.correct, fontSize: 14, lineHeight: 20 },
  errorText: { color: colors.destructive, fontSize: 14, textAlign: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  primary: { minHeight: 52, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary },
  primaryText: { color: colors.primaryForeground, fontSize: 16, fontWeight: '700' },
  secondary: { minHeight: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
