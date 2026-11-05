import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStudyStateQueryKey, usePutStudyState, type StudyStateEnvelope } from '@workspace/api-client-react';
import { consentedState } from '@phone-lib/ai-consent';
import { friendlyError } from '@phone-lib/friendly-error';
import { ConsentDialog } from './Dialogs';

/**
 * D-305: the AI agreement asked where the student is (the phone's D-211) on any web screen: `withConsent`
 * runs the action at once after agreeing, or opens the agreement first; `dialog` is rendered by the screen.
 */
export function useAiConsent(envelope: StudyStateEnvelope | undefined): { withConsent: (reason: string, run: () => void) => void; dialog: ReactNode } {
  const client = useQueryClient();
  const put = usePutStudyState();
  const [ask, setAsk] = useState<{ reason: string; run: () => void } | null>(null);
  const [error, setError] = useState('');
  const agreed = (envelope?.state as { aiConsent?: unknown } | undefined)?.aiConsent === true;

  const withConsent = (reason: string, run: () => void) => {
    if (agreed) { run(); return; }
    setError('');
    setAsk({ reason, run });
  };
  const agree = async () => {
    if (!envelope || !ask) return;
    setError('');
    try {
      const result = await put.mutateAsync({ data: { state: consentedState(envelope.state, new Date().toISOString()) as never, version: envelope.version } });
      client.setQueryData<StudyStateEnvelope>(getGetStudyStateQueryKey(), result);
      const run = ask.run;
      setAsk(null);
      run();
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) void client.invalidateQueries({ queryKey: getGetStudyStateQueryKey() });
      setError(friendlyError(problem));
    }
  };
  const dialog = ask ? <ConsentDialog reason={ask.reason} busy={put.isPending} error={error} onAgree={() => void agree()} onClose={() => setAsk(null)} /> : null;
  return { withConsent, dialog };
}
