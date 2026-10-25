/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1, etapa 4: the chefão's balance, time to kill with 1, 3 and 6 players. A real
 * room on Cidade Nevada (mode 'ninhos', manual combat) in node: the owner connected, played by a room bot's brain plus N−1 room
 * bots, everyone placed by the Uno, the chefão called at once ({t:'lab',chefao:true}'s path) and the sim run until he
 * falls (or CAP_S). Starting kits: the floor of a real fight at the end of wave 1 (heroes there have a few levels more).
 *
 *   node --experimental-strip-types evidence/NEW-20261023-ORQ-boss-fim-onda-1/balanco.ts [seeds=3]
 */
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {Room,OWNER_GAP_MS}=await import('../../multiplayer/room.ts');
const {ROOM_PROTOCOL}=await import('../../src/protocol/room.ts');
const {clientCatalog}=await import('../../src/protocol/map-catalog.ts');

const root=new URL('../../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('public/maps/cidade-nevada.manifest.json',root),'utf8'));
const cityText=readFileSync(new URL('public/maps/cidade-nevada.json',root),'utf8');
const CITY={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
const CAP_S=600,SEEDS=Number(process.argv[2]??3);
const say=(room:any,p:any,m:object,now:number)=>room.receive(p,JSON.stringify(m),now);
const peer=()=>({messages:[] as any[],send(s:string|Uint8Array){if(typeof s==='string')this.messages.push(JSON.parse(s));},close(){}});

async function fight(players:number,seed:number){
  let t=1000;
  const room:any=new Room(t,seed,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',mode:'ninhos',combat:'manual'}),a=peer();
  await room.ready();
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  for(let i=1;i<players;i++)say(room,a,{t:'bot-add',round:room.run.snapshot().round},t+=OWNER_GAP_MS+10);
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t+=OWNER_GAP_MS+10);
  for(let i=0;i<4000&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  // The owner stays connected (the room counts it, hp × players) and plays with a room bot's brain.
  const me=[...room.sim.players.values()].find((p:any)=>p.name==='Ana').id;
  room.bots.add(me,room.bots.freeSlot());
  const car=room.sim.run.chaveiro?.state.car;
  for(const p of room.sim.players.values()){p.x=car.x+2;p.y=car.y+2;}
  room.sim.summonChefao();
  let called:number|undefined,maxHp=0,downs=0;
  const start=room.sim.tick;
  for(let i=0;i<CAP_S*20*2;i++){
    say(room,a,{t:'ping',at:t},t);room.advance(t+=50);
    const c=room.sim.run.chefao.state;
    if(called===undefined&&c.called!==undefined){called=c.called;maxHp=room.sim.world.enemies.get(c.enemy)?.maxHp??0;}
    for(const p of room.sim.players.values())if(p.downed&&!p.__seen){p.__seen=true;downs++;}else if(!p.downed)p.__seen=false;
    if(c.boss.defeated)return {players,seed,maxHp,s:(room.sim.tick-(called??start))/20,downs,result:'caiu'};
    if(room.run.snapshot().phase!=='combat'){const e=room.sim.world.enemies.get(c.enemy);return {players,seed,maxHp,s:(room.sim.tick-(called??start))/20,downs,result:`time perdeu (chefão com ${Math.round(e?.hp??0)}/${maxHp})`};}
    if(called!==undefined&&room.sim.tick-called>CAP_S*20)break;
  }
  const e=room.sim.world.enemies.get(room.sim.run.chefao.state.enemy);
  return {players,seed,maxHp,s:CAP_S,downs,result:`não caiu (hp ${e?.hp?.toFixed(0)}/${maxHp})`};
}

for(const n of (process.argv[3]??'1,3,6').split(',').map(Number))for(let s=1;s<=SEEDS;s++){
  const r=await fight(n,100+s);
  console.log(JSON.stringify(r));
}
