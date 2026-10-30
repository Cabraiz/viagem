// NEW-20261012-E5-chunk-velho-deploy, front B: how the page wires the version watch (src/client/ui/update-toast.ts,
// main.ts, lobby.ts, explore.ts). The pure rules run here with fakes; the DOM wiring is pinned on the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MATCH_PHASES,RESUME_KEY,RESUME_MAX_MS,UPDATE_LINE,UPDATE_TITLE,chunkFailed,inMatchOf,leftMatch,linkWatch,matchEnded,opening,
  resumeOf,saveResume,takeResume,type DocLike,type Resume,type ShellLike,
} from '../../src/client/ui/update-toast.ts';
import {createVersionWatch,startVersionWatch,type WatchWindow} from '../../src/client/ui/version-watch.ts';

const ROOM='0A1B2C3D4E';
const CHROME_404=new TypeError('Failed to fetch dynamically imported module: https://viagem.cyou/assets/lobby-abc123.js');

class Store {
  map=new Map<string,string>();
  getItem(k:string){return this.map.get(k)??null;}
  setItem(k:string,v:string){this.map.set(k,v);}
  removeItem(k:string){this.map.delete(k);}
}
const shell=(classes:string[],data:Record<string,string|undefined>={}):ShellLike=>({classList:{contains:c=>classes.includes(c)},dataset:data});
/** A document with at most an open island shell and an open lobby window (the only selectors the rules ask for). */
function doc(open:{shell?:ShellLike;lobby?:ShellLike}={}):DocLike{
  return {querySelector(selector){
    if(selector==='dialog.explore-shell[open]')return open.shell??null;
    if(selector==='dialog.coop-lobby[open]')return open.lobby??null;
    throw new Error(`unexpected selector ${selector}`);
  }};
}
const solo=()=>shell(['explore-shell']);
const room=(phase?:string,code=ROOM)=>shell(['explore-shell','coop-shell'],{runPhase:phase,room:code});

test('in a match: the solo island, or a room run in countdown/combat; never menu, lobby, waiting room or result',()=>{
  assert.equal(inMatchOf(doc()),false,'menu');
  assert.equal(inMatchOf(doc({lobby:shell(['coop-lobby'],{room:ROOM})})),false,'lobby window, even after joining');
  assert.equal(inMatchOf(doc({shell:solo()})),true,'solo island');
  assert.deepEqual([...MATCH_PHASES],['countdown','combat']);
  for(const [phase,expected] of [[undefined,false],['lobby',false],['countdown',true],['combat',true],['result',false]] as const)
    assert.equal(inMatchOf(doc({shell:room(phase)})),expected,`room phase ${phase}`);
});

test('leftMatch: only countdown/combat → something else',()=>{
  assert.equal(leftMatch('combat','result'),true);
  assert.equal(leftMatch('countdown','lobby'),true);
  assert.equal(leftMatch('combat',undefined),true);
  assert.equal(leftMatch('countdown','combat'),false);
  assert.equal(leftMatch('lobby','countdown'),false);
  assert.equal(leftMatch('result','lobby'),false);
  assert.equal(leftMatch(undefined,'combat'),false);
  assert.equal(leftMatch(undefined,'lobby'),false);
});

test('resumeOf: the room of the shell or the lobby, the lobby being opened, else the menu',async()=>{
  const at=1_000;
  assert.deepEqual(resumeOf(doc(),at),{view:'menu',at});
  assert.deepEqual(resumeOf(doc({shell:room('lobby')}),at),{view:'lobby',room:ROOM,at},'waiting room');
  assert.deepEqual(resumeOf(doc({shell:room('result')}),at),{view:'lobby',room:ROOM,at},'result');
  assert.deepEqual(resumeOf(doc({shell:room('combat')}),at),{view:'lobby',room:ROOM,at},'the tap in a match rejoins the seat');
  assert.deepEqual(resumeOf(doc({shell:room('lobby','not-a-code')}),at),{view:'menu',at},'garbage room code');
  assert.deepEqual(resumeOf(doc({shell:solo()}),at),{view:'menu',at},'solo island: back to the menu');
  assert.deepEqual(resumeOf(doc({lobby:shell(['coop-lobby'])}),at),{view:'lobby',at},'lobby without a room');
  assert.deepEqual(resumeOf(doc({lobby:shell(['coop-lobby'],{room:ROOM})}),at),{view:'lobby',room:ROOM,at},'lobby that joined a room');
  // While the lobby chunk loads (no window yet) the intent says where the player was going; it ends with the load.
  const seen=await opening({view:'lobby'},async()=>resumeOf(doc(),at));
  assert.deepEqual(seen,{view:'lobby',at});
  assert.deepEqual(resumeOf(doc(),at),{view:'menu',at},'intent cleared after the load');
  await assert.rejects(opening({view:'lobby',room:ROOM},async()=>{assert.deepEqual(resumeOf(doc(),at),{view:'lobby',room:ROOM,at});throw CHROME_404;}));
  assert.deepEqual(resumeOf(doc(),at),{view:'menu',at},'intent cleared after a failed load');
  // An open window beats the intent.
  await opening({view:'lobby'},async()=>assert.deepEqual(resumeOf(doc({shell:room('lobby')}),at),{view:'lobby',room:ROOM,at}));
});

