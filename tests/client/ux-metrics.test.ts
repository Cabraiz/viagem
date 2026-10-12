// NEW-20261009-UX-playtest-metricas: playtest metrics on the phone. Off by default (and then nothing is loaded or touched),
// on only with ?dev=1; pure recorder under node; the JSON has no names, ids or positions; the report script checks the
// targets of docs/playtest-ux.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {uxMetricsEnabled,UX_FLAG,groupLabel,inviteQuery,setMeasuringTeam,resetUxFlagMemory} from '../../src/client/dev/ux-flag.ts';
import {UxRecorder,UxMetrics,createUxMetrics,FIRST_MOVE_DISTANCE,STILL_WINDOW_MS,UX_SCHEMA,LAST_KEY,type UxCoachState,type UxNet} from '../../src/client/dev/ux-metrics.ts';
import {shareLink} from '../../src/client/lobby.ts';
import type {RunView,PlayerRunView,OfferView} from '../../src/contract/view.ts';
import type {RunState} from '../../src/sim/run.ts';
// @ts-expect-error plain .mjs script without types
import {summarize,formatReport,TARGETS} from '../../scripts/ux-report.mjs';

const ME='p-me',FRIEND='p-zé';
const player=(id:string,over:Partial<PlayerRunView>={}):PlayerRunView=>({id,name:id===ME?'Maria Aparecida':'Zé do Pix',classId:'cidadao-comum',hp:100,maxHp:100,online:true,spectator:false,weapons:[],passives:[],...over});
let eventId=0;
type Ev=RunView['events'][number];
const ev=(e:Omit<Ev,'eventId'>|Record<string,unknown>):Ev=>({...e,eventId:++eventId}) as Ev;
function view(over:{round?:number;phase?:'wave'|'prepare';offers?:OfferView[];events?:Ev[];me?:Partial<PlayerRunView>}={}):RunView{
  return {tick:1,team:{xp:0,level:1,nextXp:5},round:{index:over.round??1,total:10,phase:over.phase??'wave',phaseEndsTick:999,remaining:3},
    enemies:[],pickups:[],projectiles:[],telegraphs:[],structures:[],players:[player(ME,over.me),player(FRIEND)],offers:over.offers??[],events:over.events??[]};
}
const offer=(id:string,source:'level'|'round'='level'):OfferView=>({id,source,level:2,choices:[{itemId:'boleto',level:1}],deadlineTick:9e9,defaultIndex:0});
const run=(round:number,phase:RunState['phase'],over:Partial<RunState>={}):RunState=>({round,phase,elapsed:0,remaining:0,owner:ME,
  members:[{id:ME,online:true,ready:true,spectator:false},{id:'bot-1',online:true,ready:true,spectator:false,bot:true},{id:'bot-2',online:true,ready:true,spectator:false,bot:true}],...over});
const meta={group:'k3x9qa',date:'2026-10-12',device:{viewport:'390x844',orientation:'retrato' as const,dpr:3,text:'100',touch:true}};
const coach=(done:string[],show?:{lesson:string;done:boolean}):UxCoachState=>({done:new Set(done),show});
/** A recorder whose scene is up from t=0 (the joystick works): the move clock starts with combat. */
const rec=()=>{const r=new UxRecorder(meta,0);r.sceneReady(0);return r;};
const alone:RunState['members']=[{id:ME,online:true,ready:true,spectator:false}];

test('off by default: only exactly ?dev=1 turns it on',()=>{
  for(const search of ['','?','?dev','?dev=','?dev=0','?dev=true','?dev=yes','?devs=1','?zonas','?room=ABCDEF1234','?DEV=1',undefined])
    assert.equal(uxMetricsEnabled(search),false,`off for ${JSON.stringify(search)}`);
  for(const search of ['?dev=1','dev=1','?room=ABCDEF1234&dev=1','?dev=1&zonas'])assert.equal(uxMetricsEnabled(search),true,`on for ${search}`);
  assert.deepEqual(UX_FLAG,{name:'dev',value:'1'});
});

