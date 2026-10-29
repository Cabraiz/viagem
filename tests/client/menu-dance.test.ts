import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {readFileSync} from 'node:fs';
import {menuDancePlan,danceFrameAt,danceCell,firstDancePage,playableFrame,MenuDance} from '../../src/client/ui/menu-dance.ts';
import {PERSONAGEM_PADRAO,PERSONAGENS_LIBERADOS} from '../../src/rules/index.ts';
import {STADIUM_TALL_QUERY} from '../../src/client/ui/stadium.ts';

const page={file:'aposentado-p1.webp',columns:5,rows:8,firstFrame:0,frameCount:40};
const second={...page,file:'aposentado-p2.webp',firstFrame:40};
const third={...page,file:'aposentado-p3.webp',firstFrame:80};
const fourth={file:'aposentado-p4.webp',columns:5,rows:2,firstFrame:120,frameCount:8};
const dance=(extra:Record<string,unknown>={})=>({cell:[768,512],frames:128,fps:128/36,loop:true,pages:[page,second,third,fourth],...extra});
function index(file:Record<string,unknown>,id='aposentado'){
  setArtIndex(parseArtIndex({version:2,groups:{menu:{output:'public/art/menu/danca',pieces:{[id]:{kind:'dance',files:{dance:file}}}}}}));
}
test('128-frame dance reads every 281.25-ms timestamp, crosses all four pages and loops at 36 seconds',()=>{
  index(dance());const plan=menuDancePlan('aposentado')!;
  assert.ok(plan);assert.equal(plan.frames,128);assert.equal(plan.fps,128/36);
  assert.equal(plan.pages[0].url,'/art/lite/menu/danca/aposentado-p1.webp');
  assert.deepEqual(Array.from({length:128},(_,frame)=>danceFrameAt(plan,frame*281.25)),Array.from({length:128},(_,frame)=>frame));
  assert.deepEqual([0,281.25,11249,11250,22499,22500,33749,33750,35999,36000].map(t=>danceFrameAt(plan,t)),[0,1,39,40,79,80,119,120,127,0]);
  assert.deepEqual(danceCell(plan,39),{pageIndex:0,x:3072,y:3584});
  assert.deepEqual(danceCell(plan,40),{pageIndex:1,x:0,y:0});
  assert.deepEqual(danceCell(plan,79),{pageIndex:1,x:3072,y:3584});
  assert.deepEqual(danceCell(plan,80),{pageIndex:2,x:0,y:0});
  assert.deepEqual(danceCell(plan,119),{pageIndex:2,x:3072,y:3584});
  assert.deepEqual(danceCell(plan,120),{pageIndex:3,x:0,y:0});
  assert.deepEqual(danceCell(plan,127),{pageIndex:3,x:1536,y:512});
  index(dance({fps:5}));assert.equal(danceFrameAt(menuDancePlan('aposentado')!,1000),5,'the client follows metadata rather than hardcoding the canonical fps');
  setArtIndex(parseArtIndex(undefined));
});
test('legacy 16-, 32- and 64-frame dances remain supported with their original timing',()=>{
  for(const frames of [16,32,64]){
    const fps=frames===64?64/12:10,frameMs=1000/fps;
    const pages=frames===64?[page,{...second,rows:5,frameCount:24}]:[{...page,rows:Math.ceil(frames/5),frameCount:frames}];
    index(dance({frames,fps,pages}));
    const legacy=menuDancePlan('aposentado')!;
    assert.deepEqual(Array.from({length:frames},(_,frame)=>danceFrameAt(legacy,frame*frameMs)),Array.from({length:frames},(_,frame)=>frame));
    assert.equal(danceFrameAt(legacy,frames*frameMs),0);
  }
  setArtIndex(parseArtIndex(undefined));
});
test('missing, malformed or GPU-oversized dance plans keep the portrait',()=>{
  setArtIndex(parseArtIndex(undefined));assert.equal(menuDancePlan('aposentado'),undefined);
  for(const patch of [{fps:0},{fps:NaN},{frames:63},{pages:[{...page,frameCount:39},second]},{pages:[{...page,columns:8},second]}]){
    index(dance(patch));assert.equal(menuDancePlan('aposentado'),undefined,JSON.stringify(patch));
  }
  setArtIndex(parseArtIndex(undefined));
});

