import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * The design tokens for the current color scheme (D-043): the dark palette when the device
 * is in Dark Mode, the light one otherwise, plus scheme-independent values like `radius`.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius, scheme: scheme === 'dark' ? 'dark' as const : 'light' as const };
}
