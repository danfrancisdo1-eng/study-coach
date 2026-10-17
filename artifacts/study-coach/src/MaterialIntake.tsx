import { useEffect, useRef, useState } from 'react';
import { useExtractStudyWebsite, type StudyMaterialExtraction } from '@workspace/api-client-react';
import ProgressBar, { useElapsed } from './ProgressBar';
import { materialWorkMs, timeLeftText, uploadThenWork } from './lib/progress';
import { uploadMaterial } from './lib/material-upload';

export default function MaterialIntake({ courseName, consent, files, onFilesChange, onSave }: {
  courseName: string;
  consent: boolean;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onSave: (preview: StudyMaterialExtraction) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const current = useRef(true);
  const websiteMutation = useExtractStudyWebsite();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<StudyMaterialExtraction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [lastUrl, setLastUrl] = useState('');
  // D-126: the waiting bar: real upload share, then an estimate of reading and writing notes.
  const [sent, setSent] = useState(0);
  const [workStart, setWorkStart] = useState<number | null>(null);
  const [job, setJob] = useState<{ kind: 'file' | 'photo' | 'website'; bytes: number } | null>(null);
  const elapsed = useElapsed(busy && job !== null);
  const open = () => { if (!dialog.current?.open) dialog.current?.showModal(); };
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);

  const read = async (file?: File, link?: string) => {
    setBusy(true);
    setPreview(null);
    setJob({ kind: 'website', bytes: 0 }); setSent(1); setWorkStart(Date.now());
    setNotice('Nothing is saved yet.');
    try {
      const result = await websiteMutation.mutateAsync({ data: { url: link ?? '' } });
      if (!current.current) return;
      setPreview(result);
      setNotice('Review the text and coverage below, then choose Save.');
    } catch (error) {
      if (current.current) setNotice(`${error instanceof Error ? error.message : 'Extraction failed.'} Nothing was saved. You can retry.`);
    } finally { if (current.current) setBusy(false); }
  };

  // D-126: the file goes up with XMLHttpRequest (same route and headers) so the bar shows bytes sent.
  const readFile = async (file: File) => {
    setBusy(true); setPreview(null); setNotice('Nothing is saved yet.');
    setJob({ kind: file.type.startsWith('image/') ? 'photo' : 'file', bytes: file.size }); setSent(0); setWorkStart(null);
    try {
      if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('Choose a nonempty file up to 12 MB.');
      if (file.type.startsWith('image/') && !consent) throw new Error('Accept the AI-processing consent before reading image text.');
      const result = await uploadMaterial(file, (fraction) => { if (!current.current) return; setSent(fraction); if (fraction >= 1) setWorkStart((at) => at ?? Date.now()); });
      if (current.current) { setPreview(result); setNotice('Review the text and coverage, then choose Save.'); }
    } catch (error) {
      if (current.current) setNotice(`${error instanceof Error ? error.message : 'Extraction failed.'} Nothing was saved. Retry or choose another file.`);
    } finally { if (current.current) setBusy(false); }
  };
  useEffect(() => { if (files[0]) { open(); void readFile(files[0]); } }, [files[0]]);

  const save = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await onSave(preview);
      if (!current.current) return;
      setPreview(null); setNotice('Saved to this private course. The next tutor response can use it.');
      if (files.length) onFilesChange(files.slice(1));
    } catch (error) { if (current.current) setNotice(`Not saved: ${error instanceof Error ? error.message : 'Save failed'}. Your preview remains available to retry.`); }
    finally { if (current.current) setBusy(false); }
  };
  return <>
    <button type="button" aria-label="Add course material" data-testid="button-material-plus" onClick={open}
      style={{ position: 'fixed', right: 22, bottom: 22, width: 56, height: 56, borderRadius: '50%', fontSize: 28, color: '#fff', background: '#bd583b', border: 0, zIndex: 90 }}>+</button>
    <dialog ref={dialog} aria-labelledby="intake-title" style={{ width: 'min(92vw, 640px)', maxHeight: '88vh', border: '1px solid #d9d3c8', borderRadius: 18, padding: 24, background: '#fffdf8' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><h2 id="intake-title">Add to {courseName}</h2><button type="button" aria-label="Close material intake" onClick={() => dialog.current?.close()} data-testid="button-close-intake">Close</button></div>
      <p>Your conversation, quiz and unsent work stay in place. Photos use your existing AI-processing consent.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => photoInput.current?.click()} data-testid="button-intake-photos">Photos</button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => fileInput.current?.click()} data-testid="button-intake-files">Files</button>
      </div>
      <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { if (event.target.files?.length) onFilesChange(Array.from(event.target.files)); event.target.value = ''; }} />
      <input ref={fileInput} type="file" multiple accept=".txt,.md,.markdown,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp" hidden onChange={event => { if (event.target.files?.length) onFilesChange(Array.from(event.target.files)); event.target.value = ''; }} />
      <label className="field">Website link<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" data-testid="input-intake-url" /></label>
      <button type="button" className="btn btn-outline" disabled={busy || !url.trim()} onClick={() => { onFilesChange([]); setLastUrl(url.trim()); void read(undefined, url.trim()); }} data-testid="button-intake-website">Read page</button>
      {busy && job && (() => {
        const expected = materialWorkMs(job);
        const workElapsed = workStart ? Date.now() - workStart : 0;
        const label = sent < 1 ? `Uploading ${Math.round(sent * 100)}%` : `${job.kind === 'website' ? 'Reading the page' : job.kind === 'photo' ? 'Reading your photo' : 'Reading your file'} and writing notes · ${timeLeftText(workElapsed, expected)}`;
        void elapsed; // re-renders twice a second while waiting
        return <ProgressBar fraction={uploadThenWork(sent, workElapsed, expected)} label={label} testId="progress-material" />;
      })()}
      <p role="status" aria-live="polite" data-testid="status-intake">{notice}</p>
      {preview ? <>
        <h3>{preview.filename}</h3>
        {preview.sourceUrl && <p style={{ overflowWrap: 'anywhere' }}>{preview.sourceUrl}</p>}
        <p>{preview.coverageNote}</p>
        {/* D-124: read-only notes; corrections go through the coach after saving. */}
        <p className="ae-kicker">{preview.notes ? 'Your notes' : 'Extracted text (the coach writes notes after you save)'}</p>
        <div data-testid="panel-intake-notes" style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #d9d3c8', borderRadius: 10, padding: 12, whiteSpace: preview.notes ? 'normal' : 'pre-wrap' }}>
          {preview.notes ? preview.notes.split('\n').filter(line => line.trim()).map((line, i) => /^#{1,6}\s/.test(line)
            ? <p key={i} style={{ fontWeight: 700, margin: i ? '10px 0 2px' : '0 0 2px' }}>{line.replace(/^#+\s*/, '')}</p>
            : <p key={i} style={{ margin: '2px 0' }}>{line.replace(/^\s*[-*]\s+/, '• ').replace(/\*\*(.+?)\*\*/g, '$1')}</p>) : preview.text}
        </div>
        {preview.notes && <p className="ae-muted" style={{ fontSize: '.85rem' }}>Anything wrong? After saving, tell the coach in this course's chat and it fixes the notes.</p>}
        <button type="button" className="btn btn-dark" disabled={busy || !preview.text.trim()} onClick={() => void save()} data-testid="button-intake-save">Save to this course</button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setPreview(null); onFilesChange(files.slice(1)); setNotice('Preview discarded. Nothing was saved.'); }}>Discard preview</button>
      </> : !busy && notice && <button type="button" className="btn btn-outline" onClick={() => files[0] ? void readFile(files[0]) : lastUrl ? void read(undefined, lastUrl) : fileInput.current?.click()} data-testid="button-intake-retry">Retry / choose file</button>}
    </dialog>
  </>;
}