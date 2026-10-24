/**
 * D-052 slice 5, bots-carro (card NEW-20261016-ORQ-carro-e-fortificacao-livre; src/sim/bot-brain.ts objectiveTask
 * 'carro', carHeading): the room bots help a person move the chaveiro's car.
 *  - the brain: who helps (CAR_HELP_BOTS nearest free bots within CAR_HELP_RANGE, only while a person moves it), which
 *    way (the people's pull: a pusher toward the body, the rope toward its holder; the bots' own push left out);
 *  - a city Simulation (the real Cidade Nevada) with a person leaning on the car and three RoomBots: two bots join, the
 *    car goes at carSpeed(3) the person's way, the third keeps fighting; the person lets go and the car stops;
 *  - puxar-uno-corda: the helper ahead of the car takes the free rope (the car going nose first), the other pushes.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR_ID,CAR_NOSE,CAR_RADIUS,CAR_ROPE_REST,SIM_HZ,carSpeed,ticks} from '../../src/contract/index.ts';
import {CAR_HELP_BOTS,CAR_HELP_RANGE,carHeading,objectiveTask} from '../../src/sim/bot-brain.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';

type View=Parameters<typeof objectiveTask>[0];
const player=(id:string,x:number,y=0)=>({id,online:true,spectator:false,downed:false,eliminated:false,hp:100,maxHp:100,x,y});
const view=(players:ReturnType<typeof player>[],car:{movers?:string[];rope?:string;heading?:number},moto:'anda'|'morta'='anda')=>({tick:100,players,
  structures:[{id:CAR_ID,kind:CAR_ID,x:0,y:0,hp:120,maxHp:120}],
  objective:{moto:{x:40,y:0,mode:moto},etaS:300,budget:120,car:{x:0,y:0,hits:0,limit:100,parts:0,...car}}} as unknown as View);
const BOTS=['b1','b2','b3'];

test('brain: nobody helps a still car; a person pushing calls the CAR_HELP_BOTS nearest bots, pushing the same way',()=>{
  assert.equal(CAR_HELP_BOTS,2);
  const people=[player('ana',-1.3),player('b1',-5),player('b2',-6),player('b3',9)];
  for(const id of BOTS)assert.equal(objectiveTask(view(people,{}),id,BOTS),undefined,`${id}: nobody moves it`);
  // Ana leans on the car's west side: she pushes it east.
  const pushed=view(people,{movers:['ana']});
  assert.deepEqual(carHeading(pushed,BOTS),{x:1,y:0});
  const b1=objectiveTask(pushed,'b1',BOTS),b2=objectiveTask(pushed,'b2',BOTS);
  assert.equal(b1?.kind,'carro');assert.equal(b2?.kind,'carro');
  assert.equal(objectiveTask(pushed,'b3',BOTS),undefined,'the third keeps fighting');
  if(b1?.kind!=='carro'||b2?.kind!=='carro')return;
  assert.deepEqual(b1.heading,{x:1,y:0});assert.deepEqual(b1.at,{x:0,y:0});
  assert.notEqual(b1.side,b2.side,'one on each side of her line');
});

test('brain: the heading is the people\'s pull (the rope toward its holder, the bots\' own push left out)',()=>{
  // Ana holds the rope 4 u north of the nose (the car faces north); b1 already pushes from the east (it would say
  // west): the car goes north.
  const roped=view([player('ana',0,-1.3-4),player('b1',1.4),player('b2',3)],{movers:['ana','b1'],rope:'ana',heading:-Math.PI/2});
  const north=carHeading(roped,BOTS)!;
  assert.ok(Math.abs(north.x)<1e-9&&Math.abs(north.y+1)<1e-9,JSON.stringify(north));
  // Only bots on the list (the sim never moves it so, but the brain must not follow a bot): no heading, no task.
  const botsOnly=view([player('b1',-1.3),player('b2',3)],{movers:['b1']});
  assert.equal(carHeading(botsOnly,BOTS),undefined);
  assert.equal(objectiveTask(botsOnly,'b2',BOTS),undefined);
  // Two people from the west and the south: north-east.
  const two=carHeading(view([player('ana',-1.3),player('bia',0,1.3),player('b1',5)],{movers:['ana','bia']}),BOTS)!;
  assert.ok(Math.abs(two.x-Math.SQRT1_2)<1e-9&&Math.abs(two.y+Math.SQRT1_2)<1e-9,JSON.stringify(two));
});

test('brain: the moto\'s pushers and far bots stay out; the next nearest bot helps instead',()=>{
  // A dead moto 40 u east with a crew: b1 and b2 (nearest to it) push the moto; only b3 is free for the car.
  const moto=view([player('ana',-1.3),player('b1',38),player('b2',36),player('b3',-4)],{movers:['ana']},'morta');
  assert.equal(objectiveTask(moto,'b1',BOTS)?.kind,'push');
  assert.equal(objectiveTask(moto,'b2',BOTS)?.kind,'push');
  assert.equal(objectiveTask(moto,'b3',BOTS)?.kind,'carro');
  const far=view([player('ana',-1.3),player('b1',CAR_HELP_RANGE+1),player('b2',3),player('b3',-CAR_HELP_RANGE-5)],{movers:['ana']});
  assert.equal(objectiveTask(far,'b1',BOTS),undefined,'beyond CAR_HELP_RANGE');
  assert.equal(objectiveTask(far,'b2',BOTS)?.kind,'carro');
  assert.equal(objectiveTask(far,'b3',BOTS),undefined);
});

test('room: a person leans on the car, two bots join (any phase) and it goes her way at carSpeed(3); she lets go and it stops',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
  const loaded=await cityTerrainFrom(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'),manifest.hash);
  if(!loaded.ok)throw new Error(loaded.error);
  const sim=new Simulation(11,{world:'cidade',terrain:loaded.terrain,cityStructures:true,objective:'chaveiro'});
  sim.add('ana','Ana','cidadao-comum');
  const ids=['bot-1','bot-2','bot-3'],bots=new RoomBots();
  ids.forEach((id,i)=>{sim.addBot(id,id,'cidadao-comum');bots.add(id,i);});
  sim.resetRun();
  // Quiet streets: no critters, nothing telegraphed (the bots would fight or dodge instead).
  const calm=()=>{sim.world.enemies.clear();sim.world.telegraphs.clear();sim.world.projectiles.clear();};
  // The round-2 intermission (wave 1 ends at once with no critters): the car moves in any phase but the opening.
  for(let i=0;i<ticks(120)&&!(sim.world.round.index>=2&&sim.world.round.phase==='prepare');i++){calm();bots.think(sim);sim.step(sim.tick*50);}
  assert.equal(sim.world.round.phase,'prepare');
  const car=()=>sim.objectiveView()!.car,ana=sim.players.get('ana')!,east={x:1,y:0};
  // Ana leans on its west side and walks east; the bots stand around the car (3 to 6 u, where they fight).
  ids.forEach((id,i)=>{const b=sim.players.get(id)!,c=car();b.x=c.x+[3,-4,-6][i];b.y=c.y;});
  let seq=0;
  const lean=(push:boolean)=>{
    if(push){const c=car();ana.x=c.x-(CAR_RADIUS+.3);ana.y=c.y;}
    sim.input('ana',{seq:++seq,x:push?east.x:0,y:push?east.y:0,attack:false});
  };
  const run=(n:number,push:boolean)=>{for(let i=0;i<n;i++){calm();lean(push);bots.think(sim);sim.step(sim.tick*50);}};
  const x0=car().x;
  run(ticks(3),true);
  const movers=car().movers??[];
  assert.ok(movers.includes('ana'),`ana moves it: ${movers}`);
  const helping=movers.filter(id=>ids.includes(id));
  assert.equal(helping.length,CAR_HELP_BOTS,`two bots lean on it: ${movers} (modes ${[...bots.modes]})`);
  assert.equal(car().rope,'bot-1','puxar-uno-corda: the bot ahead of the car pulls it by the rope');
  // From here on, a second at full crew: carSpeed(3) east, straight.
  const x1=car().x,y1=car().y;
  run(SIM_HZ,true);
  assert.ok(Math.abs(car().x-x1-carSpeed(3))<.05,`a second at carSpeed(3) = ${carSpeed(3)}: ${car().x-x1}`);
  assert.ok(Math.abs(car().y-y1)<.05,`her way: dy ${car().y-y1} from ${y1} x ${car().x}`);
  assert.ok(car().x-x0>carSpeed(1)*4-1,'farther than she alone');
  const third=ids.find(id=>!helping.includes(id))!;
  assert.notEqual(bots.modes.get(third),'carro','the third keeps to its own business');
  // She lets go: the car stops (the bots alone never move it) and the helpers go back to the team.
  run(4,false);
  const x2=car().x;
  run(ticks(2),false);
  assert.equal(car().x,x2,'still');
  assert.equal(car().movers,undefined);
  for(const id of ids)assert.notEqual(bots.modes.get(id),'carro',`${id} stops helping`);
});

test('brain (puxar-uno-corda): the helper ahead of the car takes the free rope when it goes nose first; the other pushes',()=>{
  // Ana pushes the car east (its nose); b1 stands ahead near the rope's end, b2 behind.
  const pushed=view([player('ana',-1.3),player('b1',4),player('b2',-4)],{movers:['ana']});
  const b1=objectiveTask(pushed,'b1',BOTS),b2=objectiveTask(pushed,'b2',BOTS);
  assert.ok(b1?.kind==='carro'&&b1.rope,'b1 pulls');
  assert.ok(b2?.kind==='carro'&&!b2.rope,'b2 pushes');
  if(b1?.kind!=='carro'||!b1.rope)return;
  assert.deepEqual(b1.rope.tip,{x:CAR_NOSE+CAR_ROPE_REST,y:0});assert.equal(b1.rope.held,false);
  // On the rope it keeps it (even if b2 got nearer to the end).
  const held=view([player('ana',-1.3),player('b1',6),player('b2',2.5)],{movers:['ana'],rope:'b1'});
  const h1=objectiveTask(held,'b1',BOTS);
  assert.ok(h1?.kind==='carro'&&h1.rope?.held,'b1 keeps the rope');
  assert.ok((objectiveTask(held,'b2',BOTS) as {rope?:unknown}|undefined)?.rope===undefined,'b2 does not');
  // The car pushed backwards (west, against its nose), or a person on the rope: nobody takes it.
  const back=view([player('ana',1.3),player('b1',4),player('b2',-4)],{movers:['ana']});
  for(const id of ['b1','b2'])assert.equal((objectiveTask(back,id,BOTS) as {rope?:unknown}|undefined)?.rope,undefined,`${id}: backwards`);
  const person=view([player('ana',CAR_NOSE+3.2),player('b1',4),player('b2',-4)],{movers:['ana'],rope:'ana'});
  for(const id of ['b1','b2'])assert.equal((objectiveTask(person,id,BOTS) as {rope?:unknown}|undefined)?.rope,undefined,`${id}: a person holds it`);
});

