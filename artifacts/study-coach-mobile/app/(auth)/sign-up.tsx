import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, Redirect, useRouter } from 'expo-router';
import { useAuth, useSignUp } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { SocialSignIn } from '@/components/SocialSignIn';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [ageOk, setAgeOk] = useState(false); // App Store readiness (D-046): 13+ attestation before any account is created
  const busy = fetchStatus === 'fetching';
  const error = message || errors.fields.emailAddress?.message || errors.fields.password?.message || errors.fields.code?.message || '';
  const verifying = signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields.includes('email_address') &&
    signUp.missingFields.length === 0;

  const finishSignUp = async () => {
    await signUp.finalize();
    router.replace('/');
  };

  const submit = async () => {
    setMessage('');
    const { error: requestError } = await signUp.password({ emailAddress, password });
    if (requestError) {
      setMessage(requestError.message);
      return;
    }
    const { error: codeError } = await signUp.verifications.sendEmailCode();
    if (codeError) setMessage(codeError.message);
  };

  const verify = async () => {
    setMessage('');
    const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code });
    if (verifyError) {
      setMessage(verifyError.message);
      return;
    }
    if (signUp.status === 'complete') await finishSignUp();
    else setMessage('The verification is not complete yet. Check the code and try again.');
  };

  if (isSignedIn) {
    return <Redirect href="/" />;
  }

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 25, paddingBottom: insets.bottom + 26 }]}
      bottomOffset={28}
      keyboardShouldPersistTaps="handled"
      testID="screen-sign-up"
    >
      <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="book-open" size={23} color={colors.primaryForeground} /></View>
      <Text style={[styles.eyebrow, { color: colors.primaryText }]}>Study Coach</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>{verifying ? 'Check your email.' : 'Make room to learn.'}</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{verifying ? `We sent a verification code to ${emailAddress}.` : 'Create an account to keep courses and study sessions in sync.'}</Text>
      {verifying ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Email verification code</Text>
          <TextInput testID="input-sign-up-code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="Enter code" placeholderTextColor={colors.mutedForeground} />
          <Pressable testID="button-sign-up-verify" accessibilityRole="button" disabled={busy || !code.trim()} onPress={() => void verify()} style={[styles.button, { backgroundColor: colors.primary }, (busy || !code.trim()) && styles.disabled]}>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{busy ? 'Verifying…' : 'Verify and create account'}</Text>
          </Pressable>
          <Pressable testID="button-resend-sign-up-code" onPress={() => void signUp.verifications.sendEmailCode()} style={styles.textButton}>
            <Text style={[styles.link, { color: colors.primaryText }]}>Send a new code</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ageOk }} accessibilityLabel="I am 13 or older" onPress={() => setAgeOk((v) => !v)} style={styles.checkRow} testID="checkbox-age">
            <Feather name={ageOk ? 'check-square' : 'square'} size={22} color={ageOk ? colors.primaryText : colors.mutedForeground} />
            <Text style={[styles.checkText, { color: colors.foreground }]}>I'm 13 or older.</Text>
          </Pressable>
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>
            Study Coach is for people 13 and older. By creating an account you agree to the{' '}
            {PRIVACY_URL ? <Text style={[styles.link, styles.captionLink, { color: colors.primaryText }]} accessibilityRole="link" onPress={openPrivacy} testID="link-privacy">privacy policy</Text> : 'privacy policy'}.
          </Text>
          <SocialSignIn disabled={!ageOk} />
          <Text style={[styles.label, { color: colors.foreground }]}>Email address</Text>
          <TextInput testID="input-sign-up-email" value={emailAddress} onChangeText={setEmailAddress} keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="you@example.com" placeholderTextColor={colors.mutedForeground} />
          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput testID="input-sign-up-password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="Create a password" placeholderTextColor={colors.mutedForeground} />
          <Pressable testID="button-sign-up-submit" accessibilityRole="button" disabled={busy || !ageOk || !emailAddress.trim() || password.length < 8} onPress={() => void submit()} style={[styles.button, { backgroundColor: colors.primary }, (busy || !ageOk || !emailAddress.trim() || password.length < 8) && styles.disabled]}>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{busy ? 'Creating account…' : 'Create account'}</Text>
          </Pressable>
          <Text style={[styles.caption, { color: colors.mutedForeground }]}>Use at least 8 characters. Email verification is required.</Text>
          <View style={styles.linkRow}>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>Already have an account? </Text>
            <Link href="/(auth)/sign-in" testID="link-sign-in"><Text style={[styles.link, { color: colors.primaryText }]}>Sign in</Text></Link>
          </View>
        </>
      )}
      <View nativeID="clerk-captcha" />
      {error ? <Text accessibilityRole="alert" testID="status-auth-error" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 25, gap: 12 },
  brandMark: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 17, marginBottom: 8 },
  eyebrow: { fontSize: 14, fontWeight: '600' },
  title: { fontSize: 34, lineHeight: 41, letterSpacing: -1.3, fontWeight: '700', marginTop: 1 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 6 },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  button: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginTop: 7 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.48 },
  textButton: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 13, flexWrap: 'wrap' },
  body: { fontSize: 14 },
  link: { fontSize: 14, fontWeight: '700' },
  caption: { fontSize: 12, lineHeight: 18 },
  captionLink: { fontSize: 12 },
  checkRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  checkText: { fontSize: 15, fontWeight: '600' },
  error: { fontSize: 13, lineHeight: 19, marginTop: 7 },
});
