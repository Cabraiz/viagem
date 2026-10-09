import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {ticks} from '../src/game/sim/types.ts';
import type {RunView} from '../src/game/sim/view.ts';
import {applyEvents,bossInfo,emptyTally,formatDuration,offerDeadlineFraction,offerTitle,reviveAlerts,roundInfo,teamOrder,xpFraction} from '../src/game/hud/model.ts';
import {marqueeFor} from '../src/game/hud/topbar.ts';
import {memberState} from '../src/game/hud/team.ts';
import {allItemDisplays,itemDisplay,levelTag} from '../src/game/hud/items.ts';
import {HUD_SCENARIOS,fakePlayers,fakeResult,fakeView} from '../src/game/hud/fixtures.ts';
import {classes} from '../src/classes.ts';
import {MAX_AWARDS_PER_PLAYER,awardsOf,computeAwards} from '../src/game/hud/awards.ts';
import {choiceFlags,offerJoke,queueLabel} from '../src/game/hud/offer.ts';
import {compactNumber,resultHeadline} from '../src/game/hud/result.ts';
import {fakeResultEvents} from '../src/game/hud/fixtures.ts';

const WEAPONS=['chinelo','boleto','cafe','guarda-chuva','pombo','audio'];
const EVOLUTIONS=['chinelo-evo','boleto-evo','cafe-evo'];
const PASSIVES=['cafe-forte','marmita','tenis','megafone','bone','ima','oculos','cartao'];

test('round chip shows Round N/10 with critters in a wave and a countdown in the interval',()=>{
  const wave=fakeView('wave',1);
  assert.deepEqual(roundInfo(wave),{index:3,total:10,label:'Round 3/10',phase:'wave',remaining:23,detail:'23 bichos'});
  wave.round!.remaining=1;assert.equal(roundInfo(wave)!.detail,'falta 1 bicho');
  const prepare=fakeView('prepare',1);
  assert.equal(roundInfo(prepare)!.countdown,17);assert.equal(roundInfo(prepare)!.detail,'Intervalo · 17 s');
  prepare.tick=prepare.round!.phaseEndsTick+40;assert.equal(roundInfo(prepare)!.countdown,0);
  const legacy:RunView={...fakeView('wave',1),round:undefined,wave:{index:2,label:'Onda 2'}};
  assert.equal(roundInfo(legacy)!.label,'Round 2/10');
  assert.equal(roundInfo({...legacy,wave:undefined}),undefined);
});

test('xp, boss and duration helpers clamp bad numbers',()=>{
  const view=fakeView('wave',1);
  assert.equal(xpFraction(view),37/58);
  view.team={xp:9,level:2,nextXp:0};assert.equal(xpFraction(view),0);
  view.team={xp:Number.NaN,level:2,nextXp:5};assert.equal(xpFraction(view),0);
  const boss=bossInfo(fakeView('boss',1))!;
  assert.equal(boss.name,'Síndico Supremo');assert.ok(Math.abs(boss.fraction-6200/9000)<1e-9);assert.equal(boss.enraged,false);
  assert.equal(bossInfo(fakeView('wave',1)),undefined);
  assert.equal(formatDuration(ticks(14*60+37)),'14:37');assert.equal(formatDuration(-5),'0:00');
});

test('team order puts the local player first and spectators last; member states',()=>{
  const players=fakePlayers(6);players[1].spectator=true;
  assert.deepEqual(teamOrder(players,'p4').map(p=>p.id),['p4','p1','p3','p5','p6','p2']);
  const [p]=fakePlayers(1);
  assert.equal(memberState(p),'ok');
  assert.equal(memberState({...p,hp:20}),'low');
  assert.equal(memberState({...p,online:false}),'offline');
  assert.equal(memberState({...p,online:false,downed:{progress:0,bleedOutTick:9}}),'downed');
  assert.equal(memberState({...p,downed:{progress:0,bleedOutTick:9},eliminated:true}),'eliminated');
  assert.equal(memberState({...p,spectator:true}),'spectator');
});

test('revive alerts: own fall first, then allies by urgency, with rescue progress',()=>{
  const view=fakeView('downed',6);
  const alerts=reviveAlerts(view,'p1');
  assert.deepEqual(alerts.map(a=>[a.kind,a.playerId,a.seconds]),[['self','p1',21],['ally','p3',12]]);
  assert.match(alerts[0].text,/Você caiu/);assert.match(alerts[1].text,/Salvando Zé do Pix… 45%/);
  view.players[2].eliminated=true;
  assert.equal(reviveAlerts(view,'p1').length,1);
});

test('offer copy distinguishes round upgrades from level-ups; deadline fraction',()=>{
  const [level,round]=fakeView('offer',1).offers;
  assert.deepEqual(offerTitle(round),{eyebrow:'FIM DE ROUND',title:'Upgrade do round'});
  assert.deepEqual(offerTitle(level),{eyebrow:'NÍVEL 12',title:'Subiu de nível!'});
  assert.equal(offerDeadlineFraction(level,1000,1000),1);
  assert.equal(offerDeadlineFraction(level,1000+ticks(3),1000),.5);
  assert.equal(offerDeadlineFraction(level,level.deadlineTick+5,1000),0);
  assert.ok(round.choices.length===4&&level.choices.length===3);
});

