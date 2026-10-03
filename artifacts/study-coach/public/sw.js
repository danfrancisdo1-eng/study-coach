const CACHE='study-coach-shell-v2';
const scope=self.registration.scope;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([scope,scope+'manifest.webmanifest',scope+'icon.svg'])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()]))});
self.addEventListener('fetch',event=>{
  const req=event.request;const url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.includes('/api/'))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(scope,copy));return response}).catch(()=>caches.match(scope)));
    return;
  }
  event.respondWith(fetch(req).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy))}return response}).catch(()=>caches.match(req)));
});