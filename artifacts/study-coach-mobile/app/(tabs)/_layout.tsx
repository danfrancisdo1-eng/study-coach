import React from 'react';
import { Platform, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * The tab bar (D-164, Dan: "I don't even really know how many main pages we have"): three
 * places, always on screen, the lit one saying where you are. Coach is the chat; Courses is the
 * list (the home for a returning account, D-056); Account holds plan, privacy, sign out and
 * deletion. A course, its lectures, the review sheet and the paywall push on top of the tabs.
 * The legacy session screen stays reachable by route only (href null). D-036's "no tab bar"
 * held while the coach was the only page; it isn't any more.
 */
export default function TabLayout() {
  const colors = useColors();
  const icon = (name: React.ComponentProps<typeof Feather>['name']) => ({ color, size }: { color: ColorValue; size: number }) => <Feather name={name} size={size} color={color} />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primaryText,
      tabBarInactiveTintColor: colors.mutedForeground,
      tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      // Android: the composer sits on the keyboard, not on the bar.
      tabBarHideOnKeyboard: Platform.OS === 'android',
    }}>
      <Tabs.Screen name="index" options={{ title: 'Coach', tabBarIcon: icon('message-circle'), tabBarAccessibilityLabel: 'Coach' }} />
      <Tabs.Screen name="course-list" options={{ title: 'Courses', tabBarIcon: icon('book-open'), tabBarAccessibilityLabel: 'Courses and exams' }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('user'), tabBarAccessibilityLabel: 'Account' }} />
      <Tabs.Screen name="courses" options={{ href: null }} />
    </Tabs>
  );
}
