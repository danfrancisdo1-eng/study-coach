import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, Redirect, useRouter } from 'expo-router';
import { useAuth, useSignIn } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { BUILD } from '@/constants/build';
import { Feather } from '@expo/vector-icons';
import { SocialSignIn } from '@/components/SocialSignIn';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';
import { SIGNED_IN_BEFORE_KEY, signInTitle } from '@/lib/sign-in-copy';

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [signedInBefore, setSignedInBefore] = useState(false);
  useEffect(() => { AsyncStorage.getItem(SIGNED_IN_BEFORE_KEY).then((v) => setSignedInBefore(v === '1')).catch(() => {}); }, []);
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { isSignedIn } = useAuth();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const busy = fetchStatus === 'fetching';
  const error = message || errors.fields.identifier?.message || errors.fields.password?.message || errors.fields.code?.message || '';

  const finishSignIn = async () => {
    await signIn.finalize();
    router.replace('/');
  };

  const submit = async () => {
    setMessage('');
    const { error: requestError } = await signIn.password({ emailAddress, password });
    if (requestError) {
      setMessage(requestError.message);
      return;
    }
    if (signIn.status === 'complete') {
      await finishSignIn();
      return;
    }
    if (signIn.status === 'needs_client_trust') {
      const emailFactor = signIn.supportedSecondFactors.find((factor) => factor.strategy === 'email_code');
      if (emailFactor) {
        const { error: factorError } = await signIn.mfa.sendEmailCode();
        if (factorError) setMessage(factorError.message);
      } else {
        setMessage('This account requires a verification method that this sign-in screen does not support. Contact your administrator.');
      }
      return;
    }
    if (signIn.status === 'needs_second_factor') {
      setMessage('This account requires a second-factor method that this sign-in screen does not support. Contact your administrator.');
    }
  };

  const verify = async () => {
    setMessage('');
    const { error: verifyError } = await signIn.mfa.verifyEmailCode({ code });
    if (verifyError) {
      setMessage(verifyError.message);
      return;
    }
    if (signIn.status === 'complete') await finishSignIn();
  };

  if (isSignedIn) {
    return <Redirect href="/" />;
  }

  const needsEmailCode = signIn.status === 'needs_client_trust';
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <KeyboardAwareScrollViewCompat
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 25, paddingBottom: insets.bottom + 26 }]}
      bottomOffset={28}
      keyboardShouldPersistTaps="handled"
      testID="screen-sign-in"
    >
      <Image source={require('@/assets/images/app-icon.png')} style={styles.brandMark} accessibilityLabel="RapidRecall AI logo" />
      <Text style={[styles.eyebrow, { color: colors.primaryText }]}>RapidRecall AI</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>{signInTitle(signedInBefore)}</Text>
      {needsEmailCode ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Email verification code</Text>
          <TextInput testID="input-sign-in-code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="Enter code" placeholderTextColor={colors.mutedForeground} />
          <Pressable testID="button-sign-in-verify" accessibilityRole="button" disabled={busy || !code.trim()} onPress={() => void verify()} style={[styles.button, { backgroundColor: colors.primary }, (busy || !code.trim()) && styles.disabled]}>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{busy ? 'Verifying…' : 'Verify and sign in'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="button-resend-sign-in-code" onPress={() => void signIn.mfa.sendEmailCode()} style={styles.textButton}>
            <Text style={[styles.link, { color: colors.primaryText }]}>Send a new code</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setMessage(''); void signIn.reset(); }} style={styles.textButton}>
            <Text style={[styles.link, { color: colors.mutedForeground }]}>Start over</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>
            By continuing you confirm you're 13 or older and agree to the{' '}
            {PRIVACY_URL ? <Text style={[styles.link, styles.captionLink, { color: colors.primaryText }]} accessibilityRole="link" onPress={openPrivacy} testID="link-privacy">privacy policy</Text> : 'privacy policy'}.
          </Text>
          <SocialSignIn />
          <Text style={[styles.label, { color: colors.foreground }]}>Email address</Text>
          <TextInput testID="input-sign-in-email" value={emailAddress} onChangeText={setEmailAddress} keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="you@example.com" placeholderTextColor={colors.mutedForeground} />
          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput testID="input-sign-in-password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="Password" placeholderTextColor={colors.mutedForeground} />
          <Pressable testID="button-sign-in-submit" accessibilityRole="button" disabled={busy || !emailAddress.trim() || !password} onPress={() => void submit()} style={[styles.button, { backgroundColor: colors.primary }, (busy || !emailAddress.trim() || !password) && styles.disabled]}>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{busy ? 'Signing in…' : 'Continue'}</Text>
          </Pressable>
          <View style={styles.linkRow}>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>New to RapidRecall AI? </Text>
            <Link href="/(auth)/sign-up" testID="link-sign-up"><Text style={[styles.link, { color: colors.primaryText }]}>Create account</Text></Link>
          </View>
          <Link href="/onboarding?replay=1" style={styles.textButton} testID="link-tour"><Text style={[styles.link, { color: colors.primaryText }]}>See the tour</Text></Link>
          {__DEV__ ? <Text style={[styles.build, { color: colors.mutedForeground }]} testID="text-build">Build {BUILD}</Text> : null}
        </>
      )}
      {error ? <Text accessibilityRole="alert" testID="status-auth-error" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    </KeyboardAwareScrollViewCompat>
    {/* Nothing scrolls under the clock and battery (review finding 28, D-083). */}
    <View pointerEvents="none" style={[styles.statusBacking, { height: insets.top, backgroundColor: colors.background }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  statusBacking: { position: 'absolute', top: 0, left: 0, right: 0 },
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 25, gap: 12 },
  brandMark: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 17, marginBottom: 8 },
  eyebrow: { fontSize: 14, fontWeight: '600' },
  title: { fontSize: 36, lineHeight: 42, letterSpacing: -1.4, fontWeight: '700', marginTop: 1 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 6 },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  button: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginTop: 7 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.48 },
  textButton: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 13, flexWrap: 'wrap' },
  body: { fontSize: 14 },
  link: { fontSize: 14, fontWeight: '700' },
  build: { fontSize: 11, textAlign: 'center', marginTop: 8, opacity: 0.8 },
  caption: { fontSize: 12, lineHeight: 18 },
  captionLink: { fontSize: 12 },
  error: { fontSize: 13, lineHeight: 19, marginTop: 7 },
});
