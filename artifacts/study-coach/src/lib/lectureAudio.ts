// Keep large recordings out of the study-state object. Each MediaRecorder slice is
// committed to IndexedDB independently so a suspended page can retain prior slices.
const DB = 'study-coach-lecture-audio-v1';
const STORE = 'chunks';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value:T)=>void, reject:(error:unknown)=>void)=>void):Promise<T> {
  return open().then(db => new Promise<T>((resolve,reject) => {
    const tx=db.transaction(STORE,mode);
    let result:T;
    run(tx.objectStore(STORE), value=>{result=value}, reject);
    tx.oncomplete=()=>{db.close();resolve(result)};
    tx.onerror=()=>{db.close();reject(tx.error)};
    tx.onabort=()=>{db.close();reject(tx.error)};
  }));
}
export function saveAudioChunk(id:string,index:number,blob:Blob):Promise<void> {
  return transaction<void>('readwrite',(store,_resolve,reject)=>{
    const request=store.put(blob,`${id}:${String(index).padStart(8,'0')}`);
    request.onerror=()=>reject(request.error);
  });
}
export function getAudio(id:string):Promise<Blob|null> {
  return transaction<Blob|null>('readonly',(store,resolve,reject)=>{
    const parts:Blob[]=[];
    const request=store.openCursor(IDBKeyRange.bound(`${id}:`,`${id}:\uffff`));
    request.onsuccess=()=>{const cursor=request.result;if(cursor){parts.push(cursor.value as Blob);cursor.continue()}else resolve(parts.length?new Blob(parts,{type:parts[0].type}):null)};
    request.onerror=()=>reject(request.error);
  });
}
export function deleteAudio(id:string):Promise<void> {
  return transaction<void>('readwrite',(store,_resolve,reject)=>{
    const request=store.openCursor(IDBKeyRange.bound(`${id}:`,`${id}:\uffff`));
    request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue()}};
    request.onerror=()=>reject(request.error);
  });
}
export function listAudio():Promise<{id:string;chunks:number}[]> {
  return transaction<{id:string;chunks:number}[]>('readonly',(store,resolve,reject)=>{
    const counts=new Map<string,number>();
    const request=store.openKeyCursor();
    request.onsuccess=()=>{const cursor=request.result;if(cursor){
      const id=String(cursor.key).split(':')[0];
      counts.set(id,(counts.get(id)??0)+1);cursor.continue();
    }else resolve([...counts].map(([id,chunks])=>({id,chunks})))};
    request.onerror=()=>reject(request.error);
  });
}