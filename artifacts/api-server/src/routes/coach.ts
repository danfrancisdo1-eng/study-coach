import express, { Router, type IRouter } from "express";
import {
  AnalyzeMaterialBody,
  AnalyzeMaterialResponse,
  GenerateQuizBody,
  GenerateQuizResponse,
  GenerateExamPlanBody,
  GenerateExamPlanResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server"; // lecture transcription only (moves to lib/stt)
import { complete, type AiTask } from "../ai";
import * as syllabusPrompt from "../prompts/syllabus.v1";
import * as classicQuizPrompt from "../prompts/classic-quiz.v1";
import * as examPlanPrompt from "../prompts/exam-plan.v1";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAuth } from "@clerk/express";
import { reserveTranscription } from "./lectureQuota";
import { requireStudyAuth } from "./study";

const router: IRouter = Router();

// Every coach route calls the AI provider; signed-out callers must never reach it.
router.use("/coach", requireStudyAuth);
const normalize = (text:string) => text.replace(/\s+/g, " ").trim().toLowerCase();
function run(command:string,args:string[]):Promise<string>{
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:["ignore","pipe","pipe"]});
    let output="";let failure="";
    child.stdout.on("data",(part:Buffer)=>{output+=part.toString()});
    child.stderr.on("data",(part:Buffer)=>{failure+=part.toString().slice(-3000)});
    child.on("error",reject);
    child.on("close",code=>code===0?resolve(output):reject(new Error(`${command} failed (${code}): ${failure.slice(-400)}`)));
  });
}

async function completion(task: AiTask, instruction: string, content: string): Promise<unknown> {
  const { text: raw } = await complete(task, { system: instruction, messages: [{ role: "user", content }] });
  if (!raw) throw new Error("The coach returned an empty response. Please try again.");
  return JSON.parse(raw);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The coach could not complete this request.";
}

function validate<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error("The coach returned an incomplete result. Please try again.");
  }
  return result.data;
}

router.post("/coach/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeMaterialBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.text.trim() || parsed.data.text.length > 65000) {
    res.status(400).json({ error: "Provide extracted text (up to 65,000 characters) to analyze." });
    return;
  }
  try {
    const { course, filename, text } = parsed.data;
    const result = await completion(
      "syllabus",
      syllabusPrompt.systemPrompt(),
      JSON.stringify({ course, filename, document: text }),
    );
    res.json(validate(AnalyzeMaterialResponse, result));
  } catch (error) {
    req.log.error({ error: message(error) }, "Material analysis failed");
    res.status(502).json({ error: "Could not analyze this material. Please try again or add topics and dates manually." });
  }
});

router.post("/coach/quiz", async (req, res): Promise<void> => {
  const parsed = GenerateQuizBody.safeParse(req.body);
  if (!parsed.success || parsed.data.materials.length > 65000 || !parsed.data.topic.trim() ||
    (parsed.data.sources ?? []).reduce((sum,s)=>sum+s.text.length,0)>65000 ||
    (parsed.data.sources ?? []).length>30) {
    res.status(400).json({ error: "Choose a topic and keep study material under 65,000 characters." });
    return;
  }
  try {
    const data = parsed.data;
    const result = await completion(
      "classic_quiz",
      classicQuizPrompt.systemPrompt(data.count),
      JSON.stringify(data),
    );
    const quiz = validate(GenerateQuizResponse, result);
    if (quiz.questions.length !== data.count) {
      throw new Error(`Expected ${data.count} questions, received ${quiz.questions.length}.`);
    }
    if(data.sources?.length){
      const sources=new Map(data.sources.map(source=>[source.id,source.text]));
      for(const question of quiz.questions){
        if(!question.sourceRefs?.length || question.sourceRefs.some(ref=>
          !sources.has(ref.id) || normalize(ref.excerpt).length<12 ||
          !normalize(sources.get(ref.id)!).includes(normalize(ref.excerpt))
        )) throw new Error("The quiz contained a missing or unverifiable source quotation.");
      }
    }
    res.json(quiz);
  } catch (error) {
    req.log.error({ error: message(error) }, "Quiz generation failed");
    res.status(502).json({ error: "Could not generate a complete quiz. Please try again." });
  }
});

