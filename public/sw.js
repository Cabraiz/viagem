/*
 * Art cache (NEW-20261013-ORQ-3g-precarga-partida): cache-first for /art/**, the hashed /assets/** and /audio/**
 * (the boss music, fetched whole by src/client/audio/music.ts: the element's own Range requests skip the worker), each file
 * versioned by the short hash of its content in /art-versions.json (written at build time, vite.config.ts), so a new
 * deploy re-downloads only what changed and a second match downloads no art. Registered by src/main.ts in production
 * builds only. Non-GET, Range, cross-origin and anything else (pages, /multiplayer.json, /version.json, the rooms'
 * API) go straight to the network; error and opaque responses are never stored.
 * Plain script, no dependencies; the pure part (route, fresh) is also exposed on self.__viagemSw for node tests.
 */
const CACHE='viagem-art-v1';
const VERSIONS_URL='/art-versions.json';
const VERSION_HEADER='x-viagem-version';
/** How long a known versions file is trusted before it is asked again (a page load asks at once). */
const VERSIONS_TTL_MS=60000;

/**
 * 'cache' (cache-first, versioned) or 'network' (not touched) for a request seen by the worker.
 * @param {{method:string,url:string,range?:boolean}} request
 * @param {string} origin the worker's origin
 */
function route(request,origin){
  if(request.method!=='GET'||request.range)return 'network';
  let url;try{url=new URL(request.url);}catch{return 'network';}
  if(url.origin!==origin||url.search)return 'network';
  const path=url.pathname;
  return path.startsWith('/art/')||path.startsWith('/assets/')||path.startsWith('/audio/')?'cache':'network';
}
/**
 * Whether a stored copy may be served: its version equals the current one; a path missing from the versions file
 * (or no versions file at all) serves a stored /assets/ copy (content-hashed names) and refreshes an /art/ one.
 * @param {string} path @param {string|null} stored @param {Record<string,string>|undefined} versions
 */
function fresh(path,stored,versions){
  if(stored===null)return false;
  const current=versions&&versions[path];
  if(current)return stored===current;
  return path.startsWith('/assets/');
}
/** A response worth storing: same-origin, complete, 200. */
const storable=response=>!!response&&response.type==='basic'&&response.status===200;

/**
 * Whether a page load goes through the worker with cache:'no-cache': a same-origin GET navigation; anything else
 * (another origin, a form POST) is left to the browser.
 * @param {{method:string,url:string}} request @param {string} origin
 */
function navigateFresh(request,origin){
  if(request.method!=='GET')return false;
  try{return new URL(request.url).origin===origin;}catch{return false;}
}

self.__viagemSw={route,fresh,storable,navigateFresh,CACHE,VERSIONS_URL,VERSION_HEADER};

let versions,versionsText='',versionsAt=0,versionsAsk;
/** The versions file, network first (bounded), then the last copy kept in the cache. */
function loadVersions(force){
  if(versionsAsk)return versionsAsk;
  if(!force&&versions&&Date.now()-versionsAt<VERSIONS_TTL_MS)return Promise.resolve(versions);
  versionsAsk=(async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(VERSIONS_URL,{cache:'no-store',signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw new Error(String(response.status));
      const text=await response.clone().text(),next=JSON.parse(text);
      if(next&&typeof next==='object'){
        versionsAt=Date.now();
        // A new deploy (or the first look): files it no longer lists are dropped from the cache.
        if(text!==versionsText){versions=next;versionsText=text;await cache.put(VERSIONS_URL,response);await prune(cache,next).catch(()=>undefined);}
      }
    }catch{
      if(!versions){const kept=await cache.match(VERSIONS_URL);if(kept)try{versions=await kept.json();}catch{/* keep none */}}
    }
    return versions;
  })().finally(()=>{versionsAsk=undefined;});
  return versionsAsk;
}
/** Downloads of the same file at once (the room's pre-download and Phaser's) share one network fetch. */
const inflight=new Map();
function download(request,path,version){
  // Music (/audio/): low priority and the page's own signal, so a download the page aborts (the menu music yielding to
  // the match's pre-download, src/client/audio/menu-music.ts) stops here too; never shared, so an aborted one cannot
  // fail a later ask.
  const music=path.startsWith('/audio/');
  let job=music?undefined:inflight.get(path);
  if(!job){
    job=(async()=>{
      // no-cache: a version change must not be filled from the HTTP cache (max-age=600) with the previous file (BUG-20261014-ORQ-mapa-cache-velho).
      // Music (musica-do-menu): low priority and the page's abort signal, so the menu track yields to the match preload.
      const response=music
        ?await fetch(request.url,{credentials:'same-origin',cache:'no-cache',priority:'low',signal:request.signal})
        :await fetch(request.url,{credentials:'same-origin',cache:'no-cache'});
      if(!storable(response))return {response};
      const body=await response.blob(),headers=new Headers(response.headers);
      if(version)headers.set(VERSION_HEADER,version);else headers.set(VERSION_HEADER,'-');
      const init={status:response.status,statusText:response.statusText,headers};
      try{await (await caches.open(CACHE)).put(path,new Response(body,init));}catch{/* quota: served, not kept */}
      return {body,init};
    })();
    if(!music){job=job.finally(()=>inflight.delete(path));inflight.set(path,job);}
  }
  return job.then(r=>r.response?r.response.clone():new Response(r.body,r.init));
}
async function serve(request){
  const path=new URL(request.url).pathname;
  const [cache,known]=await Promise.all([caches.open(CACHE),loadVersions(false).catch(()=>undefined)]);
  const stored=await cache.match(path);
  if(stored&&fresh(path,stored.headers.get(VERSION_HEADER),known))return stored;
  try{return await download(request,path,known&&known[path]);}
  catch(error){if(stored)return stored;throw error;}
}
/** Drops stored files the current versions file no longer lists (old deploys' art and chunks). */
async function prune(cache,known){
  for(const request of await cache.keys()){
    const path=new URL(request.url).pathname;
    if(path!==VERSIONS_URL&&!known[path])await cache.delete(request);
  }
}

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const name of await caches.keys())if(name.startsWith('viagem-art-')&&name!==CACHE)await caches.delete(name);
    await loadVersions(true).catch(()=>undefined);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  // A page load: the deploy may have changed, so the versions file is asked again (not awaited here), and the page
  // itself skips the HTTP cache (BUG-20261024-ORQ-arrastar-atualiza-versao-nova): Pages serves it with max-age=600, so
  // reopening the game (or the installed app) within 10 min of a deploy came back to the old build, which the rooms
  // refuse. no-cache revalidates (304 when nothing changed); offline, the plain request decides.
  if(request.mode==='navigate'){
    event.waitUntil(loadVersions(true).catch(()=>undefined));
    if(navigateFresh(request,self.location.origin))event.respondWith(fetch(new Request(request,{cache:'no-cache'})).catch(()=>fetch(request)));
    return;
  }
  if(route({method:request.method,url:request.url,range:request.headers.has('range')},self.location.origin)!=='cache')return;
  event.respondWith(serve(request));
});
