import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {ticks} from '../../src/contract/types.ts';
import type {RunView} from '../../src/contract/view.ts';
import {applyEvents,bossInfo,emptyTally,resetTally,formatDuration,offerDeadlineFraction,offerTitle,reviveAlerts,roundInfo,teamOrder,xpFraction} from '../../src/client/hud/model.ts';
import {marqueeFor} from '../../src/client/hud/topbar.ts';
import {memberState} from '../../src/client/hud/team.ts';
import {allItemDisplays,itemDisplay,levelTag} from '../../src/client/hud/items.ts';
import {FIXTURE_INTERMISSION_SECONDS,HUD_SCENARIOS,fakePlayers,fakeResult,fakeView} from '../../src/client/hud/fixtures.ts';
import {classes} from '../../src/rules/classes.ts';
import {MAX_AWARDS_PER_PLAYER,awardsOf,computeAwards} from '../../src/client/hud/awards.ts';
import {OFFER_TAP_GUARD_MS,OfferTapGuard,TAKE_ALL_MIN,chipText,choiceFlags,isAllNew,offerJoke,offerUiState,queueLabel,trackShownAt} from '../../src/client/hud/offer.ts';
import {offerMode} from '../../src/client/hud/model.ts';
import {priceTag} from '../../src/client/hud/items.ts';
import {HEAL_AMOUNT,HEAL_CHOICE,HELD_DEADLINE,OFFER_SECONDS} from '../../src/rules/offers.ts';
import {BUILD_SLOTS,buildIcons,compactNumber,resultHeadline} from '../../src/client/hud/result.ts';
import {fakeResultEvents} from '../../src/client/hud/fixtures.ts';
import {WEAPON_CATALOG} from '../../src/sim/weapons/catalog.ts';
import {PASSIVES as PASSIVE_DEFS} from '../../src/rules/passives.ts';
import {BOSS_ROUND_NAMES,MODIFIERS,ROUND_NAMES,modifierLabel} from '../../src/rules/waves.ts';

const WEAPONS=['boleto','cafe','guarda-chuva','pombo','audio'];
const EVOLUTIONS=['boleto-evo','cafe-evo'];
const PASSIVES=['cafe-forte','marmita','tenis','megafone','bone','oculos','cartao'];

test('round chip shows Round N/10 with critters in a wave and a countdown in the interval',()=>{
  const wave=fakeView('wave',1);
  assert.deepEqual(roundInfo(wave),{index:3,total:10,label:'Rodada 3 de 10',phase:'wave',remaining:23,detail:'23 bichos'});
  wave.round!.remaining=1;assert.equal(roundInfo(wave)!.detail,'falta 1 bicho');
  const prepare=fakeView('prepare',1);
  assert.equal(roundInfo(prepare)!.countdown,17);assert.equal(roundInfo(prepare)!.detail,'Intervalo 17 s');
  prepare.tick=prepare.round!.phaseEndsTick+40;assert.equal(roundInfo(prepare)!.countdown,0);
  const legacy:RunView={...fakeView('wave',1),round:undefined,wave:{index:2,label:'Onda 2'}};
  assert.equal(roundInfo(legacy)!.label,'Rodada 2 de 10');
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
  const [level,round]=fakeView('offer-prepare',1).offers;
  assert.deepEqual(offerTitle(round),{title:'Escolha da rodada'});
  assert.deepEqual(offerTitle(level),{title:'Nível 12!'});
  assert.equal(offerDeadlineFraction(level,1000,1000),1);
  assert.equal(offerDeadlineFraction(level,1000+ticks(FIXTURE_INTERMISSION_SECONDS/2),1000),.5);
  assert.equal(offerDeadlineFraction(level,level.deadlineTick+5,1000),0);
  assert.ok(round.choices.length===3&&level.choices.length===3);
});

test('event tally counts each eventId once and ignores late or repeated events',()=>{
  const tally=emptyTally(),view=fakeView('wave',2);
  view.events=[
    {type:'downed',player:'p1',eventId:1},{type:'revived',player:'p1',by:'p2',eventId:2},
    {type:'pickup',player:'p2',pickup:'k-1',kind:'heal',value:30,eventId:3},{type:'kill',enemy:'e-1',kind:'bebado',by:'p1',x:0,y:0,eventId:4},
  ];
  applyEvents(tally,view);applyEvents(tally,view);
  view.events=[{type:'downed',player:'p1',eventId:2},{type:'downed',player:'p1',eventId:5}];
  applyEvents(tally,view);
  assert.equal(tally.players.get('p1')!.downs,2);assert.equal(tally.players.get('p2')!.revives,1);
  assert.equal(tally.players.get('p2')!.heals,1);assert.equal(tally.players.get('p1')!.kills,1);assert.equal(tally.lastEventId,5);
});

