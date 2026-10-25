import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import type { PurchasesPackage } from 'react-native-purchases';
import { getGetPremiumStatusQueryKey, useRefreshPremium } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { AuroraBackground } from '@/components/AuroraBackground';
import { ScreenHeader } from '@/components/ScreenHeader';
import { friendlyError } from '@/lib/friendly-error';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';
import { orderPackages, trialBadge, packageLabel, paywallMode, paywallReason, paywallRows, paywallSegments, paywallState, savingLabel, trialLength, trialTerms } from '@/lib/premium-ui';
import { PressScale } from '@/components/PressScale';
import { TERMS_URL, buy, premiumPackages, purchasesAvailable, restore } from '@/lib/purchases';
import { FOUNDER_QUOTE } from '@/lib/founder';

/**
 * The paywall (D-090, D-153, SPEC §9, UX_PRINCIPLES "Paywall rules"). Two products on one screen,
 * chosen with a segment under the title (D-180, Dan: "confusing, not organized right"): Premium
 * (what is free and what it adds, the yearly and monthly cards with the real saving as the badge,
 * one button, "Start your free week" while Apple's free week applies, what happens after) and the
 * Exam Pass (one payment for 60 days, no renewal). The segment the screen opens on follows how it
 * was opened (?kind=exam or the exam-free-used refusal → Exam Pass). Then Restore Purchases, terms
 * and privacy, a visible close. Opened from Account, or with ?reason=<code>.
 */
