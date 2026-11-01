import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, Image, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { limitCopy, PREMIUM_ON_IPHONE, WEB_AI_NOTICE, type PlanStatus, type PremiumCode } from '../lib/coach-ui';

const ICONS = { send: Send, image: Image, 'alert-circle': AlertCircle, 'refresh-cw': RefreshCw } as const;

/** A centred dialog over a shade; Escape and a click on the shade close it, focus starts inside (D-303). */
function Dialog({ labelledBy, onClose, children, testId }: { labelledBy: string; onClose: () => void; children: ReactNode; testId: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="rr-shade" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={box} className="rr-dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} data-testid={testId}>{children}</div>
  </div>;
}

/**
 * The AI agreement, asked where the student is (the phone's D-211, the mock Dan approved for the web):
 * "I understand and consent" saves it and the tapped action carries on; "Not now" sends nothing.
 */
export function ConsentDialog({ reason, busy, error, onAgree, onClose }: { reason: string; busy: boolean; error: string; onAgree: () => void; onClose: () => void }) {
  return <Dialog labelledBy="consent-title" onClose={onClose} testId="sheet-ai-consent">
    <h2 id="consent-title"><ShieldCheck size={20} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 8 }} />Turn on the AI coach</h2>
    <p className="rr-reason">{reason}</p>
    <div className="rr-notice">
      {WEB_AI_NOTICE.map(line => { const Icon = ICONS[line.icon]; return <div key={line.icon}><Icon size={17} aria-hidden="true" /><span>{line.text}</span></div>; })}
    </div>
    <p><a href="/privacy" target="_blank" rel="noreferrer">Read the privacy policy</a></p>
    {error && <p className="rr-error" role="alert">{error}</p>}
    <button type="button" className="rr-primary rr-primary--wide" disabled={busy} onClick={onAgree} data-testid="button-ai-consent-sheet">{busy ? 'Saving…' : 'I understand and consent'}</button>
    <button type="button" className="rr-secondary" disabled={busy} onClick={onClose} data-testid="button-consent-not-now">Not now</button>
  </Dialog>;
}

/** A request the plan stopped (402). The web sells nothing: it says where Premium is bought (D-303). */
export function LimitDialog({ code, status, checking, onCheckAgain, onClose }: { code: PremiumCode; status: PlanStatus | null; checking: boolean; onCheckAgain: () => void; onClose: () => void }) {
  const copy = limitCopy(code, status);
  return <Dialog labelledBy="limit-title" onClose={onClose} testId="dialog-plan-limit">
    <span className="rr-badge">{status?.plan === 'trial' ? 'Free week' : status?.plan === 'premium' ? 'Premium' : 'Free plan'}</span>
    <h2 id="limit-title">{copy.title}</h2>
    <p>{copy.body}</p>
    {status?.plan !== 'premium' && <p className="rr-callout"><strong>Want more?</strong> {PREMIUM_ON_IPHONE}</p>}
    <button type="button" className="rr-primary rr-primary--wide" onClick={onClose} data-testid="button-limit-ok">OK</button>
    {status?.plan !== 'premium' && <button type="button" className="rr-secondary" disabled={checking} onClick={onCheckAgain} data-testid="button-limit-check">{checking ? 'Checking…' : 'I already have Premium: check again'}</button>}
  </Dialog>;
}
