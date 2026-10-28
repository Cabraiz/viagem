// "Jogar sozinho" opens a real match in the Cidade Nevada with 0–5 room bots (BUG-20261013-ORQ-jogar-sozinho-abre-ilha).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BOTS_DEFAULT,BOTS_KEY,SOLO_FAILED,SOLO_GAP_MS,SOLO_MAP,SOLO_RETRY_MS,botsLabel,clampBots,islandFlag,readBots,saveBots,soloErrorText,
  objectiveFromSearch,soloMemory,soloNext,soloPlan,soloProgress,SOLO_STEPS,SOLO_STARTING,type SoloMemory,type SoloRoom} from '../../src/client/ui/solo-plan.ts';

const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');

test('bots: clamped to 0..5, whole, garbage is the default 3',()=>{
  assert.equal(BOTS_DEFAULT,3);
  assert.deepEqual([0,1,5,6,-1,2.4,2.6].map(clampBots),[0,1,5,5,0,2,3]);
  assert.deepEqual(['4',' 2 ','','x',null,undefined,NaN,Infinity,{}].map(clampBots),[4,2,3,3,3,3,3,3,3]);
  assert.deepEqual([0,1,3].map(botsLabel),['Sem bots','1 bot','3 bots']);
});

test('bots: remembered in localStorage, and storage that throws or is gone never breaks the dialog',()=>{
  const map=new Map<string,string>();
  const store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};
  assert.equal(readBots(store),3,'nothing stored: the default');
  assert.equal(saveBots(store,9),5);assert.equal(map.get(BOTS_KEY),'5');assert.equal(readBots(store),5);
  assert.equal(saveBots(store,0),0);assert.equal(readBots(store),0,'zero bots is a real choice');
  map.set(BOTS_KEY,'lixo');assert.equal(readBots(store),3);
  const broken={getItem:()=>{throw new Error('SecurityError');},setItem:()=>{throw new Error('QuotaExceeded');}};
  assert.equal(readBots(broken),3);assert.equal(saveBots(broken,2),2,'this session keeps the pick');
  assert.equal(readBots(undefined),3);assert.equal(saveBots(undefined,4),4);
});

test('solo plan: the city, with the clamped bot count',()=>{
  assert.equal(SOLO_MAP,'cidade-nevada');
  assert.deepEqual(soloPlan(3),{map:'cidade-nevada',bots:3});
  assert.deepEqual(soloPlan(8),{map:'cidade-nevada',bots:5});
  assert.deepEqual(soloPlan('x'),{map:'cidade-nevada',bots:3});
});

/** A tiny room: answers each command after `lag` ms, like the real one (city → readies reset, bots always ready). */
function run(bots:number,opts:{lag?:number;gateUntil?:number;drop?:Set<number>}={}){
  const lag=opts.lag??80,plan=soloPlan(bots);
  const room:SoloRoom={connected:true,phase:'lobby',owner:true,map:'infinito',bots:0,seatsLeft:5,selfReady:false,readyBlocked:true};
  const queue:{at:number;apply:()=>void}[]=[],sent:string[]=[];
  let mem:SoloMemory=soloMemory(),n=0;
  for(let now=0;now<60_000&&!mem.done;now+=200){
    for(const q of queue.filter(q=>q.at<=now)){q.apply();queue.splice(queue.indexOf(q),1);}
    room.readyBlocked=now<(opts.gateUntil??1000)||room.map!==SOLO_MAP;
    const step=soloNext(plan,room,mem,now);mem=step.mem;
    if(step.action==='wait'||step.action==='done')continue;
    sent.push(step.action);
    if(opts.drop?.has(n++))continue;
    if(step.action==='map')queue.push({at:now+lag,apply:()=>{room.map=SOLO_MAP;room.selfReady=false;}});
    if(step.action==='bot')queue.push({at:now+lag,apply:()=>{if(room.seatsLeft>0){room.bots++;room.seatsLeft--;}}});
    if(step.action==='ready')queue.push({at:now+lag,apply:()=>{room.selfReady=true;room.phase='countdown';}});
  }
  return {sent,room,mem};
}

test('solo driver: city first, then each bot, then "pronto" (no taps), and it stops',()=>{
  const r=run(3);
  assert.deepEqual(r.sent,['map','bot','bot','bot','ready']);
  assert.equal(r.room.bots,3);assert.equal(r.room.phase,'countdown');assert.ok(r.mem.done);
  assert.deepEqual(run(0).sent,['map','ready'],'no bots: straight to ready');
  assert.deepEqual(run(5).sent,['map','bot','bot','bot','bot','bot','ready']);
});

