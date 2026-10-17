import { useEffect, useState } from 'react';

/**
 * A waiting bar that fills left to right (D-126), same rules as the phone: words always say what
 * is happening; estimates never reach 100% by themselves. The fill eases via CSS transition, which
 * the global prefers-reduced-motion rule turns off.
 */
export default function ProgressBar({ fraction, label, testId }: { fraction: number; label: string; testId?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-testid={testId ?? 'progress-bar'} style={{ margin: '10px 0' }}>
      <div style={{ height: 8, borderRadius: 99, background: '#e5dfd1', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#d56848', transition: 'width .45s ease-out' }} />
      </div>
      <p className="ae-muted" style={{ fontSize: '.85rem', margin: '6px 0 0' }}>{label}</p>
    </div>
  );
}

/** Milliseconds since `active` became true (ticks twice a second; 0 while inactive). */
export function useElapsed(active: boolean): number {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) { setStart(null); return; }
    const begun = Date.now();
    setStart(begun); setNow(begun);
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return start === null ? 0 : Math.max(0, now - start);
}
