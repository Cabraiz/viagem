// menu-imagens-sem-buraco: the popup's pictures come down in the menu's idle time, so BORA! opens it whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chosenArtUrl,createMenuArtPreload,popupArtUrls,POPUP_FIXOS,type MenuArtEnv} from '../../src/client/preload/menu-art-preload.ts';

function fake(over:Partial<MenuArtEnv>={}){
  const loads:{url:string;priority:string}[]=[],idles:(()=>void)[]=[],frees:(()=>void)[]=[];
  let held=false,previasAsked=0;
  const env:MenuArtEnv={saveData:()=>false,held:()=>held,deitado:()=>false,dpr:()=>1,
    onFree:fn=>{frees.push(fn);return ()=>{const i=frees.indexOf(fn);if(i>=0)frees.splice(i,1);};},
    idle:fn=>{idles.push(fn);},
    load:(url,priority)=>{loads.push({url,priority});return Promise.resolve();},
    previas:()=>{previasAsked++;return Promise.resolve({'/art/menu/escolha/maromba-amigos.webp':'data:image/webp;base64,AA'});},
    ...over};
  return {env,loads,idles,frees,setHeld:(v:boolean)=>{held=v;},previasAsked:()=>previasAsked,
    runIdle:()=>{for(const fn of idles.splice(0))fn();},free:()=>{held=false;for(const fn of [...frees])fn();}};
}
const tick=()=>new Promise(r=>setTimeout(r,0));

test('the popup files: the frame, X, blocks, − and +, the 2 escolha arts of the orientation and the small picture on top',()=>{
  assert.deepEqual(popupArtUrls('maromba',false,1),[...POPUP_FIXOS,'/art/menu/escolha/maromba-amigos.webp','/art/menu/escolha/maromba-sozinho.webp','/art/portraits/maromba-thumb.webp']);
  assert.deepEqual(popupArtUrls('maromba',true,2).slice(-3),['/art/menu/escolha/maromba-amigos-deitado.webp','/art/menu/escolha/maromba-sozinho-deitado.webp','/art/portraits/maromba-768.webp']);
  assert.deepEqual(popupArtUrls('cidadao-comum',false,1),[...POPUP_FIXOS,'/art/portraits/cidadao-comum-thumb.webp'],'a hero without escolha art: the frame only');
  for(const url of [...popupArtUrls('maromba',false,1),...popupArtUrls('maromba',true,1),chosenArtUrl('maromba',3)])assert.ok(existsSync(`public${url}`),url);
});

test('nothing before start; start waits for idle; then every popup file at low priority, once, and the previews chunk',async()=>{
  const f=fake(),art=createMenuArtPreload(f.env);
  art.warm('maromba');
  assert.equal(f.idles.length,0,'warm before start (no load event yet) asks nothing');
  art.start('maromba');
  assert.equal(f.loads.length,0,'nothing outside idle time');
  f.runIdle();
  assert.deepEqual(f.loads.map(l=>l.url),popupArtUrls('maromba',false,1));
  assert.ok(f.loads.every(l=>l.priority==='low'));
  assert.equal(f.previasAsked(),1);
  art.start('maromba');f.runIdle();
  assert.equal(f.loads.length,popupArtUrls('maromba',false,1).length,'a second start fetches nothing twice');
  await tick();
  assert.ok(art.ready('/art/menu/escolha/maromba-amigos.webp'));
  assert.equal(art.previa('/art/menu/escolha/maromba-amigos.webp'),'data:image/webp;base64,AA');
});

test('a new hero: only his own files, in idle time; the frame is not asked again',()=>{
  const f=fake(),art=createMenuArtPreload(f.env);
  art.start('maromba');f.runIdle();
  const before=f.loads.length;
  art.warm('maromba');assert.equal(f.idles.length,0,'the same hero asks nothing');
  art.warm('aposentado');
  assert.equal(f.loads.length,before,'not outside idle time');
  f.runIdle();
  assert.deepEqual(f.loads.slice(before).map(l=>l.url),['/art/menu/escolha/aposentado-amigos.webp','/art/menu/escolha/aposentado-sozinho.webp','/art/portraits/aposentado-thumb.webp']);
});

test('while the match holds the link nothing starts; it goes when the last hold does',()=>{
  const f=fake(),art=createMenuArtPreload(f.env);
  f.setHeld(true);art.start('maromba');f.runIdle();
  assert.equal(f.loads.length,0);
  assert.equal(f.frees.length,1);
  art.warm('vendedor-praia');f.runIdle();
  assert.equal(f.frees.length,1,'one listener, not one per pick');
  f.free();
  assert.deepEqual(f.loads.map(l=>l.url),popupArtUrls('vendedor-praia',false,1),'the hero picked while held');
  assert.equal(f.frees.length,0,'the listener goes');
});

test('Save-Data: nothing in the background (BORA! still fetches what it shows)',async()=>{
  const f=fake({saveData:()=>true}),art=createMenuArtPreload(f.env);
  art.start('maromba');f.runIdle();art.warm('aposentado');f.runIdle();
  assert.equal(f.loads.length,0);
  await art.now(POPUP_FIXOS);
  assert.deepEqual(f.loads.map(l=>l.url),[...POPUP_FIXOS]);
  assert.ok(f.loads.every(l=>l.priority==='high'));
  assert.ok(POPUP_FIXOS.every(art.ready));
});

test('a failed download is not "ready" and is asked again later',async()=>{
  let fail=true;const loads:string[]=[];
  const f=fake({load:url=>{loads.push(url);return fail?Promise.reject(new Error('net')):Promise.resolve();}}),art=createMenuArtPreload(f.env);
  await art.now([POPUP_FIXOS[0]]);
  assert.equal(art.ready(POPUP_FIXOS[0]),false);
  fail=false;await art.now([POPUP_FIXOS[0]]);
  assert.equal(loads.length,2);assert.ok(art.ready(POPUP_FIXOS[0]));
});
