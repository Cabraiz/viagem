// scripts/smoke-veredito.mjs: the production smoke's verdict (it gates the queue and the site's publish). A failure is
// the machine's (exit 2, retried once) only with a starved page AND outside evidence; anything else is the game's (1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {STALL_MS,FIRE_RATIO_MIN,NODE_LAG_MS,ROOM_SLOW_MS,BROWSERS_MAX,CHUNKS_UNVERIFIED,HUNG_POLLS,progressSignature,pageStarved,rendererHung,machineEvidence,isMachine,smokeExit} from '../../scripts/smoke-veredito.mjs';

const sample=(s:number,extra:object={})=>({wallMs:s*1000,answered:true,fires:5,dueFires:5,...extra});
const calm=(from:number,n:number,extra:object={})=>Array.from({length:n},(_,i)=>sample(from+i,extra));

test('progress: what the player sees and the room\'s phase and tick, never the round\'s clock',()=>{
  const base={stage:'partida',loading:'',ready:'',p0:'',bytes:'',count:'',roundLabel:'Round 1/10',roomPhase:'countdown',roomTick:0};
  for(const k of ['stage','loading','ready','p0','bytes','count','roundLabel','roomPhase','roomTick'] as const)
    assert.notEqual(progressSignature(base),progressSignature({...base,[k]:k==='roomTick'?1:'x'}),k);
  // The ETA beside the label ticks every second even in a stuck match: it is not part of the signature.
  assert.equal(progressSignature(base),progressSignature({...base,round:'Round 1/10 ⏱ 2 s',eta:'0:41'}));
});

test('a starved page: most polls unanswered (timed out), or its probe timer fired under FIRE_RATIO_MIN of the time',()=>{
  const now=300000,from=300-STALL_MS/1000;
  assert.equal(pageStarved(calm(from,90),now),'');
  assert.equal(pageStarved(calm(from,90,{fires:3,dueFires:5}),now),'','60 % is busy, not starved');
  assert.match(pageStarved(calm(from,90,{fires:2,dueFires:5}),now),/rodou 40 %/);
  assert.ok(FIRE_RATIO_MIN===.5);
  assert.match(pageStarved([...calm(from,45),...calm(from+45,45,{answered:false})],now),/não respondeu/);
  assert.equal(pageStarved([...calm(from,80),...calm(from+80,10,{answered:false})],now),'','a few slow polls are not starvation');
  // Only the stall window counts: an old hiccup does not.
  assert.equal(pageStarved([...calm(0,30,{fires:0,dueFires:5}),...calm(from,90)],now),'');
});

test('outside evidence: the smoke\'s own event loop late, the local room slow or erring, more browsers than the 2 slots',()=>{
  assert.equal(machineEvidence({}),'');
  assert.equal(machineEvidence({nodeLagP90:NODE_LAG_MS,roomMs:ROOM_SLOW_MS,browsers:BROWSERS_MAX}),'','at the limits: none');
  assert.match(machineEvidence({nodeLagP90:NODE_LAG_MS+1}),/node do smoke/);
  assert.match(machineEvidence({roomMs:ROOM_SLOW_MS+1}),/sala local/);
  assert.match(machineEvidence({roomMs:20,roomOk:false}),/erro/);
  assert.match(machineEvidence({browsers:BROWSERS_MAX+1}),/navegadores headless/);
});

test('exit: 0 all passed; 2 only when every failure is the machine\'s; 1 as soon as one is the game\'s',()=>{
  const ok={why:'',errors:[],starved:''};
  const machine={why:'não entrou: nada mudou em 90 s (sala: "Baixando: 0%", sala ? tick ?)',errors:[],starved:'a página rodou 20 % do tempo; 9 navegadores headless no PC (vagas: 2)'};
  const game={why:'não entrou: nada mudou em 90 s (partida: "Round 1/10", sala countdown tick 0)',errors:[],starved:''};
  const capped={why:'não entrou em 240 s',errors:[],starved:''};
  assert.equal(smokeExit([ok,ok]),0);
  assert.equal(smokeExit([ok,machine]),2);assert.ok(isMachine(machine));
  assert.equal(smokeExit([machine,game]),1);assert.equal(smokeExit([game,machine]),1);
  assert.equal(smokeExit([capped]),1,'the cap with no evidence is the game');
  assert.equal(smokeExit([{...machine,errors:['TypeError: x']}]),1,'a page error is the game, starved or not');
  assert.equal(smokeExit([{...machine,why:`${machine.why} | chunk: lobby.js: boom`}]),1,'a chunk that throws is the game');
  assert.equal(smokeExit([{why:'page.goto: net::ERR_CONNECTION_REFUSED',errors:[],starved:'x'}]),1,'only "não entrou" failures can be the machine\'s');
});

test('a hung renderer: its last polls, all since its last answer, timed out while the room answered on time (lot 162643)',()=>{
  const now=300000,from=300-STALL_MS/1000,room={ok:true,ms:40};
  const silent=calm(from,9,{answered:false}).map((t,i)=>({...t,wallMs:(from+i*10)*1000}));
  assert.match(rendererHung(silent,now,room),/renderer travou: as últimas 9 leituras \(90 s\) não responderam e a sala respondeu em 40 ms/);
  // An answer after the silence: a slow page, not a dead one (pageStarved and the outside evidence judge it).
  assert.equal(rendererHung([...silent.slice(0,8),{...silent[8],answered:true}],now,room),'');
  // A hang that starts late in the window (60 s of the same screen, then silence) is still a hang (review of 0c36755).
  assert.ok(HUNG_POLLS===3);
  assert.match(rendererHung([...calm(from,60),...silent.slice(6)],now,room),/últimas 3 leituras \(30 s\)/);
  assert.equal(rendererHung([...calm(from,60),...silent.slice(7)],now,room),'','two silent polls: not yet');
  // The room silent, slow or erring: the whole machine (or the room), not a hung renderer.
  assert.equal(rendererHung(silent,now,undefined),'');
  assert.equal(rendererHung(silent,now,{ok:false,ms:40}),'');
  assert.equal(rendererHung(silent,now,{ok:true,ms:ROOM_SLOW_MS+1}),'');
  assert.match(rendererHung(silent,now,{ok:true,ms:ROOM_SLOW_MS}),/travou/,'at the limit: on time');
  // Too few samples to say (a stall needs the window), and answers before the window do not count.
  assert.equal(rendererHung(silent.slice(0,2),now,room),'');
  assert.match(rendererHung([...calm(0,30),...silent],now,room),/travou/);
});

test("a hung renderer is the machine's, also with the chunks it could not check; a chunk that throws still is the game's",()=>{
  const why=`não entrou: nada mudou em 90 s (sem resposta: "", sala countdown tick 3) | chunk: ${CHUNKS_UNVERIFIED}`;
  const hung={why,errors:[],starved:'o renderer travou: as últimas 9 leituras (90 s) não responderam e a sala respondeu em 40 ms',hung:'x'};
  assert.ok(isMachine(hung));assert.equal(smokeExit([hung]),2);
  assert.equal(smokeExit([{...hung,starved:''}]),1,'unchecked chunks with nothing starved: the game');
  assert.equal(smokeExit([{...hung,why:`${why} | chunk: lobby.js: boom`}]),1);
  assert.equal(smokeExit([{...hung,errors:['TypeError: x']}]),1);
  // Also a starved page with outside evidence may leave its chunks unchecked: the machine's too.
  assert.equal(smokeExit([{...hung,hung:'',starved:'a página não respondeu (8 de 9 leituras); 4 navegadores headless no PC (vagas: 2)'}]),2);
});