test('selected dance animates, retries lossless on failure, cancels on selection changes and leaves portrait fallback',async()=>{
  const originals=new Map<string,PropertyDescriptor|undefined>();
  const replace=(key:string,value:unknown)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  const classes=new Set<string>(),draws:any[]=[],requests:string[]=[],frames=new Map<number,FrameRequestCallback>();let frameId=0;
  const host={classList:{add:(s:string)=>classes.add(s),remove:(s:string)=>classes.delete(s)},append:(c:any)=>{canvas=c;}};let canvas:any;
  const fakeCanvas=()=>({dataset:{},setAttribute(){},getContext:()=>({clearRect(){},drawImage:(...a:any[])=>draws.push(a)}),remove(){if(canvas===this)canvas=undefined;}});
  class FakeImage {
    naturalWidth=3840;src='';decoding='';fetchPriority='';
    get naturalHeight(){return this.src.includes('-p4')?1024:4096;}
    async decode(){requests.push(this.src);if(this.src.includes('/lite/')||this.src.includes('missing'))throw new Error('missing');}
  }
  replace('document',{hidden:false,addEventListener(){},removeEventListener(){},createElement:()=>fakeCanvas()});
  replace('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  replace('Image',FakeImage);replace('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++frameId,fn);return frameId;});
  replace('cancelAnimationFrame',(id:number)=>frames.delete(id));replace('IntersectionObserver',undefined);
  replace('performance',{now:()=>1000});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  try{
    index(dance());const consumer=new MenuDance(host as never,async()=>true);
    consumer.show('aposentado');assert.ok(classes.has('dance-pending'),'the still portrait is hidden from the selection on');
    await flush();
    assert.ok(classes.has('dancing'));assert.ok(!classes.has('dance-pending'));assert.equal(canvas.dataset.frame,'0');assert.equal(draws.length,1);
    assert.deepEqual(requests,[...['p1','p2','p3','p4'].map(p=>`/art/lite/menu/danca/aposentado-${p}.webp`),...['p1','p2','p3','p4'].map(p=>`/art/menu/danca/aposentado-${p}.webp`)]);
    const tickAt=(elapsed:number)=>{const tick=[...frames.values()][0];frames.clear();tick(1000+elapsed);};
    for(const [frame,page] of [[39,1],[40,2],[79,2],[80,3],[119,3],[120,4],[127,4],[128,1]]){
      tickAt(frame*281.25);assert.equal(canvas.dataset.frame,String(frame%128));assert.ok(draws.at(-1)[0].src.endsWith(`-p${page}.webp`));
    }
    consumer.show('mendigo');await flush();
    assert.equal(classes.has('dancing'),false);assert.equal(canvas,undefined);assert.equal(frames.size,0);
    assert.equal(classes.has('dance-pending'),false,'no dance for mendigo in this index: the portrait shows');
    // A later page lost in both copies: the dance stays, looping over the first page (no switch back to the portrait).
    index(dance({pages:[page,{...second,file:'missing-p2.webp'},third,fourth]}));consumer.show('aposentado');await flush();
    assert.ok(classes.has('dancing'));assert.ok(!classes.has('dance-pending'));
    tickAt(40*281.25);assert.equal(canvas.dataset.frame,'0','frame 40 is missing: back to the first page');
    tickAt(20*281.25);assert.equal(canvas.dataset.frame,'20');
    // The first page lost in both copies: the dance failed for good, the portrait shows.
    index(dance({pages:[{...page,file:'missing-p1.webp'},second,third,fourth]}));consumer.show('pedreiro');consumer.show('aposentado');await flush();
    assert.equal(classes.has('dancing'),false,'both failures of the first page preserve the existing portrait');
    assert.equal(classes.has('dance-pending'),false);
    consumer.destroy();
  }finally{
    setArtIndex(parseArtIndex(undefined));
    for(const [key,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  }
});