test('round marquee: absurd name and modifier, boss round, interval joke',()=>{
  const modifier=modifierLabel(MODIFIERS[0]);
  assert.deepEqual(marqueeFor({index:3,phase:'wave',name:ROUND_NAMES[0],modifier}),{title:ROUND_NAMES[0],subtitle:modifier,tone:'round'});
  const boss=marqueeFor({index:10,phase:'wave',name:BOSS_ROUND_NAMES[0]})!;
  assert.equal(boss.tone,'boss');assert.equal('kicker' in boss,false);assert.equal(boss.title,BOSS_ROUND_NAMES[0]);assert.ok(boss.subtitle);
  assert.equal(marqueeFor({index:2,phase:'wave'})!.title,'Rodada 2');
  assert.equal(marqueeFor({index:4,phase:'prepare'})!.title,'Intervalo!');
  assert.equal(marqueeFor({index:4,phase:'end'}),undefined);
});

test('item display covers every fixed id with pt-BR copy and falls back for unknown ids',()=>{
  const ids=new Set(allItemDisplays().map(i=>i.id));
  for(const id of [...WEAPONS,...EVOLUTIONS,...PASSIVES,HEAL_CHOICE])assert.ok(ids.has(id),id);
  for(const item of allItemDisplays())assert.ok(item.name&&item.blurb&&item.joke&&item.icon,item.id);
  // Names must match the server catalogs; blurbs stay short enough for 3 lines on a portrait card.
  for(const [id,def] of WEAPON_CATALOG){assert.equal(itemDisplay(id).name,def.name,id);assert.equal(itemDisplay(id).kind,def.kind,id);}
  for(const def of Object.values(PASSIVE_DEFS)){assert.equal(itemDisplay(def.id).name,def.name,def.id);assert.equal(itemDisplay(def.id).kind,'passive',def.id);}
  for(const item of allItemDisplays())assert.ok(item.blurb.length<=36&&item.joke.length<=22,`${item.id}: ${item.blurb.length}/${item.joke.length}`);
  assert.equal(itemDisplay('cafe-evo').kind,'evolution');assert.equal(itemDisplay('x-y').name,'X y');
  assert.equal(levelTag('pombo',1),'Novo!');assert.equal(levelTag('pombo',4),'Nív. 4');assert.equal(levelTag('boleto-evo',1),'Evolução');
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
  for(const a of awards)assert.ok(a.title&&a.line&&a.icon,a.id);
});

test('solo awards skip team-only titles; zero metrics win nothing',()=>{
  const solo=computeAwards(fakeResult(1),emptyTally());
  assert.ok(solo.length>=1&&solo.length<=2);
  assert.ok(solo.every(a=>!['rei-do-resgate','turista','bate-nao-mata','figurante'].includes(a.id)));
  const idle=fakeResult(2);idle.players=idle.players.map(p=>({...p,weapons:[],passives:[],stats:{damage:0,kills:0,revives:0,pickups:0}}));
  assert.deepEqual(computeAwards(idle,emptyTally()).map(a=>a.id),['figurante','figurante']);
});

