import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useCreateReviewSheet, type ReviewSheet } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { friendlyError } from '@/lib/friendly-error';
import { premiumCode } from '@/lib/premium-ui';
import { reviewHtml } from '@/lib/review-html';
import { goBack } from '@/lib/nav';
import { ProgressBar, useElapsed } from '@/components/ProgressBar';
import { estimate } from '@/lib/progress';

/**
 * The review sheet (D-101, spec C): the course's key points, memory tricks and the student's
 * own misses by section, shown here first, then shared or saved as a PDF through the iPhone
 * share sheet (Files, Mail, AirDrop, Print). Written once per visit; counts as one set.
 */
/** D-142: the PDF is shared under the sheet's title, not a random id; the random name if the copy fails. */
async function named(uri: string, title: string): Promise<string> {
  try {
    const name = `${title.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().slice(0, 80) || 'Review sheet'}.pdf`;
    const target = new File(Paths.cache, name);
    if (target.exists) target.delete();
    await new File(uri).copy(target);
    return target.uri;
  } catch { return uri; }
}

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
  const elapsed = useElapsed(create.isPending && !sheet);

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

  // The PDF in iPhone's preview: the real pages, scroll and pinch to zoom (D-142). Opens by itself once written.
  const [opening, setOpening] = useState(false);
  const openPdf = async (next: ReviewSheet | null = sheet) => {
    if (!next || opening) return;
    setOpening(true); setError('');
    try { await Print.printAsync({ html: reviewHtml(next) }); }
    catch (problem) { setError(friendlyError(problem)); }
    finally { setOpening(false); }
  };
  useEffect(() => { if (sheet) void openPdf(sheet); }, [sheet]);

  const share = async () => {
    if (!sheet || sharing) return;
    setSharing(true); setError('');
    try {
      const { uri } = await Print.printToFileAsync({ html: reviewHtml(sheet) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(await named(uri, sheet.title), { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: sheet.title });
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
            {/* D-142 (Dan): a fill bar while it is written (about a minute and a half). */}
            <ProgressBar fraction={estimate(elapsed, 90_000)} label="Writing your review sheet from your material and your results…" testID="progress-review-sheet" />
          </View>
        ) : null}
        {error ? (
          <View style={styles.waiting}>
            <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
            {!sheet ? <Pressable accessibilityRole="button" onPress={() => void build()} style={styles.secondary} testID="button-retry-review"><Text style={styles.secondaryText}>Try again</Text></Pressable> : null}
          </View>
        ) : null}
        {/* D-142 (Dan: "open the actual pdf"): the sheet is shown as the PDF itself, in iPhone's preview
            (scroll, pinch to zoom), not redrawn here (the redrawn "Remember it" box was unreadable). */}
        {sheet ? <>
          <Text style={styles.sheetTitle} accessibilityRole="header">{sheet.title}</Text>
          <Text style={styles.muted}>Built from {sheet.basedOn.materials ? 'your material' : 'general knowledge (no material yet)'}{sheet.basedOn.misses ? `, ${sheet.basedOn.misses} of your misses` : ''}{sheet.basedOn.memoryRows ? ` and your memory sheet` : ''}.</Text>
          <Pressable accessibilityRole="button" disabled={opening} onPress={() => void openPdf()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed, opening && styles.disabled]} testID="button-open-pdf">
            <Text style={styles.secondaryText}>{opening ? 'Opening…' : 'Open the PDF'}</Text>
          </Pressable>
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
  bodyBold: { color: colors.foreground, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  weight: { color: colors.correct, fontSize: 14, fontWeight: '700' },
  factsBox: { gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  factRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  factLabel: { width: 110, color: colors.mutedForeground, fontSize: 14, fontWeight: '600' },
  sub: { gap: 4, marginTop: 4 },
  subTitle: { color: colors.foreground, fontSize: 15, fontWeight: '700', marginTop: 4 },
  decoder: { gap: 6, padding: 12, borderRadius: 12, backgroundColor: colors.foreground, marginTop: 10 },
  decoderKicker: { color: colors.background, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.8 },
  decoderText: { color: colors.background, fontSize: 14, lineHeight: 22, fontWeight: '600' },
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