test('off costs nothing: no window global, no listener, no DOM, no hook on the client',()=>{
  const touched:string[]=[];
  const host=new Proxy({location:{search:'?room=ABCDEF1234'}},{get(t,k){touched.push(String(k));return Reflect.get(t,k);},set(_t,k){touched.push(`set:${String(k)}`);return true;}});
  const net:UxNet={code:'ABCDEF1234',id:ME,connected:true,onSos:()=>{}};
  assert.equal(createUxMetrics(host as never,net),undefined);
  assert.deepEqual(touched,['location'],'only the address is read');
  assert.equal(net.onCommand,undefined,'the client keeps no hook');
  assert.equal(createUxMetrics(undefined,net),undefined);
  assert.equal((globalThis as {__uxMetrics?:unknown}).__uxMetrics,undefined);
});

test('off costs nothing in the code: the metrics module is loaded on demand, every use is ux?.',()=>{
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  const lobby=readFileSync(new URL('../../src/client/lobby.ts',import.meta.url),'utf8');
  const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
  // Only `import type` statically (erased): the module itself comes through import(), behind the flag.
  assert.doesNotMatch(explore,/^import \{[^}]*\} from '\.\/dev\/ux-metrics\.ts'/m);
  assert.match(explore,/^import type \{UxMetrics\} from '\.\/dev\/ux-metrics\.ts';$/m);
  assert.match(explore,/if\(uxMetricsEnabled\(location\.search\)\)void import\('\.\/dev\/ux-metrics\.ts'\)/);
  assert.equal(explore.match(/import\('\.\/dev\/ux-metrics\.ts'\)/g)?.length,1);
  assert.match(main,/if\(new URLSearchParams\(location\.search\)\.get\('dev'\)==='1'&&[^\n]*void import\('\.\/client\/dev\/ux-metrics\.ts'\)/);
  // Every call on `ux` outside the loader is optional: with the flag off `ux` stays undefined.
  const uses=[...explore.matchAll(/\bux(\?)?\.(\w+)\(/g)];
  assert.ok(uses.length>=6,'the hooks are there');
  for(const u of uses)assert.equal(u[1],'?',`ux.${u[2]} is called with ?.`);
  for(const file of [lobby,main])assert.doesNotMatch(file,/from '\.\/(client\/)?dev\/ux-metrics/,'only the flag is imported statically');
  assert.match(lobby,/from '\.\/dev\/ux-flag\.ts'/);
  // The flag module stays small (that is all the game loads when the metrics are off) and imports nothing.
  const flag=readFileSync(new URL('../../src/client/dev/ux-flag.ts',import.meta.url),'utf8');
  assert.ok(flag.length<3500,`ux-flag.ts is ${flag.length} chars`);
  assert.doesNotMatch(flag,/^import /m,'and imports nothing');
});

const memoryStore=()=>{const m=new Map<string,string>();return {m,getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);}};};

test('invite: carries &dev=1&g=<label> only when this tab chose "Medir a turma" (and the flag is on), never the room code',()=>{
  resetUxFlagMemory();
  const store=memoryStore();
  assert.equal(shareLink('https://viagem.cyou/','ABCDEF1234'),'https://viagem.cyou/?room=ABCDEF1234#personagem');
  assert.equal(inviteQuery('?dev=1',store),'','metrics on, team not measured: plain invite');
  setMeasuringTeam(true,store);
  assert.equal(inviteQuery('',store),'','flag off: plain invite even with the choice stored');
  const q=inviteQuery('?dev=1',store);
  assert.match(q,/^&dev=1&g=[a-z0-9]{6}$/);
  const link=shareLink('https://viagem.cyou','ABCDEF1234',q),search=new URL(link).search;
  assert.equal(uxMetricsEnabled(search),true);
  // The friend's phone gets the same label from the link; the label is random, not the room code.
  assert.equal(groupLabel(search,memoryStore()),groupLabel('?dev=1',store));
  assert.notEqual(groupLabel('?dev=1',store).toUpperCase(),'ABCDEF1234');
  assert.equal(groupLabel('?dev=1',store),groupLabel('?dev=1',store),'stable for the tab');
  assert.equal(groupLabel('?dev=1&g=ROOM!!',store),groupLabel('?dev=1',store),'a bad g is ignored');
  setMeasuringTeam(false,store);assert.equal(inviteQuery('?dev=1',store),'');
  // It ends with the tab: sessionStorage, nothing in localStorage.
  assert.ok([...store.m.keys()].every(k=>k.startsWith('viagem:ux-')));
});

