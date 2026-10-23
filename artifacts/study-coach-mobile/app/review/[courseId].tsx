import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { WebView } from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import { useCreateReviewSheet, type ReviewSheet } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { AuroraBackground } from '@/components/AuroraBackground';
import { ScreenHeader } from '@/components/ScreenHeader';
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
      if (code) router.push({ pathname: '/premium', params: { reason: code, courseId: courseId! } });
    }
  };
  useEffect(() => { if (isSignedIn && courseId) void build(); }, [isSignedIn, courseId]);

  // D-149 (Dan: "review the actual pdf before they decide to print or download it"): once written, the
  // sheet is made into the PDF and shown right here (scroll, pinch to zoom); Print and Share sit below it.
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!sheet) return;
    let live = true;
    void (async () => {
      try {
        const { uri } = await Print.printToFileAsync({ html: reviewHtml(sheet) });
        const file = await named(uri, sheet.title);
        if (live) setPdfUri(file);
      } catch (problem) { if (live) setError(friendlyError(problem)); }
    })();
    return () => { live = false; };
  }, [sheet]);

  if (isLoaded && !isSignedIn) return <Redirect href="/" />;

  const print = async () => {
    if (!pdfUri || printing) return;
    setPrinting(true); setError('');
    try { await Print.printAsync({ uri: pdfUri }); }
    // Closing the print screen without printing is not an error (D-148).
    catch (problem) { if (!/did not complete|cancel/i.test(String((problem as Error)?.message ?? problem))) setError(friendlyError(problem)); }
    finally { setPrinting(false); }
  };

  const share = async () => {
    if (!pdfUri || sharing) return;
    setSharing(true); setError('');
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: sheet?.title ?? 'Review sheet' });
      else setError('Sharing is not available on this device.');
    } catch (problem) {
      setError(friendlyError(problem));
    } finally { setSharing(false); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-review-sheet">
      <AuroraBackground />
      <ScreenHeader leading="back" onLeading={() => goBack()} title="Review sheet" />
      {pdfUri ? (
        <WebView source={{ uri: pdfUri }} originWhitelist={['*']} allowingReadAccessToURL={pdfUri.slice(0, pdfUri.lastIndexOf('/') + 1)} style={[styles.pdf, { marginBottom: insets.bottom + 76 }]} testID="view-review-pdf" />
      ) : (
        <View style={styles.content}>
          {!sheet && !error ? (
            <View style={styles.waiting} testID="status-review-writing">
              {/* D-142 (Dan): a fill bar while it is written (about a minute and a half). */}
              <ProgressBar fraction={estimate(elapsed, 90_000)} label="Writing your review sheet from your material and your results…" testID="progress-review-sheet" />
            </View>
          ) : null}
          {sheet && !error ? <View style={styles.waiting}><ActivityIndicator color={colors.primaryText} /></View> : null}
        </View>
      )}
      {error ? (
        <View style={[styles.content, styles.waiting]}>
          <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
          {!sheet ? <Pressable accessibilityRole="button" onPress={() => void build()} style={styles.secondary} testID="button-retry-review"><Text style={styles.secondaryText}>Try again</Text></Pressable> : null}
        </View>
      ) : null}
      {pdfUri ? (
        <View style={[styles.footer, styles.footerRow, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable accessibilityRole="button" disabled={printing} onPress={() => void print()} style={({ pressed }) => [styles.secondary, styles.footerButton, pressed && styles.pressed, printing && styles.disabled]} testID="button-print-pdf">
            <Feather name="printer" size={18} color={colors.foreground} /><Text style={styles.secondaryText}>Print</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={sharing} onPress={() => void share()} style={({ pressed }) => [styles.primary, styles.footerButton, pressed && styles.pressed, sharing && styles.disabled]} testID="button-share-pdf">
            {sharing ? <ActivityIndicator color={colors.primaryForeground} /> : <><Feather name="share" size={18} color={colors.primaryForeground} /><Text style={styles.primaryText}>Save or share</Text></>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18, gap: 10 },
  waiting: { gap: 12, paddingVertical: 30, alignItems: 'center' },
  errorText: { color: colors.destructive, fontSize: 14, textAlign: 'center' },
  pdf: { flex: 1, backgroundColor: colors.background },
  footerRow: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1, flexDirection: 'row', gap: 8, minHeight: 52 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  primary: { minHeight: 52, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary },
  primaryText: { color: colors.primaryForeground, fontSize: 16, fontWeight: '700' },
  secondary: { minHeight: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
