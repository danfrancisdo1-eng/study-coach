import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PRESS_SCALE, PressScale } from '@/components/PressScale';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { Feather } from '@expo/vector-icons';
import { afterIntro } from '@/lib/intro';

/**
 * Dan's intro video (D-134, D-150): full screen, once, the first time the app ever opens, before
 * the tour. Skip is always on screen; the sound is ON from the start and the pill is a Mute button
 * (D-176, Dan: "change the button on the intro video to mute instead of play for sound"); tapping the
 * video toggles it too; at the end (or on Skip) it hands over to the tour. Account → "Watch the intro" replays it with `?replay=1`.
 * The end card (D-182) is Dan's real NVIDIA-Certified Professional: Agentic AI and Google Cloud
 * Generative AI Leader certificates, held 4.5 s while the music fades; the QR code and every
 * credential ID are blurred and pixelated in the file itself (his name, titles and dates stay).
 */
export default function IntroScreen() {
  const insets = useSafeAreaInsets();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const [muted, setMuted] = useState(false);
  const player = useVideoPlayer(require('@/assets/video/intro.mp4'), (p) => {
    p.loop = false;
    p.muted = false;
    p.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  const leave = async () => {
    player.pause();
    const next = afterIntro(replay === '1');
    if (next === 'back' && router.canGoBack()) router.back();
    else router.replace(next === 'back' ? '/account' : next);
  };

  useEffect(() => {
    const sub = player.addListener('playToEnd', () => void leave());
    return () => sub.remove();
  }, [player]);
  // A video that cannot play never blocks the way in.
  useEffect(() => { if (status === 'error') void leave(); }, [status]);

  const toggleSound = () => { const next = !muted; player.muted = next; setMuted(next); };

  return (
    <View style={styles.screen} testID="screen-intro">
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} />
      <Pressable style={StyleSheet.absoluteFill} onPress={toggleSound} accessibilityRole="button" accessibilityLabel={muted ? 'Turn the sound on' : 'Turn the sound off'} testID="button-intro-sound" />
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <PressScale scale={PRESS_SCALE.icon} onPress={toggleSound} style={styles.pill} accessibilityRole="button" accessibilityLabel={muted ? 'Turn the sound on' : 'Turn the sound off'}>
          <Feather name={muted ? 'volume-x' : 'volume-2'} size={18} color="#fff" />
          <Text style={styles.pillText}>{muted ? 'Unmute' : 'Mute'}</Text>
        </PressScale>
        <PressScale scale={PRESS_SCALE.icon} onPress={() => void leave()} style={styles.pill} accessibilityRole="button" testID="button-intro-skip">
          <Text style={styles.pillText}>Skip</Text>
          <Feather name="chevron-right" size={18} color="#fff" />
        </PressScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  topBar: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  pill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)' },
  pillText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
