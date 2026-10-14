// NEW-20261012-ORQ-cidade-06-base-praca: the forge tap's optional `target` ({t:'forge',round,recipe,req,target?}).
// The room drops any target that is not 'muralha' or 'barricada-N|S|L|O' before the simulation; a valid one reaches
// stonewards buy as targetId; a tap without it repairs the wall, as older phones always did.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FORGE_REFUSALS,RECIPES} from '../../src/rules/index.ts';
import {cityTerrainFrom,cityAsField} from '../../src/maps/index.ts';

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
const join=(r:Room,p:Peer,n='Amigo',now=1000)=>{r.connect(p,now);r.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:n,classId:'cidadao-comum'}),now);};
const command=(room:Room,p:Peer,message:object,now=1100)=>room.receive(p,JSON.stringify(message),now);
const idOf=(p:ReturnType<typeof peer>)=>p.messages.find(m=>m.t==='welcome').id as string;
const forged=(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='forged');
function startRun(room:Room,peers:ReturnType<typeof peer>[]){
  for(const p of peers)command(room,p,{t:'ready',round:room.run.snapshot().round,ready:true});
  for(let i=0;i<60;i++)room.advance(1200+i*50);
  assert.equal(room.run.snapshot().phase,'combat');
}

test('a forge tap with a forged target is dropped before the simulation; a valid one is forwarded as targetId',()=>{
  const room=new Room(1000),a=peer();join(room,a);startRun(room,[a]);
  const round=room.run.snapshot().round,calls:unknown[][]=[];
  const real=room.sim.forge.bind(room.sim);
  room.sim.forge=(...args:Parameters<Simulation['forge']>)=>{calls.push(args);return real(...args);};
  const bad:unknown[]=[null,0,1,true,'',{},['barricada-N'],'barricada-X','barricada-n','barricada-NS','Barricada-N','muralha ',' muralha',
    'barricada-N\n','torre-1','__proto__','constructor','barricada-','x'.repeat(200)];
  for(const [i,target] of bad.entries())command(room,a,{t:'forge',round,recipe:'reparo',req:100+i,target});
  assert.deepEqual(calls,[],'no forged target reaches the forge');
  assert.deepEqual(forged(a),[],'and the tap gets no answer, like any other forged command');
  const id=idOf(a);
  command(room,a,{t:'forge',round,recipe:'reparo',req:1});
  command(room,a,{t:'forge',round,recipe:'reparo',req:2,target:'muralha'});
  command(room,a,{t:'forge',round,recipe:'reparo',req:3,target:'barricada-N'});
  command(room,a,{t:'forge',round,recipe:'torre-chinelo',req:4,target:'barricada-O'});
  assert.deepEqual(calls,[[id,'reparo','1',undefined],[id,'reparo','2','muralha'],[id,'reparo','3','barricada-N'],[id,'torre-chinelo','4','barricada-O']]);
  // The island has no barricades: stonewards answers 'target', and the phone has a line for it. The answer keeps its shape.
  assert.deepEqual(forged(a).find(m=>m.req===3),{t:'forged',req:3,recipe:'reparo',ok:false,reason:'target'});
  assert.ok(FORGE_REFUSALS.target);
});

test('a city room: the target reaches the barricade (repaired) and a tap without target still repairs the wall',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')) as {hash:string};
  const loaded=await cityTerrainFrom(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'),manifest.hash);
  if(!loaded.ok)throw new Error(loaded.error);
  // The city is locked behind CITY_PLAYABLE in setMap: the run starts on the default map and the room then plays on a
  // city Simulation built directly (as cidade-barricadas-sala.test.ts), with the same seat.
  const room=new Room(1000),a=peer();join(room,a);startRun(room,[a]);
  const id=idOf(a),old=room.sim.players.get(id)!;
  const sim=new Simulation(7,{world:'cidade',terrain:cityAsField(loaded.terrain)});
  sim.add(id,old.name,old.classId);sim.resetRun();room.sim=sim;
  const sw=sim.run.stonewards.state,round=room.run.snapshot().round;
  const rows=sw.barricades;
  assert.ok(rows?.length,'the city run raised its barricades');
  assert.equal(sim.world.round.phase,'prepare');
  const n=rows.find(b=>b.id==='barricada-N')!,p=sim.players.get(id)!;
  n.hp=100;sw.grana=2*RECIPES.reparo.cost+3;p.x=n.x;p.y=n.y;
  command(room,a,{t:'forge',round,recipe:'reparo',req:1,target:'barricada-N'});
  assert.deepEqual(forged(a).at(-1),{t:'forged',req:1,recipe:'reparo',ok:true});
  assert.equal(n.hp,100+Math.ceil(n.maxHp*.25));
  // A forged target on the city never reaches the barricades either.
  const before=n.hp;
  command(room,a,{t:'forge',round,recipe:'reparo',req:2,target:'barricada-Z'});
  assert.equal(n.hp,before);assert.equal(forged(a).at(-1).req,1);
  // Without target: the wall, from the forge at the fountain (an older phone).
  sw.wall.hp=100;p.x=sw.wall.x;p.y=sw.wall.y;
  command(room,a,{t:'forge',round,recipe:'reparo',req:3});
  assert.deepEqual(forged(a).at(-1),{t:'forged',req:3,recipe:'reparo',ok:true});
  assert.equal(sw.wall.hp,100+Math.ceil(sw.wall.maxHp*.25));
  assert.equal(n.hp,before,'the barricade was not touched');
  assert.equal(sw.grana,3,'D-048: each reparo charged its price (RECIPES.reparo.cost) of the team Grana');
});
