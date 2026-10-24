// BUG-20261024-ORQ-arrastar-atualiza-versao-nova: the "versão nova" message never leaves the player stuck (the page
// asks the site's build every RETRY_S s and reloads once it changed), the menus' own pull-to-refresh (pullStep), and
// the service worker loading pages with no-cache (Pages' max-age=600 brought the old build back).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RETRY_S,UPDATE_TEXT,isNewBuild,retryLine,startUpdateRetry,type RetryState} from '../../src/client/ui/update-retry.ts';
import {PULL_RELOAD_PX,PULL_SHOW_PX,PULL_MAX_PX,PULL_SKIP,atTop,pullOffset,pullStep} from '../../src/client/ui/pull-refresh.ts';
import {UPDATE_NEEDED,needsUpdate} from '../../src/protocol/index.ts';

/** A fake clock: timers run when `advance` passes them. */
function clock(){
  let now=0,seq=0;const timers=new Map<number,{at:number;run:()=>void}>();
  return {
    setTimeout:(run:()=>void,ms:number)=>{const id=++seq;timers.set(id,{at:now+ms,run});return id;},
    clearTimeout:(id:unknown)=>{timers.delete(id as number);},
    async advance(ms:number){
      const end=now+ms;
      for(;;){
        const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;
        timers.delete(next[0]);now=next[1].at;next[1].run();
        await new Promise(r=>setImmediate(r));
      }
      now=end;
    },
    get pending(){return timers.size;},
  };
}
const flush=()=>new Promise(r=>setImmediate(r));

test('retry: the site still on this build → countdown from RETRY_S, then asks again; a new build → reloads once',async()=>{
  const c=clock(),shown:RetryState[]=[];let site='old',reloads=0,asks=0;
  const retry=startUpdateRetry({current:'old',fetchVersion:async()=>{asks++;return site;},reload:()=>{reloads++;},show:s=>shown.push(s),setTimeout:c.setTimeout,clearTimeout:c.clearTimeout});
  await flush();
  assert.equal(asks,1);
  assert.deepEqual(shown.slice(0,2),[{kind:'checking'},{kind:'waiting',seconds:RETRY_S}]);
  await c.advance(3000);
  assert.deepEqual(shown.at(-1),{kind:'waiting',seconds:RETRY_S-3});
  await c.advance((RETRY_S-3)*1000);
  assert.equal(asks,2,'asked again after the countdown');
  assert.equal(reloads,0);
  site='new';
  await c.advance(RETRY_S*1000);
  assert.equal(asks,3);
  assert.equal(reloads,1);
  assert.deepEqual(shown.at(-1),{kind:'reloading'});
  assert.ok(retry.stopped);
  await c.advance(60_000);
  assert.equal(asks,3,'nothing after the reload');
});

test('retry: a failed ask is not a new build (counts down again); stop() ends the asks',async()=>{
  const c=clock();let asks=0,reloads=0;
  const retry=startUpdateRetry({current:'b1',fetchVersion:async()=>{asks++;return undefined;},reload:()=>{reloads++;},show:()=>{},setTimeout:c.setTimeout,clearTimeout:c.clearTimeout});
  await flush();await c.advance(RETRY_S*1000);
  assert.equal(asks,2);assert.equal(reloads,0);
  retry.stop();
  assert.equal(c.pending,0);
  await c.advance(5*RETRY_S*1000);
  assert.equal(asks,2);
  assert.ok(!isNewBuild(undefined,'b1')&&!isNewBuild('','b1')&&!isNewBuild('b1','b1')&&isNewBuild('b2','b1'));
});

test('retry: the lines are short and no longer say "espera 1 minuto"; the room\'s message still counts as an update',()=>{
  assert.equal(retryLine({kind:'waiting',seconds:7}),'A versão nova ainda está saindo do forno. Tento de novo em 7 s.');
  assert.equal(retryLine({kind:'checking'}),UPDATE_TEXT.checking);
  assert.equal(retryLine({kind:'reloading'}),UPDATE_TEXT.reloading);
  for(const line of [UPDATE_TEXT.title,UPDATE_TEXT.checking,UPDATE_TEXT.reloading,UPDATE_TEXT.waiting(10)])assert.doesNotMatch(line,/minuto/);
  assert.ok(needsUpdate(UPDATE_NEEDED));
});

