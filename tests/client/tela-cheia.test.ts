import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APP_QUERY,autoFullscreen,canFullscreen,lockMatchOrientation,showButton,TELA_CHEIA_KEY,toggleFullscreen,TOQUE_QUERY,type TelaCheiaEnv} from '../../src/client/ui/tela-cheia.ts';

/** A page the Fullscreen API answers (Android Chrome) or not (iPhone Safari: no requestFullscreen on the page). */
function env(o:{api?:boolean;media?:string[];refuse?:boolean;landscape?:boolean}={}){
  const calls:string[]=[],store=new Map<string,string>();
  const doc:TelaCheiaEnv['doc']={fullscreenEnabled:o.api!==false,fullscreenElement:null,documentElement:{}};
  if(o.api!==false)doc.documentElement.requestFullscreen=async opts=>{
    calls.push(`enter:${opts?.navigationUI}`);if(o.refuse)throw new TypeError('no user gesture');doc.fullscreenElement={} as Element;};
  doc.exitFullscreen=async()=>{calls.push('exit');doc.fullscreenElement=null;};
  const media=new Set([...(o.media??[TOQUE_QUERY]),...(o.landscape?['(orientation: landscape)']:[])]);
  const e:TelaCheiaEnv={doc,media:q=>media.has(q),storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>void store.set(k,v),removeItem:k=>void store.delete(k)},
    orientation:{lock:async t=>void calls.push(`lock:${t}`),unlock:()=>void calls.push('unlock')}};
  return {e,calls,store};
}

test('celular-deitado-tela-cheia: a touch screen goes full screen on SELECIONAR/JOGAR, the bar hidden too; the PC is never pushed',async()=>{
  const phone=env();
  assert.equal(await autoFullscreen(phone.e),true);
  assert.deepEqual(phone.calls,['enter:hide']);
  assert.equal(await autoFullscreen(phone.e),true);assert.deepEqual(phone.calls,['enter:hide'],'already full: nothing asked again');
  const pc=env({media:[]});
  assert.equal(await autoFullscreen(pc.e),false);assert.deepEqual(pc.calls,[],'a mouse only goes full screen by the button');
  // Installed (manifest display fullscreen): no bar to hide, no button.
  const app=env({media:[TOQUE_QUERY,APP_QUERY]});
  assert.equal(await autoFullscreen(app.e),false);assert.deepEqual(app.calls,[]);assert.equal(showButton(app.e),false);
  // The browser says no (no gesture, a policy): the menu goes on as it was.
  const refused=env({refuse:true});
  assert.equal(await autoFullscreen(refused.e),false);
});

test('celular-deitado-tela-cheia: iPhone Safari (no page fullscreen) gets no button and no request',async()=>{
  const ios=env({api:false});
  assert.equal(canFullscreen(ios.e.doc),false);assert.equal(showButton(ios.e),false);
  assert.equal(await autoFullscreen(ios.e),false);assert.deepEqual(ios.calls,[]);
  assert.equal(showButton(env().e),true);
  // In full screen Chrome matches display-mode fullscreen too: the button stays, to leave it.
  const full=env({media:[TOQUE_QUERY,APP_QUERY]});full.e.doc.fullscreenElement={} as Element;
  assert.equal(showButton(full.e),true);
});

test('celular-deitado-tela-cheia: the button turns it off for good on this device, and back on',async()=>{
  const p=env({landscape:true});
  await autoFullscreen(p.e);
  await toggleFullscreen(p.e);
  assert.equal(p.store.get(TELA_CHEIA_KEY),'off');assert.deepEqual(p.calls,['enter:hide','unlock','exit']);
  assert.equal(await autoFullscreen(p.e),false,'SELECIONAR no longer asks');assert.equal(p.calls.length,3);
  await toggleFullscreen(p.e);
  assert.equal(p.store.has(TELA_CHEIA_KEY),false);assert.equal(p.calls.at(-1),'enter:hide');
});

test('celular-deitado-tela-cheia: a match started on its side stays on its side; upright stays free (D-009 plays both)',async()=>{
  const side=env({landscape:true});
  assert.equal(await lockMatchOrientation(side.e),false,'no lock outside full screen (the browser refuses it)');
  await autoFullscreen(side.e);
  assert.equal(await lockMatchOrientation(side.e),true);assert.equal(side.calls.at(-1),'lock:landscape');
  const upright=env();await autoFullscreen(upright.e);
  assert.equal(await lockMatchOrientation(upright.e),false);assert.ok(!upright.calls.some(c=>c.startsWith('lock')));
});

test('celular-deitado-tela-cheia: wired in the menu (SELECIONAR, both JOGAR buttons, the corner button) and the manifest',()=>{
  const main=readFileSync('src/main.ts','utf8'),css=readFileSync('src/client/estadio.css','utf8'),insta=readFileSync('src/client/ui/insta.css','utf8');
  assert.match(main,/if\(!isLiberado\(selected\.id\)\) return;[^\n]*\n\s*void autoFullscreen\(tela\);/,'SELECIONAR asks first thing, inside the tap');
  assert.match(main,/coopButton\.addEventListener\('click',\(\)=>\{toMatch\(\);/);
  assert.match(main,/const button=document\.getElementById\('enter-island'\) as HTMLButtonElement;\n\s*toMatch\(\);/,'before any await: still the tap');
  assert.match(main,/<button type="button" class="menu-tela-cheia" hidden><\/button>/);
  assert.ok(css.includes('.estadio .menu-tela-cheia[hidden] { display: none; }'));
  assert.ok(insta.includes('.estadio .menu-tela-cheia,'),'the upright profile has its own top bar');
  const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  assert.equal(manifest.display,'fullscreen');assert.equal(manifest.orientation,'any');
});
