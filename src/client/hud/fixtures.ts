/**
 * Fake RunView/RunResult data for the HUD sandbox and tests (VGM-040). Deterministic, no DOM.
 */
import {ticks} from '../../contract/index.ts';
import {HELD_DEADLINE,RECIPES,UNITS_PER_TOKEN} from '../../rules/index.ts';
import type {OfferView,PlayerRunView,RunView} from '../../contract/index.ts';
import type {SimEvent} from '../../contract/index.ts';
import type {RunResult} from './model.ts';

/**
 * offer: 2 level offers held in combat outside a pause (D-050: nothing shows); offer-open: the same in the level-up
 * pause (the sandbox sets Hud.setPause), the window open by itself; offer-prepare: the intermission queue, a level offer then the round offer; offer-round: the
 * round offer alone (4 tags); offer-heal: the full-build coxinha; offer-new: the production "Tudo novo!" window
 * (BUG-20261012-ORQ-oferta-cortada-retrato): a level offer of three first picks (every tag Nv 1, one-line effects)
 * with the round offer queued behind it, so "Levar os indicados" shows;
 * offer-downed / offer-open-downed: the same intermission window / pause window with two allies down, the last of
 * the team column among them (the window and the strip must never cover SOS, the timer or the "caiu!" banner).
 * Stonewards (VGM-046B): camp-forge: the intermission with the hero in the camp (forge open, one tag short of material:
 * 6 units, 0 fichas de torre); the other scenarios hold 156 units (3 fichas, the ring at 90%: the "falta pouco" look);
 * camp-horn: the horn with the hero far away (last 4 s); camp-wave: a wave with the wall at 22% (low bar, notice).
 */
export type HudScenario='wave'|'prepare'|'offer'|'offer-open'|'offer-prepare'|'offer-round'|'offer-heal'|'offer-new'|'offer-downed'|'offer-open-downed'|'downed'|'boss'|'result'|'camp-forge'|'camp-horn'|'camp-wave';
export const HUD_SCENARIOS:readonly HudScenario[]=['wave','prepare','offer','offer-open','offer-prepare','offer-round','offer-heal','offer-new','offer-downed','offer-open-downed','downed','boss','result','camp-forge','camp-horn','camp-wave'];
/** Where the fixtures put the wall, and the hero spots the sandbox hands the HUD (in the camp / far away). */
export const FIXTURE_WALL={x:12,y:12};
export const FIXTURE_HERO:Partial<Record<HudScenario,{x:number;y:number;bearing?:number}>>={
  'camp-forge':{x:12,y:15},'camp-horn':{x:40,y:52,bearing:-120},'camp-wave':{x:12,y:15},
};

const roster=[
  {id:'p1',name:'Mateus',classId:'cidadao-comum'},
  {id:'p2',name:'Tia Cleide',classId:'merendeira'},
  {id:'p3',name:'Zé do Pix',classId:'viciado-em-bet'},
  {id:'p4',name:'Bruninha',classId:'motogirl'},
  {id:'p5',name:'Seu Jorge',classId:'aposentado'},
  {id:'p6',name:'Kaique Mil Grau',classId:'gamer-mobile'},
];
const builds=[
  {weapons:[{id:'chinelo',level:5},{id:'cafe',level:3}],passives:[{id:'tenis',level:2},{id:'marmita',level:1}]},
  {weapons:[{id:'boleto',level:4},{id:'pombo',level:2}],passives:[{id:'cartao',level:3}]},
  {weapons:[{id:'audio',level:2},{id:'guarda-chuva',level:1},{id:'pombo',level:1},{id:'cafe',level:1}],passives:[{id:'bone',level:4},{id:'ima',level:1},{id:'megafone',level:1}]},
  {weapons:[{id:'chinelo-evo',level:1},{id:'boleto',level:2}],passives:[{id:'tenis',level:5},{id:'oculos',level:2}]},
  {weapons:[{id:'guarda-chuva',level:6}],passives:[{id:'marmita',level:5},{id:'cafe-forte',level:2}]},
  {weapons:[{id:'pombo',level:7},{id:'audio',level:3}],passives:[{id:'oculos',level:4},{id:'megafone',level:2},{id:'ima',level:3}]},
];
const stats=[
  {damage:18420,kills:212,revives:1,pickups:140},
  {damage:9120,kills:96,revives:5,pickups:88},
  {damage:2310,kills:23,revives:0,pickups:301},
  {damage:15200,kills:180,revives:2,pickups:120},
  {damage:6100,kills:51,revives:3,pickups:44},
  {damage:21050,kills:240,revives:0,pickups:97},
];