test('event tally counts each eventId once and ignores late or repeated events',()=>{
  const tally=emptyTally(),view=fakeView('wave',2);
  view.events=[
    {type:'downed',player:'p1',eventId:1},{type:'revived',player:'p1',by:'p2',eventId:2},
    {type:'pickup',player:'p2',pickup:'k-1',kind:'heal',value:30,eventId:3},{type:'kill',enemy:'e-1',kind:'gosma',by:'p1',x:0,y:0,eventId:4},
  ];
  applyEvents(tally,view);applyEvents(tally,view);
  view.events=[{type:'downed',player:'p1',eventId:2},{type:'downed',player:'p1',eventId:5}];
  applyEvents(tally,view);
  assert.equal(tally.players.get('p1')!.downs,2);assert.equal(tally.players.get('p2')!.revives,1);
  assert.equal(tally.players.get('p2')!.heals,1);assert.equal(tally.players.get('p1')!.kills,1);assert.equal(tally.lastEventId,5);
});

test('round marquee: absurd name and modifier, boss round, interval joke',()=>{
  assert.deepEqual(marqueeFor({index:3,phase:'wave',name:'Round do Pavê',modifier:'Todo mundo é tio'}),{title:'Round 3 · Round do Pavê',subtitle:'Todo mundo é tio',tone:'round'});
  assert.equal(marqueeFor({index:10,phase:'wave'})!.tone,'boss');
  assert.equal(marqueeFor({index:4,phase:'prepare'})!.title,'Intervalo!');
  assert.equal(marqueeFor({index:4,phase:'end'}),undefined);
});

test('item display covers every fixed id with pt-BR copy and falls back for unknown ids',()=>{
  const ids=new Set(allItemDisplays().map(i=>i.id));
  for(const id of [...WEAPONS,...EVOLUTIONS,...PASSIVES])assert.ok(ids.has(id),id);
  for(const item of allItemDisplays())assert.ok(item.name&&item.blurb&&item.joke&&item.icon,item.id);
  assert.equal(itemDisplay('cafe-evo').kind,'evolution');assert.equal(itemDisplay('x-y').name,'X y');
  assert.equal(levelTag('pombo',1),'NOVO!');assert.equal(levelTag('pombo',4),'Nv 4');assert.equal(levelTag('boleto-evo',1),'EVOLUÇÃO');
});

test('fixtures use real classes with approved portraits and cover every scenario',()=>{
  const ids=new Set(classes.map(c=>c.id));
  for(const p of fakePlayers(6)){
    assert.ok(ids.has(p.classId),p.classId);
    assert.ok(existsSync(`public/art/portraits/${p.classId}-thumb.webp`),p.classId);
  }
  for(const scenario of HUD_SCENARIOS)for(const n of [1,6])assert.equal(fakeView(scenario,n).players.length,n);
  assert.equal(fakeResult(6,false).victory,false);
});

const tallyFor=(n:number)=>{let id=0;const view=fakeView('result',n);view.events=fakeResultEvents(n,()=>++id);return applyEvents(emptyTally(),view);};

test('joke awards: truthful winners, everyone gets one in a group, at most two, deterministic, tally untouched',()=>{
  const result=fakeResult(6),tally=tallyFor(6),before=JSON.stringify([...tally.players]);
  const awards=computeAwards(result,tally);
  assert.deepEqual(computeAwards(result,tally),awards);assert.equal(JSON.stringify([...tally.players]),before);
  for(const p of result.players){const mine=awardsOf(awards,p.id);assert.ok(mine.length>=1&&mine.length<=MAX_AWARDS_PER_PLAYER,p.id);}
  const winner=(id:string)=>awards.find(a=>a.id===id)?.playerId;
  assert.equal(winner('mais-caiu'),'p3');
  const kills=Math.max(...result.players.map(p=>p.stats!.kills));
  assert.equal(result.players.find(p=>p.id===winner('exterminador'))?.stats?.kills,kills);
  assert.equal(winner('rei-do-resgate'),'p2');
  for(const a of awards)assert.ok(a.title&&a.line&&a.emoji,a.id);
});

test('solo awards skip team-only titles; zero metrics win nothing',()=>{
  const solo=computeAwards(fakeResult(1),emptyTally());
  assert.ok(solo.length>=1&&solo.length<=2);
  assert.ok(solo.every(a=>!['rei-do-resgate','turista','bate-nao-mata','figurante'].includes(a.id)));
  const idle=fakeResult(2);idle.players=idle.players.map(p=>({...p,weapons:[],passives:[],stats:{damage:0,kills:0,revives:0,pickups:0}}));
  assert.deepEqual(computeAwards(idle,emptyTally()).map(a=>a.id),['figurante','figurante']);
});

test('offer and result copy helpers are deterministic pt-BR',()=>{
  assert.equal(offerJoke('lvl-12-p1','level'),offerJoke('lvl-12-p1','level'));
  assert.equal(queueLabel(0),'');assert.equal(queueLabel(2),'+2 na fila');
  const offer=fakeView('offer-round',1).offers[0];
  assert.deepEqual(choiceFlags(offer,2),{isDefault:true,luck:false});assert.deepEqual(choiceFlags(offer,3),{isDefault:false,luck:true});
  assert.equal(resultHeadline({victory:true,seed:'a'}).title,'VITÓRIA!');assert.equal(resultHeadline({victory:false,seed:'a'}).title,'DERROTA…');
  assert.deepEqual(resultHeadline({victory:true,seed:'x'}),resultHeadline({victory:true,seed:'x'}));
  assert.equal(compactNumber(980),'980');assert.equal(compactNumber(18420),'18,4k');assert.equal(compactNumber(21050),'21k');assert.equal(compactNumber(Number.NaN),'0');
});