test('a run: first move, still time, falls, offers (chosen, default, Depois), chip, coach, rematch',()=>{
  eventId=0;
  const r=rec();
  r.runState(run(1,'lobby',{members:alone}),ME,0);
  // The owner's commands count when the roster shows them: 2 bots asked and seen, 1 that never left the phone.
  r.command({t:'bot-add'},true,200);r.command({t:'bot-add'},true,300);r.command({t:'bot-add'},false,350);
  r.stick(400);
  r.runState(run(1,'countdown'),ME,500);
  // Combat starts at t=1000; the coach knows nothing on this phone.
  r.runState(run(1,'combat'),ME,1000,coach([]));
  let t=1000;
  const step=(v:RunView,hero:{x:number;y:number},c=coach([]),dt=50,connected=true)=>{t+=dt;r.view(v,ME,hero,connected,t,c);};
  // Stands still 2 s with the walk hint, then walks.
  for(let i=0;i<40;i++)step(view(),{x:10,y:10},coach([],{lesson:'walk',done:false}));
  r.stick(t);
  for(let i=1;i<=10;i++)step(view(),{x:10+i*.05,y:10},coach(i>=8?['walk']:[],{lesson:'walk',done:i>=8}));
  // A snap (reconnection) is not a step: the anchor moves with it.
  step(view(),{x:40,y:40},coach(['walk']));
  // Zé falls in round 1, Maria rescues him; later Maria falls and bleeds out... in round 2.
  step(view({events:[ev({type:'downed',player:FRIEND})]}),{x:40.1,y:40},coach(['walk']));
  step(view({events:[ev({type:'revived',player:FRIEND,by:ME})]}),{x:40.2,y:40},coach(['walk']));
  // The first level offer: the chip (t=3700 → 2700 ms), tapped at 4200, chosen 600 ms later.
  step(view({offers:[offer('lvl-2')]}),{x:40.3,y:40},coach(['walk'],{lesson:'chip',done:false}));
  const chipAt=t;
  r.tap('chip',chipAt+500);r.command({t:'choose',offer:'lvl-2',index:1},true,chipAt+1100);
  step(view(),{x:40.4,y:40},coach(['walk','chip'],{lesson:'chip',done:true}),1200);
  // Intermission: a round offer the player folds with "Depois" and lets run out; offline the offer looks gone (not a default).
  step(view({phase:'prepare',offers:[offer('rnd-1','round')]}),{x:40.4,y:40},coach(['walk','chip']));
  r.tap('later',t+10);
  step(view({phase:'prepare',offers:[]}),{x:40.4,y:40},coach(['walk','chip']),50,false);
  step(view({phase:'prepare',offers:[offer('rnd-1','round')]}),{x:40.4,y:40},coach(['walk','chip']));
  step(view({phase:'prepare',offers:[],events:[ev({type:'happening',kind:'boletos',endsTick:5})]}),{x:40.4,y:40},coach(['walk','chip']));
  step(view({round:2,events:[ev({type:'downed',player:ME}),ev({type:'eliminated',player:ME}),ev({type:'last-bicho',kind:'gosma',x:1,y:2,round:2})]}),{x:40.4,y:40},coach(['walk','chip']));
  // Same events again (a view repeated): counted once.
  step(view({round:2,events:[ev({type:'downed',player:FRIEND})].map(e=>({...e,eventId:1}))}),{x:40.4,y:40},coach(['walk','chip']));
  r.sos(true);r.sos(false);r.sos(false);
  // The result: the XP hint was on screen ≥ 8 s, so the coach learned it by sight at showResult.
  r.runState(run(1,'result',{outcome:'defeat',shame:{player:ME} as never}),ME,t+100,coach(['walk','chip','xp']));
  r.command({t:'rematch'},true,t+2100);
  r.runState(run(2,'lobby'),ME,t+2200);
  const data=r.snapshot(t+3000);
  assert.equal(data.schema,UX_SCHEMA);assert.equal(data.novice,true);assert.equal(data.group,'k3x9qa');
  assert.deepEqual(data.owner,{isOwner:true,kick:0,botAdd:2,botRemove:0,unconfirmed:0,unsent:1});
  assert.deepEqual(data.waitingRoom,{stickMs:400},'a drag in the waiting room (the hero cannot walk there yet)');
  assert.equal(data.runs.length,1);
  const x=data.runs[0];
  assert.equal(x.ended,'result');assert.equal(x.outcome,'defeat');assert.equal(x.roundReached,2);
  assert.deepEqual(x.team,{people:1,bots:2});
  assert.equal(x.firstStickMs,2000);
  assert.equal(x.firstMoveMs,2250,`the hero is ${FIRST_MOVE_DISTANCE} u away after 5 steps`);
  assert.ok(x.still60.seconds>=1.9&&x.still60.seconds<=2.6,`still ${x.still60.seconds} s`);
  assert.deepEqual(x.downs,{me:1,meRound1:0,team:2,teamRound1:1});
  assert.deepEqual(x.fallen,{rescued:1,rescuedByMe:1,lost:1});
  assert.equal(x.offers.total,2);assert.equal(x.offers.chosen,1);assert.equal(x.offers.defaulted,1);assert.equal(x.offers.pendingAtEnd,0);
  assert.deepEqual(x.offers.combat,{chosen:1,defaulted:0});assert.deepEqual(x.offers.intermission,{chosen:0,defaulted:1});
  assert.deepEqual(x.offers.choiceMs,[1100]);assert.equal(x.offers.choiceMsAvg,1100);assert.equal(x.offers.later,1);
  assert.equal(x.chip.firstMs,chipAt-1000);assert.equal(x.chip.firstTapMs,chipAt+500-1000);
  assert.equal(x.coach.walk.shownMs,50);assert.equal(x.coach.walk.by,'action');assert.ok(x.coach.walk.learnedMs!>2000);
  assert.equal(x.coach.chip.by,'action');assert.equal(x.coach.xp.by,'sight');assert.equal(x.coach.rescue.learnedMs,null);
  assert.deepEqual(x.pings,{sent:1,received:2});assert.deepEqual(x.emotes,{available:false,sent:0});
  assert.deepEqual(x.moments,{'happening:boletos':1,killcam:1,shame:1});
  assert.deepEqual(x.rematch,{pressedMs:2000,started:true});
});