// Raw audio is processed in a temporary directory and removed in finally.
// No audio or transcript is persisted on this server.
router.post("/coach/transcribe", (req,res,next)=>{
  const auth=getAuth(req);
  const claimUserId=auth?.sessionClaims?.userId;
  const userId=typeof claimUserId==="string"?claimUserId:auth?.userId;
  if(typeof userId!=="string"||!userId){res.status(401).json({error:"Sign in before requesting transcription."});return}
  res.locals.transcriptionUserId=userId;
  next();
}, express.raw({type:"application/octet-stream",limit:"50mb"}), async (req,res):Promise<void>=>{
  const type=req.header("X-Audio-Type")?.split(";")[0]?.trim().toLowerCase();
  const extensions:Record<string,string>={"audio/webm":"webm","audio/mp4":"m4a","audio/x-m4a":"m4a","audio/mpeg":"mp3","audio/mp3":"mp3","audio/wav":"wav","audio/x-wav":"wav","audio/ogg":"ogg","audio/aac":"aac","audio/aiff":"aiff","audio/x-aiff":"aiff","audio/x-caf":"caf"};
  if(!type || !extensions[type] || !Buffer.isBuffer(req.body) || !req.body.length || req.body.length>50*1024*1024){
    res.status(400).json({error:"Choose a supported audio file up to 50 MB (M4A, MP3, WAV, WebM, OGG, AIFF or CAF)."});return;
  }
  const reservation=reserveTranscription(res.locals.transcriptionUserId as string);
  if(!reservation.allowed){
    res.setHeader("Retry-After",String(reservation.retryAfterSeconds));
    res.status(429).json({error:reservation.reason==="quota"?"Two transcription attempts are available every 24 hours. Your audio is still saved here.":"Transcription is busy. Your audio is still saved here; try again shortly."});
    return;
  }
  let dir:string|undefined;
  let transcribed=false; // true once the provider has returned a result; only then does the attempt count
  try{
    dir=await mkdtemp(join(tmpdir(),"study-lecture-"));
    const input=join(dir,`lecture.${extensions[type]}`);
    await writeFile(input,req.body);
    const duration=Number(await run("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",input]));
    if(!Number.isFinite(duration)||duration<=0||duration>7200){res.status(400).json({error:"Audio must be readable and no longer than two hours. Split a longer lecture before importing."});return}
    await run("ffmpeg",["-nostdin","-v","error","-i",input,"-vn","-ac","1","-ar","16000","-c:a","libmp3lame","-b:a","48k","-f","segment","-segment_time","300","-reset_timestamps","1",join(dir,"part-%03d.mp3")]);
    const files=(await readdir(dir)).filter(name=>/^part-\d{3}\.mp3$/.test(name)).sort();
    const segments:{start:number;end:number;text:string}[]=[];
    for(let i=0;i<files.length;i++){
      const file=await readFile(join(dir,files[i]));
      const result=await openai.audio.transcriptions.create({model:"gpt-4o-mini-transcribe",file:new File([file],files[i],{type:"audio/mpeg"})});
      transcribed=true;
      if(result.text.trim()) segments.push({start:i*300,end:Math.min(duration,(i+1)*300),text:result.text.trim()});
    }
    if(!segments.length)throw new Error("The audio contained no recognizable speech.");
    res.json({segments});
  }catch(error){
    req.log.error({error:message(error)},"Lecture transcription failed");
    res.status(502).json({error:"Transcription failed. Your audio remains in this browser; try again or download it."});
  }finally{
    if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});
    if(!transcribed)reservation.refund();
    reservation.release();
  }
});

router.post("/coach/plan", async (req, res): Promise<void> => {
  const parsed = GenerateExamPlanBody.safeParse(req.body);
  if (!parsed.success || parsed.data.materials.length > 65000 || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.data.examDate)) {
    res.status(400).json({ error: "Enter a valid exam date and keep study material under 65,000 characters." });
    return;
  }
  try {
    const data = parsed.data;
    const result = await completion(
      "exam_plan",
      examPlanPrompt.systemPrompt(new Date().toISOString().slice(0, 10)),
      JSON.stringify(data),
    );
    res.json(validate(GenerateExamPlanResponse, result));
  } catch (error) {
    req.log.error({ error: message(error) }, "Exam planning failed");
    res.status(502).json({ error: "Could not create an exam plan. Please try again." });
  }
});

export default router;