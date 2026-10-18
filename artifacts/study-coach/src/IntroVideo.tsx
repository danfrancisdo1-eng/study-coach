import { useEffect, useRef, useState } from 'react';

// D-150: Dan's intro video on the web: full screen, once, the first time this browser opens the app;
// Skip always on screen; sound off until tapped. Settings → "Watch the intro" replays it.
export const INTRO_SEEN_KEY = 'rapidrecall-intro-seen';
const REPLAY_EVENT = 'rapidrecall-replay-intro';

const seen = () => { try { return localStorage.getItem(INTRO_SEEN_KEY) === '1'; } catch { return true; } };
export const replayIntro = () => window.dispatchEvent(new Event(REPLAY_EVENT));

export function IntroVideo() {
  const [open, setOpen] = useState(() => !seen());
  const [muted, setMuted] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const replay = () => { setMuted(true); setOpen(true); };
    window.addEventListener(REPLAY_EVENT, replay);
    return () => window.removeEventListener(REPLAY_EVENT, replay);
  }, []);
  if (!open) return null;
  const close = () => { try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* private mode: it just shows again */ } setOpen(false); };
  const toggleSound = () => { const next = !muted; setMuted(next); if (video.current) video.current.muted = next; };
  const pill: React.CSSProperties = { minHeight: 44, padding: '0 16px', borderRadius: 22, border: 0, background: 'rgba(0,0,0,.55)', color: '#fff', font: '700 16px system-ui', cursor: 'pointer' };
  return (
    <div role="dialog" aria-label="Intro video" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="overlay-intro">
      <video ref={video} src={`${import.meta.env.BASE_URL}intro.mp4`} autoPlay muted playsInline onEnded={close} onError={close} onClick={toggleSound} style={{ maxWidth: '100%', maxHeight: '100%', height: '100%', objectFit: 'contain' }} />
      <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
        <button type="button" onClick={toggleSound} style={pill} data-testid="button-intro-sound">{muted ? '🔇 Tap for sound' : '🔊'}</button>
        <button type="button" onClick={close} style={pill} data-testid="button-intro-skip">Skip ›</button>
      </div>
    </div>
  );
}