test('the JSON has no names, player ids or positions',()=>{
  eventId=0;
  const r=rec();
  r.runState(run(1,'combat'),ME,0,coach([]));
  for(let i=0;i<5;i++)r.view(view({offers:[offer('lvl-2-'+ME)],events:[ev({type:'downed',player:FRIEND,by:ME})]}),ME,{x:12.345+i,y:67.891},true,i*50,coach([]));
  r.command({t:'kick',id:FRIEND},true,300);
  const json=JSON.stringify(r.snapshot(400));
  for(const banned of ['Maria','Zé',ME,FRIEND,'ABCDEF','12.3','67.8','"x"','"y"','"name"','"id"','userAgent'])assert.ok(!json.includes(banned),`no ${banned}`);
});

test('leaving mid-run ends it as "left"; an offer still open at the result is pending, not a default',()=>{
  const r=rec();
  r.runState(run(1,'combat'),ME,0,coach(['walk','xp','chip','rescue','gather']));
  r.view(view({offers:[offer('lvl-9')]}),ME,{x:0,y:0},true,100);
  r.runState(run(1,'result',{outcome:'victory'}),ME,200);
  r.runState(run(2,'combat'),ME,5000,coach(['walk','xp','chip','rescue','gather']));
  r.view(view(),ME,{x:0,y:0},true,5100);
  r.leave(6000);
  const data=r.snapshot(7000);
  assert.equal(data.novice,false,'a phone that knew every hint is not a novice');
  assert.equal(data.runs[0].offers.pendingAtEnd,1);assert.equal(data.runs[0].offers.defaulted,0);
  assert.equal(data.runs[0].rematch.started,true,'a later run number after the result: someone started the rematch');
  assert.equal(data.runs[0].rematch.pressedMs,null,'not this player');
  assert.equal(data.runs[1].ended,'left');assert.equal(data.runs[1].durationMs,1000);
  assert.equal(data.runs[1].firstMoveMs,null);
  for(const lesson of Object.values(data.runs[1].coach))assert.equal(lesson.knownAtStart,true);
});

