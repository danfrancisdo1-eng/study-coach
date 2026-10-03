import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Question, PlanResultDaysItem } from '@workspace/api-client-react';

export type Course = { id:string; code:string; name:string; short:string; accent:string };
export const COURSES:Course[] = [
  { id:'biol-114-lecture', code:'Biology I', name:'Introductory Biology I', short:'Biology I', accent:'#c9d9cf' },
  { id:'biol-114-lab', code:'Biology Lab', name:'Introductory Biology I Lab', short:'Biology I Lab', accent:'#d9e6d7' },
  { id:'phil-151', code:'Leadership', name:'Philosophy of Leadership', short:'Philosophy of Leadership', accent:'#e2d6c4' },
  { id:'engl-103-3', code:'English', name:'English Composition', short:'English Composition', accent:'#d9ddeb' },
  { id:'soci-102', code:'Diversity', name:'Introduction to Cultural Diversity', short:'Cultural Diversity', accent:'#e8d7ce' },
  { id:'psyc-236', code:'Psychology', name:'Positive Psychology', short:'Positive Psychology', accent:'#e2e3cc' },
];
export type CourseId = string;
export type Material = { id:string; courseId:string; name:string; text:string; addedAt:string };
export type Lecture = { id:string; courseId:string; title:string; recordedAt:string; duration:number; status:'draft'|'reviewed'; segments:{start:number;end:number;text:string}[]; audioChunks:number; audioType:string };
export type Deadline = { id:string; courseId:string; title:string; date:string; kind:'exam'|'assignment' };
export type Concept = { key:string; courseId:string; name:string; level:number; due:string; misses:number; lastSeen:string; teaching:string; mnemonic:string; reviewed:boolean };
export type Attempt = { id:string; courseId:string; topic:string; date:string; questions:Question[]; answers:number[]; score:number; remediationCompleted:boolean; flagged?:number[] };
export type Plan = { id:string; courseId:string; examId:string; days:PlanResultDaysItem[]; completed:string[] };
export type StudyData = { onboarded:boolean; minutes:number; practice:string; courses:Course[]; archivedCourses:Course[]; topics:Record<string,string[]>; materials:Material[]; lectures:Lecture[]; deadlines:Deadline[]; concepts:Concept[]; attempts:Attempt[]; plans:Plan[]; activeQuiz?:{courseId:string;topic:string;questions:Question[];answers:number[];index:number} };
export const initialData:StudyData={onboarded:false,minutes:35,practice:'',courses:COURSES.map(c=>({...c})),archivedCourses:[],topics:{},materials:[],lectures:[],deadlines:[],concepts:[],attempts:[],plans:[]};
export const uid=()=>crypto.randomUUID();
export const today=()=>new Date().toLocaleDateString('en-CA');
export const daysFrom=(days:number)=>{const d=new Date();d.setDate(d.getDate()+days);return d.toLocaleDateString('en-CA')};
export const courseById=(id:string,courses:Course[]=COURSES)=>courses.find(c=>c.id===id);
export const shortDate=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'});
const oldBiologyId='biol-114';
const oldBiologyCourse:Course={id:oldBiologyId,code:'Biology I and Lab',name:'Introductory Biology I and Lab',short:'Biology I and Lab',accent:'#c9d9cf'};
export function restoreStudyData(saved:Partial<StudyData>):StudyData{
  const hadEditableCourses=Array.isArray(saved.courses);
  const oldBiologyWork=Boolean(
    saved.topics?.[oldBiologyId]?.length ||
    saved.materials?.some(item=>item.courseId===oldBiologyId) ||
    saved.deadlines?.some(item=>item.courseId===oldBiologyId) ||
    saved.concepts?.some(item=>item.courseId===oldBiologyId) ||
    saved.attempts?.some(item=>item.courseId===oldBiologyId) ||
    saved.plans?.some(item=>item.courseId===oldBiologyId) ||
    saved.activeQuiz?.courseId===oldBiologyId
  );
  const archivedCourses=Array.isArray(saved.archivedCourses)?saved.archivedCourses:[];
  return {
    ...initialData,...saved,
    courses:hadEditableCourses?saved.courses!:COURSES.map(c=>({...c})),
    archivedCourses:!hadEditableCourses&&oldBiologyWork
      ?[...archivedCourses,oldBiologyCourse]
      :archivedCourses,
  };
}
const Context=createContext<{data:StudyData; ready:boolean; error:string; update:(fn:(prev:StudyData)=>StudyData)=>void}|null>(null);
const DB='study-coach-local-v1';
function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{req.result.createObjectStore('state')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function read():Promise<StudyData|null>{const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly');const req=tx.objectStore('state').get('study');req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close()})}
async function write(value:StudyData){const db=await openDB();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,'study');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
let pendingWrite:Promise<void>=Promise.resolve();
export function StudyProvider({children}:{children:ReactNode}){
  const [data,setData]=useState<StudyData>(initialData);const [ready,setReady]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{read().then(saved=>{if(saved)setData(restoreStudyData(saved));setReady(true)}).catch(e=>{setError(`Could not open browser storage: ${String(e)}. Your changes may not persist.`);setReady(true)})},[]);
  const update=(fn:(prev:StudyData)=>StudyData)=>setData(prev=>{const next=fn(prev);pendingWrite=pendingWrite.catch(()=>{}).then(()=>write(next));pendingWrite.catch(e=>setError(`Could not save locally: ${String(e)}`));return next});
  return createElement(Context.Provider,{value:{data,ready,error,update}},children);
}
export function useStudy(){const ctx=useContext(Context);if(!ctx)throw new Error('StudyProvider missing');return ctx}
export function reviewConcepts(previous:Concept[],courseId:string,questions:Question[],answers:number[]):Concept[]{
  const next=[...previous];
  questions.forEach((q,i)=>{const key=`${courseId}:${q.concept.toLowerCase().trim()}`;const old=next.find(c=>c.key===key);const correct=answers[i]===q.answerIndex;const level=correct?Math.min(5,(old?.level??0)+1):0;const updated:Concept={key,courseId,name:q.concept,level,due:daysFrom(correct?[1,2,4,7,14,30][level]:1),misses:(old?.misses??0)+(correct?0:1),lastSeen:today(),teaching:q.teaching,mnemonic:q.mnemonic,reviewed:false};const index=next.findIndex(c=>c.key===key);if(index>=0)next[index]=updated;else next.push(updated)});
  return next;
}