test('runners-up get a vice title with their real place, never a first-place title or figurante',()=>{
  const result=fakeResult(6),awards=computeAwards(result,tallyFor(6));
  const firsts=new Set(['mais-caiu','rei-do-resgate','carregou','exterminador','build-sem-sentido','ima-humano','turista','coxinha','sortudo-do-bau','bate-nao-mata','evolucao','marombeiro']);
  // p1 is 2nd in falls (1 × 4) and in damage (18,4k × 21k): consolation states the place, the earlier award wins the tie.
  const mine=awardsOf(awards,'p1');
  assert.equal(mine.length,1);assert.equal(mine[0].id,'vice-mais-caiu');assert.equal(mine[0].title,'Vice-campeão de tombo');
  assert.match(mine[0].line,/^2º em "Mais caiu"/);assert.equal(mine[0].icon,'podio-2');
  for(const a of awards)if(firsts.has(a.id))assert.ok(!a.id.startsWith('vice-'));
  assert.ok(!awards.some(a=>a.id==='figurante'));
  // Ties share a place: two players tied for 2nd are both "2º", nobody is called 3rd.
  const tie=fakeResult(3);tie.players=tie.players.map((p,i)=>({...p,weapons:[],passives:[],stats:{damage:[30,10,10][i],kills:0,revives:0,pickups:0}}));
  const tied=computeAwards(tie,emptyTally());
  assert.deepEqual(tied.map(a=>[a.playerId,a.id]),[['p1','carregou'],['p2','turista'],['p3','vice-turista']]);
  assert.match(awardsOf(tied,'p3')[0].line,/^Empatou em "Turista"/);
});

test('a vice title goes to one card when the player has another to take (no two "Turista de fim de semana")',()=>{
  // Real room (lab end): one player did all the damage, four did none and are tied for "Turista"; two of them also
  // picked things up. Before, both empty-handed ties showed the same vice; now the second takes its next-best vice.
  const r=fakeResult(5);r.players=r.players.map((p,i)=>({...p,weapons:[],passives:[],stats:{damage:[2400,0,0,0,0][i],kills:[120,0,0,0,0][i],revives:0,pickups:[0,3,2,0,1][i]}}));
  const awards=computeAwards(r,emptyTally());
  const vices=awards.filter(a=>a.id.startsWith('vice-'));
  assert.equal(vices.length,2,JSON.stringify(awards.map(a=>[a.playerId,a.id])));
  assert.equal(new Set(vices.map(a=>a.title)).size,vices.length,JSON.stringify(awards.map(a=>[a.playerId,a.id])));
  assert.match(computeAwards(r,emptyTally()).find(a=>a.id==='ima-humano')!.line,/^Catou 3 coisas/);
});

test('plural: one thing caught is "1 coisa"',()=>{
  const r=fakeResult(1);r.players=r.players.map(p=>({...p,weapons:[],passives:[],stats:{damage:0,kills:0,revives:0,pickups:1}}));
  assert.equal(computeAwards(r,emptyTally()).find(a=>a.id==='ima-humano')?.line,'Catou 1 coisa. Até chiclete.');
});

test('offer and result copy helpers are deterministic pt-BR',()=>{
  assert.equal(offerJoke('lvl-12-p1','level'),offerJoke('lvl-12-p1','level'));
  assert.equal(queueLabel(0),'');assert.equal(queueLabel(2),'+2 na fila');
  const offer=fakeView('offer-round',1).offers[0];
  assert.deepEqual(choiceFlags(offer,2),{isDefault:true});assert.deepEqual(choiceFlags(offer,0),{isDefault:false});
  assert.equal(resultHeadline({victory:true,seed:'a'}).title,'Vitória!');assert.equal(resultHeadline({victory:false,seed:'a'}).title,'Derrota…');
  assert.deepEqual(resultHeadline({victory:true,seed:'x'}),resultHeadline({victory:true,seed:'x'}));
  assert.equal(compactNumber(980),'980');assert.equal(compactNumber(18420),'18,4k');assert.equal(compactNumber(21050),'21k');assert.equal(compactNumber(Number.NaN),'0');
});

test('result build row never wraps: evolutions and weapons first, overflow becomes a +N chip',()=>{
  const full=fakeResult(6,true,true).players[0];
  assert.equal(full.weapons.length+full.passives.length,12);
  const portrait=buildIcons(full,BUILD_SLOTS.portrait);
  assert.deepEqual(portrait.items.map(i=>i.id),['boleto-evo','rojao']);
  assert.equal(portrait.hidden.length,10);assert.equal(portrait.items.length+1,BUILD_SLOTS.portrait);
  assert.equal(buildIcons(full,BUILD_SLOTS.landscape).items.length,5);
  // Fits exactly: no chip wasted on a single hidden item.
  const five={weapons:full.weapons.slice(0,3),passives:full.passives.slice(0,2)};
  assert.deepEqual(buildIcons(five,5).hidden,[]);assert.equal(buildIcons(five,Infinity).items.length,5);
  // Passives sort by level after weapons; ties keep the build order.
  assert.deepEqual(buildIcons({weapons:[],passives:[{id:'cartao',level:1},{id:'bone',level:3},{id:'tenis',level:1}]},9).items.map(i=>i.id),['bone','cartao','tenis']);
});

