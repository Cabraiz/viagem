/**
 * Fake RunView/RunResult data for the HUD sandbox and tests (VGM-040). Deterministic, no DOM.
 */
import {ticks} from '../sim/types.ts';
import {HELD_DEADLINE} from '../sim/offers.ts';
import type {OfferView,PlayerRunView,RunView} from '../sim/view.ts';
import type {SimEvent} from '../sim/types.ts';
import type {RunResult} from './model.ts';

/**
 * offer: 2 level offers held in combat (chip only); offer-open: the same with the compact panel opened from the chip
 * (the sandbox taps it); offer-prepare: the intermission queue, a level offer then the round offer; offer-round: the
 * round offer alone (4 tags); offer-heal: the full-build coxinha;
 * offer-downed / offer-open-downed: the same intermission window / combat strip with two allies down, the last of
 * the team column among them (the window and the strip must never cover SOS, the timer or the "caiu!" banner).
 */
export type HudScenario='wave'|'prepare'|'offer'|'offer-open'|'offer-prepare'|'offer-round'|'offer-heal'|'offer-downed'|'offer-open-downed'|'downed'|'boss'|'result';
export const HUD_SCENARIOS:readonly HudScenario[]=['wave','prepare','offer','offer-open','offer-prepare','offer-round','offer-heal','offer-downed','offer-open-downed','downed','boss','result'];

const roster=[
  {id:'p1',name:'Mateus',classId:'cidadao-comum'},
  {id:'p2',name:'Tia Cleide',classId:'tia-festa'},
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

export function fakePlayers(count:number,scenario:HudScenario='wave'):PlayerRunView[]{
  return roster.slice(0,Math.max(1,Math.min(6,count))).map((entry,index)=>{
    const maxHp=100+index*10;
    const player:PlayerRunView={...entry,hp:Math.round(maxHp*[0.92,0.55,0.18,0.74,1,0.33][index]),maxHp,online:index!==4||count<6,spectator:false,weapons:builds[index].weapons,passives:builds[index].passives,stats:stats[index]};
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
  const prepare=scenario==='prepare'||scenario==='offer-round'||scenario==='offer-prepare'||scenario==='offer-heal'||scenario==='offer-downed';
  const ends=tick+ticks(prepare?FIXTURE_INTERMISSION_SECONDS:60);
  const boss=scenario==='boss';
  const index=boss?10:prepare?4:3;
  const view:RunView={
    tick,
    team:{xp:37,level:12,nextXp:58},
    round:{index,total:10,phase:prepare?'prepare':'wave',phaseEndsTick:ends,remaining:prepare?0:boss?6:23},
    enemies:boss?[{id:'e-boss',kind:'chefe',x:12,y:12,hp:6200,maxHp:9000,boss:true,phase:1}]:[],
    pickups:[],projectiles:[],telegraphs:[],structures:[],
    players:fakePlayers(playerCount,scenario),
    // Combat: the server holds level offers until the intermission (D-021, HELD_DEADLINE).
    offers:scenario==='offer'||scenario==='offer-open'||scenario==='offer-open-downed'?[fakeOffer('level',HELD_DEADLINE),fakeOffer('level',HELD_DEADLINE,13)]
      :scenario==='offer-prepare'||scenario==='offer-downed'?[fakeOffer('level',ends),fakeOffer('round',ends)]
      :scenario==='offer-round'?[fakeOffer('round',ends)]
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
  return {victory,durationTicks:ticks(14*60+37),round:victory?10:7,totalRounds:10,seed:'pave-4271',players};
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