/**
 * Each fixture player's wallet (carteira-e-pix, SimPlayer.grana on the wire): the PIX balloon shows a friend's; p1's
 * equals the camp's R$ 23 (CampView.grana is the viewer's own), Zé do Pix has R$ 0, Kaique more than PIX_MAX.
 */
export const FIXTURE_GRANA=[23,40,0,12,7,150] as const;
export function fakePlayers(count:number,scenario:HudScenario='wave'):PlayerRunView[]{
  return roster.slice(0,Math.max(1,Math.min(6,count))).map((entry,index)=>{
    const maxHp=100+index*10;
    const player:PlayerRunView&{grana:number}={...entry,hp:Math.round(maxHp*[0.92,0.55,0.18,0.74,1,0.33][index]),maxHp,online:index!==4||count<6,spectator:false,weapons:builds[index].weapons,passives:builds[index].passives,stats:stats[index],grana:FIXTURE_GRANA[index]};
    if(scenario==='downed'&&(index===0||index===2)){player.hp=0;player.downed={progress:index===2?0.45:0,bleedOutTick:1000+ticks(index===0?21:12)};}
    if((scenario==='offer-downed'||scenario==='offer-open-downed')&&(index===2||index===count-1)&&index>0){player.hp=0;player.online=true;player.downed={progress:0,bleedOutTick:1000+ticks(index===2?13:17)};}
    return player;
  });
}

/** Intermission deadline of the fixtures (round.phaseEndsTick in prepare). */
export const FIXTURE_INTERMISSION_SECONDS=17;
function fakeOffer(source:'level'|'round',deadlineTick:number,level=12):OfferView{
  return source==='round'
    ?{id:'rnd-4-p1',source,level:4,choices:[{itemId:'cafe-forte',level:3},{itemId:'pombo',level:1},{itemId:'chinelo',level:6},{itemId:'bone',level:1}],deadlineTick,defaultIndex:2}
    :level===12?{id:'lvl-12-p1',source,level,choices:[{itemId:'boleto',level:1},{itemId:'megafone',level:2},{itemId:'chinelo',level:6}],deadlineTick,defaultIndex:0}
    :{id:`lvl-${level}-p1`,source,level,choices:[{itemId:'tenis',level:3},{itemId:'audio',level:1},{itemId:'cartao',level:2}],deadlineTick,defaultIndex:2};
}

