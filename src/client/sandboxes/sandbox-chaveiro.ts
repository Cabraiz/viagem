/**
 * Fake chaveiro objective for the city sandbox (card NEW-20261013-ORQ-chaveiro-render): `objetivo=1` with
 *  - `moto=anda|lombada|volta|morta|entrega|tombo|abrindo` (default anda: he rides the whole route in a 40 s loop; the
 *    others stop him at their point of the route: the speed bump, 85 %, the 2nd dead point, the delivery, 90 %, the car),
 *  - `rota=N|S|L|O` (the avenue end he comes from, real map; default N),
 *  - `pecas=0..15` (the fallen parts' bits: para-choque 1, retrovisor 2, porta 4, capô 8) or `cai=1` (one more falls
 *    every 2.5 s, then they all come back),
 *  - `pancadas=N` (hits of the limit 80; default 20 per fallen part), `alarme=1` (the alarm sounds),
 *  - `empurra=0..1` (the push with mode morta; default it fills in a 4 s loop),
 *  - `fim=vitoria|derrota` (the end: he opened it, or perda total),
 *  - `anda=<graus>` (D-052, the car moves: `voce` pulls it back and forth along that heading, CAR_SWING_U each way in
 *    a CAR_SWING_MS loop; it reverses at the ends, the nose kept),
 *  - `empurrando=<graus>` (card empurrar-uno): the car rolls straight ahead along that heading at `vel=` u/s (default
 *    CAR_SPEED's top, 3.6) over PUSH_SPAN_U and starts over, pushed by `voce` (a mover, no rope).
 *  - `fala=alarme,venda,peca,…` (card chaveiro-falas): those moments' events (fakeTalkEvents), one every FALA_EVERY_MS
 *    from FALA_AT_MS (`falaEm=ms` instead) after the first frame, through the game's line timing (render/chaveiro/talk.ts)
 *    into the zueiras' balloons; `seed=N` the room's seed.
 * The car stands at the plaza (asset point `praca`). Without `hero`, the hero stands next to the moto (or the car).
 * Deterministic from the clock only; nothing talks to the server.
 */
import {M} from '../render/chaveiro/iso.ts';
import type {ChaveiroView,MotoMode,StopKind} from '../render/chaveiro/view.ts';
import type {LooseEvent} from '../render/chaveiro/talk.ts';

type Pt={x:number;y:number};
/** anda=: how far the car swings each way (units) and the loop (ms): ≈ 1.6 u/s at the middle, a mover's speed. */
export const CAR_SWING_U=1.5,CAR_SWING_MS=6000;
/** anda=: the car's offset from its spot at `now` (units) along `heading` (radians). */
export const carSwing=(now:number,heading:number)=>{const s=CAR_SWING_U*Math.sin(now/CAR_SWING_MS*Math.PI*2);return {x:Math.cos(heading)*s,y:Math.sin(heading)*s};};
/** empurrando=: the stretch the car rolls before it starts over (units). */
export const PUSH_SPAN_U=8;
/** empurrando=: the car's offset from its spot at `now` (units), rolling ahead along `heading` at `speed` u/s. */
export const carRoll=(now:number,heading:number,speed:number)=>{const s=(now/1000*speed)%PUSH_SPAN_U-PUSH_SPAN_U/2;return {x:Math.cos(heading)*s,y:Math.sin(heading)*s};};
const MODES:readonly MotoMode[]=['anda','lombada','volta','morta','entrega','tombo','abrindo'];
/** The moto parks this far behind the car's back (units) when he arrives. */
const CAR_STOP=3.2*M;
/** One loop of the route in mode anda (ms). */
const LOOP_MS=40000;
/** Where the stops sit along the route (share of its length), like the sim's proposal: dead 25/55/80 %, bumps, deliveries. */
const STOPS:readonly {kind:StopKind;at:number}[]=[
  {kind:'morta',at:.25},{kind:'lombada',at:.4},{kind:'morta',at:.55},{kind:'entrega',at:.65},{kind:'morta',at:.8},
];
/** Where each stopped mode stands (share of the route); abrindo: at the car. */
const MODE_AT:Readonly<Record<Exclude<MotoMode,'anda'|'abrindo'>,number>>={lombada:.4,volta:.85,morta:.55,entrega:.65,tombo:.9};

export interface FakeChaveiro {
  view(now:number):{view:ChaveiroView;tick:number};
  /** Where the hero stands without `hero`. */
  heroAt:Pt;
}

/** Length of a polyline and the point at share `t` of it. */
function along(route:readonly Pt[],t:number):Pt{
  const lens=route.slice(1).map((p,i)=>Math.hypot(p.x-route[i].x,p.y-route[i].y)),total=lens.reduce((s,l)=>s+l,0);
  let left=Math.max(0,Math.min(1,t))*total;
  for(let i=0;i<lens.length;i++){
    if(left<=lens[i]||i===lens.length-1){const k=lens[i]?Math.min(1,left/lens[i]):0;return {x:route[i].x+(route[i+1].x-route[i].x)*k,y:route[i].y+(route[i+1].y-route[i].y)*k};}
    left-=lens[i];
  }
  return {...route[route.length-1]};
}
const routeLength=(route:readonly Pt[])=>route.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-route[i].x,p.y-route[i].y),0);

