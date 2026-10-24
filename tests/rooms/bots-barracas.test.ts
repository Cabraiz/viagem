// NEW-20261023-ORQ-barracas-no-caminho, etapa 4: the room bots collect the map's barracas in a lull and set them near the
// Uno (bot-barracas.ts), in a real city Room in mode 'ninhos' (manual combat). One person (invulnerable, at the car)
// and two bots; within two minutes of combat a bot has collected a barraca and a new one stands near the car.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {CAR_ID} from '../../src/contract/index.ts';
import {piecesOf} from '../../src/sim/towers/free-build.ts';
import {BARRACA_HOME,planBarraca,barracaDrop,BARRACA_DROP_RING} from '../../src/sim/bot-barracas.ts';
import {kitId} from '../../src/rules/index.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);

test('the room bots carry a barraca of the map rows to the Uno in a lull',async()=>{
  const t0=Date.now(),room=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',solo:true,mode:'ninhos',combat:'manual'});
  await room.ready();
  const a=peer();room.connect(a,t0);
  say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t0);
  say(room,a,{t:'bot-add',round:room.run.snapshot().round},t0+1100);
  say(room,a,{t:'bot-add',round:room.run.snapshot().round},t0+2200);
  let t=t0+2300;
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(let i=0;i<1200&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  assert.equal(room.run.snapshot().phase,'combat');
  room.advance(t+=50);
  const state=room.sim.run.stonewards.state,car=room.sim.botView().structures.find(s=>s.kind===CAR_ID)!;
  assert.ok(car,'the Uno is on the map');
  const ana=[...room.sim.players.values()].find(p=>!room.sim.bots.has(p.id))!;
  ana.invulnerableUntil=Number.MAX_SAFE_INTEGER;ana.x=car.x+1.6;ana.y=car.y;
  const near=()=>piecesOf(state).filter(p=>p.kind==='barraca'&&Math.hypot(p.x-car.x,p.y-car.y)<=BARRACA_HOME).map(p=>p.id);
  const before=new Set(near()),rows=piecesOf(state).filter(p=>p.kind==='barraca').length;
  assert.ok(rows>0,'the map has its rows');
  for(let i=0;i<120*20&&room.bots.barracas<1;i++){
    if(i%20===0)say(room,a,{t:'ack',seq:0},t);
    room.advance(t+=50);
  }
  assert.ok(room.bots.coletas>=1,'a bot started a coleta');
  assert.ok(room.bots.barracas>=1,`a bot set a barraca (coletas ${room.bots.coletas})`);
  const added=near().filter(id=>!before.has(id));
  assert.ok(added.length>=1,'a new barraca stands near the Uno');
});

test('planBarraca: a free bot goes to the nearest barraca it is the nearest free bot to; with the kit, to its drop',()=>{
  const car={id:'c1',kind:CAR_ID,x:50,y:50,hp:1,maxHp:1},row={id:'b1',kind:'barraca',x:70,y:50,hp:240,maxHp:240};
  const me={id:'bot-1',online:true,hp:100,maxHp:100,weapons:[{id:'faca',level:1}],x:66,y:50} as any;
  const other={id:'bot-2',online:true,hp:100,maxHp:100,weapons:[{id:'faca',level:1}],x:90,y:50} as any;
  const view={tick:100,enemies:[],players:[me,other],structures:[car,row]} as any,memory:any={};
  const plan=planBarraca(view,me,me,0,memory,undefined,['bot-1','bot-2'],40)!;
  assert.equal(plan.goal?.id,'b1');assert.equal(plan.command,undefined,'too far to collect');
  // The other bot is nearer: this one leaves it.
  assert.equal(planBarraca({...view,players:[me,{...other,x:71}]},me,me,0,{},undefined,['bot-1','bot-2'],40),undefined);
  // In reach: the coleta, once (again only when it would have ended).
  const close={...me,x:68.5};
  assert.deepEqual(planBarraca(view,close,close,0,memory,undefined,['bot-1','bot-2'],40)!.command,{t:'coletar',piece:'b1'});
  assert.equal(planBarraca(view,close,close,0,memory,undefined,['bot-1','bot-2'],40)!.command,undefined);
  // A critter near: no barraca business.
  assert.equal(planBarraca({...view,enemies:[{id:'e',x:67,y:50,hp:5}]},me,me,0,{},undefined,['bot-1'],40),undefined);
  // With the kit: the drop point on the ring toward the source (no city: straight), the kit set once there.
  const holding={...me,weapons:[{id:'faca',level:1},{id:kitId('barraca'),level:1}],x:60,y:50};
  const drop=barracaDrop(view,car,0,undefined);
  assert.ok(Math.abs(Math.hypot(drop.x-car.x,drop.y-car.y)-BARRACA_DROP_RING)<1e-9);
  const m2:any={},go=planBarraca(view,holding,holding,0,m2,undefined,['bot-1'],40)!;
  assert.equal(go.goal?.id,'barraca-drop');assert.equal(go.command,undefined);
  const at={...holding,x:m2.barracaDrop.x,y:m2.barracaDrop.y};
  assert.deepEqual(planBarraca(view,at,at,0,m2,undefined,['bot-1'],40)!.command,{t:'kit',slot:1});
});