test('solo driver: a slow network never seats one bot too many; a lost command goes again',()=>{
  const slow=run(3,{lag:1900});
  assert.equal(slow.room.bots,3,'one add in flight at a time');
  assert.deepEqual(slow.sent,['map','bot','bot','bot','ready']);
  const lossy=run(2,{drop:new Set([0,2])});
  assert.equal(lossy.room.bots,2);assert.equal(lossy.room.phase,'countdown');
  assert.deepEqual(lossy.sent,['map','map','bot','bot','bot','ready']);
});

test('solo driver: respects the ready gate (download, P0 up to 25 s) and the room\'s 300 ms owner gap',()=>{
  const gated=run(1,{gateUntil:20_000});
  assert.deepEqual(gated.sent,['map','bot','ready']);assert.equal(gated.room.phase,'countdown');
  const base:SoloRoom={connected:true,phase:'lobby',owner:true,map:SOLO_MAP,bots:0,seatsLeft:5,selfReady:false,readyBlocked:false};
  const plan=soloPlan(1);
  const first=soloNext(plan,base,soloMemory(),0);assert.equal(first.action,'bot');
  assert.equal(soloNext(plan,{...base,bots:1,seatsLeft:4},first.mem,SOLO_GAP_MS-1).action,'wait','never two commands within the gap');
  assert.equal(soloNext(plan,{...base,bots:1,seatsLeft:4},first.mem,SOLO_GAP_MS).action,'ready');
  assert.equal(soloNext(plan,{...base,readyBlocked:true,bots:1},soloMemory(),0).action,'wait','blocked: no ready');
  const once=soloNext(soloPlan(0),base,soloMemory(),0);assert.equal(once.action,'ready');
  assert.equal(soloNext(soloPlan(0),base,once.mem,SOLO_RETRY_MS-1).action,'wait','not sent twice while the room answers');
  assert.equal(soloNext(soloPlan(0),base,once.mem,SOLO_RETRY_MS).action,'ready','lost: sent again');
});

test('solo driver: waits offline / before the run / without the owner post, and is done for good once ready',()=>{
  const base:SoloRoom={connected:true,phase:'lobby',owner:true,map:'infinito',bots:0,seatsLeft:5,selfReady:false,readyBlocked:false};
  const plan=soloPlan(3);
  for(const room of [{...base,connected:false},{...base,phase:undefined},{...base,owner:false}])assert.equal(soloNext(plan,room,soloMemory(),0).action,'wait');
  const done=soloNext(plan,{...base,map:SOLO_MAP,selfReady:true},soloMemory(),0);
  assert.equal(done.action,'done');
  assert.equal(soloNext(plan,{...base,map:SOLO_MAP,selfReady:false},done.mem,10_000).action,'done','a later "Ops, peraí" is the player\'s own');
  assert.equal(soloNext(plan,{...base,phase:'combat'},soloMemory(),0).action,'done');
  assert.equal(soloNext(soloPlan(5),{...base,map:SOLO_MAP,bots:2,seatsLeft:0},soloMemory(),0).action,'ready','a full room: no more bots');
});

test('solo errors are pt-BR: our messages pass, platform ones become the generic line',()=>{
  assert.equal(soloErrorText(new Error('A cidade não baixou. Tente novamente.')),'A cidade não baixou. Tente novamente.');
  assert.equal(soloErrorText(new TypeError('Failed to fetch')),SOLO_FAILED);
  const timeout=new Error('signal timed out');timeout.name='TimeoutError';
  assert.equal(soloErrorText(timeout),SOLO_FAILED);
  assert.equal(soloErrorText('x'),SOLO_FAILED);
});

test('the island only with ?ilha=1',()=>{
  assert.equal(islandFlag('?ilha=1'),true);
  assert.equal(islandFlag('?ilha=1&dev=1'),true);
  for(const s of ['','?ilha=0','?ilha','?room=ABC'])assert.equal(islandFlag(s),false);
});

