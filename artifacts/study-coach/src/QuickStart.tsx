import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, FileText, GraduationCap, ShieldCheck, UploadCloud } from 'lucide-react';
import './quick-start.css';
import { useStudy, uid, today, type CourseId, type Material } from './lib/study';
import { extractFile } from './lib/extract';

type Intent = 'test' | 'class' | 'upload';

export function QuickStart() {
  const { data, update } = useStudy();
  const [, navigate] = useLocation();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [courseId, setCourseId] = useState<CourseId | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [topic, setTopic] = useState('');
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadError, setUploadError] = useState('');
  const course = data.courses.find(item => item.id === courseId);

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !courseId || uploadPending) return;
    const destinationCourse = courseId;
    setUploadPending(true);
    setUploadMessage('');
    setUploadError('');
    const extracted: Material[] = [];
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await extractFile(file);
        extracted.push({ id: uid(), courseId: destinationCourse, name: file.name, text, addedAt: today() });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (extracted.length) {
      update(previous => ({ ...previous, materials: [...previous.materials, ...extracted] }));
      setUploadMessage(`${extracted.length} file${extracted.length === 1 ? '' : 's'} extracted and saved locally for ${data.courses.find(item => item.id === destinationCourse)?.name ?? 'this course'}. ${extracted.map(file => file.name).join(', ')}. Analyze them in your workspace only if you choose to.`);
    }
    if (failures.length) setUploadError(failures.join(' '));
    setUploadPending(false);
  };

  const finish = (destination: string) => {
    update(previous => ({
      ...previous,
      onboarded: true,
      topics: intent === 'class' && courseId && topic.trim()
        ? { ...previous.topics, [courseId]: [...new Set([...(previous.topics[courseId] ?? []), topic.trim()])] }
        : previous.topics,
       deadlines: intent === 'test' && courseId && date
         ? [...previous.deadlines, { id: uid(), courseId, title: title.trim() || `${previous.courses.find(item => item.id === courseId)?.name ?? 'Course'} test`, date, kind: 'exam' as const }]
        : previous.deadlines,
    }));
    navigate(destination);
  };

  const start = () => {
    if (!course || !intent) return;
    if (intent === 'upload') {
      finish(`/courses/${course.id}#materials`);
      return;
    }
    const focus = intent === 'test'
      ? (title.trim() ? `${title.trim()} test preparation` : `General ${course.name} test preparation`)
      : (topic.trim() || `General ${course.name} overview`);
    finish(`/quiz?course=${course.id}&topic=${encodeURIComponent(focus)}&count=20&mode=standard`);
  };

  return (
    <div className="onboard onboard-quick-start">
      <div className="brand" style={{ padding: '0 0 10px', width: 'fit-content' }}>
        <span className="brand-mark"><GraduationCap size={19} /></span>
        study coach<span style={{ color: '#dc6843' }}>.</span>
      </div>
      <div className="onboard-hero">
        <span className="eyebrow">YOUR STUDY DESK</span>
        <h1 className="display">What do you want to study?</h1>
        <p className="lead">Choose a starting point. Materials, topics, and dates are optional.</p>
      </div>
      {!intent ? (
        <div className="stack" style={{ gap: 12 }}>
          {([
            { id: 'upload', label: 'Add course materials', hint: 'Recommended for the best, class-specific practice. Add a syllabus, slides, or notes. You can still continue without them.', icon: UploadCloud },
            { id: 'test', label: 'I have a test coming up', hint: 'Start practicing now, even without a date.', icon: CalendarDays },
            { id: 'class', label: 'I want to study a class', hint: 'Get a 20-question course overview.', icon: BookOpen },
          ] as const).map(({ id, label, hint, icon: Icon }) => (
            <button key={id} className={`start-choice ${id === 'upload' ? 'recommended-choice' : ''}`} onClick={() => setIntent(id)} data-testid={`button-start-${id}`}>
              <span className="start-choice-icon"><Icon size={24} strokeWidth={1.8} /></span>
              <span className="start-choice-copy">
                {id === 'upload' && <span className="recommended-label">RECOMMENDED</span>}
                <strong>{label}</strong><small>{hint}</small>
              </span>
              <ArrowRight size={20} />
            </button>
          ))}
          <div className="start-actions">
            <button className="btn btn-quiet" onClick={() => finish('/home')} data-testid="button-skip-onboarding">Not ready? Go to Home <ArrowRight size={16} /></button>
          </div>
        </div>
      ) : (
        <div className="panel onboard-card fade-in">
          <button className="btn btn-quiet" style={{ paddingLeft: 0 }} disabled={uploadPending} onClick={() => { setIntent(null); setCourseId(null); setUploadMessage(''); setUploadError(''); }} data-testid="button-change-start">
            <ArrowLeft size={16} /> Change my choice
          </button>
          <span className="eyebrow" style={{ display: 'block', marginTop: 12 }}>ONE SMALL NEXT STEP</span>
          <h2 className="display">Which class?</h2>
           <p>Choose one of your current courses. Nothing else is required to get started.</p>
          <div className="stack" style={{ gap: 9, marginTop: 23 }}>
             {data.courses.map(item => (
              <button
                key={item.id}
                className={`start-choice start-course ${courseId === item.id ? 'selected' : ''}`}
                onClick={() => { setCourseId(item.id); setUploadMessage(''); setUploadError(''); }}
                disabled={uploadPending}
                data-testid={`button-quick-course-${item.id}`}
                aria-pressed={courseId === item.id}
              >
                 <span className="start-choice-copy"><strong>{item.name}</strong></span>
                {courseId === item.id && <ArrowRight size={18} />}
              </button>
            ))}
          </div>
           {!data.courses.length && <div className="empty" style={{ marginTop: 18 }}><h3>No courses in your list yet.</h3><p>Add a course using only its name, or restore one you hid. Then come back and start studying.</p><Link href="/courses" className="btn btn-primary" data-testid="link-quick-add-course">Add a course <ArrowRight size={16}/></Link></div>}
          {course && (
            <div className="fade-in" style={{ marginTop: 24 }}>
              {intent === 'test' && (
                <>
                  <div className="grid2">
                    <label className="field">Test name (optional)
                      <input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Midterm 1" data-testid="input-quick-test-title" />
                    </label>
                    <label className="field">Test date (optional)
                      <input type="date" value={date} onChange={event => setDate(event.target.value)} data-testid="input-quick-test-date" />
                    </label>
                  </div>
                   {date && !title.trim() && <p className="muted" style={{ fontSize: '.78rem', marginTop: 10 }}>We’ll save this date as “{course.name} test.” You can add a more specific name later.</p>}
                </>
              )}
              {intent === 'class' && <label className="field">Topic (optional)
                <input value={topic} onChange={event => setTopic(event.target.value)} placeholder="Leave blank for a general course overview" data-testid="input-quick-topic" />
              </label>}
              {intent === 'upload' && (
                <div className="stack">
                  <p className="muted" style={{ fontSize: '.84rem', margin: 0 }}>
                     Choose files for {course.name}: PDF, DOCX, PPTX, TXT, MD, PNG, or JPG, up to 12 MB each. Nothing is saved until readable text is extracted.
                  </p>
                  <label className="btn btn-outline" style={{ width: 'fit-content', cursor: uploadPending ? 'wait' : 'pointer' }}>
                    <UploadCloud size={17} /> {uploadPending ? 'Extracting files…' : 'Choose files'}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg"
                      disabled={uploadPending}
                      onChange={event => { void uploadFiles(event.target.files); event.target.value = ''; }}
                      style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                      data-testid="input-quick-upload-files"
                    />
                  </label>
                  {uploadPending && <div className="notice" role="status" data-testid="status-quick-upload-pending">Extracting readable text in this browser. Please keep this page open.</div>}
                  {uploadMessage && <div className="notice" role="status" data-testid="status-quick-upload-success"><FileText size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />{uploadMessage}</div>}
                  {uploadError && <div className="error" role="alert" data-testid="status-quick-upload-error">{uploadError}</div>}
                </div>
              )}
              {intent !== 'upload' && !data.materials.some(material => material.courseId === courseId) &&
                <div className="context-tip">No materials uploaded for this course yet. Your questions will be general {intent === 'test' ? 'test-prep' : 'course overview'} questions, not grounded in your syllabus. Add files later for course-specific practice.</div>}
              <div className="start-actions">
                <button className="btn btn-primary" onClick={start} disabled={uploadPending} data-testid="button-quick-continue">
                  {intent === 'upload' ? 'Open upload workspace' : 'Start 20 questions'} <ArrowRight size={17} />
                </button>
                <button className="btn btn-quiet" onClick={() => finish('/home')} disabled={uploadPending} data-testid="button-quick-skip">Go to Home instead</button>
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 26 }} className="notice">
        <ShieldCheck size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 7 }} />
        Your progress stays in this browser. AI quizzes need internet; extracted course text is sent only when you choose an AI action. Results are shared with a parent only if you opt in.
      </div>
      <p className="muted" style={{ fontSize: '.77rem', lineHeight: 1.6, marginTop: 18 }}>
        Want one-tap access? On iPhone Safari, tap Share &gt; Add to Home Screen. On Windows, choose Install app in your browser.
      </p>
      {data.onboarded && <Link href="/home" className="btn btn-quiet" data-testid="link-quick-home">Back to Home</Link>}
    </div>
  );
}