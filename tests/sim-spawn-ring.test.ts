/** Spawn around the players in the endless world, inside the real room simulation (NEW-20261009-ORQ-spawn-em-volta). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../src/game/net/shared.ts';
import {walkable,type Point} from '../src/game/world.ts';
import {INTEREST_RADIUS,visibleFrom} from '../src/game/sim/offscreen.ts';

test('room simulation, endless world: 6 players 200 units apart, every horde off screen and next to its player',t=>{
  const s=new Simulation(4242,{world:'infinito',experimental:true});
  for(let i=0;i<6;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
  s.resetRun();
  const players=[...s.players.values()];
  players.forEach((p,i)=>{
    const a=i/6*Math.PI*2;let q:Point={x:Math.round(Math.cos(a)*200),y:Math.round(Math.sin(a)*200)};
    while(!walkable(q,s.terrain))q={x:q.x+.5,y:q.y};
    Object.assign(p,q);
  });
  const seen=new Set<string>(),near=new Map(players.map(p=>[p.id,0]));
  const born=new Map<string,number>(),arrival:number[]=[];
  const times:number[]=[];
  let onScreen=0;
  for(let tick=0;tick<ticksOf(70);tick++){
    // Bots circle slowly (a joystick held to the side), so they stay roughly where they were put.
    players.forEach((p,i)=>s.input(p.id,{seq:tick+1,x:Math.cos(tick/40+i),y:Math.sin(tick/40+i),attack:false}));
    const t0=performance.now();s.step();times.push(performance.now()-t0);
    for(const e of s.enemies){
      if(born.has(e.id)&&players.some(p=>Math.hypot(p.x-e.x,p.y-e.y)<3)){arrival.push((s.tick-born.get(e.id)!)/20);born.delete(e.id);}
      if(seen.has(e.id))continue;
      born.set(e.id,s.tick);
      seen.add(e.id);
      if(e.boss)continue;
      const bodies=players.filter(p=>!p.spectator&&!p.eliminated);
      if(bodies.some(p=>visibleFrom(p,e)))onScreen++;
      const owner=bodies.find(p=>Math.hypot(p.x-e.x,p.y-e.y)<=INTEREST_RADIUS);
      if(owner)near.set(owner.id,near.get(owner.id)!+1);
    }
  }
  times.sort((a,b)=>a-b);
  t.diagnostic(`room step, endless, 6 players 200 u apart: median ${times[times.length>>1].toFixed(2)} ms, p99 ${times[Math.floor(times.length*.99)].toFixed(2)} ms; ${seen.size} enemies, per player ${JSON.stringify([...near.values()])}; spawn to contact (<3 u) median ${arrival.sort((a,b)=>a-b)[arrival.length>>1]?.toFixed(1)} s over ${arrival.length}`);
  assert.equal(onScreen,0,'no enemy appeared on a screen');
  assert.ok(seen.size>=12,`${seen.size} enemies spawned`);
  for(const [id,n] of near)assert.ok(n>=1,`${id} got a horde`);
  assert.ok(s.run.director.state.stage!=='idle');
});
const ticksOf=(seconds:number)=>Math.round(seconds*20);
