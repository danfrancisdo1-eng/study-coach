import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Check, Download, FileAudio, Mic, Pause, Pencil, Play, RotateCcw, Square, Trash2, UploadCloud, X } from 'lucide-react';
import { useStudy, uid, type Lecture } from './lib/study';
import { saveAudioChunk, getAudio, deleteAudio, listAudio } from './lib/lectureAudio';
import { transcribeLecture } from '@workspace/api-client-react';
import './lectures.css';

type Segment = Lecture['segments'][number];
type RecordingPhase = 'idle' | 'requesting' | 'recording' | 'paused' | 'saving';
type Session = { id:string; title:string; recorder:MediaRecorder; stream:MediaStream; mime:string; started:number; elapsed:number; chunks:number; queue:Promise<void>; failure:string | null; stopping:boolean };
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const time=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
const MAX_AUDIO=50*1024*1024;
const fileTypes:Record<string,string>={m4a:'audio/mp4',mp4:'audio/mp4',mp3:'audio/mpeg',wav:'audio/wav',aac:'audio/aac',webm:'audio/webm',ogg:'audio/ogg',oga:'audio/ogg',aif:'audio/aiff',aiff:'audio/aiff',caf:'audio/x-caf'};
const supportedMime=(file:File)=>{const ext=file.name.split('.').pop()?.toLowerCase()??'';return fileTypes[ext]??(Object.values(fileTypes).includes(file.type)?file.type:'')};

function AudioPanel({lecture}:{lecture:Lecture}){
  const [url,setUrl]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!lecture.audioChunks){setUrl('');setLoading(false);return}
    let alive=true;let objectUrl='';
    setLoading(true);setError('');
    getAudio(lecture.id).then(blob=>{
      if(!alive)return;
      if(!blob)throw new Error('Audio could not be found in this browser.');
      objectUrl=URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(e=>{if(alive)setError(message(e))}).finally(()=>{if(alive)setLoading(false)});
    return ()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[lecture.id,lecture.audioChunks,attempt]);
  if(!lecture.audioChunks)return <p className="lecture-note">Audio removed. Your transcript remains available below.</p>;
  if(loading)return <div className="lecture-status" role="status">Opening saved audio…</div>;
  if(error)return <div className="lecture-status failed" role="alert">Could not open audio: {error} <button className="btn btn-quiet" type="button" onClick={()=>setAttempt(n=>n+1)} data-testid={`button-retry-audio-${lecture.id}`}><RotateCcw size={14}/> Retry</button></div>;
  return <div><audio controls preload="none" src={url} aria-label={`Audio for ${lecture.title}`} data-testid={`audio-lecture-${lecture.id}`}/><a className="btn btn-outline" href={url} download={`${lecture.title.replace(/[^a-z0-9-_ ]/gi,'').trim()||'lecture'}.${lecture.audioType.includes('mp4')?'m4a':lecture.audioType.includes('mpeg')?'mp3':lecture.audioType.includes('wav')?'wav':lecture.audioType.includes('ogg')?'ogg':'webm'}`} data-testid={`link-download-lecture-${lecture.id}`}><Download size={15}/> Download audio</a></div>;
}

