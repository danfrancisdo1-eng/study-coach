import React, { useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { getGetMemoryPictureQueryKey, useGetMemoryPicture } from '@workspace/api-client-react';
import { PressScale } from '@/components/PressScale';
import { Bone, SkeletonGroup } from '@/components/Skeleton';
import { useColors } from '@/hooks/useColors';
import { pictureRefetch } from '@/lib/memory-picture';

/**
 * A memory hack's picture (D-216; the mock Dan approved): under the Memory hack's first paragraph, when the memory
 * coach decided a picture is the best way to remember that miss. The server draws it right after grading; while it is
 * still drawing the phone shows a soft placeholder and asks again every few seconds. Tap to see it full screen. No
 * picture (none, failed, or the wait ran out): nothing is shown and the words carry the hack as before.
 */
export function MemoryPicture({ sessionId, questionId }: { sessionId: string; questionId: string }) {
  const colors = useColors();
  const styles = createStyles(colors);
  const firstAsked = useRef(Date.now());
  const [open, setOpen] = useState(false);
  const query = useGetMemoryPicture(sessionId, questionId, {
    query: {
      queryKey: getGetMemoryPictureQueryKey(sessionId, questionId),
      staleTime: Infinity,
      refetchInterval: (q) => pictureRefetch(q.state.data?.status, firstAsked.current, Date.now()),
    },
  });
  const picture = query.data;
  const drawing = query.isLoading || (picture?.status === 'drawing' && pictureRefetch('drawing', firstAsked.current, Date.now()) !== false);
  if (drawing) {
    return (
      <SkeletonGroup style={styles.frame} testID="memory-picture-loading">
        <Bone height={190} radius={16} />
      </SkeletonGroup>
    );
  }
  if (picture?.status !== 'ready' || !picture.data) return null;
  const uri = `data:${picture.mimeType ?? 'image/webp'};base64,${picture.data}`;
  return (
    <Animated.View entering={FadeIn.duration(320)} style={styles.frame}>
      <PressScale accessibilityRole="imagebutton" accessibilityLabel="Memory hack picture. Double tap to enlarge." onPress={() => setOpen(true)} style={styles.card} testID="memory-picture">
        <Image source={{ uri }} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors />
      </PressScale>
      <Text style={styles.caption}>Tap to enlarge</Text>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close picture" onPress={() => setOpen(false)} style={styles.full} testID="memory-picture-full">
          <Image source={{ uri }} style={styles.fullImage} resizeMode="contain" accessibilityIgnoresInvertColors />
          <Text style={styles.fullHint}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  frame: { gap: 6, marginTop: 4 },
  card: { borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.secondary },
  image: { width: '100%', aspectRatio: 3 / 2 },
  caption: { color: colors.mutedForeground, fontSize: 13 },
  full: { flex: 1, backgroundColor: 'rgba(5, 9, 18, 0.94)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 14 },
  fullImage: { width: '100%', aspectRatio: 3 / 2, borderRadius: 16 },
  fullHint: { color: '#c7d0e0', fontSize: 14 },
});
