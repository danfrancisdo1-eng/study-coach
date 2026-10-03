import { useEffect, useRef, useState } from 'react';
import { useExtractStudyMaterial, useExtractStudyWebsite, type StudyMaterialExtraction } from '@workspace/api-client-react';

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
  const open = () => { if (!dialog.current?.open) dialog.current?.showModal(); };
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);

  const read = async (file?: File, link?: string) => {
    setBusy(true);
    setPreview(null);
    setNotice('Extracting readable text… Nothing is saved yet.');
    try {
      const result = await websiteMutation.mutateAsync({ data: { url: link ?? '' } });
      if (!current.current) return;
      setPreview(result);
      setNotice('Review the text and coverage below, then choose Save.');
    } catch (error) {
      if (current.current) setNotice(`${error instanceof Error ? error.message : 'Extraction failed.'} Nothing was saved. You can retry.`);
    } finally { if (current.current) setBusy(false); }
  };

  // Each selection gets its own generated-hook request header, without bypassing the shared client.
  const extraction = useExtractStudyMaterial({ request: { headers: { 'X-Filename': files[0]?.name ?? 'Material' } } });
  const extractionRef = useRef(extraction.mutateAsync);
  extractionRef.current = extraction.mutateAsync;
  const readFile = async (file: File) => {
    setBusy(true); setPreview(null); setNotice('Extracting readable text… Nothing is saved yet.');
    try {
      if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('Choose a nonempty file up to 12 MB.');
      if (file.type.startsWith('image/') && !consent) throw new Error('Accept the AI-processing consent before reading image text.');
      const result = await extractionRef.current({ data: file });
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
      <p role="status" aria-live="polite" data-testid="status-intake">{busy ? 'Working… ' : ''}{notice}</p>
      {preview ? <>
        <h3>{preview.filename}</h3>
        {preview.sourceUrl && <p style={{ overflowWrap: 'anywhere' }}>{preview.sourceUrl}</p>}
        <p>{preview.coverageNote}</p>
        <label className="field">Review or correct the extracted text ({preview.text.length.toLocaleString()} characters)
          <textarea value={preview.text} rows={12} onChange={event => setPreview({ ...preview, text: event.target.value, characterCount: event.target.value.length })} data-testid="input-intake-preview" />
        </label>
        <button type="button" className="btn btn-dark" disabled={busy || !preview.text.trim()} onClick={() => void save()} data-testid="button-intake-save">Save to this course</button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setPreview(null); onFilesChange(files.slice(1)); setNotice('Preview discarded. Nothing was saved.'); }}>Discard preview</button>
      </> : !busy && notice && <button type="button" className="btn btn-outline" onClick={() => files[0] ? void readFile(files[0]) : lastUrl ? void read(undefined, lastUrl) : fileInput.current?.click()} data-testid="button-intake-retry">Retry / choose file</button>}
    </dialog>
  </>;
}