test('still time counts only the first 60 s, standing (a caído is not "parado")',()=>{
  const r=rec();
  r.runState(run(1,'combat'),ME,0,coach([]));
  let t=0;
  for(;t<=90000;t+=100)r.view(view({me:t>=10000&&t<20000?{downed:{progress:0,bleedOutTick:9}}:{}}),ME,{x:5,y:5},true,t);
  const x=r.snapshot(t).runs[0];
  assert.equal(x.still60.windowSeconds,(STILL_WINDOW_MS-10000)/1000);
  assert.equal(x.still60.seconds,50);
  assert.equal(x.firstMoveMs,null);
});

test('report: joins phones, checks the targets of the playtest script',()=>{
  const novice=(firstMoveMs:number,meRound1:number,defaulted:number,chosen:number,chipMs:number,started:boolean,group:string)=>({schema:UX_SCHEMA,date:'2026-10-12',group,novice:true,
    device:meta.device,sessionMs:1,owner:{isOwner:false,kick:0,botAdd:0,botRemove:0},
    runs:[{run:1,ended:'result',outcome:'defeat',durationMs:200000,roundReached:3,team:{people:2,bots:0},firstMoveMs,firstStickMs:firstMoveMs,still60:{seconds:5,windowSeconds:60},
      downs:{me:meRound1,meRound1,team:meRound1,teamRound1:meRound1},fallen:{rescued:0,rescuedByMe:0,lost:0},
      offers:{total:chosen+defaulted,chosen,defaulted,pendingAtEnd:0,combat:{chosen,defaulted:0},intermission:{chosen:0,defaulted},choiceMs:[2000],choiceMsAvg:2000,later:0},
      chip:{firstMs:chipMs,firstTapMs:chipMs+1000},coach:{},pings:{sent:0,received:0},emotes:{available:false,sent:0},moments:{},rematch:{pressedMs:started?1000:null,started}}]});
  const files=[novice(1500,0,1,9,20000,true,'G1'),novice(2500,0,0,8,25000,true,'G1'),novice(4000,1,1,4,40000,false,'G2'),novice(2000,0,0,5,10000,false,'G2'),novice(2900,0,0,6,12000,true,'G3')];
  const s=summarize(files);
  assert.equal(s.phones,5);assert.equal(s.groups,3);
  const by=Object.fromEntries(s.rows.map((row:{key:string})=>[row.key,row]));
  assert.equal(by.firstMove.value,'4 de 5 (80%)');assert.equal(by.firstMove.ok,true);
  assert.equal(by.round1.value,'4 de 5 (80%)');assert.equal(by.round1.ok,true);
  assert.equal(by.defaulted.ok,true);
  assert.equal(by.rematch.value,'2 de 3 grupos (67%)');assert.equal(by.rematch.ok,true);
  assert.equal(by.chip.value,'4 de 5 (80%)');
  const text=formatReport(s);
  for(const target of Object.values(TARGETS) as {label:string}[])assert.ok(text.includes(target.label),target.label);
  // Missing data is "sem dado", never a pass.
  const empty=summarize([]);assert.ok(empty.rows.every((row:{ok:boolean|null})=>row.ok===null));
});

