import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ANSWER_SOUNDS_KEY, answerSoundsFromStorage, answerSoundsToStorage } from '@/lib/answer-feedback';

/**
 * The "Answer sounds" switch (D-172): on unless the student turned it off on the Account tab.
 * Kept on this phone (AsyncStorage), like the welcome replay flag; the server never needs it.
 */
export function useAnswerSounds(): { enabled: boolean; loaded: boolean; setEnabled: (next: boolean) => void } {
  const [enabled, setEnabledState] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(ANSWER_SOUNDS_KEY)
      .then((stored) => { if (live) setEnabledState(answerSoundsFromStorage(stored)); })
      .catch(() => {})
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);
  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    AsyncStorage.setItem(ANSWER_SOUNDS_KEY, answerSoundsToStorage(next)).catch(() => {});
  }, []);
  return { enabled, loaded, setEnabled };
}
