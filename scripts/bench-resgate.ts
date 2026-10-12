/**
 * Rescue metric (NEW-20261009-UX-resgate-e-ping): share of caídos rescued before they bleed out, in a room of six bots,
 * before and after the "Me salva" ping. Lab measure on the real Room + Simulation (node, no browser, no network).
 * - before: a bot only goes to a caído it can see (within SIGHT units, about a phone screen around it); else it wanders;
 * - after: every caído pings ({t:'sos'}, 3 s anti-spam); a bot that hears a ping goes to that position (the edge arrow
 *   and the minimap give the same information to a person).
 * Bots never fight on purpose (weapons fire on their own) and wander between random spots of the island, so falls come
 * from the horde. Same seeds for both policies.
 * Run: node --experimental-strip-types scripts/bench-resgate.ts [runs=4] [minutes=4] [ilha|infinito]
 */
import {Room,type Peer} from '../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../multiplayer/simulation.ts';
import {Rng} from '../src/contract/rng.ts';
import {walkable,worldBase} from '../src/maps/world.ts';

const RUNS=Number(process.argv[2])||4,MINUTES=Number(process.argv[3])||4,WORLD=process.argv[4]==='infinito'?'infinito' as const:undefined,SIGHT=7,STEP_MS=50;
/** Wander radius around the base: the island is ~21 u across; the endless world spreads the team wider. */
const SPREAD=WORLD?28:9;
type Policy='before'|'after';
interface Bot {peer:Peer&{messages:any[]};id:string;seq:number;goal?:{x:number;y:number};until:number;heard?:{id:string;x:number;y:number}}

function run(seed:number,policy:Policy){
  const room=new Room(0,1000+seed,WORLD?{world:WORLD}:{}),base=worldBase(room.sim.terrain),rng=new Rng(seed*7919+13),bots:Bot[]=[];
  let now=0;
  for(let i=0;i<6;i++){
    const messages:any[]=[];
    const peer={messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
    room.connect(peer,now);room.receive(peer,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:`Bot ${i}`,classId:'cidadao-comum'}),now);
    bots.push({peer,id:messages.find(m=>m.t==='welcome').id,seq:0,until:0});
  }
  const send=(b:Bot,m:object)=>room.receive(b.peer,JSON.stringify(m),now);
  for(const b of bots)send(b,{t:'ready',round:1,ready:true});
  const end=MINUTES*60_000;
  let downs=0,rescued=0,lost=0;
  const seen=new Map<string,number>();
  for(;now<end;now+=STEP_MS){
    room.advance(now);
    const run=room.run.snapshot();if(run.phase==='result')break;if(run.phase!=='combat')continue;
    const players=[...room.sim.players.values()];
    for(const b of bots){
      const me=room.sim.players.get(b.id);if(!me)continue;
      // A phone stays connected while caído or out (the room drops a peer silent for 12 s).
      if(now%1000===0)send(b,{t:'ack',seq:0});
      // Hear the room's pings (after only: a before-bot ignores them, as if it had no arrow and no minimap).
      for(const m of b.peer.messages.splice(0))if(m.t==='sos'&&policy==='after'&&m.id!==b.id)b.heard={id:m.id,x:m.x,y:m.y};
      if(me.eliminated)continue;
      if(me.downed){if(policy==='after')send(b,{t:'sos',round:run.round});continue;}
      if(b.heard&&!players.find(p=>p.id===b.heard!.id)?.downed)b.heard=undefined;
      const visible=players.filter(p=>p.id!==b.id&&p.downed&&!p.eliminated&&Math.hypot(p.x-me.x,p.y-me.y)<=SIGHT)
        .sort((p,q)=>Math.hypot(p.x-me.x,p.y-me.y)-Math.hypot(q.x-me.x,q.y-me.y))[0];
      let goal=visible?{x:visible.x,y:visible.y}:b.heard?{x:b.heard.x,y:b.heard.y}:undefined;
      if(!goal){
        if(!b.goal||now>b.until||Math.hypot(b.goal.x-me.x,b.goal.y-me.y)<.5){
          let spot={...base};for(let k=0;k<30;k++){const c={x:base.x+rng.range(-SPREAD,SPREAD),y:base.y+rng.range(-SPREAD,SPREAD)};if(walkable(c,room.sim.terrain)){spot=c;break;}}
          b.goal=spot;b.until=now+8000;
        }
        goal=b.goal;
      }
      const dx=goal.x-me.x,dy=goal.y-me.y,d=Math.hypot(dx,dy);
      const close=visible||b.heard?d<.6:d<.3;
      send(b,{t:'input',round:run.round,seq:++b.seq,x:close?0:dx/d,y:close?0:dy/d,attack:false});
    }
    for(const e of room.sim.events){
      if(e.type==='downed'){downs++;seen.set(e.player,room.sim.tick);}
      else if(e.type==='revived'){rescued++;seen.delete(e.player);}
      else if(e.type==='eliminated'){lost++;seen.delete(e.player);}
    }
  }
  return {downs,rescued,lost,pending:seen.size,round:room.sim.world.round.index};
}

const out:Record<Policy,{downs:number;rescued:number;lost:number;pending:number}>={before:{downs:0,rescued:0,lost:0,pending:0},after:{downs:0,rescued:0,lost:0,pending:0}};
for(let s=1;s<=RUNS;s++)for(const policy of ['before','after'] as Policy[]){
  const r=run(s,policy);const o=out[policy];o.downs+=r.downs;o.rescued+=r.rescued;o.lost+=r.lost;o.pending+=r.pending;
  console.log(`seed ${s} ${policy}: ${r.downs} quedas, ${r.rescued} resgatados, ${r.lost} sangraram, round ${r.round}`);
}
for(const policy of ['before','after'] as Policy[]){
  const o=out[policy],decided=o.rescued+o.lost;
  console.log(`${policy==='before'?'antes (sem ping)':'depois (vai até o ping)'}: ${o.rescued}/${decided} resgatados antes de zerar = ${decided?Math.round(o.rescued/decided*100):0}% (${o.downs} quedas, ${o.pending} em aberto no fim)`);
}
