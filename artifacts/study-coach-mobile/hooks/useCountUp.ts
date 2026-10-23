import { useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { COUNT_UP_MS, countUpValue } from '@/lib/count-up';

/**
 * The number to render while a score counts up from 0 to `target` (D-179), over about
 * `durationMs`. Restarts when `target` changes. With Reduce Motion on it is `target` at once.
 */
export function useCountUp(target: number, durationMs: number = COUNT_UP_MS): number {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(() => (reduceMotion ? target : 0));
  useEffect(() => {
    if (reduceMotion || target <= 0) { setShown(Math.max(0, target)); return; }
    const started = Date.now();
    setShown(0);
    let frame = requestAnimationFrame(function tick() {
      const value = countUpValue(target, Date.now() - started, durationMs);
      setShown(value);
      if (value < target) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduceMotion]);
  return shown;
}