export function fakeView(scenario:HudScenario,playerCount:number,tick=1000):RunView{
  const prepare=scenario==='prepare'||scenario==='offer-round'||scenario==='offer-prepare'||scenario==='offer-heal'||scenario==='offer-new'||scenario==='offer-downed'||scenario==='camp-forge'||scenario==='camp-horn';
  const ends=tick+ticks(prepare?FIXTURE_INTERMISSION_SECONDS:60);
  const boss=scenario==='boss';
  const index=boss?10:prepare?4:3;
  const view:RunView={
    tick,
    team:{xp:37,level:12,nextXp:58},
    round:{index,total:10,phase:prepare?'prepare':'wave',phaseEndsTick:ends,remaining:prepare?0:boss?6:23},
    enemies:boss?[{id:'e-boss',kind:'chefe',x:12,y:12,hp:6200,maxHp:9000,boss:true,phase:1}]:[],
    pickups:[],projectiles:[],telegraphs:[],
    structures:[{id:'s1',kind:'muralha',...FIXTURE_WALL,hp:scenario==='camp-wave'?132:scenario==='camp-forge'?410:540,maxHp:600},
      ...(scenario==='camp-forge'?[{id:'s2',kind:'torre-chinelo',x:13,y:14,hp:80,maxHp:80,untilTick:tick+ticks(30)}]:[])],
    // Grana R$ 23 (D-048): in the obra a tier-2 or -3 evolution yes, a tier-4 (R$ 25) not; 3 fichas with the ring at 90%.
    // In the forge scene the gambiarra's price + 1: the repair and the gambiarra yes, the chinelo tower short.
    camp:{units:scenario==='camp-forge'?6:3*UNITS_PER_TOKEN+Math.round(.9*UNITS_PER_TOKEN),grana:scenario==='camp-forge'?RECIPES.gambiarra.cost+1:23,
      ...(scenario==='camp-horn'?{hornEndsTick:tick+ticks(4)}:{})},
    players:fakePlayers(playerCount,scenario),
    // Combat: the server holds level offers until the intermission (D-021, HELD_DEADLINE).
    offers:scenario==='offer'||scenario==='offer-open'||scenario==='offer-open-downed'?[fakeOffer('level',HELD_DEADLINE),fakeOffer('level',HELD_DEADLINE,13)]
      :scenario==='offer-prepare'||scenario==='offer-downed'?[fakeOffer('level',ends),fakeOffer('round',ends)]
      :scenario==='offer-round'?[fakeOffer('round',ends)]
      :scenario==='offer-new'?[{id:'lvl-3-p1',source:'level',level:3,choices:[{itemId:'guarda-chuva',level:1},{itemId:'bone',level:1},{itemId:'pombo',level:1}],deadlineTick:ends,defaultIndex:0},fakeOffer('round',ends)]
      // Full build: the server's only choice is the coxinha (HEAL_CHOICE in sim/offers.ts).
      :scenario==='offer-heal'?[{id:'lvl-31-p1',source:'level',level:31,choices:[{itemId:'heal',level:1}],deadlineTick:ends,defaultIndex:0}]:[],
    events:[],
  };
  return view;
}

/** Late-run worst case: 6 weapons + 6 passives each (the most a build can hold), for layout stress tests. */
const FULL_BUILD={
  weapons:[{id:'chinelo-evo',level:1},{id:'boleto',level:8},{id:'cafe',level:7},{id:'guarda-chuva',level:6},{id:'pombo',level:5},{id:'audio',level:4}],
  passives:[{id:'cafe-forte',level:5},{id:'marmita',level:5},{id:'tenis',level:4},{id:'megafone',level:3},{id:'bone',level:2},{id:'ima',level:1}],
};

export function fakeResult(playerCount:number,victory=true,full=false):RunResult{
  const players=fakePlayers(playerCount,'result').map(player=>full?{...player,...FULL_BUILD}:player);
  // The run's most embarrassing moment (VGM-053B), on the longest sentence: a recaída needs the most words.
  const shame=players.length?{player:players[Math.min(2,players.length-1)].id,key:'recaida' as const,round:7,tick:7000,seconds:3}:undefined;
  return {victory,durationTicks:ticks(14*60+37),round:victory?10:7,totalRounds:10,seed:'pave-4271',players,...(shame?{shame}:{})};
}

/** Falls, rescues, coxinhas and chests for the result scenario, so tally-based awards show up. */
export function fakeResultEvents(playerCount:number,nextId:()=>number):(SimEvent&{eventId:number})[]{
  const ids=fakePlayers(playerCount).map(p=>p.id);
  const at=(i:number)=>ids[i%ids.length];
  const events:SimEvent[]=[
    ...Array.from({length:4},():SimEvent=>({type:'downed',player:at(2)})),
    {type:'downed',player:at(0)},{type:'revived',player:at(2),by:at(1)},
    ...Array.from({length:3},(_,i):SimEvent=>({type:'pickup',player:at(4),pickup:`k-${i}`,kind:'heal',value:30})),
    {type:'pickup',player:at(3),pickup:'c-1',kind:'chest',value:1},
  ];
  return events.map(event=>({...event,eventId:nextId()}));
}
