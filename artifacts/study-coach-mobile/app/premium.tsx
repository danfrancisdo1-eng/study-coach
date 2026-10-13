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
import { friendlyError } from '@/lib/friendly-error';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';
import { orderPackages, packageLabel, paywallReason } from '@/lib/premium-ui';
import { TERMS_URL, buy, premiumPackages, purchasesAvailable, restore } from '@/lib/purchases';

/**
 * The paywall (D-090, UX_PRINCIPLES "Paywall rules"): what is free and what Premium adds,
 * both prices as Apple shows them with their billing period and renewal terms, each its own
 * button (nothing pre-selected), Restore Purchases, terms and privacy, and a visible close.
 * Opened from the Account page, or with ?reason=<code> when the server stopped a request.
 */
export default function PremiumScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const refresh = useRefreshPremium();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const available = purchasesAvailable();

  useEffect(() => {
    if (!userId || !available) { setPackages([]); return; }
    premiumPackages(userId).then((list) => setPackages(orderPackages(list))).catch((problem) => { setPackages([]); setError(friendlyError(problem)); });
  }, [userId, available]);

  if (isLoaded && !isSignedIn) return <Redirect href="/" />;

  const close = () => { if (router.canGoBack()) router.back(); else router.replace('/course-list'); };
  const afterPurchase = async (done: string) => {
    const status = await refresh.mutateAsync();
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

  const row = (label: string, free: string, premium: string) => (
    <View style={styles.compareRow} key={label}>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={styles.compareFree}>{free}</Text>
      <Text style={styles.comparePremium}>{premium}</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-premium">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={styles.iconButton} testID="button-close-premium"><Feather name="x" size={24} color={colors.foreground} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
        <Text style={styles.kicker}>{paywallReason(reason)}</Text>
        <Text style={styles.title}>Study Coach Premium</Text>
        <View style={styles.compare} accessible accessibilityLabel="Free: 1 course, 3 sets and 40 coach messages a day. Premium: every course, 20 sets and 300 coach messages a day.">
          <View style={styles.compareRow}>
            <Text style={styles.compareLabel} />
            <Text style={[styles.compareFree, styles.compareHead]}>Free</Text>
            <Text style={[styles.comparePremium, styles.compareHead]}>Premium</Text>
          </View>
          {row('Courses and exams', '1', 'Unlimited')}
          {row('Question sets a day', '3', '20')}
          {row('Coach messages a day', '40', '300')}
          {row('Every feature', 'Yes', 'Yes')}
        </View>

        {!available ? (
          <Text style={styles.note} testID="text-purchases-unavailable">Purchases aren't available in this preview build. They work in the Study Coach app from TestFlight or the App Store.</Text>
        ) : packages === null ? <ActivityIndicator color={colors.primaryText} /> : packages.length === 0 && !error ? (
          <Text style={styles.note}>Premium isn't available right now. Try again later.</Text>
        ) : packages.map((pkg) => (
          <Pressable key={pkg.identifier} accessibilityRole="button" disabled={!!busy} onPress={() => void subscribe(pkg)} style={({ pressed }) => [styles.buy, pressed && styles.pressed, !!busy && styles.disabled]} testID={`button-buy-${pkg.packageType.toLowerCase()}`}>
            {busy === pkg.identifier ? <ActivityIndicator color={colors.primaryForeground} /> : <>
              <Text style={styles.buyTitle}>{packageLabel(pkg.packageType)} · {pkg.product.priceString} {pkg.packageType === 'ANNUAL' ? 'a year' : pkg.packageType === 'MONTHLY' ? 'a month' : ''}</Text>
              <Text style={styles.buyCaption}>Renews automatically. Cancel any time in Settings.</Text>
            </>}
          </Pressable>
        ))}

        {message ? <Text style={styles.success} accessibilityRole="alert" testID="status-premium-message">{message}</Text> : null}
        {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}

        <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => void restorePurchases()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} testID="button-restore-purchases">
          {busy === 'restore' ? <ActivityIndicator color={colors.foreground} /> : <Text style={styles.secondaryText}>Restore Purchases</Text>}
        </Pressable>
        <Text style={styles.terms}>Payment is charged to your Apple ID. A subscription renews automatically unless you cancel at least 24 hours before the end of the current period; manage or cancel it in Settings › Apple ID › Subscriptions.</Text>
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
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  content: { paddingHorizontal: 20, gap: 14 },
  kicker: { color: colors.mutedForeground, fontSize: 15, lineHeight: 21 },
  title: { color: colors.foreground, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  compare: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingVertical: 6 },
  compareRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 14 },
  compareHead: { fontWeight: '700', color: colors.foreground },
  compareLabel: { flex: 1.6, color: colors.foreground, fontSize: 14 },
  compareFree: { flex: 1, color: colors.mutedForeground, fontSize: 14, textAlign: 'center' },
  comparePremium: { flex: 1, color: colors.primaryText, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  buy: { minHeight: 64, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  buyTitle: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  buyCaption: { color: colors.primaryForeground, fontSize: 12, opacity: 0.85 },
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