test('pull: down and vertical pulls; past PULL_RELOAD_PX it is ready; up or sideways cancels for the touch',()=>{
  assert.deepEqual(pullStep(100,100,102,105),{kind:'idle'});
  assert.deepEqual(pullStep(100,100,105,100+PULL_SHOW_PX+10),{kind:'pulling',dy:PULL_SHOW_PX+10,ready:false});
  assert.deepEqual(pullStep(100,100,110,100+PULL_RELOAD_PX),{kind:'pulling',dy:PULL_RELOAD_PX,ready:true});
  assert.deepEqual(pullStep(100,100,100,60),{kind:'cancelled'},'up: the finger scrolls');
  assert.deepEqual(pullStep(100,100,180,130),{kind:'cancelled'},'sideways: the hero carousel');
  assert.equal(pullOffset(0),0);assert.equal(pullOffset(1000),PULL_MAX_PX);
});

test('pull: starts only where nothing above the finger is scrolled; never on the canvas, joystick or fields',()=>{
  const root={scrollTop:0,parentElement:null},list={scrollTop:0,parentElement:root},item={scrollTop:0,parentElement:list};
  assert.ok(atTop(item,{scrollingElement:{scrollTop:0}}));
  assert.ok(!atTop(item,{scrollingElement:{scrollTop:5}}));
  assert.ok(!atTop({scrollTop:0,parentElement:{scrollTop:40,parentElement:root}},{scrollingElement:{scrollTop:0}}));
  for(const sel of ['canvas','input','.explore-stick','.explore-canvas','[data-sem-puxar]'])assert.ok(PULL_SKIP.split(',').includes(sel),sel);
});

interface Sw {navigateFresh(r:{method:string;url:string},origin:string):boolean}
function loadSw():{sw:Sw;fetch?:(e:unknown)=>void}{
  const handlers:Record<string,(e:unknown)=>void>={};
  const self:Record<string,unknown>={addEventListener:(name:string,h:(e:unknown)=>void)=>{handlers[name]=h;},location:{origin:'https://viagem.cyou'}};
  new Function('self',readFileSync('public/sw.js','utf8'))(self);
  return {sw:self.__viagemSw as Sw,fetch:handlers.fetch};
}

test('service worker: same-origin page loads go to the network with no-cache; others are left alone',()=>{
  const {sw,fetch:onFetch}=loadSw();
  assert.ok(sw.navigateFresh({method:'GET',url:'https://viagem.cyou/?room=ABCDEF0123'},'https://viagem.cyou'));
  assert.ok(!sw.navigateFresh({method:'POST',url:'https://viagem.cyou/'},'https://viagem.cyou'));
  assert.ok(!sw.navigateFresh({method:'GET',url:'https://outro.site/'},'https://viagem.cyou'));
  // The handler answers a navigation with a no-cache request (the Request/fetch globals are stubbed here).
  const g=globalThis as Record<string,unknown>,saved={Request:g.Request,fetch:g.fetch};
  const seen:{cache?:string}[]=[];
  g.Request=class{cache:string;constructor(_r:unknown,init:{cache:string}){this.cache=init.cache;}};
  g.fetch=(r:{cache?:string})=>{seen.push(r);return Promise.resolve('ok');};
  try{
    let responded:unknown;
    const page=['https:','','viagem.cyou',''].join('/');
    onFetch!({request:{mode:'navigate',method:'GET',url:page,headers:{has:()=>false}},waitUntil:()=>{},respondWith:(p:unknown)=>{responded=p;}});
    assert.ok(responded,'answered');
    assert.equal(seen[0]?.cache,'no-cache');
  }finally{g.Request=saved.Request;g.fetch=saved.fetch;}
});