test('still time in buckets: a hero whose spot updates in jumps (a slow phone) still counts as walking',()=>{
  const r=rec();
  r.runState(run(1,'combat'),ME,0,coach([]));
  // Views at 20 Hz, but the predicted spot moves 0.3 u only every 1.5 s (what the lab's loaded machine showed).
  for(let t=0;t<=30000;t+=50)r.view(view(),ME,{x:Math.floor(t/1500)*.3,y:0},true,t);
  const x=r.snapshot(30000).runs[0];
  assert.equal(x.still60.seconds,0);assert.equal(x.still60.windowSeconds,30);
  assert.equal(x.firstMoveMs,1500);
});

test('rematch: events of the old run seen again (eventIds grow across runs, D-011) are not counted in the new one',()=>{
  eventId=0;
  const r=rec();
  r.runState(run(1,'combat'),ME,0,coach([]));
  const old=[ev({type:'downed',player:ME}),ev({type:'revived',player:ME,by:FRIEND}),ev({type:'last-bicho',kind:'gosma',x:1,y:1,round:1})];
  r.view(view({events:old}),ME,{x:0,y:0},true,100);
  r.runState(run(1,'result',{outcome:'defeat'}),ME,200);
  // On the result and in the waiting room the feed still carries them; and the new run's first view too.
  r.view(view({events:old}),ME,{x:0,y:0},true,300,undefined,false);
  r.runState(run(2,'lobby'),ME,400);r.runState(run(2,'combat'),ME,500,coach([]));
  r.view(view({events:[...old,ev({type:'downed',player:FRIEND})]}),ME,{x:0,y:0},true,600);
  const [a,b]=r.snapshot(700).runs;
  assert.deepEqual(a.downs,{me:1,meRound1:1,team:1,teamRound1:1});assert.equal(a.moments.killcam,1);
  assert.deepEqual(b.downs,{me:0,meRound1:0,team:1,teamRound1:1},'only the new fall');
  assert.deepEqual(b.fallen,{rescued:0,rescuedByMe:0,lost:0});assert.deepEqual(b.moments,{});
  // Events between runs (result, waiting room) never count either.
  const r2=rec();r2.runState(run(1,'result'),ME,0);r2.view(view({events:[ev({type:'downed',player:ME})]}),ME,undefined,true,10,undefined,false);
  r2.runState(run(2,'combat'),ME,20,coach([]));r2.view(view(),ME,{x:0,y:0},true,30);
  assert.equal(r2.snapshot(40).runs[0].downs.team,0);
});

test('only what the room took: unsent picks and rematch do not count; owner commands need the roster; offer phase is the one it arrived in',()=>{
  const r=rec();
  r.runState(run(1,'combat'),ME,0,coach([]));
  // Arrives in combat (held for the intermission, D-021), resolved in the intermission: it counts as combat.
  r.view(view({offers:[offer('lvl-2')]}),ME,{x:0,y:0},true,100);
  r.view(view({phase:'prepare',offers:[offer('lvl-2')]}),ME,{x:0,y:0},true,200);
  r.command({t:'choose',offer:'lvl-2',index:0},false,250);
  r.view(view({phase:'prepare',offers:[]}),ME,{x:0,y:0},true,300);
  // A tap that left: chosen only once the offer is gone from the queue.
  r.view(view({phase:'prepare',offers:[offer('rnd-1','round')]}),ME,{x:0,y:0},true,400);
  r.command({t:'choose',offer:'rnd-1',index:0},true,900);
  let x=r.snapshot(950).runs[0];
  assert.equal(x.offers.chosen,0,'not yet: the room has not taken it');
  r.view(view({phase:'prepare',offers:[]}),ME,{x:0,y:0},true,1000);
  r.runState(run(1,'result'),ME,1100);
  r.command({t:'rematch'},false,1200);
  // Owner: a kick sent and the person gone; a bot removal sent but refused (roster unchanged).
  r.runState(run(1,'result',{members:[...alone,{id:FRIEND,online:true,ready:false,spectator:false}]}),ME,1300);
  r.command({t:'kick',id:FRIEND},true,1400);r.command({t:'bot-remove'},true,1450);
  r.runState(run(1,'result',{members:alone}),ME,1500);
  const d=r.snapshot(1600);x=d.runs[0];
  assert.deepEqual(x.offers.combat,{chosen:0,defaulted:1});assert.deepEqual(x.offers.intermission,{chosen:1,defaulted:0});
  assert.equal(x.offers.unsent,1);assert.deepEqual(x.offers.choiceMs,[500]);
  assert.equal(x.rematch.pressedMs,null,'an unsent rematch is no rematch');
  assert.equal(d.owner.kick,1);assert.equal(d.owner.botRemove,0);assert.equal(d.owner.unconfirmed,1,'the refused removal');
});