test('takeResume reads once, and only a fresh, well-formed resume',()=>{
  const store=new Store(),now=500_000;
  saveResume(store,{view:'lobby',room:ROOM,at:now-1000});
  assert.deepEqual(takeResume(store,now),{view:'lobby',room:ROOM,at:now-1000});
  assert.equal(store.getItem(RESUME_KEY),null,'deleted on read');
  assert.equal(takeResume(store,now),undefined,'only once');
  const put=(value:unknown)=>store.setItem(RESUME_KEY,typeof value==='string'?value:JSON.stringify(value));
  put({view:'lobby',at:now-RESUME_MAX_MS});assert.deepEqual(takeResume(store,now),{view:'lobby',at:now-RESUME_MAX_MS},'at the limit');
  put({view:'lobby',at:now-RESUME_MAX_MS-1});assert.equal(takeResume(store,now),undefined,'stale');
  assert.equal(store.getItem(RESUME_KEY),null,'a stale resume is deleted too');
  put({view:'lobby',at:now+5000});assert.equal(takeResume(store,now),undefined,'from the future');
  put('{not json');assert.equal(takeResume(store,now),undefined);
  put({view:'island',at:now});assert.equal(takeResume(store,now),undefined,'unknown view');
  put({view:'lobby',at:'now'});assert.equal(takeResume(store,now),undefined,'no time');
  put(null);assert.equal(takeResume(store,now),undefined);
  put({view:'lobby',room:'<img src=x>',at:now});assert.deepEqual(takeResume(store,now),{view:'lobby',at:now},'bad room dropped');
  put({view:'menu',room:ROOM,at:now});assert.deepEqual(takeResume(store,now),{view:'menu',at:now},'the menu has no room');
  assert.equal(takeResume(undefined,now),undefined,'no storage');
  const broken={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
  assert.equal(takeResume(broken,now),undefined);
  assert.doesNotThrow(()=>saveResume(broken,{view:'menu',at:now}));
});

/** The watch as main.ts builds it, on fakes: the page state, a reload counter and the resume store. */
function page(state:{doc:DocLike}){
  const session=new Store(),reloads:Resume[]=[],shown:string[]=[];
  let now=10_000;
  const watch=createVersionWatch({current:'build-a',fetchVersion:async()=>'build-a',inMatch:()=>inMatchOf(state.doc),storage:session,now:()=>now,
    reload:()=>reloads.push(JSON.parse(session.getItem(RESUME_KEY)!)),onAvailable:reason=>shown.push(reason),
    beforeReload:()=>saveResume(session,resumeOf(state.doc,now))});
  linkWatch(watch);
  return {session,reloads,shown,watch,tick:(ms:number)=>{now+=ms;}};
}

test('menu: a lobby chunk 404 reloads once and comes back to the lobby, without "As salas não abriram. Tenta de novo."',async()=>{
  const state={doc:doc()},p=page(state);
  let message='';
  // main.ts openCoop: Vite fires vite:preloadError (→ watch.chunkFailed) before the import rejects into the catch.
  try{await opening({view:'lobby'},async()=>{p.watch.chunkFailed(CHROME_404);throw CHROME_404;});}
  catch(e){if(!chunkFailed(e))message='As salas não abriram. Tenta de novo.';}
  assert.equal(message,'');
  assert.equal(p.reloads.length,1,'one reload (the catch asking again is idempotent)');
  assert.equal(p.reloads[0].view,'lobby');
  assert.deepEqual(p.shown,[]);
  // After the reload, main.ts reads it back once.
  assert.equal(takeResume(p.session,10_000+1000)?.view,'lobby');
  linkWatch(undefined);
});

test('lobby window that joined a room: the island chunk 404 reloads back into the same room',()=>{
  const state={doc:doc({lobby:shell(['coop-lobby'],{room:ROOM})})},p=page(state);
  assert.equal(chunkFailed(new TypeError('error loading dynamically imported module: /assets/explore-1.js')),true);
  assert.deepEqual(p.reloads,[{view:'lobby',room:ROOM,at:10_000}]);
  linkWatch(undefined);
});

test('in a match: notice once, no reload; the match ends (result) and then it reloads into the room',()=>{
  const state={doc:doc({shell:room('combat')})},p=page(state);
  assert.equal(chunkFailed(new TypeError('Importing a module script failed.')),true);
  assert.equal(chunkFailed(CHROME_404),true);
  assert.deepEqual(p.shown,['chunk'],'the notice once');
  assert.equal(p.reloads.length,0,'never mid-match');
  p.tick(30_000);
  // explore.ts calls it when the phase leaves countdown/combat (leftMatch), with the shell already saying 'result'.
  state.doc=doc({shell:room('result')});
  matchEnded();
  assert.deepEqual(p.reloads,[{view:'lobby',room:ROOM,at:40_000}]);
  linkWatch(undefined);
});

test('solo island counts as a match; the tap reloads to the menu',()=>{
  const state={doc:doc({shell:solo()})},p=page(state);
  assert.equal(chunkFailed(CHROME_404),true);
  assert.deepEqual(p.shown,['chunk']);assert.equal(p.reloads.length,0);
  p.watch.update();
  assert.deepEqual(p.reloads,[{view:'menu',at:10_000}]);
  linkWatch(undefined);
});

test('other errors keep the old messages; no watch or a dev build (inert watch) too',()=>{
  const p=page({doc:doc()});
  for(const e of [new Error('A conexão falhou.'),new TypeError("Cannot read properties of undefined (reading 'x')"),undefined,'boom'])assert.equal(chunkFailed(e),false);
  assert.equal(p.reloads.length,0);
  linkWatch(undefined);
  assert.equal(chunkFailed(CHROME_404),false,'no watch linked');
  const noop=()=>{};
  const win:WatchWindow={addEventListener:noop,removeEventListener:noop,setInterval:()=>0,clearInterval:noop,document:{visibilityState:'visible',addEventListener:noop,removeEventListener:noop}};
  const dev=startVersionWatch({win,current:'dev-abc',fetchVersion:async()=>undefined,inMatch:()=>false,reload:()=>assert.fail('dev reload'),onAvailable:()=>assert.fail('dev notice'),storage:new Store()});
  linkWatch(dev);
  assert.equal(chunkFailed(CHROME_404),false,'dev server: the old message shows');
  linkWatch(undefined);dev.stop();
});

test('the notice text: pt-BR, the line the card asks for, and a short joke for out of the round',()=>{
  assert.equal(UPDATE_TITLE,'Saiu versão nova do jogo. Toca pra atualizar.');
  assert.ok(UPDATE_LINE.length>0&&UPDATE_LINE.length<=40,UPDATE_LINE);
});

// ---------- Wiring on the source (the DOM parts) ----------
const read=(f:string)=>fs.readFileSync(f,'utf8');

test('main.ts: watch and notice in the entry chunk, every lazy-import catch asks the watch first, resume at startup',()=>{
  const main=read('src/main.ts');
  // Static: after a deploy the lazy chunks 404, so the code (and the CSS) reacting to it cannot be one of them.
  assert.match(main,/^import \{[^}]*startVersionWatch[^}]*\} from '\.\/client\/ui\/version-watch\.ts';$/m);
  assert.match(main,/^import \{[^}]*showUpdateToast[^}]*\} from '\.\/client\/ui\/update-toast\.ts';$/m);
  assert.match(main,/^import '\.\/client\/ui\/update-toast\.css';$/m);
  assert.match(main,/current:__BUILD_ID__/);
  assert.match(main,/inMatch:\(\)=>inMatchOf\(document\)/);
  assert.match(main,/onAvailable:\(\)=>showUpdateToast\(document\)/);
  assert.match(main,/beforeReload:\(\)=>saveResume\(session\(\),resumeOf\(document,Date\.now\(\)\)\)/);
  assert.match(main,/const versionWatch=startVersionWatch\(/);
  assert.match(main,/linkWatch\(versionWatch\);/);
  // arrastar-atualiza-versao-nova: one check at startup (a page from the HTTP cache reloads into the site's build),
  // and the menus' pull-to-refresh goes through the watch's tap.
  assert.match(main,/void versionWatch\.check\(\);/);
  assert.match(main,/startPullToRefresh\(\{doc:document,win:window,inMatch:\(\)=>inMatchOf\(document\),refresh:\(\)=>updateNow\(\)\}\)/);
  // The two old messages only when it was not a stale chunk.
  assert.match(main,/if\(!chunkFailed\(e\)\)\{?text\('explore-error','As salas não abriram\. Tenta de novo\.'\)/);
  assert.match(main,/if\(!chunkFailed\(e\)\)text\('explore-error','A ilha não carregou\. Tenta de novo\.'\)/);
  assert.equal(main.match(/As salas não abriram\. Tenta de novo\./g)?.length,1);
  // The lobby import runs with the lobby as the place to come back to.
  assert.match(main,/opening\(intent,async\(\)=>\{const \{openLobby\}=await import\('\.\/client\/lobby\.ts'\)/);
  // Resume: read once at startup; the lobby reopens, and joins the room by itself.
  assert.match(main,/const resume=takeResume\(session\(\),Date\.now\(\)\);/);
  assert.match(main,/resume\?\.view==='lobby'&&nickname\.trim\(\)\)void openCoop\(resume\.room\?\{room:resume\.room,autoJoin:true\}:\{\}\)/);
});

test('update-toast.ts imports nothing that would leave the entry chunk or touch the DOM in node',()=>{
  const src=read('src/client/ui/update-toast.ts');
  const imports=[...src.matchAll(/^import .* from '([^']+)';$/gm)].map(m=>m[1]);
  assert.deepEqual(imports.sort(),['./icon.ts','./version-watch.ts']);
  assert.doesNotMatch(src,/import\(/,'no lazy import: it must work when the lazy chunks are gone');
  const css=read('src/client/ui/update-toast.css');
  assert.match(css,/min-height:48px/,'tap target');
  assert.match(css,/var\(--sa-t\)/,'safe-area aware');
  assert.match(css,/\.rh \.update-toast-line\{display:none\}/,'one line in the HUD slot');
});

test('lobby.ts: a stale chunk never leaves the room (the seat waits for the reload), autoJoin enters the resumed room',()=>{
  const lobby=read('src/client/lobby.ts');
  const caught=lobby.indexOf('if(chunkFailed(e)&&reloadUnderway())'),left=lobby.indexOf('client?.leave();',caught);
  assert.ok(caught>0&&left>caught,'the seat is kept only while a reload is really underway; otherwise the client leaves');
  assert.match(lobby,/dialog\.dataset\.room=code;\s*\n\s*const \{openExploration\}=await import\('\.\/explore\.ts'\)/,'room recorded before the island chunk loads');
  assert.match(lobby,/export async function openLobby\(hero:HeroClass,name:string,options:LobbyOptions=\{\}\)/);
  assert.match(lobby,/codeInput\.value=formatRoomCode\(readRoomCode\(options\.room\?\?/);
  assert.match(lobby,/if\(options\.autoJoin&&endpoint&&codeInput\.value\)void enter\(false\);/);
  assert.match(lobby,/import\('\.\/net-fatal\.ts'\)\.catch\(/,'the fatal panel import cannot throw out of the catch');
});

test('explore.ts: the phase on the shell drives matchEnded; the scene chunk 404 asks the watch; the HUD slot is lent in combat only',()=>{
  const explore=read('src/client/explore.ts');
  assert.match(explore,/const previous=shell\.dataset\.runPhase;\s*\n\s*putData\(shell,'runPhase',run\.phase\);/);
  assert.match(explore,/if\(leftMatch\(previous,run\.phase\)\)matchEnded\(\)/);
  assert.match(explore,/\}catch\(e\)\{if\(!closed\)\{clearTimeout\(coverSlow\);if\(chunkFailed\(e\)\)\$\('\.explore-loading'\)\.textContent='Saiu versão nova do jogo\.'/);
  assert.match(explore,/net\.run\?\.phase!=='combat'\)return false;runHud\.queueRow\(el,UPDATE_ROW_MS\)/);
  // Closing the island or the room is the end of the match too (after the shell is gone, so the resume sees the menu).
  assert.match(explore,/shell\.remove\(\);returnFocus\?\.focus\(\);\s*\n(?:\s*\/\/.*\n)*\s*matchEnded\(\);/);
});
