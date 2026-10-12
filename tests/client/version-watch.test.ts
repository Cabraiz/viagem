import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOCUS_CHECK_MS,MAX_AUTO_RELOADS,POLL_MS,POLL_OVERRIDE_KEY,RELOAD_GUARD_KEY,RELOAD_GUARD_MS,VERSION_URL,
  createVersionWatch,fetchBuildId,isChunkLoadError,startVersionWatch,
  type UpdateReason,type VersionWatchDeps,
} from '../../src/client/ui/version-watch.ts';

class MemoryStorage {
  map=new Map<string,string>();
  getItem(k:string){return this.map.get(k)??null;}
  setItem(k:string,v:string){this.map.set(k,v);}
  removeItem(k:string){this.map.delete(k);}
}

function rig(opts:{current?:string;remote?:string|undefined|Error;match?:boolean;storage?:MemoryStorage;t?:number}={}){
  const s={
    remote:'remote' in opts?opts.remote:opts.current??'aaa',
    match:opts.match??false,
    t:opts.t??1_000_000,
    reloads:0,before:0,
    available:[] as UpdateReason[],
    storage:opts.storage??new MemoryStorage(),
    fetches:0,
  };
  const deps:VersionWatchDeps={
    current:opts.current??'aaa',
    fetchVersion:async()=>{s.fetches++;if(s.remote instanceof Error)throw s.remote;return s.remote;},
    inMatch:()=>s.match,
    reload:()=>{s.reloads++;},
    storage:s.storage,
    now:()=>s.t,
    onAvailable:reason=>{s.available.push(reason);},
    beforeReload:()=>{s.before++;},
  };
  return {s,deps,watch:createVersionWatch(deps)};
}

const CHUNK_CHROME=new TypeError('Failed to fetch dynamically imported module: https://viagem.example/assets/lobby-AbC123.js');

test('constants match the spec',()=>{
  assert.equal(VERSION_URL,'/version.json');
  assert.equal(POLL_MS,60_000);
  assert.equal(RELOAD_GUARD_KEY,'viagem:version-reload');
  assert.equal(RELOAD_GUARD_MS,5*60_000);
  assert.equal(POLL_OVERRIDE_KEY,'viagem:version-poll-ms');
});

test('same build is a no-op',async()=>{
  const {s,watch}=rig();
  assert.equal(await watch.check(),false);
  assert.equal(s.reloads,0);assert.deepEqual(s.available,[]);assert.equal(watch.pending,undefined);
  assert.equal(s.storage.getItem(RELOAD_GUARD_KEY),null);
});

test('a new build in the menu reloads once, after beforeReload, and writes the guard',async()=>{
  const {s,watch}=rig({remote:'bbb'});
  assert.equal(await watch.check(),true);
  assert.equal(s.reloads,1);assert.equal(s.before,1);assert.deepEqual(s.available,[]);
  assert.deepEqual(JSON.parse(s.storage.getItem(RELOAD_GUARD_KEY)!),{targets:{bbb:s.t}});
  // Idempotent: more detections while the reload is underway do nothing.
  assert.equal(await watch.check(),true);
  assert.equal(watch.chunkFailed(CHUNK_CHROME),true);
  assert.equal(s.reloads,1);assert.deepEqual(s.available,[]);
});

test('after the reload, a second detection of the same target does not reload again: it shows the update UI',async()=>{
  const storage=new MemoryStorage();
  const first=rig({remote:'bbb',storage});
  await first.watch.check();
  assert.equal(first.s.reloads,1);
  // The reload served the stale page (old build again) and it sees the same new build 30 s later.
  const second=rig({remote:'bbb',storage,t:first.s.t+30_000});
  assert.equal(await second.watch.check(),true);
  assert.equal(second.s.reloads,0);
  assert.deepEqual(second.s.available,['version']);
  assert.equal(second.watch.pending,'version');
  await second.watch.check();second.watch.matchEnded();
  assert.equal(second.s.reloads,0);assert.deepEqual(second.s.available,['version'],'onAvailable once');
  // The tap still reloads.
  second.watch.update();
  assert.equal(second.s.reloads,1);assert.equal(second.s.before,1);
});