test('full-build coxinha (HEAL_CHOICE) is a known, funny snack card, not "Item misterioso"',()=>{
  const heal=itemDisplay(HEAL_CHOICE);
  assert.equal(heal.icon,'coxinha');assert.equal(heal.kind,'snack');
  assert.match(heal.name,/Coxinha/);assert.ok(heal.blurb.includes(String(HEAL_AMOUNT)),heal.blurb);assert.ok(heal.joke);
  assert.equal(levelTag(HEAL_CHOICE,1),'Lanche');
});

test('queued offers start their deadline bar full when they become the shown offer',()=>{
  // Server chains deadlines: B waits for A, then gets its own OFFER_SECONDS (progression.ts pushOffer/resolve).
  const a={id:'a',source:'level' as const,level:5,choices:[{itemId:'boleto',level:1}],deadlineTick:1000+ticks(OFFER_SECONDS),defaultIndex:0};
  const b={...a,id:'b',level:6,deadlineTick:1000+ticks(2*OFFER_SECONDS)};
  const shownAt=new Map<string,number>();
  assert.equal(trackShownAt(shownAt,[a,b],1000),1000);assert.ok(!shownAt.has('b'));
  // A resolves after 4 s; B becomes head with its chained deadline.
  const t=1000+ticks(4);
  const start=trackShownAt(shownAt,[b],t)!;
  assert.equal(start,t);assert.ok(!shownAt.has('a'));
  assert.equal(offerDeadlineFraction(b,t,start),1);
  assert.equal(trackShownAt(shownAt,[],t+1),undefined);assert.equal(shownAt.size,0);
});

test('tap guard: a second quick tap on the offer that replaced the chosen one is ignored',()=>{
  const guard=new OfferTapGuard();
  guard.rendered('a',0);
  guard.pointerDown('a',1,500);assert.equal(guard.accept('a',1,520),true);
  // A chosen → B rendered at 520 in the same spot; the finger lands again 120 ms later.
  guard.rendered('b',520);
  guard.pointerDown('b',1,640);assert.equal(guard.accept('b',1,660),false);
  // Deliberate tap after the guard window works.
  guard.pointerDown('b',2,520+OFFER_TAP_GUARD_MS+10);assert.equal(guard.accept('b',2,520+OFFER_TAP_GUARD_MS+30),true);
  // Down on one card, click on another, or down on the old offer: rejected.
  guard.pointerDown('b',0,2000);assert.equal(guard.accept('b',1,2010),false);
  guard.pointerDown('a',0,2000);assert.equal(guard.accept('b',0,2010),false);
  assert.equal(guard.accept('b',0,2020),false,'click without pointerdown');
  // Screen reader / keyboard activation (no pointer) only needs the render delay.
  assert.equal(guard.accept('b',0,2030,true),true);
  guard.rendered('c',3000);assert.equal(guard.accept('c',0,3100,true),false);
});

test('rematch: tally restarts but late events of the old run still dedupe (monotonic eventIds)',()=>{
  const tally=emptyTally(),view=fakeView('wave',2);
  view.events=[{type:'downed',player:'p1',eventId:10},{type:'kill',enemy:'e',kind:'bebado',by:'p2',x:0,y:0,eventId:11}];
  applyEvents(tally,view);
  assert.equal(tally.players.get('p1')!.downs,1);
  resetTally(tally);
  assert.equal(tally.players.size,0);assert.equal(tally.startTick,undefined);
  // A late resend of run 1 (eventId 11) plus run 2 events.
  view.events=[{type:'kill',enemy:'e',kind:'bebado',by:'p2',x:0,y:0,eventId:11},{type:'downed',player:'p2',eventId:12}];
  applyEvents(tally,view);
  assert.equal(tally.players.get('p2')!.kills,0);assert.equal(tally.players.get('p2')!.downs,1);assert.equal(tally.players.get('p1'),undefined);
  // Awards of run 2 only see run 2.
  const awards=computeAwards(fakeResult(2),tally);
  assert.equal(awards.find(a=>a.id==='mais-caiu')?.playerId,'p2');
});