function LectureCard({lecture}:{lecture:Lecture}){
  const {update}=useStudy();
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState<Segment[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{
    if(!editing)return;
    const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',leave);
    return ()=>window.removeEventListener('beforeunload',leave);
  },[editing]);
  const edit=()=>{setDraft(lecture.segments.map(s=>({...s})));setEditing(true);setError('');setNotice('')};
  const cancelEdit=()=>{if(window.confirm('Discard your unsaved transcript corrections?'))setEditing(false)};
  const saveEdit=()=>{
    if(draft.some((s,i)=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||!s.text.trim()||(i>0&&s.start<draft[i-1].end))){setError('Each segment needs text and valid, non-overlapping start and end times.');return}
    update(s=>({...s,lectures:(s.lectures??[]).map(item=>item.id===lecture.id?{...item,segments:draft.map(part=>({...part,text:part.text.trim()})),status:'draft' as const}:item)}));
    setEditing(false);setError('');setNotice('Corrections saved in this browser. Mark reviewed when you are ready.');
  };
  const transcribe=async()=>{
    if(!lecture.audioChunks){setError('This lecture has no saved audio to transcribe.');return}
    if(!window.confirm(`Send the audio for “${lecture.title}” to the transcription service? The recording will leave this browser. This is separate from saving it locally.`))return;
    setBusy(true);setError('');setNotice('');
    const abort=new AbortController();controller.current=abort;
    try{
      const blob=await getAudio(lecture.id);
      if(!blob)throw new Error('Saved audio is unavailable. Check browser storage before trying again.');
       const result:unknown=await transcribeLecture(blob,{headers:{'X-Audio-Type':lecture.audioType||blob.type||'application/octet-stream'},signal:abort.signal});
      if(!result||typeof result!=='object'||!('segments' in result)||!Array.isArray(result.segments))throw new Error('The service returned an unreadable transcript.');
      const segments:Segment[]=result.segments.map((part:unknown)=>{
        if(!part||typeof part!=='object'||!('start' in part)||!('end' in part)||!('text' in part)||typeof part.start!=='number'||typeof part.end!=='number'||typeof part.text!=='string'||!Number.isFinite(part.start)||!Number.isFinite(part.end))throw new Error('The service returned an invalid transcript segment.');
        return {start:part.start,end:part.end,text:part.text};
      });
      update(s=>({...s,lectures:(s.lectures??[]).map(item=>item.id===lecture.id?{...item,segments,status:'draft' as const}:item)}));
      setNotice(segments.length?'Transcript saved locally. Read through it and correct anything you hear differently.':'No speech was found. Your audio is still saved; you can retry.');
    }catch(e){if(abort.signal.aborted)setNotice('Transcription request cancelled. Your saved audio and previous transcript are still here.');else setError(`Transcription failed: ${message(e)} Your saved audio and previous transcript have not been deleted.`)}
    finally{if(controller.current===abort)controller.current=null;setBusy(false)}
  };
  const removeAudio=async()=>{
    if(!window.confirm(`Delete the saved audio for “${lecture.title}” from this browser? Its transcript will stay. Download the audio first if you need a copy.`))return;
    setBusy(true);setError('');setNotice('');
    try{await deleteAudio(lecture.id);update(s=>({...s,lectures:(s.lectures??[]).map(item=>item.id===lecture.id?{...item,audioChunks:0,audioType:''}:item)}));setNotice('Audio deleted. Transcript kept.')}
    catch(e){setError(`Could not delete audio: ${message(e)}`)}
    finally{setBusy(false)}
  };
  const removeLecture=async()=>{
    if(!window.confirm(`Permanently delete “${lecture.title}”, including its audio and transcript? This cannot be undone. Download a copy first if you need one.`))return;
    setBusy(true);setError('');
    try{if(lecture.audioChunks)await deleteAudio(lecture.id);update(s=>({...s,lectures:(s.lectures??[]).filter(item=>item.id!==lecture.id)}))}
    catch(e){setError(`Could not delete lecture: ${message(e)} Nothing was removed from the lecture list.`);setBusy(false)}
  };
  const formattedDate=Number.isNaN(Date.parse(lecture.recordedAt))?lecture.recordedAt:new Date(lecture.recordedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return <article className="lecture-card" id={`lecture-${lecture.id}`} data-testid={`card-lecture-${lecture.id}`}>
    <div className="lecture-card-top"><div><span className="eyebrow">LECTURE NOTES</span><h3 data-testid={`text-lecture-title-${lecture.id}`}>{lecture.title}</h3><div className="lecture-card-meta">{formattedDate} · {lecture.duration?time(lecture.duration):'Imported audio'} · {lecture.audioChunks?'Audio saved locally':'Transcript only'}</div></div><span className={`tag ${lecture.status}`} data-testid={`status-lecture-${lecture.id}`}>{lecture.status==='reviewed'?<><Check size={13}/> Reviewed</>:'Needs review'}</span></div>
    <AudioPanel lecture={lecture}/>
    <div className="lecture-actions">
      <button type="button" className="btn btn-outline" disabled={busy||!lecture.audioChunks||editing} onClick={()=>void transcribe()} data-testid={`button-transcribe-${lecture.id}`}>{busy?'Working…':lecture.segments.length?'Retranscribe audio':'Transcribe audio'}</button>
      {busy&&<button type="button" className="btn btn-quiet" onClick={()=>controller.current?.abort()} disabled={!controller.current} data-testid={`button-cancel-transcription-${lecture.id}`}>Cancel request</button>}
      {lecture.segments.length>0&&!editing&&<button type="button" className="btn btn-quiet" disabled={busy} onClick={edit} data-testid={`button-edit-transcript-${lecture.id}`}><Pencil size={14}/> Correct text</button>}
      {lecture.segments.length>0&&!editing&&<button type="button" className="btn btn-quiet" disabled={busy} onClick={()=>{update(s=>({...s,lectures:(s.lectures??[]).map(item=>item.id===lecture.id?{...item,status:item.status==='reviewed'?'draft' as const:'reviewed' as const}:item)}));setNotice(lecture.status==='reviewed'?'Reopened for review.':'Marked reviewed.')}} data-testid={`button-review-lecture-${lecture.id}`}>{lecture.status==='reviewed'?'Reopen':'Mark reviewed'}</button>}
       <button type="button" className="btn btn-quiet lecture-danger" disabled={busy||editing||!lecture.audioChunks||lecture.status!=='reviewed'} title={lecture.status!=='reviewed'?'Review the transcript before deleting its audio.':undefined} onClick={()=>void removeAudio()} data-testid={`button-delete-audio-${lecture.id}`}>Delete audio</button>
      <button type="button" className="btn btn-quiet lecture-danger" disabled={busy||editing||!lecture.segments.length} onClick={()=>{if(window.confirm(`Delete only the transcript for “${lecture.title}”? The saved audio will remain.`)){update(s=>({...s,lectures:(s.lectures??[]).map(item=>item.id===lecture.id?{...item,segments:[],status:'draft' as const}:item)}));setNotice('Transcript deleted. Audio kept.')}}} data-testid={`button-delete-transcript-${lecture.id}`}>Delete transcript</button>
      <button type="button" className="btn btn-quiet lecture-danger" disabled={busy||editing} onClick={()=>void removeLecture()} data-testid={`button-delete-lecture-${lecture.id}`}><Trash2 size={14}/> Delete lecture</button>
    </div>
    {busy&&<div className="lecture-status" role="status">Sending audio for transcription. Keep this page open; your local copy stays here.</div>}
    {notice&&<div className="lecture-status" role="status">{notice}</div>}
    {error&&<div className="lecture-status failed" role="alert">{error}</div>}
    {lecture.segments.length>0&&<div className="lecture-transcript">
      <div className="lecture-transcript-head"><h4>Transcript</h4><span>{lecture.segments.length} passages</span></div>
      {(editing?draft:lecture.segments).map((segment,index)=><div className="lecture-segment" id={`segment-${lecture.id}-${index}`} key={index}>
        {editing?<label className="lecture-time">Start (s)<input className="input" type="number" min="0" step="0.1" value={segment.start} onChange={e=>setDraft(parts=>parts.map((p,i)=>i===index?{...p,start:Number(e.target.value)}:p))} data-testid={`input-segment-start-${lecture.id}-${index}`}/>End (s)<input className="input" type="number" min="0" step="0.1" value={segment.end} onChange={e=>setDraft(parts=>parts.map((p,i)=>i===index?{...p,end:Number(e.target.value)}:p))} data-testid={`input-segment-end-${lecture.id}-${index}`}/></label>:<span className="lecture-time">{time(segment.start)}</span>}
        {editing?<textarea aria-label={`Passage ${index+1}`} value={segment.text} onChange={e=>setDraft(parts=>parts.map((p,i)=>i===index?{...p,text:e.target.value}:p))} data-testid={`textarea-segment-${lecture.id}-${index}`}/>:<p data-testid={`text-segment-${lecture.id}-${index}`}>{segment.text}</p>}
      </div>)}
      {editing&&<div className="lecture-actions"><button type="button" className="btn btn-primary" onClick={saveEdit} data-testid={`button-save-transcript-${lecture.id}`}><Check size={15}/> Save corrections</button><button type="button" className="btn btn-quiet" onClick={cancelEdit} data-testid={`button-cancel-edit-${lecture.id}`}><X size={15}/> Cancel</button></div>}
    </div>}
  </article>;
}

export function Lectures({courseId}:{courseId:string}){
  const {data,update}=useStudy();
  const [title,setTitle]=useState('');
  const [consent,setConsent]=useState(false);
  const [phase,setPhase]=useState<RecordingPhase>('idle');
  const [elapsed,setElapsed]=useState(0);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [recoverable,setRecoverable]=useState<{id:string;chunks:number}[]>([]);
  const session=useRef<Session|null>(null);
  const mounted=useRef(true);
  const recording=phase==='recording'||phase==='paused'||phase==='saving'||phase==='requesting';
  const lectures=(data.lectures??[]).filter(l=>l.courseId===courseId).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));
  useEffect(()=>{
    let active=true;
    listAudio().then(items=>{
      if(!active)return;
      setRecoverable(items.filter(item=>!data.lectures.some(l=>l.id===item.id)));
      const interrupted=items.filter(item=>data.lectures.some(l=>l.id===item.id&&l.audioChunks<item.chunks));
      if(interrupted.length)update(s=>({...s,lectures:s.lectures.map(l=>{
        const found=interrupted.find(item=>item.id===l.id);
        return found?{...l,audioChunks:found.chunks}:l;
      })}));
    }).catch(e=>{if(active)setError(`Could not check saved recordings: ${message(e)}`)});
    return ()=>{active=false};
  },[data.lectures.length,courseId]);
  const recover=async(item:{id:string;chunks:number})=>{
    try{
      const audio=await getAudio(item.id);
      if(!audio?.size)throw new Error('No readable audio was found.');
      update(s=>({...s,lectures:[{id:item.id,courseId,title:'Recovered recording',recordedAt:new Date().toISOString(),duration:0,status:'draft',segments:[],audioChunks:item.chunks,audioType:audio.type||'audio/webm'},...s.lectures]}));
      setRecoverable(previous=>previous.filter(x=>x.id!==item.id));
      setNotice('Recovered audio. Download a backup and listen before transcription.');
    }catch(e){setError(`Could not recover audio: ${message(e)}`)}
  };
  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;const current=session.current;if(current&&current.recorder.state!=='inactive')current.recorder.stop()};
  },[]);
  useEffect(()=>{
    if(!recording)return;
    const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
    const hidden=()=>{if(document.hidden&&session.current&&mounted.current)setNotice('Keep this page open while recording. iPhone Safari may interrupt the microphone when the screen locks or you switch apps.')};
    window.addEventListener('beforeunload',leave);document.addEventListener('visibilitychange',hidden);
    return ()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('visibilitychange',hidden)};
  },[recording]);
  useEffect(()=>{
    if(phase!=='recording')return;
    const interval=window.setInterval(()=>{const s=session.current;if(s)setElapsed(Math.round((s.elapsed+Date.now()-s.started)/1000))},250);
    return ()=>window.clearInterval(interval);
  },[phase]);
  const stop=()=>{
    const s=session.current;if(!s||s.stopping)return;
    s.stopping=true;
    if(s.recorder.state==='recording')s.elapsed+=Date.now()-s.started;
    if(s.recorder.state!=='inactive')s.recorder.stop();
    else s.stream.getTracks().forEach(track=>track.stop());
    if(mounted.current)setPhase('saving');
  };
  const start=async()=>{
    if(!consent||!title.trim()||phase!=='idle')return;
    setError('');setNotice('');setPhase('requesting');
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Microphone recording is not available in this browser. Import an audio file instead.');
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!mounted.current){stream.getTracks().forEach(track=>track.stop());return}
      const preferred=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
      const mime=preferred.find(type=>typeof MediaRecorder.isTypeSupported==='function'&&MediaRecorder.isTypeSupported(type))??'';
      let recorder:MediaRecorder;
      try{recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)}
      catch(e){stream.getTracks().forEach(track=>track.stop());throw e}
      const s:Session={id:uid(),title:title.trim(),recorder,stream,mime:recorder.mimeType||mime||'audio/webm',started:Date.now(),elapsed:0,chunks:0,queue:Promise.resolve(),failure:null,stopping:false};
      session.current=s;
      recorder.ondataavailable=event=>{
        if(!event.data?.size)return;
        const index=s.chunks++;
        s.queue=s.queue.then(()=>saveAudioChunk(s.id,index,event.data)).catch(e=>{
          s.failure=message(e);
          if(recorder.state!=='inactive')stop();
        });
      };
      recorder.onerror=()=>{s.failure='The microphone stopped unexpectedly.';stop()};
      recorder.onstop=()=>{
        s.stream.getTracks().forEach(track=>track.stop());
        const duration=Math.round((s.elapsed+(s.stopping?0:Date.now()-s.started))/1000);
        void s.queue.then(async()=>{
          if(s.failure)throw new Error(s.failure);
          if(!s.chunks)throw new Error('No audio was captured. Try again or import a Voice Memos file.');
          const audio=await getAudio(s.id);
          if(!audio?.size)throw new Error('The recording could not be read back from browser storage.');
          const lecture:Lecture={id:s.id,courseId,title:s.title,recordedAt:new Date().toISOString(),duration,audioChunks:s.chunks,audioType:s.mime,segments:[],status:'draft'};
          update(prev=>({...prev,lectures:[lecture,...(prev.lectures??[])]}));
          if(mounted.current){setNotice('Recording saved on this device. Transcription is optional and never starts automatically.');setTitle('');setConsent(false)}
        }).catch(e=>{if(mounted.current)setError(`Recording could not be completed: ${message(e)} Do not clear browser data; any earlier audio chunks may still be stored here.`)})
          .finally(()=>{if(session.current===s)session.current=null;if(mounted.current){setPhase('idle');setElapsed(0)}});
      };
      stream.getAudioTracks().forEach(track=>{track.onended=()=>{if(!s.stopping){setNotice('Microphone access ended. Saving the audio captured so far.');stop()}}});
      recorder.start(10000);
      setElapsed(0);setPhase('recording');
    }catch(e){setError(`Could not start recording: ${message(e)} You can import audio instead.`);setPhase('idle')}
  };
  const pause=()=>{const s=session.current;if(!s||s.recorder.state!=='recording')return;try{s.recorder.pause();s.elapsed+=Date.now()-s.started;setElapsed(Math.round(s.elapsed/1000));setPhase('paused')}catch(e){setError(`Could not pause: ${message(e)} Stop to save what was recorded.`)}};
  const resume=()=>{const s=session.current;if(!s||s.recorder.state!=='paused')return;try{s.recorder.resume();s.started=Date.now();setPhase('recording')}catch(e){setError(`Could not resume: ${message(e)} Stop to save what was recorded.`)}};
  const finish=()=>stop();
  const importFile=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    const mime=supportedMime(file);
    if(!mime){setError('Choose an audio file such as M4A, MP3, WAV, AAC, MP4, or WebM.');return}
    if(file.size>MAX_AUDIO){setError('This file is over 50 MB. Export or trim a shorter recording first.');return}
    if(!file.size){setError('That audio file is empty. Choose another file.');return}
    setError('');setNotice('Saving imported audio on this device…');setPhase('saving');
    const id=uid();
    try{
      await saveAudioChunk(id,0,file);
      const saved=await getAudio(id);
      if(!saved?.size)throw new Error('The imported audio could not be read back from browser storage.');
      const lecture:Lecture={id,courseId,title:title.trim()||file.name.replace(/\.[^.]+$/,'')||'Imported lecture',recordedAt:new Date().toISOString(),duration:0,audioChunks:1,audioType:mime,segments:[],status:'draft'};
      update(s=>({...s,lectures:[lecture,...(s.lectures??[])]}));
      setTitle('');setConsent(false);setNotice('Audio saved on this device. Use Transcribe audio only when you choose to send it.');
    }catch(e){setError(`Import failed: ${message(e)} Your original file has not been changed.`);setNotice('')}
    finally{setPhase('idle')}
  };
  return <section className="lectures" id="lectures" aria-label="Lectures">
    <div className="lectures-head"><div><span className="eyebrow">LISTEN BACK · LEARN FORWARD</span><h2>Lecture desk</h2></div><span className="tag">{lectures.length} SAVED</span></div>
    <p className="lectures-intro">Keep the voice behind your notes. Record or add a lecture here, then decide separately whether to send its audio for a transcript. Everything you save stays in this browser unless you choose transcription.</p>
    <div className="lecture-capture">
      <div className="lecture-capture-top"><span className="lecture-capture-icon"><Mic size={21}/></span><div><h3>Bring a lecture in</h3><p>Give it a name first, then record here or import from Voice Memos.</p></div></div>
      <div className="lecture-create-grid"><label className="field">Lecture title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Cell membranes · Week 4" maxLength={160} disabled={recording} data-testid="input-lecture-title"/></label>
        <button type="button" className="btn btn-primary" onClick={()=>void start()} disabled={recording||!title.trim()||!consent} data-testid="button-start-lecture-recording"><Mic size={16}/> Start recording</button>
         <label className="btn btn-outline lecture-import"><UploadCloud size={16}/> Import audio<input type="file" accept="audio/*,.m4a,.mp3,.wav,.aac,.mp4,.webm,.ogg,.oga,.aif,.aiff,.caf" onChange={e=>void importFile(e)} disabled={recording||!consent} aria-label="Import audio file" data-testid="input-import-lecture"/></label>
      </div>
       <label className="lecture-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={recording} data-testid="checkbox-lecture-permission"/><span>I have permission to record or import this lecture and will follow my instructor’s and classmates’ recording rules. This permission applies only to this lecture.</span></label>
       <p className="lecture-help">Audio stays on this device until you explicitly request transcription. Sign-in is required, with two transcription attempts per 24 hours; failed attempts may count, but your local audio stays available. Import M4A from iPhone Voice Memos or common audio files from Windows (up to 50 MB). Keep this page open and your screen awake during recording; Safari may stop the microphone when you lock your phone or switch apps.</p>
      {recording&&<div className="lecture-recording" role="status"><div className="lecture-recording-id"><span className={`lecture-record-dot ${phase==='recording'?'live':''}`}/><div><strong>{phase==='requesting'?'Requesting microphone…':phase==='saving'?'Saving audio…':phase==='paused'?'Recording paused':'Recording now'}</strong><small>{phase==='saving'?'Please keep this page open until saved.':phase==='paused'?'Resume or stop to save.':'Do not lock your screen.'}</small></div></div><div className="lecture-record-actions"><span className="lecture-timer" data-testid="text-recording-timer">{time(elapsed)}</span>{phase==='recording'&&<button type="button" className="btn btn-outline" onClick={pause} data-testid="button-pause-recording"><Pause size={15}/> Pause</button>}{phase==='paused'&&<button type="button" className="btn btn-outline" onClick={resume} data-testid="button-resume-recording"><Play size={15}/> Resume</button>}{(phase==='recording'||phase==='paused')&&<button type="button" className="btn btn-dark" onClick={finish} data-testid="button-stop-recording"><Square size={14}/> Stop & save</button>}</div></div>}
      {notice&&<div className="lecture-status" role="status" data-testid="status-lecture-capture">{notice}</div>}
      {error&&<div className="lecture-status failed" role="alert" data-testid="error-lecture-capture">{error}</div>}
    </div>
    {recoverable.length>0&&<div className="lecture-status" role="status"><strong>Interrupted recordings found</strong><p>These saved audio pieces were not added to a lecture. Recover them here before clearing browser data.</p>{recoverable.map(item=><button key={item.id} className="btn btn-outline" onClick={()=>void recover(item)} data-testid={`button-recover-lecture-${item.id}`}>Recover saved audio ({item.chunks} parts)</button>)}</div>}
    {lectures.length?<div className="lecture-list">{lectures.map(lecture=><LectureCard key={lecture.id} lecture={lecture}/>)}</div>:<div className="lecture-empty"><FileAudio size={27} strokeWidth={1.5}/><strong>Nothing to listen back to yet.</strong><p>Start with a short recording or bring in one from Voice Memos. Your first lecture will appear here.</p></div>}
  </section>;
}