test('wiring: #enter-island starts openSolo with the stepper\'s bots; the island path sits behind ?ilha=1',()=>{
  const main=read('src/main.ts');
  assert.match(main,/<button id="enter-island" class="secondary-button"><span class="escolha-rotulo">Jogar sozinho<\/span><\/button>/,'the id the live-play uses stays');
  assert.match(main,/aria-label="Menos um bot"/);assert.match(main,/aria-label="Mais um bot"/);
  assert.match(main,/class="solo-bots-value" aria-live="polite"/);
  assert.match(main,/const island=islandFlag\(location\.search\);/);
  // danca-no-podio: the menu dance lets go of its pages before the island loads (menu-dance.ts hold).
  assert.match(main,/if\(island\)\{\s*const releaseDance=menuDance\.hold\(\);\s*try \{\s*const \{openExploration\}=await import\('\.\/client\/explore\.ts'\);/);
  assert.match(main,/await openSolo\(selected,nickname\.trim\(\),\{bots,\s*onStep:[^\n]*\n\s*onJoined:/);
  assert.equal(main.match(/openExploration\(/g)?.length,1,'the island opens from one place only');
  const lobby=read('src/client/lobby.ts');
  const solo=lobby.slice(lobby.indexOf('export async function openSolo'));
  assert.match(solo,/client\.cityRef=cityRef;/,'the city goes in join.maps, or the room refuses setMap');
  assert.match(solo,/mountWaitingRoom\(layout,joined,\{solo:plan\}\)/);
  assert.ok(solo.indexOf('options.onJoined?.()')>solo.indexOf('await client.join()'),'the dialog closes only once the room is joined');
  assert.match(lobby,/if\(step\.action==='map'\)client\.setMap\?\.\(options\.solo\.map\);/);
  assert.match(lobby,/else if\(step\.action==='ready'\)client\.ready\(true\);/);
  const css=read('src/client/style.css');
  assert.match(css,/#confirmation \.solo-row\{display:flex/,'the stepper shares the button\'s row (no height added)');
});

test('sala-solo-privada: openSolo asks the room for the solo map and a private room, in a plain-text body (no CORS preflight)',()=>{
  const lobby=read('src/client/lobby.ts'),solo=lobby.slice(lobby.indexOf('export async function openSolo'));
  assert.ok(solo.includes('const body:RoomCreateOptions={map:plan.map,solo:true,...objectiveFromSearch(location.search)};'),'map, solo and the asked objective');
  assert.ok(solo.includes("fetch(new URL('/rooms',endpoint),{method:'POST',body:JSON.stringify(body),"),'the body, no Content-Type header');
  assert.ok(!/headers:\{[^}]*Content-Type/.test(solo.slice(0,solo.indexOf('client=new CoopClient'))),'no JSON content type: a simple request');
});

test('?modo= (D-051, rodada-legado): the solo room is always the nests with the manual combat, whatever the address',()=>{
  for(const s of ['','?modo=ninhos','?modo=ondas','?modo=muralha','?modo=chaveiro','?ilha=1&modo=chaveiro','?modo=ondas&combate=auto',undefined])
    assert.deepEqual(objectiveFromSearch(s),{mode:'ninhos',combat:'manual'},String(s));
});

test('auditoria-ui-menus 5: the card\'s bar moves only with real steps, and its line names the first one not done',()=>{
  assert.equal(SOLO_STEPS.reduce((s,x)=>s+x.weight,0).toFixed(2),'1.00','the steps fill the whole bar');
  assert.deepEqual(soloProgress({}),{fraction:0,text:'Baixando o jogo…'});
  // The city's map may end before the code: the line stays on the code, the bar has the city's share.
  assert.deepEqual(soloProgress({city:1}),{fraction:.35,text:'Baixando o jogo…'});
  assert.deepEqual(soloProgress({code:1,city:.6}),{fraction:.56,text:'Baixando a cidade…'});
  assert.deepEqual(soloProgress({code:1,city:1}),{fraction:.7,text:'Abrindo a sala…'});
  assert.deepEqual(soloProgress({code:1,city:1,room:1}),{fraction:.85,text:'Entrando…'});
  assert.deepEqual(soloProgress({code:1,city:1,room:1,join:1}),{fraction:1,text:'Entrando…'});
  assert.equal(soloProgress({code:7,city:-1}).fraction,.35,'out-of-range parts are clamped');
  assert.equal(SOLO_STARTING,'Começando…');
});

test('auditoria-ui-menus 5: the solo downloads start when the popup opens, and the card shows the steps on a bar',()=>{
  const main=read('src/main.ts'),lobby=read('src/client/lobby.ts');
  const confirm=main.slice(main.indexOf("document.getElementById('confirm')!.addEventListener"));
  assert.ok(confirm.indexOf('m.warmSolo(selected.id)')>confirm.indexOf('dialog.showModal()'),'warm right as the popup opens');
  assert.doesNotMatch(main,/'Preparando…'/,'no bare "Preparando…" any more');
  assert.match(main,/bar\.setAttribute\('role','progressbar'\)/);
  const solo=lobby.slice(lobby.indexOf('export async function openSolo'));
  assert.match(solo,/const warm=warmSolo\(hero\.id\)/,'the tap reuses what the popup started');
  assert.ok(solo.indexOf("step('room')")<solo.indexOf('await client.join()')&&solo.indexOf("step('join')")>solo.indexOf('await client.join()'));
  assert.match(lobby,/options\.solo&&client\.run\?\.phase==='countdown'\?SOLO_STARTING/,'no "Ops, peraí" in a solo countdown');
  const css=read('src/client/ui/escolha.css');
  assert.match(css,/#enter-island\[aria-busy=true\]:disabled\{opacity:1\}/,'the card is not faded while it loads');
});