/**
 * The fake objective around the plaza `car`, the moto coming from `from` (an avenue end) through `mouth` (a plaza
 * mouth), or from `fallback` when the map has no such points.
 */
export function fakeChaveiro(params:URLSearchParams,car:Pt,from?:Pt,mouth?:Pt,fallback?:Pt):FakeChaveiro{
  const mode=(MODES as readonly string[]).includes(params.get('moto')??'')?params.get('moto') as MotoMode:'anda';
  const end={x:car.x-CAR_STOP,y:car.y+1.6*M};
  const start=from??fallback??{x:car.x-12,y:car.y+6};
  const route:Pt[]=[start,...(mouth?[mouth]:[]),end].map(p=>({x:+p.x.toFixed(3),y:+p.y.toFixed(3)}));
  const stops=STOPS.map(s=>({kind:s.kind,...along(route,s.at),s:+(s.at*routeLength(route)).toFixed(2)}));
  const fixedParts=Math.max(0,Math.min(15,Number(params.get('pecas'))|0)),cycle=params.get('cai')==='1';
  const alarm=params.get('alarme')==='1';
  const ended=params.get('fim')==='vitoria'?'victory':params.get('fim')==='derrota'?'defeat':undefined;
  const swing=params.has('anda')?(Number(params.get('anda'))||0)*Math.PI/180:undefined;
  const roll=params.has('empurrando')?(Number(params.get('empurrando'))||0)*Math.PI/180:undefined,rollSpeed=Number(params.get('vel'))||3.6;
  const pushParam=params.has('empurra')?Math.max(0,Math.min(1,Number(params.get('empurra')))):undefined;
  const stillMode:MotoMode=ended==='victory'?'abrindo':mode;
  const stillAt=stillMode==='anda'?.15:stillMode==='abrindo'?1:MODE_AT[stillMode];
  const motoStill=along(route,stillAt);
  const heroAt=ended||stillMode==='abrindo'?{x:car.x+1.2,y:car.y+2.4}:{x:motoStill.x+1.3,y:motoStill.y+1.3};
  return {heroAt,view(now){
    const tick=Math.floor(now/100);
    const parts=cycle?(1<<(Math.floor(now/2500)%5))-1:ended==='defeat'?15:fixedParts;
    const fell=[1,2,4,8].filter(b=>parts&b).length;
    const hits=Number(params.get('pancadas'))||(ended==='defeat'?80:fell*20);
    const t=stillMode==='anda'?(now%LOOP_MS)/LOOP_MS:stillAt;
    const moto=stillMode==='anda'?along(route,t):motoStill;
    const total=routeLength(route),speed=total/(LOOP_MS/1000);
    const nextDelivery=stops.find(s=>s.kind==='entrega'&&s.s>t*total);
    const delivery=stillMode==='anda'&&nextDelivery?{x:nextDelivery.x,y:nextDelivery.y,etaS:(nextDelivery.s-t*total)/speed}:undefined;
    const etaS=ended?0:stillMode==='abrindo'?Math.max(0,15-(now/1000)%15):Math.round((1-t)*600);
    const view:ChaveiroView={
      moto:{...moto,mode:stillMode,...(stillMode==='morta'?{push:pushParam??((now%4000)/4000)}:{})},
      etaS,alarmUntil:alarm?tick+50:0,
      ...(delivery?{delivery}:{}),
      car:{...(roll!==undefined?(o=>({x:car.x+o.x,y:car.y+o.y,movers:['voce']}))(carRoll(now,roll,rollSpeed)):swing===undefined?{x:car.x,y:car.y}:(o=>({x:car.x+o.x,y:car.y+o.y,movers:['voce']}))(carSwing(now,swing))),hits:Math.min(80,hits),limit:80,parts},
      route,stops,...(ended?{ended}:{}),
    };
    return {view,tick};
  }};
}

/** `fala=`: the first moment's event at FALA_AT_MS, then one every FALA_EVERY_MS (past the cast's line gap). */
export const FALA_AT_MS=1200,FALA_EVERY_MS=5000;
/** The protocol-15 event (or main's boss arrival) of each `fala=` moment. */
const FALA_EVENTS:Readonly<Record<string,LooseEvent>>={
  alarme:{type:'alarm',untilTick:0},venda:{type:'sale',enemy:'e1'},compra:{type:'buy',player:'self',item:'cocada'},
  peca:{type:'part',name:'porta'},chefe:{type:'boss-phase',enemy:'boss',phase:1},acordou:{type:'acordou',x:0,y:0,n:4},sozinha:{type:'moto',mode:'tranco',alone:true},
  ...Object.fromEntries(['morta','tranco','lombada','entrega','tombo','volta','abrindo','chegou'].map(m=>[m,{type:'moto',mode:m}])),
};
/** The `fala=` moments' events due in (from, to] ms (eventId: the moment's order), unknown names skipped. */
export function fakeTalkEvents(params:URLSearchParams,from:number,to:number):LooseEvent[]{
  const names=(params.get('fala')??'').split(',').filter(n=>Object.hasOwn(FALA_EVENTS,n));
  const out:LooseEvent[]=[],first=params.has('falaEm')?Number(params.get('falaEm'))||0:FALA_AT_MS;
  names.forEach((n,i)=>{const at=first+i*FALA_EVERY_MS;if(at>from&&at<=to)out.push({...FALA_EVENTS[n],eventId:i});});
  return out;
}
