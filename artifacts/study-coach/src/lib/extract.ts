const LIMIT=12*1024*1024;
export const AI_TEXT_LIMIT=65000;
export const forAI=(text:string)=>text.slice(0,AI_TEXT_LIMIT);
function decodeXml(xml:string){const doc=new DOMParser().parseFromString(xml,'text/xml');return Array.from(doc.getElementsByTagName('a:t')).map(el=>el.textContent??'').join(' ')}
export async function extractFile(file:File):Promise<string>{
  if(file.size>LIMIT)throw new Error('File exceeds 12 MB. Try a smaller export or split the document.');
  const ext=file.name.split('.').pop()?.toLowerCase();
  let text='';
  try{
    if(ext==='txt'||ext==='md')text=await file.text();
    else if(ext==='pdf'){
      const pdfjs=await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
      const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
      const pages:string[]=[];for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();pages.push(content.items.map(item=>('str'in item?item.str:'')).join(' '))}text=pages.join('\n\n');
    }else if(ext==='docx'){
      const mammoth=await import('mammoth');text=(await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;
    }else if(ext==='pptx'){
      const JSZip=(await import('jszip')).default;const zip=await JSZip.loadAsync(await file.arrayBuffer());const slides=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>Number(a.match(/slide(\d+)/)?.[1])-Number(b.match(/slide(\d+)/)?.[1]));text=(await Promise.all(slides.map(async name=>decodeXml(await zip.files[name].async('string'))))).join('\n\n');
    }else if(['png','jpg','jpeg'].includes(ext??'')){
      const Tesseract=await import('tesseract.js');text=(await Tesseract.recognize(file,'eng')).data.text;
    }else throw new Error('Unsupported file. Choose PDF, DOCX, PPTX, TXT, MD, PNG, or JPG.');
  }catch(e){throw new Error(`Extraction failed for ${file.name}: ${e instanceof Error?e.message:String(e)}`)}
  if(!text.trim())throw new Error(`No readable text found in ${file.name}. For scanned PDFs, upload page screenshots for OCR, or add topics manually.`);
  return text.trim();
}