test('the guard expires: after RELOAD_GUARD_MS the same target reloads again; another target is never blocked',async()=>{
  const storage=new MemoryStorage();
  storage.setItem(RELOAD_GUARD_KEY,JSON.stringify({target:'bbb',at:1_000_000}));
  const late=rig({remote:'bbb',storage,t:1_000_000+RELOAD_GUARD_MS});
  await late.watch.check();
  assert.equal(late.s.reloads,1);
  storage.setItem(RELOAD_GUARD_KEY,JSON.stringify({target:'bbb',at:1_000_000}));
  const other=rig({remote:'ccc',storage,t:1_000_001});
  await other.watch.check();
  assert.equal(other.s.reloads,1);
  // A corrupt guard is ignored.
  storage.setItem(RELOAD_GUARD_KEY,'{nope');
  const corrupt=rig({remote:'bbb',storage});
  await corrupt.watch.check();
  assert.equal(corrupt.s.reloads,1);
});

test('in a match it never reloads: onAvailable once, then matchEnded() reloads',async()=>{
  const {s,watch}=rig({remote:'bbb',match:true});
  assert.equal(await watch.check(),true);
  assert.equal(watch.chunkFailed(CHUNK_CHROME),true);
  assert.equal(await watch.check(),true);
  assert.equal(s.reloads,0);assert.equal(s.before,0);
  assert.deepEqual(s.available,['version']);
  assert.equal(watch.pending,'version');
  s.match=false;
  watch.matchEnded();
  assert.equal(s.reloads,1);assert.equal(s.before,1);
  assert.equal(JSON.parse(s.storage.getItem(RELOAD_GUARD_KEY)!).targets['chunk:aaa'],s.t,'the last detected target is guarded');
  watch.matchEnded();
  assert.equal(s.reloads,1,'matchEnded twice reloads once');
});

test('matchEnded without a pending update does nothing',()=>{
  const {s,watch}=rig();
  watch.matchEnded();
  assert.equal(s.reloads,0);
});

test('a chunk error in a match waits; in the menu it reloads with target chunk:<current>',()=>{
  const inMatch=rig({match:true});
  assert.equal(inMatch.watch.chunkFailed(CHUNK_CHROME),true);
  assert.equal(inMatch.s.reloads,0);assert.deepEqual(inMatch.s.available,['chunk']);
  assert.equal(inMatch.watch.pending,'chunk');
  const menu=rig();
  assert.equal(menu.watch.chunkFailed(CHUNK_CHROME),true);
  assert.equal(menu.s.reloads,1);
  assert.deepEqual(JSON.parse(menu.s.storage.getItem(RELOAD_GUARD_KEY)!),{targets:{'chunk:aaa':menu.s.t}});
  // Same stale chunk right after the reload (cached index.html): no loop, tap-to-update instead.
  const again=rig({storage:menu.s.storage,t:menu.s.t+5_000});
  assert.equal(again.watch.chunkFailed(CHUNK_CHROME),true);
  assert.equal(again.s.reloads,0);assert.deepEqual(again.s.available,['chunk']);
});

test('a non-chunk error is not handled (callers keep their own message)',()=>{
  const {s,watch}=rig();
  assert.equal(watch.chunkFailed(new TypeError("Cannot read properties of undefined (reading 'openLobby')")),false);
  assert.equal(s.reloads,0);assert.deepEqual(s.available,[]);assert.equal(watch.pending,undefined);
});

