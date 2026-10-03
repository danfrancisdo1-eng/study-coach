import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Check, Clock3, ShieldCheck } from 'lucide-react';
import { useStudy } from './lib/study';

export function Settings() {
  const { data, update } = useStudy();
  const [minutes, setMinutes] = useState(data.minutes);
  const [practice, setPractice] = useState(data.practice);
  const [saved, setSaved] = useState(false);
  return (
    <div className="onboard">
      <Link href="/home" className="btn btn-quiet" data-testid="link-settings-home"><ArrowLeft size={16} /> Back to Home</Link>
      <div className="onboard-hero">
        <span className="eyebrow">OPTIONAL SETTINGS</span>
        <h1 className="display">Make room for real life.</h1>
        <p className="lead">These details shape future study plans. You can always study without filling them in.</p>
      </div>
      <div className="panel onboard-card">
        <div className="row" style={{ marginBottom: 22 }}><Clock3 size={21} color="#b65338" /><h2 className="section-title">Your usual study window</h2></div>
        <div className="grid2">
          <label className="field">Available minutes per day
            <input type="number" min="5" max="480" value={minutes} onChange={event => setMinutes(Number(event.target.value))} data-testid="input-daily-minutes" />
          </label>
          <label className="field">Football practice / other constraints (optional)
            <input value={practice} onChange={event => setPractice(event.target.value)} placeholder="e.g. Tue & Thu afternoons" data-testid="input-practice" />
          </label>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => {
          update(previous => ({ ...previous, minutes: Math.max(5, Math.min(480, minutes || 35)), practice: practice.trim() }));
          setSaved(true);
        }} data-testid="button-save-settings"><Check size={16} /> Save preferences</button>
        {saved && <p className="notice" role="status" style={{ marginTop: 18 }}>Your preferences were saved in this browser.</p>}
      </div>
      <div className="notice" style={{ marginTop: 24 }}><ShieldCheck size={16} style={{ display: 'inline', marginRight: 7, verticalAlign: 'middle' }} />Your work stays in this browser. AI actions need internet and send extracted text only when requested. Results are never sent to a parent unless you choose to share them.</div>
    </div>
  );
}