import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteAccount } from '@workspace/api-client-react';

/**
 * Delete my account on the web (D-089), the same as the phone's (D-046): type DELETE, the
 * server removes every row of the account and the sign-in, then the page signs out.
 */
export default function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const client = useQueryClient();
  const remove = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [error, setError] = useState('');
  const ready = word.trim() === 'DELETE' && !remove.isPending;

  const confirm = async () => {
    if (!ready) return;
    setError('');
    try {
      const result = await remove.mutateAsync();
      client.clear();
      if (!result.identityDeleted) window.alert('Your data is deleted. Your sign-in could not be removed automatically; contact support and it will be finished by hand.');
      onDeleted();
    } catch {
      setError('Study Coach could not delete the account just now. Nothing was removed. Try again in a moment.');
    }
  };

  if (!open) {
    return <button type="button" className="btn btn-quiet" style={{ color: '#9b392b' }} onClick={() => { setWord(''); setError(''); setOpen(true); }} data-testid="button-delete-account">Delete my account</button>;
  }
  return (
    <div className="panel panel-pad" role="dialog" aria-label="Delete my account" style={{ flexBasis: '100%', marginTop: 8 }} data-testid="panel-delete-account">
      <h2 className="section-title" style={{ marginBottom: 10 }}>Delete my account</h2>
      <p className="muted" style={{ fontSize: '.85rem', lineHeight: 1.6 }}>This deletes your courses and exams, uploaded materials, practice sets, flashcards, memory sheet, conversations and lecture transcripts from our servers, and your sign-in. Lectures kept in this browser's lecture desk stay in this browser until you clear its site data. This cannot be undone.</p>
      <label className="field" style={{ marginTop: 12 }}>Type DELETE to confirm
        <input value={word} onChange={(event) => setWord(event.target.value)} autoComplete="off" placeholder="DELETE" data-testid="input-delete-word" />
      </label>
      {error ? <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="btn" style={{ background: '#9b392b', color: '#fff' }} disabled={!ready} onClick={() => void confirm()} data-testid="button-confirm-delete">{remove.isPending ? 'Deleting…' : 'Delete everything'}</button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)} data-testid="button-cancel-delete">Cancel</button>
      </div>
    </div>
  );
}
