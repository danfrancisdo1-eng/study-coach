import React, { useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth, useClerk } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { getGetPremiumStatusQueryKey, getGetStudyStateQueryKey, useDeleteAccount, useGetPremiumStatus, useGetStudyState, usePutStudyState, useRefreshPremium } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAnswerSounds } from '@/hooks/useAnswerSounds';
import { AuroraBackground } from '@/components/AuroraBackground';
import { HeaderIconButton, ScreenHeader } from '@/components/ScreenHeader';
import { friendlyError } from '@/lib/friendly-error';
import { SIGNED_OUT_ROUTE, signOutInOrder } from '@/lib/sign-out';
import { BUILD } from '@/constants/build';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';
import { welcomeReplayKey } from '@/lib/welcome';
import { planLine } from '@/lib/premium-ui';
import { MANAGE_SUBSCRIPTIONS_URL, purchasesAvailable, restore } from '@/lib/purchases';

/**
 * The Account page (D-080, Dan: "we need a link to account page"): privacy, the welcome and
 * the tour again, sign out, and account deletion (D-046) set apart at the bottom. The Account
 * tab (D-164); the course list's own Sign out and Account rows (D-079, D-080) moved here.
 */
export default function AccountScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const deleteAccount = useDeleteAccount();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false); // D-171: the header's hairline once the page moves under it
  const answerSounds = useAnswerSounds(); // D-172
  // D-189 (Dan: "let them choose"): questions per set, 10 or 20, saved on the account so the coach and every device use it.
  const stateKey = [...getGetStudyStateQueryKey(), userId];
  const stateQuery = useGetStudyState({ query: { queryKey: stateKey, enabled: !!userId } });
  const putState = usePutStudyState();
  const setSize = (stateQuery.data?.state as { setSize?: unknown } | undefined)?.setSize === 20 ? 20 : 10;
  const chooseSetSize = async (size: 10 | 20) => {
    const current = stateQuery.data;
    if (!current || size === setSize || putState.isPending) return;
    try {
      const base = (current.state && typeof current.state === 'object' ? current.state : {}) as Record<string, unknown>;
      const result = await putState.mutateAsync({ data: { state: { ...base, aiConsent: base.aiConsent === true, setSize: size }, version: current.version } });
      queryClient.setQueryData(stateKey, result);
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) await queryClient.invalidateQueries({ queryKey: stateKey });
      setPlanNote(friendlyError(problem));
    }
  };
  const [deleteWord, setDeleteWord] = useState('');
  const [error, setError] = useState('');
  // Premium (D-090): the plan line, Restore Purchases and Manage subscription.
  const premiumQuery = useGetPremiumStatus({ query: { queryKey: getGetPremiumStatusQueryKey(), enabled: !!isSignedIn } });
  const refresh = useRefreshPremium();
  const [restoring, setRestoring] = useState(false);
  const [planNote, setPlanNote] = useState('');
  const status = premiumQuery.data;
  const restorePurchases = async () => {
    if (!userId || restoring) return;
    setRestoring(true); setPlanNote('');
    try {
      await restore(userId);
      const next = await refresh.mutateAsync({ data: {} });
      queryClient.setQueryData(getGetPremiumStatusQueryKey(), next);
      setPlanNote(next.plan === 'premium' ? 'Purchases restored. You have Premium.' : 'No Premium purchase was found for this Apple ID.');
    } catch (problem) { setPlanNote(friendlyError(problem)); } finally { setRestoring(false); }
  };

  if (isLoaded && !isSignedIn) return <Redirect href="/" />;

  // D-180: leave the tabs first, then drop the session (see lib/sign-out.ts). A failed sign-out says so and stays signed in.
  const leaveAndSignOut = async () => {
    const result = await signOutInOrder(() => router.replace(SIGNED_OUT_ROUTE), () => signOut());
    if (result === 'failed') { router.replace('/account'); Alert.alert("Couldn't sign out", 'Check your connection and try again.'); }
  };

  // Account deletion (D-046): everything on the server and the sign-in identity, after typing DELETE.
  const removeAccount = async () => {
    if (deleteWord.trim() !== 'DELETE' || deleteAccount.isPending) return;
    setError('');
    try {
      const result = await deleteAccount.mutateAsync();
      setDeleteOpen(false);
      if (userId) AsyncStorage.removeItem(`study-coach-focus:${userId}`).catch(() => {});
      queryClient.clear();
      if (!result.identityDeleted) Alert.alert('Your data is deleted', 'Your sign-in could not be removed automatically. Contact support and it will be finished by hand.');
      await leaveAndSignOut();
    } catch (problem) {
      setError(friendlyError(problem));
    }
  };

  const row = (icon: React.ComponentProps<typeof Feather>['name'], label: string, caption: string, onPress: () => void, testID: string, danger = false) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={testID}>
      <Feather name={icon} size={18} color={danger ? colors.destructive : colors.mutedForeground} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowName, danger && { color: colors.destructive }]}>{label}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
      {danger ? null : <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
    </Pressable>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-account">
      <AuroraBackground />
      {/* A tab (D-164): no back; the tab bar is the way between the three pages. */}
      <ScreenHeader title="Account" divider={scrolled} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 30 }]} onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 4)} scrollEventThrottle={32}>
        <View style={styles.planCard} testID="panel-plan">
          <Text style={styles.rowName}>{planLine(status)}</Text>
          {status?.plan !== 'premium' ? <Pressable accessibilityRole="button" onPress={() => router.push('/premium')} style={({ pressed }) => [styles.planButton, pressed && styles.pressed]} testID="button-see-premium"><Text style={styles.planButtonText}>See Premium</Text></Pressable> : null}
          <View style={styles.planLinks}>
            <Text style={styles.planLink} accessibilityRole="button" onPress={() => void restorePurchases()} testID="button-restore-purchases">{restoring ? 'Restoring…' : 'Restore Purchases'}</Text>
            {status?.plan === 'premium' && status.source === 'revenuecat' ? <Text style={styles.planLink} accessibilityRole="link" onPress={() => void Linking.openURL(MANAGE_SUBSCRIPTIONS_URL)} testID="link-manage-subscription">Manage subscription</Text> : null}
          </View>
          {!purchasesAvailable() ? <Text style={styles.caption}>Purchases aren't available right now.</Text> : null}
          {planNote ? <Text style={styles.caption} accessibilityRole="alert">{planNote}</Text> : null}
        </View>
        {/* D-184 (Dan): the story first, since it is nowhere else in the app; then the replays, privacy, sounds, sign out, delete. */}
        {/* D-182: the founder story. */}
        {row('award', 'Why I built this', 'Two AI certifications, self-taught, this method', () => router.push('/about'), 'button-about')}
        {/* D-150: Dan's intro video again; it comes back here. */}
        {row('film', 'Watch the intro', 'The short video from the first launch', () => router.push('/intro?replay=1'), 'button-replay-intro')}
        {/* The first-launch tour (D-049) plays once per phone; this replays it and comes back here. */}
        {row('play-circle', 'See the tour again', 'The five pages from the first launch', () => router.push('/onboarding?replay=1'), 'button-replay-tour')}
        {row('compass', 'See the welcome again', 'The three steps: course, material, coach', () => {
          if (!userId) return;
          AsyncStorage.setItem(welcomeReplayKey(userId), '1').catch(() => {}).finally(() => router.navigate('/(tabs)'));
        }, 'button-replay-welcome')}
        {PRIVACY_URL ? row('shield', 'Privacy policy', 'What is collected, where it goes, how to delete it', openPrivacy, 'link-privacy') : null}
        {/* D-172: the chime and buzz after an answer. Haptics stay on either way; the phone's silent switch wins over this. */}
        <View style={styles.row} accessible accessibilityRole="switch" accessibilityLabel="Answer sounds" accessibilityHint="A short chime for a right answer and a buzz for a wrong one" accessibilityState={{ checked: answerSounds.enabled }} testID="row-answer-sounds">
          <Feather name="volume-2" size={18} color={colors.mutedForeground} />
          <View style={styles.rowCopy}>
            <Text style={styles.rowName}>Answer sounds</Text>
            <Text style={styles.caption}>A chime when you're right, a buzz when you're not. Silent mode wins.</Text>
          </View>
          <Switch value={answerSounds.enabled} onValueChange={answerSounds.setEnabled} trackColor={{ true: colors.primary }} testID="switch-answer-sounds" />
        </View>
        <View style={styles.row} testID="row-set-size">
          <Feather name="list" size={18} color={colors.mutedForeground} />
          <View style={styles.rowCopy}>
            <Text style={styles.rowName}>Questions per set</Text>
            <Text style={styles.caption}>Quick sets of 10, or 20 at a time.</Text>
          </View>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Questions per set">
            {([10, 20] as const).map((size) => (
              <Pressable key={size} accessibilityRole="radio" accessibilityState={{ selected: setSize === size }} accessibilityLabel={`${size} questions`} disabled={putState.isPending || !stateQuery.data}
                onPress={() => void chooseSetSize(size)} style={[styles.segmentItem, setSize === size && styles.segmentOn]} testID={`button-set-size-${size}`}>
                <Text style={[styles.segmentText, setSize === size && styles.segmentTextOn]}>{size}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {row('log-out', 'Sign out', 'Back to the sign-in page', () => void leaveAndSignOut(), 'button-sign-out')}
        <View style={styles.divider} />
        {row('trash-2', 'Delete my account', 'Removes your courses, sets, chats and sign-in. Cannot be undone.', () => { setError(''); setDeleteWord(''); setDeleteOpen(true); }, 'button-delete-account', true)}
        {/* The account's id (D-095): Dan pastes it into OWNER_ACCOUNT_IDS on Render; press and hold to copy. Not a secret. */}
        {userId ? <Text selectable maxFontSizeMultiplier={1} style={styles.build} testID="text-account-id">Account ID: {userId}</Text> : null}
        {__DEV__ ? <Text maxFontSizeMultiplier={1} style={styles.build}>Build {BUILD}</Text> : null}
      </ScrollView>

      <Modal visible={deleteOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDeleteOpen(false)}>
        <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: 20 }]}>
          <ScreenHeader title="Delete my account" right={<HeaderIconButton icon="x" label="Close" onPress={() => setDeleteOpen(false)} testID="button-close-delete" />} />
          <View style={styles.sheetContent}>
            <Text style={styles.empty}>This deletes your courses and exams, uploaded materials, practice sets, flashcards, memory sheet, conversations and lecture transcripts from our servers, and your sign-in. Lecture recordings stay on this phone until you delete the app. This cannot be undone.</Text>
            <Text style={styles.caption}>Type DELETE to confirm</Text>
            <TextInput value={deleteWord} onChangeText={setDeleteWord} autoCapitalize="characters" autoCorrect={false} placeholder="DELETE" placeholderTextColor={colors.mutedForeground} style={styles.input} accessibilityLabel="Type DELETE to confirm" testID="input-delete-word" autoFocus />
            {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={deleteWord.trim() !== 'DELETE' || deleteAccount.isPending} onPress={() => void removeAccount()} style={[styles.primaryButton, { backgroundColor: colors.destructive }, (deleteWord.trim() !== 'DELETE' || deleteAccount.isPending) && styles.disabled]} testID="button-confirm-delete">
              <Text style={[styles.primaryButtonText, { color: '#ffffff' }]}>{deleteAccount.isPending ? 'Deleting…' : 'Delete everything'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  caption: { color: colors.mutedForeground, fontSize: 12 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 12 },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  segment: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segmentItem: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: colors.card },
  segmentOn: { backgroundColor: colors.primary },
  segmentText: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  segmentTextOn: { color: colors.primaryForeground },
  planCard: { gap: 10, padding: 14, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  planButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primary },
  planButtonText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '700' },
  // D-184: the two links wrap to a second line inside the box instead of running past its edge.
  planLinks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20 },
  planLink: { color: colors.primaryText, fontSize: 14, fontWeight: '600', paddingVertical: 10 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  build: { color: colors.mutedForeground, fontSize: 11, marginTop: 18, textAlign: 'center' },
  empty: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  errorText: { color: colors.destructive, fontSize: 13 },
  sheetContent: { paddingHorizontal: 18, paddingTop: 10, gap: 15 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