test('isChunkLoadError table',()=>{
  const yes:unknown[]=[
    CHUNK_CHROME,
    new TypeError('error loading dynamically imported module: https://viagem.example/assets/explore-x.js'),
    new TypeError('Importing a module script failed.'),
    new Error('Unable to preload CSS for /assets/lobby-AbC.css'),
    new TypeError('Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".'),
    new TypeError('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'),
    'Failed to fetch dynamically imported module: /assets/a.js',
    {message:'Importing a module script failed.'},
  ];
  const no:unknown[]=[
    new TypeError('Failed to fetch'),
    new Error('boom'),
    new TypeError("Cannot read properties of undefined (reading 'x')"),
    new SyntaxError('Unexpected token <'),
    new RangeError('Maximum call stack size exceeded'),
    undefined,null,0,42,true,'',{},[],{message:42},Symbol('x'),()=>{},
    {get message(){throw new Error('trap');}},
  ];
  yes.forEach((e,i)=>assert.equal(isChunkLoadError(e),true,`yes[${i}]`));
  no.forEach((e,i)=>assert.equal(isChunkLoadError(e),false,`no[${i}]`));
});

test('fetch failures are ignored: undefined, a throw, empty string',async()=>{
  for(const remote of [undefined,new Error('offline'),'']){
    const {s,watch}=rig({remote});
    assert.equal(await watch.check(),false);
    assert.equal(s.reloads,0);assert.deepEqual(s.available,[]);assert.equal(watch.pending,undefined);
  }
});

test('update() always reloads, even with nothing pending and with the guard set',()=>{
  const storage=new MemoryStorage();
  storage.setItem(RELOAD_GUARD_KEY,JSON.stringify({target:'chunk:aaa',at:1_000_000}));
  const {s,watch}=rig({storage});
  watch.update();watch.update();
  assert.equal(s.reloads,2);assert.equal(s.before,2);
});

test('beforeReload throwing does not stop the reload',async()=>{
  const {s,deps}=rig({remote:'bbb'});
  const watch=createVersionWatch({...deps,beforeReload:()=>{throw new Error('quota');}});
  await watch.check();
  assert.equal(s.reloads,1);
});

test('concurrent checks share one fetch',async()=>{
  const {s,watch}=rig({remote:'bbb',match:true});
  const [a,b]=await Promise.all([watch.check(),watch.check()]);
  assert.equal(a,true);assert.equal(b,true);
  assert.equal(s.fetches,1);assert.deepEqual(s.available,['version']);
});

test('fetchBuildId: no-store with a ?t= buster; undefined on 404, garbage, throw',async()=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const ok=(body:unknown,status=200)=>async(url:string,init:RequestInit)=>{calls.push({url,init});return new Response(typeof body==='string'?body:JSON.stringify(body),{status});};
  assert.equal(await fetchBuildId(ok({build:'bbb'}),()=>123),'bbb');
  assert.equal(calls[0].url,'/version.json?t=123');
  assert.equal(calls[0].init.cache,'no-store');
  assert.equal(await fetchBuildId(ok({build:'bbb'},404)),undefined);
  assert.equal(await fetchBuildId(ok('<html>not found</html>')),undefined);
  assert.equal(await fetchBuildId(ok({build:7})),undefined);
  assert.equal(await fetchBuildId(ok(null)),undefined);
  assert.equal(await fetchBuildId(async()=>{throw new TypeError('Failed to fetch');}),undefined);
});

function fakeWindow(opts:{visibility?:string;local?:MemoryStorage;session?:MemoryStorage}={}){
  const listeners=new Map<string,Set<(e:Event)=>void>>();
  const docListeners=new Map<string,Set<(e:Event)=>void>>();
  const add=(m:typeof listeners)=>(t:string,f:(e:Event)=>void)=>{if(!m.has(t))m.set(t,new Set());m.get(t)!.add(f);};
  const remove=(m:typeof listeners)=>(t:string,f:(e:Event)=>void)=>{m.get(t)?.delete(f);};
  const timers=new Map<number,{fn:()=>void;ms:number}>();
  let nextId=1;
  const doc={visibilityState:opts.visibility??'visible',addEventListener:add(docListeners),removeEventListener:remove(docListeners)};
  const win={
    addEventListener:add(listeners),removeEventListener:remove(listeners),
    setInterval:(fn:()=>void,ms:number)=>{const id=nextId++;timers.set(id,{fn,ms});return id;},
    clearInterval:(id:number|undefined)=>{if(id!==undefined)timers.delete(id);},
    document:doc,
    localStorage:opts.local,sessionStorage:opts.session,
  };
  const fire=(m:typeof listeners,type:string,event:Event)=>{for(const f of m.get(type)??[])f(event);};
  return {
    win,doc,timers,
    fireWin:(type:string,payload?:unknown)=>{const e=Object.assign(new Event(type,{cancelable:true}),{payload});fire(listeners,type,e);return e;},
    fireDoc:(type:string)=>fire(docListeners,type,new Event(type)),
    tick:()=>{for(const t of timers.values())t.fn();},
    count:()=>[...listeners.values(),...docListeners.values()].reduce((n,set)=>n+set.size,0),
  };
}
const flush=()=>new Promise(r=>setImmediate(r));

