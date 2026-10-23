import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { AURORA_FADE, auroraBlobs, auroraDriftMs, type AuroraBlob } from '@/lib/aurora';

/**
 * The aurora (D-179): soft indigo and amber glows behind a screen's content, drifting a few
 * dozen points over a minute and easing back. Mount it as the first child of a screen's root
 * view (which keeps its solid background color under it). It never takes touches and is hidden
 * from VoiceOver. With Reduce Motion on the glows are still; they are a material, not motion.
 */
export function AuroraBackground() {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const driftMs = auroraDriftMs(reduceMotion);
  useEffect(() => {
    if (driftMs === 0) { cancelAnimation(progress); progress.value = 0; return; }
    progress.value = withRepeat(withTiming(1, { duration: driftMs, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(progress);
  }, [driftMs, progress]);
  return (
    <View pointerEvents="none" style={styles.layer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="aurora">
      {auroraBlobs(colors.scheme).map((blob, i) => <Blob key={i} blob={blob} progress={progress} />)}
    </View>
  );
}

function Blob({ blob, progress }: { blob: AuroraBlob; progress: SharedValue<number> }) {
  const drift = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * blob.dx }, { translateY: progress.value * blob.dy }],
  }));
  const id = `aurora-${blob.color.slice(1)}-${blob.size}`;
  return (
    <Animated.View style={[{ position: 'absolute', top: blob.top, left: blob.left, width: blob.size, height: blob.size }, drift]}>
      <Svg width={blob.size} height={blob.size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={blob.color} stopOpacity={blob.alpha} />
            <Stop offset={AURORA_FADE} stopColor={blob.color} stopOpacity={0} />
            <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={blob.size / 2} cy={blob.size / 2} r={blob.size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
});
