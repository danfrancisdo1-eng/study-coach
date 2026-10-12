import React, { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';

/**
 * Skeleton loaders (D-048): gray shapes in the layout the screen will have, no copy, one soft
 * pulse shared by the whole group. With Reduce Motion on, the shapes stay still. Buttons keep
 * their own spinner text; these only replace the centered spinner while a screen first loads.
 */
export function SkeletonGroup({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) { pulse.value = 1; return; }
    pulse.value = withRepeat(withTiming(0.5, { duration: 850, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View accessible accessibilityLabel="Loading" accessibilityRole="progressbar" style={[animated, style]} testID={testID ?? 'skeleton'}>
      {children}
    </Animated.View>
  );
}

export function Bone({ width = '100%', height = 14, radius = 8, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[{ width, height, borderRadius: radius, backgroundColor: colors.secondary }, style]} />;
}

/** The coach screen while the account and thread load: the course strip, two coach turns, one of yours, a chip row. */
export function HomeSkeleton() {
  return (
    <SkeletonGroup style={styles.home} testID="skeleton-home">
      <View style={styles.strip}><Bone width={44} height={12} /><Bone width="46%" height={16} /></View>
      <View style={styles.coach}><Bone width="92%" /><Bone width="76%" /><Bone width="58%" /></View>
      <Bone width="54%" height={42} radius={18} style={styles.user} />
      <View style={styles.coach}><Bone width="88%" /><Bone width="64%" /></View>
      <View style={styles.chips}><Bone width={104} height={34} radius={17} /><Bone width={88} height={34} radius={17} /><Bone width={120} height={34} radius={17} /></View>
    </SkeletonGroup>
  );
}

/** The courses page while the account loads: the "All courses" row and three course rows. */
export function CourseListSkeleton() {
  return (
    <SkeletonGroup style={styles.list} testID="skeleton-course-list">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.listRow}>
          <Bone width={16} height={16} radius={8} />
          <View style={styles.rowCopy}><Bone width={i === 0 ? '36%' : `${52 + (i * 11) % 30}%`} height={15} /><Bone width="58%" height={11} /></View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** A course screen while the account loads: three cards shaped like the guide, progress and memory-sheet cards. */
export function CourseSkeleton() {
  return (
    <SkeletonGroup style={styles.list} testID="skeleton-course">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <Bone width="34%" height={12} />
          <View style={styles.cardRow}><Bone width="62%" /><Bone width={38} /></View>
          <View style={styles.cardRow}><Bone width="48%" /><Bone width={38} /></View>
          {i === 2 ? <Bone width="80%" height={11} /> : null}
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1, paddingHorizontal: 18, gap: 14 },
  strip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: -18, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  coach: { gap: 8, paddingVertical: 4 },
  user: { alignSelf: 'flex-end' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  listRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 12 },
  rowCopy: { flex: 1, gap: 6 },
  card: { gap: 10, padding: 14, borderRadius: 16 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