test('D-050 (replaced D-021 in waves): a held offer shows only in the level-up pause, by itself, with no chip and no clock; the intermission opens by itself with a clock',()=>{
  const combat=fakeView('offer',6);
  assert.equal(offerMode(combat),'combat');
  assert.ok(combat.offers.every(o=>o.deadlineTick===HELD_DEADLINE),'fixture mirrors the server hold');
  assert.deepEqual(offerUiState(combat),{mode:'combat',pending:2,chip:false,panel:false,clock:false,seconds:undefined},'a wave outside a pause: nothing (the next pause opens it)');
  assert.deepEqual(offerUiState(combat,false,true),{mode:'combat',pending:2,chip:false,panel:true,clock:false,seconds:undefined},'the pause opens it, the pause HUD has the clock');
  const wave=fakeView('wave',6);
  assert.deepEqual(offerUiState(wave,false,true),{mode:'combat',pending:0,chip:false,panel:false,clock:false,seconds:undefined});
  const prep=fakeView('offer-prepare',6);
  const state=offerUiState(prep);
  assert.equal(state.mode,'intermission');assert.equal(state.panel,true);
  assert.equal(state.chip,true,'the chip stays in the intermission: it folds the window away');
  assert.equal(offerUiState(prep,true).panel,false,'folded: the island and the fallen are visible');
  assert.equal(offerUiState(prep,true).chip,true,'and one tap brings it back');
  assert.ok(prep.offers.length>=TAKE_ALL_MIN,'two waiting: "Levar os indicados" shows');
  assert.equal(state.clock,true);assert.equal(state.seconds,FIXTURE_INTERMISSION_SECONDS);
  // A round offer the offline freeze carried into a wave keeps its real clock on the server; the room pauses for it
  // like for a level (pendingOffers), and in the pause the window has no clock of its own.
  const carried={...combat,offers:[{...prep.offers[1],deadlineTick:combat.tick+ticks(4)}]};
  assert.deepEqual([offerUiState(carried).chip,offerUiState(carried).panel,offerUiState(carried,false,true).panel,offerUiState(carried,false,true).clock],[false,false,true,false]);
  // D-051 drops the rounds: with no round info the pause still wins (window, no chip, not foldable away).
  const roundless={...combat,round:undefined,wave:undefined};
  assert.deepEqual([offerUiState(roundless,true,true).panel,offerUiState(roundless,true,true).chip,offerUiState(roundless,false,true).clock],[true,false,false]);
  // No round info at all (legacy feed): offers open by themselves.
  assert.equal(offerMode({...combat,round:undefined,wave:undefined}),'intermission');
  assert.equal(offerMode({...combat,round:undefined,wave:{index:2,label:'x',phase:'wave'}}),'combat');
  assert.deepEqual(chipText(1),{label:'+1',aria:'1 melhoria esperando. Toca pra escolher.'});
  assert.equal(chipText(2).label,'+2');
});

test('etiqueta price: "Nv" plus the number, "Novo!" on the star, sentence-case words, no caps anywhere',()=>{
  assert.deepEqual(priceTag('boleto',6),{kind:'level',label:'Nív. 6',level:6});
  assert.deepEqual(priceTag('pombo',1),{kind:'new',label:'Novo!'});
  assert.deepEqual(priceTag('boleto-evo',1),{kind:'evo',label:'Evolução'});
  assert.deepEqual(priceTag(HEAL_CHOICE,1),{kind:'snack',label:'Lanche'});
  for(const scenario of ['offer','offer-prepare','offer-round','offer-heal'] as const)for(const offer of fakeView(scenario,1).offers)
    for(const c of offer.choices){const label=priceTag(c.itemId,c.level).label;assert.notEqual(label,label.toUpperCase(),label);}
});

test('DSG review D2: an offer where every card is new says so in the title; mixed offers keep the price slot',()=>{
  const allNew={id:'lvl-2-p1',source:'level' as const,level:2,choices:[{itemId:'pombo',level:1},{itemId:'tenis',level:1},{itemId:'boleto',level:1}],deadlineTick:9,defaultIndex:0};
  assert.equal(isAllNew(allNew),true);
  assert.equal(isAllNew({...allNew,choices:[{itemId:'pombo',level:1},{itemId:'chinelo',level:3}]}),false);
  assert.equal(isAllNew({...allNew,choices:[{itemId:'heal',level:1}]}),false,'the lone coxinha is not "tudo novo"');
});
