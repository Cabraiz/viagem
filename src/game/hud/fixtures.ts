/**
 * Fake RunView/RunResult data for the HUD sandbox and tests (VGM-040). Deterministic, no DOM.
 */
import {ticks} from '../sim/types.ts';
import type {OfferView,PlayerRunView,RunView} from '../sim/view.ts';
import type {SimEvent} from '../sim/types.ts';
import type {RunResult} from './model.ts';

export type HudScenario='wave'|'prepare'|'offer'|'offer-round'|'downed'|'boss'|'result';
export const HUD_SCENARIOS:readonly HudScenario[]=['wave','prepare','offer','offer-round','downed','boss','result'];

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
    return player;
  });
}

function fakeOffer(source:'level'|'round',tick:number):OfferView{
  return source==='round'
    ?{id:'rnd-4-p1',source,level:4,choices:[{itemId:'cafe-forte',level:3},{itemId:'pombo',level:1},{itemId:'chinelo',level:6},{itemId:'bone',level:1}],deadlineTick:tick+ticks(14),defaultIndex:2}
    :{id:'lvl-12-p1',source,level:12,choices:[{itemId:'boleto',level:1},{itemId:'megafone',level:2},{itemId:'chinelo',level:6}],deadlineTick:tick+ticks(6),defaultIndex:0};
}

export function fakeView(scenario:HudScenario,playerCount:number,tick=1000):RunView{
  const prepare=scenario==='prepare'||scenario==='offer-round';
  const boss=scenario==='boss';
  const index=boss?10:prepare?4:3;
  const view:RunView={
    tick,
    team:{xp:37,level:12,nextXp:58},
    round:{index,total:10,phase:prepare?'prepare':'wave',phaseEndsTick:tick+ticks(prepare?17:60),remaining:prepare?0:boss?6:23},
    enemies:boss?[{id:'e-boss',kind:'chefe',x:12,y:12,hp:6200,maxHp:9000,boss:true,phase:1}]:[],
    pickups:[],projectiles:[],telegraphs:[],structures:[],
    players:fakePlayers(playerCount,scenario),
    offers:scenario==='offer'?[fakeOffer('level',tick),fakeOffer('round',tick)]:scenario==='offer-round'?[fakeOffer('round',tick)]:[],
    events:[],
  };
  return view;
}

export function fakeResult(playerCount:number,victory=true):RunResult{
  return {victory,durationTicks:ticks(14*60+37),round:victory?10:7,totalRounds:10,seed:'pave-4271',players:fakePlayers(playerCount,'result')};
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
