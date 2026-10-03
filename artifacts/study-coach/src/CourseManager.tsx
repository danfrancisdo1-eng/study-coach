import { useState, type FormEvent } from 'react';
import { ArrowRight, Archive, Plus, RotateCcw, X } from 'lucide-react';
import { useStudy, uid } from './lib/study';

const accents = ['#c9d9cf', '#d9ddeb', '#e8d7ce', '#e2e3cc', '#e2d6c4', '#d9e6d7'];
const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function CourseManager({ compact = false }: { compact?: boolean }) {
  const { data, update } = useStudy();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const cleaned = name.trim().replace(/\s+/g, ' ');
  const activeMatch = data.courses.find(c => normalize(c.name) === normalize(cleaned));
  const archivedMatch = data.archivedCourses.find(c => normalize(c.name) === normalize(cleaned));

  const restore = (id: string) => {
    const old = data.archivedCourses.find(c => c.id === id);
    if (!old) return;
    if (data.courses.some(c => normalize(c.name) === normalize(old.name))) {
      setError('An active course already has this name. Rename that course before restoring.');
      return;
    }
    update(s => {
      const course = s.archivedCourses.find(c => c.id === id);
      return course ? { ...s, courses: [...s.courses, course], archivedCourses: s.archivedCourses.filter(c => c.id !== id) } : s;
    });
    setName(''); setError(''); setMessage(`${old.name} restored with its study records.`);
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!cleaned) { setError('Enter a course name first.'); return; }
    if (activeMatch) { setError('This course is already in your list.'); return; }
    if (archivedMatch) { restore(archivedMatch.id); return; }
    update(s => ({ ...s, courses: [...s.courses, { id: uid(), name: cleaned, code: cleaned, short: cleaned, accent: accents[s.courses.length % accents.length] }] }));
    setName(''); setError(''); setMessage(`${cleaned} added. You can start studying right away.`);
  };
  const saveRename = (id: string) => {
    const cleanedEdit = editName.trim().replace(/\s+/g, ' ');
    if (!cleanedEdit) { setError('A course needs a name.'); return; }
    if (data.courses.some(c => c.id !== id && normalize(c.name) === normalize(cleanedEdit))) { setError('Another active course already has this name.'); return; }
    update(s => ({ ...s, courses: s.courses.map(c => c.id === id ? { ...c, name: cleanedEdit, short: cleanedEdit, code: cleanedEdit } : c) }));
    setEditing(null); setError(''); setMessage('Course name updated everywhere.');
  };
  const archive = (id: string) => {
    const course = data.courses.find(c => c.id === id);
    if (!course || !window.confirm(`Remove ${course.name} from your current courses? Its uploads, dates, quizzes, and history will be kept and you can restore it here.`)) return;
    update(s => ({ ...s, courses: s.courses.filter(c => c.id !== id), archivedCourses: [...s.archivedCourses, course] }));
    setEditing(null); setMessage(`${course.name} hidden from current courses. Its records are still saved.`); setError('');
  };
  return <section id="manage-courses" className="panel panel-pad course-manager" aria-labelledby="manage-courses-title" style={{scrollMarginTop:24}}>
    <div className="spread manager-heading"><div><span className="eyebrow">MAKE THIS YOURS</span><h2 id="manage-courses-title" className="section-title">Manage courses</h2></div><span className="tag">{data.courses.length} ACTIVE</span></div>
    <p className="muted manager-intro">Your schedule can change. Add or rename a class here. Removing one only hides it from current study choices—your uploads, dates, quiz history and plans stay saved.</p>
    <form onSubmit={add} className="manager-add">
      <label className="field">Course name<input value={name} onChange={e => { setName(e.target.value); setError(''); }} placeholder="Enter the class name" data-testid="input-add-course-name" /></label>
      <button type="submit" className="btn btn-primary" data-testid="button-add-course"><Plus size={16}/>{archivedMatch && !activeMatch ? 'Restore course' : 'Add course'}</button>
    </form>
    {archivedMatch && !activeMatch && <p className="manager-hint">This course is archived. Restore it to keep its existing study records together.</p>}
    {error && <div className="error" role="alert" data-testid="error-course-manager">{error}</div>}
    {message && <div className="notice" role="status" data-testid="status-course-manager">{message}</div>}
    {!compact && data.courses.length > 0 && <div className="manager-list"><h3 className="mono muted">CURRENT COURSES</h3>{data.courses.map(c => <div className="manager-row" key={c.id}>
      {editing === c.id ? <form className="manager-edit" onSubmit={e => { e.preventDefault(); saveRename(c.id); }}><label className="field">Rename {c.name}<input autoFocus value={editName} onChange={e => setEditName(e.target.value)} data-testid={`input-rename-course-${c.id}`}/></label><button className="btn btn-dark" type="submit" data-testid={`button-save-course-${c.id}`}>Save</button><button className="btn btn-quiet" type="button" onClick={() => { setEditing(null); setError(''); }} aria-label={`Cancel renaming ${c.name}`} data-testid={`button-cancel-rename-${c.id}`}><X size={17}/></button></form> : <><strong>{c.name}</strong><div className="manager-actions"><button className="btn btn-quiet" onClick={() => { setEditing(c.id); setEditName(c.name); setError(''); }} data-testid={`button-rename-course-${c.id}`}>Rename</button><button className="btn btn-quiet" onClick={() => archive(c.id)} aria-label={`Remove ${c.name} from current courses`} data-testid={`button-archive-course-${c.id}`}><Archive size={16}/> Remove</button></div></>}
    </div>)}</div>}
    {!!data.archivedCourses.length && <div className="manager-list"><h3 className="mono muted">HIDDEN COURSES · RECORDS KEPT</h3>{data.archivedCourses.map(c => <div className="manager-row" key={c.id}><span>{c.name}</span><button className="btn btn-outline" onClick={() => restore(c.id)} data-testid={`button-restore-course-${c.id}`}><RotateCcw size={16}/> Restore <ArrowRight size={14}/></button></div>)}</div>}
  </section>;
}