export default function PremiumScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { reason, kind, courseId } = useLocalSearchParams<{ reason?: string; kind?: string; courseId?: string }>();
  const [mode, setMode] = useState<'student' | 'exam'>(() => paywallMode(reason, kind));
  const [selected, setSelected] = useState<string | null>(null);
  const refresh = useRefreshPremium();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0); // D-170: "Try again" reloads the prices instead of leaving a dead end
  const available = purchasesAvailable();
  const state = paywallState(available, packages, error);

  useEffect(() => {
    if (!userId || !available) { setPackages([]); return; }
    setPackages(null); setError('');
    premiumPackages(userId, mode).then((list) => { const ordered = orderPackages(list); setPackages(ordered); setSelected(ordered[0]?.identifier ?? null); }).catch(() => { setPackages([]); setError("Prices couldn't load. Check your connection and try again."); });
  }, [userId, available, mode, attempt]);

  if (isLoaded && !isSignedIn) return <Redirect href="/" />;

  const close = () => { if (router.canGoBack()) router.back(); else router.replace('/course-list'); };
  const afterPurchase = async (done: string) => {
    // D-156: a pass bought here unlocks this exam; the server binds it to the course named.
    const status = await refresh.mutateAsync({ data: mode === 'exam' && courseId ? { courseId } : {} });
    queryClient.setQueryData(getGetPremiumStatusQueryKey(), status);
    setMessage(status.plan === 'premium' ? done : 'Your purchase is being confirmed. It can take a minute; try Restore Purchases if it does not show.');
  };
  const subscribe = async (pkg: PurchasesPackage) => {
    if (!userId || busy) return;
    setBusy(pkg.identifier); setError(''); setMessage('');
    try {
      if (await buy(userId, pkg) === 'purchased') await afterPurchase("You're Premium. Every course is yours to study.");
    } catch (problem) { setError(friendlyError(problem)); } finally { setBusy(null); }
  };
  const restorePurchases = async () => {
    if (!userId || busy) return;
    setBusy('restore'); setError(''); setMessage('');
    try {
      await restore(userId);
      await afterPurchase('Purchases restored. You have Premium.');
    } catch (problem) { setError(friendlyError(problem)); } finally { setBusy(null); }
  };

  const table = paywallRows(mode);
  const cell = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.75 } as const;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-premium">
      <AuroraBackground />
      <ScreenHeader leading="close" onLeading={close} leadingTestID="button-close-premium" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
        <Text style={styles.kicker}>{paywallReason(reason)}</Text>
        <Text style={styles.title}>Choose your plan</Text>
        {/* D-180: the two products side by side; the table, the cards and the button below follow the choice. */}
        <View style={styles.segment} accessibilityRole="tablist" testID="paywall-segment">
          {paywallSegments().map((seg) => {
            const on = seg.mode === mode;
            return (
              <PressScale key={seg.mode} haptic={false} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { if (!on) { setMode(seg.mode); setMessage(''); setError(''); } }} style={[styles.segmentItem, on && styles.segmentOn]} testID={`segment-${seg.mode}`}>
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{seg.label}</Text>
              </PressScale>
            );
          })}
        </View>
        <Text style={styles.segmentBlurb} testID="text-segment-blurb">{paywallSegments().find((s) => s.mode === mode)!.blurb}</Text>
        <View style={styles.compare} accessible accessibilityLabel={table.rows.map(([label, free, paid]) => `${label}: ${table.head[0]} ${free}, ${table.head[1]} ${paid}`).join('. ')} testID="paywall-table">
          <View style={[styles.compareRow, styles.compareDivider]}>
            <Text style={styles.compareLabel} />
            <Text {...cell} style={[styles.compareFree, styles.compareHead]}>{table.head[0]}</Text>
            <Text {...cell} style={[styles.comparePremium, styles.compareHead]}>{table.head[1]}</Text>
          </View>
          {table.rows.map(([label, free, paid], i) => (
            <View style={[styles.compareRow, i < table.rows.length - 1 && styles.compareDivider]} key={label}>
              <Text {...cell} style={styles.compareLabel}>{label}</Text>
              <Text {...cell} style={styles.compareFree}>{free}</Text>
              <Text {...cell} style={styles.comparePremium}>{paid}</Text>
            </View>
          ))}
        </View>

        {state === 'unavailable' ? (
          <Text style={styles.note} testID="text-purchases-unavailable">Purchases aren't available right now. Try again in a moment.</Text>
        ) : state === 'loading' || !packages ? <ActivityIndicator color={colors.primaryText} /> : state === 'empty' ? (
          <Text style={styles.note}>{mode === 'exam' ? "The exam pass isn't available right now. Try again later." : "Premium isn't available right now. Try again later."}</Text>
        ) : state === 'error' ? null : mode === 'exam' ? (() => {
          const pass = packages[0]!;
          return <>
            <View style={[styles.card, styles.cardOn]} testID="card-exam-pass">
              <Text style={styles.cardTitle}>Exam pass · {pass.product.priceString}</Text>
              <Text style={styles.cardCaption}>60 days of everything for your exam. One payment; it does not renew.</Text>
            </View>
            <PressScale gradient accessibilityRole="button" disabled={!!busy} onPress={() => void subscribe(pass)} style={[styles.buy, !!busy && styles.disabled]} testID="button-buy-exam-pass">
              {busy === pass.identifier ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={styles.buyTitle}>Get the exam pass</Text>}
            </PressScale>
          </>;
        })() : (() => {
          const monthly = packages.find((p) => p.packageType === 'MONTHLY');
          const yearly = packages.find((p) => p.packageType === 'ANNUAL');
          const badge = monthly && yearly ? savingLabel(monthly.product.price, yearly.product.price) : null;
          const chosen = packages.find((p) => p.identifier === selected) ?? packages[0]!;
          const trial = trialLength(chosen.product.introPrice);
          const freeWeek = trial !== null;
          return <>
            {packages.map((pkg) => {
              const on = pkg.identifier === chosen.identifier;
              const period = pkg.packageType === 'ANNUAL' ? 'year' : 'month';
              const free = trialBadge(trialLength(pkg.product.introPrice));
              return (
                <Pressable key={pkg.identifier} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setSelected(pkg.identifier)} style={[styles.card, on && styles.cardOn]} testID={`card-${pkg.packageType.toLowerCase()}`}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>{packageLabel(pkg.packageType)} · {pkg.product.priceString} a {period}</Text>
                    {pkg.packageType === 'ANNUAL' && badge ? <Text style={styles.badge}>{badge}</Text> : null}
                  </View>
                  {/* D-197: the free week shows on the card itself, so it is clear how to get it. */}
                  {free ? <Text style={styles.cardFree} testID={`text-free-${pkg.packageType.toLowerCase()}`}>{free}</Text> : null}
                  {on ? <Feather name="check-circle" size={20} color={colors.primaryText} style={styles.cardCheck} /> : null}
                </Pressable>
              );
            })}
            <PressScale gradient accessibilityRole="button" disabled={!!busy} onPress={() => void subscribe(chosen)} style={[styles.buy, !!busy && styles.disabled]} testID="button-buy">
              {busy === chosen.identifier ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={styles.buyTitle}>{freeWeek ? 'Start your free week' : 'Subscribe'}</Text>}
            </PressScale>
            <Text style={styles.trial} testID="text-trial-terms">{trialTerms(chosen.product.priceString, chosen.packageType === 'ANNUAL' ? 'year' : 'month', trial)}</Text>
          </>;
        })()}

        {message ? <Text style={styles.success} accessibilityRole="alert" testID="status-premium-message">{message}</Text> : null}
        {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
        {state === 'error' ? (
          <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => setAttempt((n) => n + 1)} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} testID="button-retry-prices">
            <Text style={styles.secondaryText}>Try again</Text>
          </Pressable>
        ) : null}

        {/* D-182: why this exists, in one line; the full story is a tap away. */}
        <Pressable accessibilityRole="link" accessibilityHint="Opens the founder's story" onPress={() => router.push('/about')} style={styles.founder} testID="link-founder">
          <Text style={styles.founderQuote}>“{FOUNDER_QUOTE}”</Text>
          <Text style={styles.founderName}>Dan Francis, founder · Read the story ›</Text>
        </Pressable>

        <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => void restorePurchases()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} testID="button-restore-purchases">
          {busy === 'restore' ? <ActivityIndicator color={colors.foreground} /> : <Text style={styles.secondaryText}>Restore Purchases</Text>}
        </Pressable>
        <Text style={styles.terms}>{mode === 'exam'
          ? 'Payment is charged to your Apple ID. The exam pass is a one-time purchase for 60 days and does not renew.'
          : 'Payment is charged to your Apple ID. A subscription renews automatically unless you cancel at least 24 hours before the end of the current period; manage or cancel it in Settings › Apple ID › Subscriptions.'}</Text>
        <View style={styles.links}>
          <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>Terms of Use</Text>
          {PRIVACY_URL ? <Text style={styles.link} accessibilityRole="link" onPress={openPrivacy}>Privacy Policy</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, gap: 14 },
  kicker: { color: colors.mutedForeground, fontSize: 15, lineHeight: 21 },
  title: { color: colors.foreground, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 14, backgroundColor: colors.secondary, gap: 3 },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  segmentOn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primaryText },
  segmentText: { color: colors.mutedForeground, fontSize: 15, fontWeight: '600' },
  segmentTextOn: { color: colors.primaryText },
  segmentBlurb: { color: colors.foreground, fontSize: 14, lineHeight: 20, marginTop: -6 },
  compare: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  compareRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 14, gap: 8 },
  compareDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  compareHead: { fontWeight: '700', color: colors.foreground },
  compareLabel: { flex: 1.5, color: colors.foreground, fontSize: 14 },
  compareFree: { flex: 1, color: colors.mutedForeground, fontSize: 14, textAlign: 'center' },
  comparePremium: { flex: 1, color: colors.primaryText, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  buy: { minHeight: 64, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  buyTitle: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  buyCaption: { color: colors.primaryForeground, fontSize: 12, opacity: 0.85 },
  card: { minHeight: 60, justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 12 },
  cardOn: { borderWidth: 2, borderColor: colors.primaryText },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 28, flexWrap: 'wrap' },
  cardTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
  cardFree: { color: colors.primaryText, fontSize: 14, lineHeight: 20, marginTop: 4, fontWeight: '600' },
  cardCaption: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20, marginTop: 4 },
  cardCheck: { position: 'absolute', right: 14, top: 18 },
  badge: { color: colors.primaryForeground, backgroundColor: colors.primary, fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  trial: { color: colors.foreground, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  founder: { gap: 4, paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  founderQuote: { color: colors.foreground, fontSize: 15, lineHeight: 21, fontStyle: 'italic' },
  founderName: { color: colors.primaryText, fontSize: 13, fontWeight: '600' },
  secondary: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  note: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  success: { color: colors.correct, fontSize: 15, fontWeight: '600' },
  errorText: { color: colors.destructive, fontSize: 13 },
  terms: { color: colors.mutedForeground, fontSize: 11.5, lineHeight: 16 },
  links: { flexDirection: 'row', gap: 20, justifyContent: 'center' },
  link: { color: colors.primaryText, fontSize: 13, fontWeight: '600', paddingVertical: 12 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
