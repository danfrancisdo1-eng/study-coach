import React from 'react';
import { Tabs } from 'expo-router';

// One screen lives in this group (the Coach home), so there is no tab bar (D-036, Dan:
// "if no buttons down there the coach button is pointless. You're already on the coach
// page."). The group is kept because routes point at "/(tabs)". The legacy courses
// screen stays reachable by route only. When a second real destination arrives, bring
// back the native tab bar (expo-router/unstable-native-tabs on iOS 26, Tabs elsewhere).
export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
      <Tabs.Screen name="index" options={{ title: 'Coach' }} />
      <Tabs.Screen name="courses" options={{ href: null }} />
    </Tabs>
  );
}
