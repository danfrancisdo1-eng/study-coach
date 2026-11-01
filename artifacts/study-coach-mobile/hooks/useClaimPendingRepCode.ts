import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { claimRepCode } from '@workspace/api-client-react';
import { PENDING_REP_CODE_KEY, forgetPendingCode } from '@/lib/rep-code';

/**
 * D-219: once the account exists, the campus rep code typed at sign-up is claimed for it, once. The code is forgotten
 * after the server answers (claimed, unknown, or the account already has one); it is kept only when the server could
 * not be reached, to try again on the next launch.
 */
export function useClaimPendingRepCode(userId: string | null | undefined) {
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || tried.current === userId) return;
    tried.current = userId;
    void (async () => {
      const code = await AsyncStorage.getItem(PENDING_REP_CODE_KEY).catch(() => null);
      if (!code) return;
      try {
        await claimRepCode({ code });
        await AsyncStorage.removeItem(PENDING_REP_CODE_KEY);
      } catch (problem) {
        if (forgetPendingCode((problem as { status?: number }).status)) await AsyncStorage.removeItem(PENDING_REP_CODE_KEY).catch(() => {});
      }
    })();
  }, [userId]);
}