test('startVersionWatch polls while visible, checks on visibility and focus, and stop() unwires everything',async()=>{
  const {s,deps}=rig({remote:'aaa'});
  const w=fakeWindow();
  const watch=startVersionWatch({...deps,win:w.win});
  assert.equal(w.timers.size,1);
  assert.equal([...w.timers.values()][0].ms,POLL_MS);
  w.tick();await flush();
  assert.equal(s.fetches,1);
  w.doc.visibilityState='hidden';
  w.tick();w.fireDoc('visibilitychange');await flush();
  assert.equal(s.fetches,1,'no polling while hidden');
  w.doc.visibilityState='visible';
  w.fireDoc('visibilitychange');await flush();
  assert.equal(s.fetches,2);
  w.fireWin('focus');await flush();
  assert.equal(s.fetches,2,'focus right after a check is throttled');
  s.t+=FOCUS_CHECK_MS;
  w.fireWin('focus');await flush();
  assert.equal(s.fetches,3);
  w.fireWin('online');await flush();
  assert.equal(s.fetches,4,'back online: check at once');
  s.remote='bbb';s.match=true;
  w.tick();await flush();
  assert.deepEqual(s.available,['version']);assert.equal(watch.pending,'version');
  s.match=false;watch.matchEnded();
  assert.equal(s.reloads,1);
  watch.stop();
  assert.equal(w.timers.size,0);assert.equal(w.count(),0);
});

test('vite:preloadError with a chunk payload is handled and NOT preventDefault-ed (the import must still reject)',()=>{
  const {s,deps}=rig({match:true});
  const w=fakeWindow();
  const watch=startVersionWatch({...deps,win:w.win});
  const ev=w.fireWin('vite:preloadError',CHUNK_CHROME);
  assert.equal(ev.defaultPrevented,false);
  assert.deepEqual(s.available,['chunk']);
  // The caller's catch then asks again: true, no second toast.
  assert.equal(watch.chunkFailed(CHUNK_CHROME),true);
  assert.deepEqual(s.available,['chunk']);
  w.fireWin('vite:preloadError',new Error('boom'));
  assert.deepEqual(s.available,['chunk']);
  watch.stop();
});

test('startVersionWatch is inert for dev builds, unless the poll override is set',async()=>{
  const {s,deps}=rig({current:'dev-abc',remote:'bbb'});
  const w=fakeWindow();
  const off=startVersionWatch({...deps,win:w.win});
  assert.equal(w.timers.size,0);assert.equal(w.count(),0);
  assert.equal(await off.check(),false);
  assert.equal(off.chunkFailed(CHUNK_CHROME),false,'dev import errors are real errors: keep the message');
  assert.equal(s.fetches,0);assert.equal(s.reloads,0);
  off.update();
  assert.equal(s.reloads,1,'the tap still reloads');
  off.stop();

  for(const where of ['session','local'] as const){
    const store=new MemoryStorage();store.setItem(POLL_OVERRIDE_KEY,'500');
    const r=rig({current:'dev-abc',remote:'dev-def'});
    const fw=fakeWindow(where==='local'?{local:store}:{});
    const on=startVersionWatch({...r.deps,storage:where==='session'?store:r.deps.storage,win:fw.win});
    assert.equal([...fw.timers.values()][0]?.ms,500,where);
    fw.tick();await flush();
    assert.equal(r.s.reloads,1,where);
    on.stop();
  }
});