test('the first-move clock waits for the scene: a phone still loading when combat starts',()=>{
  const r=new UxRecorder(meta,0);
  r.runState(run(1,'combat'),ME,0,coach([]));
  r.view(view(),ME,{x:0,y:0},true,1000);r.stick(1500);
  r.sceneReady(4000);
  r.stick(5000);
  for(let t=4000;t<=6000;t+=100)r.view(view(),ME,{x:t>=5500?1:0,y:0},true,t);
  const x=r.snapshot(6000).runs[0];
  assert.equal(x.firstStickMs,1000,'from the scene ready, not from the combat start');
  assert.equal(x.firstMoveMs,1500);
});

test('destroy puts the client hooks back',()=>{
  const prevSos=()=>{},prevCommand=()=>{};
  const net:UxNet={code:'ABCDEF1234',id:ME,connected:true,onSos:prevSos,onCommand:prevCommand};
  const store=memoryStore();
  const el=()=>({append(){},setAttribute(){},addEventListener(){},remove(){},dataset:{}});
  const doc={documentElement:{dataset:{}},querySelector:()=>null,createElement:el,body:{append(){}}};
  const host={location:{search:'?dev=1'},innerWidth:390,innerHeight:844,devicePixelRatio:3,document:doc,navigator:{},performance:{now:()=>0},sessionStorage:store};
  const ux=createUxMetrics(host as never,net) as UxMetrics;
  assert.ok(ux);assert.notEqual(net.onSos,prevSos);assert.notEqual(net.onCommand,prevCommand);
  net.onSos({id:ME,x:0,y:0,tick:1});net.onCommand!({t:'bot-add'},true);
  ux.destroy();
  assert.equal(net.onSos,prevSos);assert.equal(net.onCommand,prevCommand);
  // The last session stays for the start screen's "Métricas".
  const saved=JSON.parse(store.getItem(LAST_KEY)!);assert.equal(saved.schema,UX_SCHEMA);assert.match(saved.group,/^[a-z0-9]{6}$/);
  delete (globalThis as {__uxMetrics?:unknown}).__uxMetrics;delete (host as {__uxMetrics?:unknown}).__uxMetrics;
});

test('report: partial and broken files are "sem dado", never a crash; median ignores NaN',()=>{
  const files=[{schema:UX_SCHEMA,runs:[null,{}]},{schema:UX_SCHEMA,novice:true,group:'aaaaaa',runs:[{firstStickMs:null,firstMoveMs:Number.NaN,offers:null,chip:{},downs:{},coach:null,rematch:null,still60:{seconds:'x'}}]},
    {schema:UX_SCHEMA,runs:null},{schema:UX_SCHEMA},null,{schema:'outro'}];
  const s=summarize(files);
  const text=formatReport(s);
  assert.ok(typeof text==='string'&&text.includes('sem dado'));
  const by=Object.fromEntries(s.rows.map((row:{key:string})=>[row.key,row]));
  assert.equal(by.defaulted.ok,null);assert.equal(by.rematch.ok,null);
  assert.equal(by.round1.ok,null,'a run without downs is no proof of "no fall"');
  assert.doesNotMatch(text,/NaN|undefined/);
});
