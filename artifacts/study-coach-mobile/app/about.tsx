import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { TYPE } from '@/constants/type';
import { AuroraBackground } from '@/components/AuroraBackground';
import { ScreenHeader } from '@/components/ScreenHeader';
import { GlassFill, glassBorder } from '@/components/GlassFill';
import { FOUNDER_CREDENTIALS, FOUNDER_SIGNATURE, FOUNDER_STORY } from '@/lib/founder';

/**
 * "Why I built this" (D-181): Dan's story in his own words, from Account. The two certifications
 * are named with their dates; their IDs are never shown (the intro's end card blurs them too).
 */
export default function AboutScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/account'); };
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-about">
      <AuroraBackground />
      <ScreenHeader leading="back" onLeading={back} kicker="About" title="Why I built this" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
        <View style={styles.credentials} accessibilityRole="list">
          {FOUNDER_CREDENTIALS.map((c) => (
            <View key={c.name} style={[styles.credential, glassBorder(colors.scheme)]} accessible accessibilityLabel={`${c.issuer} ${c.name}, passed ${c.issued}`} testID="row-credential">
              <GlassFill />
              <Feather name="award" size={22} color={colors.primaryText} />
              <View style={styles.credentialCopy}>
                <Text style={styles.issuer}>{c.issuer}</Text>
                <Text style={styles.credentialName}>{c.name}</Text>
                <Text style={styles.issued}>Passed {c.issued}</Text>
              </View>
            </View>
          ))}
        </View>
        {FOUNDER_STORY.map((paragraph, i) => <Text key={i} style={[styles.body, i === FOUNDER_STORY.length - 1 && styles.last]}>{paragraph}</Text>)}
        <Text style={styles.signature}>— {FOUNDER_SIGNATURE}</Text>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 16 },
  credentials: { gap: 10, marginBottom: 4 },
  credential: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
  credentialCopy: { flex: 1, gap: 1 },
  issuer: { ...TYPE.kicker, fontSize: 12, color: colors.mutedForeground },
  credentialName: { ...TYPE.bodySemi, color: colors.foreground },
  issued: { ...TYPE.small, color: colors.mutedForeground },
  body: { ...TYPE.body, color: colors.foreground },
  last: { ...TYPE.bodySemi },
  signature: { ...TYPE.small, color: colors.mutedForeground, marginTop: 4 },
});
