import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, Redirect, useRouter } from 'expo-router';
import { useAuth, useSignIn } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { SocialSignIn } from '@/components/SocialSignIn';

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
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
    router.replace('/(tabs)');
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
    return <Redirect href="/(tabs)" />;
  }

  const needsEmailCode = signIn.status === 'needs_client_trust';
  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 25, paddingBottom: insets.bottom + 26 }]}
      bottomOffset={28}
      keyboardShouldPersistTaps="handled"
      testID="screen-sign-in"
    >
      <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="book-open" size={23} color={colors.primaryForeground} /></View>
      <Text style={[styles.eyebrow, { color: colors.primaryText }]}>Study Coach</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Welcome back.</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Sign in to continue your saved study sessions.</Text>
      {needsEmailCode ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>Email verification code</Text>
          <TextInput testID="input-sign-in-code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="Enter code" placeholderTextColor={colors.mutedForeground} />
          <Pressable testID="button-sign-in-verify" accessibilityRole="button" disabled={busy || !code.trim()} onPress={() => void verify()} style={[styles.button, { backgroundColor: colors.primary }, (busy || !code.trim()) && styles.disabled]}>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{busy ? 'Verifying…' : 'Verify and sign in'}</Text>
          </Pressable>
          <Pressable testID="button-resend-sign-in-code" onPress={() => void signIn.mfa.sendEmailCode()} style={styles.textButton}>
            <Text style={[styles.link, { color: colors.primaryText }]}>Send a new code</Text>
          </Pressable>
          <Pressable onPress={() => { setMessage(''); void signIn.reset(); }} style={styles.textButton}>
            <Text style={[styles.link, { color: colors.mutedForeground }]}>Start over</Text>
          </Pressable>
        </>
      ) : (
        <>
          <SocialSignIn />
          <Text style={[styles.label, { color: colors.foreground }]}>Email address</Text>
          <TextInput testID="input-sign-in-email" value={emailAddress} onChangeText={setEmailAddress} keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="you@example.com" placeholderTextColor={colors.mutedForeground} />
          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput testID="input-sign-in-password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} placeholder="Password" placeholderTextColor={colors.mutedForeground} />
          <Pressable testID="button-sign-in-submit" accessibilityRole="button" disabled={busy || !emailAddress.trim() || !password} onPress={() => void submit()} style={[styles.button, { backgroundColor: colors.primary }, (busy || !emailAddress.trim() || !password) && styles.disabled]}>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{busy ? 'Signing in…' : 'Continue'}</Text>
          </Pressable>
          <View style={styles.linkRow}>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>New to Study Coach? </Text>
            <Link href="/(auth)/sign-up" testID="link-sign-up"><Text style={[styles.link, { color: colors.primaryText }]}>Create account</Text></Link>
          </View>
        </>
      )}
      {error ? <Text accessibilityRole="alert" testID="status-auth-error" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  textButton: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 13, flexWrap: 'wrap' },
  body: { fontSize: 14 },
  link: { fontSize: 14, fontWeight: '700' },
  error: { fontSize: 13, lineHeight: 19, marginTop: 7 },
});