async function lifecycleFixture(fn:(env:any)=>Promise<void>){
  const originals=new Map<string,PropertyDescriptor|undefined>();
  const replace=(key:string,value:unknown)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  const classes=new Set<string>(),images:any[]=[],requests:string[]=[],frames=new Map<number,FrameRequestCallback>(),listeners=new Map<string,Set<unknown>>();
  const controls={defer:false},decodes:(()=>void)[]=[],gameObservers:any[]=[],intersections:any[]=[],body={},dialogs:{open:boolean}[]=[];let canvas:any,frameId=0;
  const host={classList:{add:(s:string)=>classes.add(s),remove:(s:string)=>classes.delete(s)},append:(value:any)=>{canvas=value;}};
  const makeCanvas=()=>({dataset:{},width:768,height:512,setAttribute(){},getContext:()=>({clearRect(){},drawImage(){}}),remove(){if(canvas===this)canvas=undefined;}});
  class FakeImage {
    src='';decoding='';fetchPriority='';naturalWidth=3840;get naturalHeight(){return this.src.includes('-p4')?1024:4096;}
    constructor(){images.push(this);}decode(){requests.push(this.src);return controls.defer?new Promise<void>(resolve=>decodes.push(resolve)):Promise.resolve();}
  }
  class GameObserver {
    fn:()=>void;targets=new Map<unknown,unknown>();constructor(fn:()=>void){this.fn=fn;gameObservers.push(this);}
    observe(target:unknown,options:unknown){this.targets.set(target,options);}disconnect(){this.targets.clear();}trigger(){this.fn();}
  }
  class VisibilityObserver {targets=new Set();constructor(){intersections.push(this);}observe(target:unknown){this.targets.add(target);}disconnect(){this.targets.clear();}}
  replace('document',{hidden:false,body,querySelectorAll:()=>dialogs,
    addEventListener:(type:string,fn:unknown)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(fn);},
    removeEventListener:(type:string,fn:unknown)=>listeners.get(type)?.delete(fn),createElement:makeCanvas});
  const reduced=new Set();replace('matchMedia',()=>({matches:false,addEventListener:(_type:string,fn:unknown)=>reduced.add(fn),removeEventListener:(_type:string,fn:unknown)=>reduced.delete(fn)}));
  replace('Image',FakeImage);replace('MutationObserver',GameObserver);replace('IntersectionObserver',VisibilityObserver);replace('performance',{now:()=>1000});
  replace('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++frameId,fn);return frameId;});replace('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  setArtIndex(parseArtIndex({version:2,groups:{menu:{output:'public/art/menu/danca',pieces:Object.fromEntries(['aposentado','pedreiro'].map(id=>[id,{kind:'dance',files:{dance:dance()}}]))}}}));
  const consumer=new MenuDance(host as never,async()=>true);
  try{await fn({consumer,images,requests,frames,classes,controls,decodes,dialogs,body,gameObservers,intersections,listeners,reduced,flush,canvas:()=>canvas});}
  finally{
    consumer.destroy();setArtIndex(parseArtIndex(undefined));
    for(const [key,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  }
}

test('game opening releases dance pages/RAF, stays blocked behind the dialog and resumes latest selection once',async()=>lifecycleFixture(async e=>{
  const {consumer,flush,images,frames,requests,gameObservers,dialogs,intersections,body}=e;
  consumer.show('aposentado');await flush();assert.equal(images.length,4);assert.equal(frames.size,1);
  const oldCanvas=e.canvas(),release=consumer.hold(),second=consumer.hold();assert.equal(e.canvas(),undefined);assert.equal(frames.size,0);
  assert.ok(images.every((image:any)=>image.src===''));assert.deepEqual([oldCanvas.width,oldCanvas.height],[0,0]);
  dialogs.push({open:true});gameObservers[0].trigger();consumer.show('pedreiro');release();release();second();await flush();
  assert.equal(images.length,4,'holds released while the game is open must not reload195MiB of pages');assert.equal(e.canvas(),undefined);
  assert.equal(gameObservers.length,1);assert.equal(intersections.length,1);assert.deepEqual(gameObservers[0].targets.get(body),{childList:true});
  assert.equal(gameObservers[0].targets.size,2,'only body and dialog.open are observed, not the HUD subtree');
  dialogs[0].open=false;gameObservers[0].trigger();await flush();assert.equal(images.length,8);assert.equal(e.canvas().dataset.danceOf,'pedreiro');assert.equal(frames.size,1);
  dialogs.length=0;gameObservers[0].trigger();await flush();assert.equal(requests.length,8,'close plus remove does not duplicate loading');
  const failedOpening=consumer.hold();assert.equal(frames.size,0);failedOpening();await flush();assert.equal(e.canvas().dataset.danceOf,'pedreiro');assert.equal(images.length,12,'failed opening returns to selected class');
  consumer.destroy();assert.equal(frames.size,0);assert.ok(images.every((image:any)=>image.src===''));assert.equal(gameObservers[0].targets.size,0);assert.equal(intersections[0].targets.size,0);
  assert.equal(e.listeners.get('visibilitychange').size,0);assert.equal(e.reduced.size,0);consumer.show('aposentado');await flush();assert.equal(images.length,12,'destroyed consumer cannot resurrect');
}));

test('blocking in-flight decodes cancels stale pages and cannot recreate the menu behind a game',async()=>lifecycleFixture(async e=>{
  e.controls.defer=true;e.consumer.show('aposentado');await e.flush();assert.equal(e.images.length,4);
  const stale=e.decodes.splice(0),release=e.consumer.hold();assert.ok(e.images.every((image:any)=>image.src===''));
  e.dialogs.push({open:true});e.gameObservers[0].trigger();release();for(const complete of stale)complete();await e.flush();
  assert.equal(e.canvas(),undefined);assert.equal(e.requests.length,4,'cancelled work cannot retry originals with a stale token');
  e.consumer.show('pedreiro');e.dialogs.length=0;e.gameObservers[0].trigger();await e.flush();
  const current=e.decodes.splice(0);for(const complete of current)complete();await e.flush();
  assert.equal(e.canvas().dataset.danceOf,'pedreiro');assert.equal(e.images.length,8);assert.equal(e.frames.size,1);
}));

test('danca-sem-fallback: playableFrame loops over the pages that arrived; the preload names the first page of the default hero',()=>{
  const plan={frames:128,fps:128/36,loop:true};
  assert.equal(playableFrame(plan,39*281.25,40),39);assert.equal(playableFrame(plan,40*281.25,40),0);assert.equal(playableFrame(plan,41*281.25,40),1);
  assert.equal(playableFrame(plan,100*281.25,128),100);assert.equal(playableFrame({...plan,loop:false},100*281.25,40),39);
  assert.equal(firstDancePage('aposentado'),'/art/lite/menu/danca/aposentado-p1.webp');
  index(dance());assert.equal(menuDancePlan('aposentado')!.pages[0].url,firstDancePage('aposentado'),'the preload and the dance ask for the same file');
  setArtIndex(parseArtIndex(undefined));
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8'),css=readFileSync(new URL('../../src/client/estadio.css',import.meta.url),'utf8');
  assert.match(html,new RegExp(`DEFAULT_HERO='${PERSONAGEM_PADRAO}'`),'index.html preloads the menu\'s default hero');
  assert.ok(html.includes(`OPEN=[${PERSONAGENS_LIBERADOS.map(id=>`'${id}'`).join(',')}]`),'index.html\'s preload list is the released one');
  // primeira-visita-leve: the phone held upright opens on the profile screen (insta.css hides the stadium and the dance),
  // so neither the upright stadium nor the 1.5 MB dance page is preloaded there.
  assert.ok(!html.includes('estadio-retrato-768'),'no preload of the stadium the profile screen hides');
  assert.match(css,/estadio-retrato-768\.webp/);
  assert.ok(html.includes(`matchMedia('${STADIUM_TALL_QUERY}').matches)return;`),'the dance preload skips the profile screen');
  assert.match(html,/'\/art\/lite\/menu\/danca\/'\+id\+'-p1\.webp'/);
  assert.match(main,/id="portrait" class="estadio-heroi dance-pending"/,'the first HTML already hides the still portrait');
  assert.match(css,/\.estadio-heroi\.dance-pending img \{ visibility: hidden; \}/);
});
