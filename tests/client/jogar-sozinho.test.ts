// "Jogar sozinho" opens a real match in the Cidade Nevada with 0–5 room bots (BUG-20261013-ORQ-jogar-sozinho-abre-ilha).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BOTS_DEFAULT,BOTS_KEY,SOLO_FAILED,SOLO_GAP_MS,SOLO_MAP,SOLO_RETRY_MS,botsLabel,clampBots,islandFlag,readBots,saveBots,soloErrorText,
  objectiveFromSearch,soloMemory,soloNext,soloCreateMs,soloOneRetry,soloPlan,soloProgress,soloRefused,soloRetryable,soloWithin,SOLO_CREATE_MS,SOLO_FIRST_CREATE_MS,SOLO_FIRST_JOIN_MS,SOLO_RETRY_GAP_MS,SOLO_STEPS,SOLO_STARTING,type SoloMemory,type SoloRoom} from '../../src/client/ui/solo-plan.ts';

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
  // menu-sem-danca: no menu dance to hold before the island loads.
  assert.match(main,/if\(island\)\{\s*try \{\s*const \{openExploration\}=await import\('\.\/client\/explore\.ts'\);/);
  assert.match(main,/await openSolo\(selected,nickname\.trim\(\),\{bots,\s*onStep:[^\n]*\n\s*onJoined:/);
  assert.equal(main.match(/openExploration\(/g)?.length,1,'the island opens from one place only');
  const lobby=read('src/client/lobby.ts');
  const solo=lobby.slice(lobby.indexOf('export async function openSolo'));
  assert.match(solo,/fresh\.cityRef=cityRef;/,'the city goes in join.maps, or the room refuses setMap');
  assert.match(solo,/mountWaitingRoom\(layout,joined,\{solo:plan\}\)/);
  assert.ok(solo.indexOf('options.onJoined?.()')>solo.indexOf('fresh.join()'),'the dialog closes only once the room is joined');
  assert.match(lobby,/if\(step\.action==='map'\)client\.setMap\?\.\(options\.solo\.map\);/);
  assert.match(lobby,/else if\(step\.action==='ready'\)client\.ready\(true\);/);
  const css=read('src/client/style.css');
  assert.match(css,/#confirmation \.solo-row\{display:flex/,'the stepper shares the button\'s row (no height added)');
});

test('sala-solo-privada: openSolo asks the room for the solo map and a private room, in a plain-text body (no CORS preflight)',()=>{
  const lobby=read('src/client/lobby.ts'),solo=lobby.slice(lobby.indexOf('export async function openSolo'));
  assert.ok(solo.includes('const body:RoomCreateOptions={map:plan.map,solo:true,...objectiveFromSearch(location.search)};'),'map, solo and the asked objective');
  assert.ok(solo.includes("fetch(new URL('/rooms',endpoint),{method:'POST',body:JSON.stringify(withDevice(body)),"),'the body, no Content-Type header');
  assert.ok(!/headers:\{[^}]*Content-Type/.test(solo.slice(0,solo.indexOf('new CoopClient'))),'no JSON content type: a simple request');
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
  assert.ok(solo.indexOf("step('room')")<solo.indexOf('fresh.join()')&&solo.indexOf("step('join')")>solo.indexOf('fresh.join()'));
  assert.match(lobby,/options\.solo&&client\.run\?\.phase==='countdown'\?SOLO_STARTING/,'no "Ops, peraí" in a solo countdown');
  const css=read('src/client/ui/escolha.css');
  assert.match(css,/#enter-island\[aria-busy=true\]:disabled\{opacity:1\}/,'the card is not faded while it loads');
});

// auditoria de jogabilidade 14: a cold room Worker failed the first "Jogar sozinho" and the error showed at once.
test('solo start: one silent second try, none for a fatal answer',async()=>{
  const waits:number[]=[];const wait=async(ms:number)=>{waits.push(ms);};
  let n=0;
  assert.equal(await soloOneRetry(async()=>{if(++n===1)throw new Error('frio');return 'sala';},()=>true,wait),'sala');
  assert.equal(n,2);assert.deepEqual(waits,[SOLO_RETRY_GAP_MS]);
  n=0;
  await assert.rejects(soloOneRetry(async()=>{++n;throw new Error(`falhou ${n}`);},()=>true,wait),/falhou 2/,'the second error is the one shown');
  n=0;
  await assert.rejects(soloOneRetry(async()=>{++n;throw new Error('versão velha');},()=>false,wait),/versão velha/);
  assert.equal(n,1,'a fatal answer is not asked twice');
  const solo=read('src/client/lobby.ts');
  const open=solo.slice(solo.indexOf('export async function openSolo'));
  assert.match(open,/const joined=await soloOneRetry\(async n=>\{\n\s*const r=await fetch\(new URL\('\/rooms'/,'the room and the join are retried together');
  assert.match(open,/if\(!fatal\)\{client\?\.leave\(\);client=undefined;\}return soloRetryable\(error,fatal\);/,'the failed client leaves before the retry');
});

// solo-tenta-de-novo: the first try is short (the audit waited 13.8 s on a cold Worker), a refusal is not asked twice.
test('solo start: the first try on short times, cut only while nothing of the room was heard',async()=>{
  assert.deepEqual([soloCreateMs(0),soloCreateMs(1)],[SOLO_FIRST_CREATE_MS,SOLO_CREATE_MS]);
  assert.ok(SOLO_FIRST_CREATE_MS+SOLO_FIRST_JOIN_MS<13800,'the second try starts before the audit\'s 13.8 s');
  assert.equal(SOLO_CREATE_MS,10000,'the second try keeps today\'s room time');
  // A fake clock: `after` keeps the timer, the test fires it.
  const timers:{ms:number;run:()=>void;cancelled:boolean}[]=[];
  const after=(ms:number,run:()=>void)=>{const t={ms,run,cancelled:false};timers.push(t);return ()=>{t.cancelled=true;};};
  const cut=soloWithin(new Promise<string>(()=>{}),SOLO_FIRST_JOIN_MS,()=>true,after);
  assert.equal(timers[0].ms,SOLO_FIRST_JOIN_MS);timers[0].run();
  await assert.rejects(cut,(e:Error)=>e.name==='SoloSlow');
  const downloading=soloWithin(new Promise<string>(ok=>setTimeout(()=>ok('cidade'),5)),SOLO_FIRST_JOIN_MS,()=>false,after);
  timers[1].run();
  assert.equal(await downloading,'cidade','the city coming down is not cut');
  assert.equal(await soloWithin(Promise.resolve('sala'),SOLO_FIRST_JOIN_MS,()=>true,after),'sala');
  assert.ok(timers[2].cancelled,'a join in time clears its timer');
  await assert.rejects(soloWithin(Promise.reject(new Error('caiu')),SOLO_FIRST_JOIN_MS,()=>true,after),/caiu/);
  assert.ok(timers[3].cancelled);
});

test('solo start: a first try without a socket enters on the second without an error; two failures show today\'s',async()=>{
  // The lobby's shape: a POST (its time by try), then the join; a 'mudo' join never hears the room.
  const run=async(tries:('mudo'|'ok'|'429'|'rede')[])=>{
    const posts:number[]=[],left:number[]=[],shown:string[]=[];
    try{
      const room=await soloOneRetry(async n=>{
        posts.push(soloCreateMs(n));const what=tries[n];
        if(what==='429')throw soloRefused('Aguarde um minuto antes de criar outra sala.');
        if(what==='rede')throw new TypeError('Failed to fetch');
        let fire=()=>{};
        const joining=what==='ok'?Promise.resolve(`sala ${n}`):new Promise<string>(()=>{});
        const joined=n===0?soloWithin(joining,SOLO_FIRST_JOIN_MS,()=>what!=='ok',(_ms,go)=>{fire=go;return ()=>{};}):joining;
        fire();return await joined;
      },error=>{left.push(posts.length);return soloRetryable(error,false);},async()=>{});
      return {room,posts,left,shown};
    }catch(e){shown.push(soloErrorText(e));return {room:undefined,posts,left,shown};}
  };
  const cold=await run(['mudo','ok']);
  assert.equal(cold.room,'sala 1');assert.deepEqual(cold.shown,[],'no error on the way');
  assert.deepEqual(cold.posts,[SOLO_FIRST_CREATE_MS,SOLO_CREATE_MS]);
  assert.deepEqual(cold.left,[1],'the first room is left before the second POST');
  const twice=await run(['mudo','rede']);
  assert.deepEqual(twice.shown,[SOLO_FAILED],'two failures: today\'s error');assert.equal(twice.posts.length,2);
  const limited=await run(['429','ok']);
  assert.deepEqual(limited.shown,['Aguarde um minuto antes de criar outra sala.'],'the rate limit is shown at once');
  assert.equal(limited.posts.length,1,'one POST: CREATE_LIMIT is not spent twice');
  assert.equal(soloRetryable(new Error('versão velha'),true),false,'the room\'s fatal word is not retried');
  assert.equal(soloRetryable(new DOMException('timeout','TimeoutError'),false),true);
  const lobby=read('src/client/lobby.ts');
  assert.match(lobby,/AbortSignal\.timeout\(soloCreateMs\(n\)\)/);
  assert.match(lobby,/throw r\.status<500\?soloRefused\(message\):new Error\(message\)/,'a 5xx is a cold Worker: retried');
  assert.match(lobby,/n===0\?soloWithin\(joining,SOLO_FIRST_JOIN_MS,\(\)=>!fresh\.connected&&!fresh\.mapLoad\):joining/);
});