test('startVersionWatch defaults the guard storage to win.sessionStorage',async()=>{
  const session=new MemoryStorage();
  const {s,deps}=rig({remote:'bbb'});
  const w=fakeWindow({session});
  const watch=startVersionWatch({...deps,storage:undefined,win:w.win});
  await watch.check();
  assert.equal(s.reloads,1);
  assert.ok(typeof JSON.parse(session.getItem(RELOAD_GUARD_KEY)!).targets.bbb==='number');
  watch.stop();
});

test('a version flipping back and forth reloads each target once and at most MAX_AUTO_RELOADS times per window (e2e oscillation)',async()=>{
  const storage=new MemoryStorage();
  // Each page load is a fresh watch on the same tab storage, like a real reload.
  const load=async(current:string,remote:string,t:number)=>{const r=rig({current,remote,storage,t});await r.watch.check();return r.s;};
  const first=await load('aaa','bbb',1_000_000);
  assert.equal(first.reloads,1,'first new version: one automatic reload');
  const second=await load('bbb','aaa',1_000_700);
  assert.equal(second.reloads,1,'rollback to another target: still allowed (cap not reached)');
  for(let i=0;i<20;i++){
    const [current,remote]=i%2?['aaa','bbb']:['bbb','aaa'];
    const s=await load(current,remote,1_001_400+i*700);
    assert.equal(s.reloads,0,`flip ${i}: no more automatic reloads within the window`);
    assert.equal(s.available.length,1,'the toast asks for the tap instead');
  }
  assert.equal(MAX_AUTO_RELOADS,2);
  // After the window, a new deploy reloads by itself again.
  const later=await load('aaa','ccc',1_000_000+RELOAD_GUARD_MS+1);
  assert.equal(later.reloads,1);
});

test('the guard reads the older single-target format',async()=>{
  const storage=new MemoryStorage();
  storage.setItem(RELOAD_GUARD_KEY,JSON.stringify({target:'bbb',at:1_000_000}));
  const {s,watch}=rig({remote:'bbb',storage,t:1_000_500});
  await watch.check();
  assert.equal(s.reloads,0);assert.deepEqual(s.available,['version']);
});

test('offline, a failed import is the network: no reload, the caller keeps its own message; online again re-checks',()=>{
  let online=false;
  const {s,deps}=rig();
  const watch=createVersionWatch({...deps,online:()=>online});
  const err=new TypeError('Failed to fetch dynamically imported module: https://x/assets/lobby-abc.js');
  assert.equal(watch.chunkFailed(err),false,'offline: not handled as a deploy');
  assert.equal(s.reloads,0);assert.deepEqual(s.available,[]);assert.equal(watch.reloading,false);
  online=true;
  assert.equal(watch.chunkFailed(err),true);
  assert.equal(s.reloads,1);assert.equal(watch.reloading,true);
});

test('startVersionWatch reads navigator.onLine and falls back to localStorage for the guard',()=>{
  const {s,deps}=rig();
  const w=fakeWindow();
  const local=new MemoryStorage();
  const win={...w.win,navigator:{onLine:false},get sessionStorage():Storage{throw new Error('blocked');},localStorage:local as unknown as Storage};
  const watch=startVersionWatch({...deps,storage:undefined,win:win as any});
  assert.equal(watch.chunkFailed(new TypeError('Failed to fetch dynamically imported module')),false,'offline');
  (win as any).navigator={onLine:true};
  assert.equal(watch.chunkFailed(new TypeError('Failed to fetch dynamically imported module')),true);
  assert.ok(local.getItem(RELOAD_GUARD_KEY),'guard written to localStorage');
  assert.equal(s.reloads,1);
  watch.stop();
});
