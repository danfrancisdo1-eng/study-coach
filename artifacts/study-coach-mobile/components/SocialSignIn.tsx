import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

type Provider = 'apple' | 'google';

export function SocialSignIn({ disabled = false }: { disabled?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [working, setWorking] = useState<Provider | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const start = async (provider: Provider) => {
    if (working) return;
    setError('');
    setWorking(provider);
    try {
      const result = await startSSOFlow({
        strategy: provider === 'apple' ? 'oauth_apple' : 'oauth_google',
        // Use an existing route for the web popup; Expo Go uses its exp:// callback.
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'study-coach-mobile', path: 'sign-in' }),
      });
      if (result.createdSessionId && result.setActive) {
        await result.setActive({
          session: result.createdSessionId,
          navigate: async ({ session }) => {
            if (session?.currentTask) {
              setError('Your account needs another step before sign-in can finish. Please use email sign-in or contact support.');
              return;
            }
            router.replace('/');
          },
        });
      } else if (result.authSessionResult?.type === 'cancel' || result.authSessionResult?.type === 'dismiss') {
        // The user closed the provider sheet; keep all sign-in options available.
      } else if (result.signIn?.status === 'needs_client_trust' || result.signIn?.status === 'needs_second_factor') {
        setError('This account needs additional verification. Please use email sign-in to finish.');
      } else if (result.signUp?.status === 'missing_requirements') {
        setError('More account information is required. Please create an account with email first.');
      } else {
        setError('Sign-in was not completed. Please try again or use email.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start sign-in. Please try again.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {(['apple', 'google'] as const).map((provider) => (
          <Pressable
            key={provider}
            testID={`button-${provider}-sign-in`}
            accessibilityRole="button"
            accessibilityLabel={`Continue with ${provider === 'apple' ? 'Apple' : 'Google'}`}
            disabled={working !== null || disabled}
            onPress={() => void start(provider)}
            style={[styles.button, { backgroundColor: colors.card, borderColor: colors.border }, (working !== null || disabled) && styles.disabled]}
          >
            <Ionicons name={provider === 'apple' ? 'logo-apple' : 'logo-google'} size={20} color={colors.foreground} />
            <Text style={[styles.buttonText, { color: colors.foreground }]}>
              {working === provider ? 'Opening…' : provider === 'apple' ? 'Apple' : 'Google'}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" testID="status-social-auth-error" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      <Text style={[styles.divider, { color: colors.mutedForeground }]}>or continue with email</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 13, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, minHeight: 50, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  divider: { textAlign: 'center', fontSize: 13 },
  error: { fontSize: 13, lineHeight: 19 },
});