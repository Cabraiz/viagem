import test from 'node:test';
import assert from 'node:assert/strict';
import {ITEMS} from '../src/game/sim/items.ts';
import {itemMaxLevel} from '../src/game/sim/evolutions.ts';
import {WEAPON_CATALOG,weaponLevel} from '../src/game/sim/weapons/catalog.ts';
import {Simulation,applyDelta,delta,packEnemy} from '../src/game/net/shared.ts';
import {RUN_ORDER} from '../src/game/sim/systems/players.ts';
import {KILL_SCORE,applyEliteExtras} from '../src/game/sim/assemble.ts';
import {ELITE,createEnemy} from '../src/game/sim/enemies/catalog.ts';
import {KITS} from '../src/game/sim/kits.ts';
import {MAX_ENEMIES,MAX_PICKUPS,MAX_PROJECTILES,MAX_TELEGRAPHS} from '../src/game/sim/budget.ts';
import type {SkillPlayer} from '../src/game/sim/skills.ts';

const sim=(players=1)=>{
  const s=new Simulation(77);
  for(let i=0;i<players;i++)s.add(`p${i}`,`Bot${i}`,'cidadao-comum');
  s.resetRun();
  return s;
};

test('single item catalog covers weapons, evolutions and passives with the same max levels as chests',()=>{
  const ids=ITEMS.all().map(d=>d.id);
  assert.equal(new Set(ids).size,ids.length,'no duplicated ids');
  for(const id of ['chinelo','boleto','cafe','guarda-chuva','pombo','audio','chinelo-evo','boleto-evo','cafe-evo',
    'cafe-forte','marmita','tenis','megafone','bone','ima','oculos','cartao'])assert.ok(ITEMS.get(id),id);
  for(const def of ITEMS.all())assert.equal(def.maxLevel,itemMaxLevel(def.id),def.id);
});

test('every horde system is registered once per run, and a rematch replaces them without stacking hooks',()=>{
  const s=sim(2);
  assert.deepEqual(s.world.registered(),RUN_ORDER.filter(id=>id!=='structures'));
  for(let run=0;run<3;run++){
    s.resetRun();
    assert.deepEqual(s.world.registered(),RUN_ORDER.filter(id=>id!=='structures'));
    const enemy=createEnemy(s.world,'gosma',{x:12,y:12},1);
    const before=[...s.players.values()].map(p=>p.score);
    assert.ok(s.world.damageEnemy(enemy.id,1e6,'p0'));
    assert.deepEqual([...s.players.values()].map(p=>p.score),before.map(n=>n+KILL_SCORE),'kill score applied once per kill');
  }
});

test('players start the run with their class kit, full hp and no fall state',()=>{
  const s=sim(1),p=s.players.get('p0')!;
  assert.ok(p.build.weapons.length>=1);
  assert.equal(p.hp,p.stats.maxHp);
  assert.ok(p.classBonus);
  p.hp=0;p.downed={sinceTick:0,bleedOutTick:10,progress:0};
  s.resetRun();
  assert.equal(p.hp,p.stats.maxHp);assert.equal(p.downed,undefined);
});

test('might is applied exactly once between a weapon hit and the damage event (D-001)',()=>{
  const s=sim(1),p=s.players.get('p0')!;
  p.stats.might=2;
  const def=WEAPON_CATALOG.get(p.build.weapons[0].id)!,base=weaponLevel(def,p.build.weapons[0].level).damage;
  const enemy=createEnemy(s.world,'tio-pave',{x:p.x+.6,y:p.y},50);
  let seen:number|undefined;
  for(let t=0;t<400&&seen===undefined;t++){
    s.input('p0',{seq:t+1,x:0,y:0,attack:false});
    for(const e of s.step())if(e.type==='damage'&&e.target===enemy.id&&e.source==='p0'){seen=e.amount;break;}
  }
  assert.ok(seen!==undefined,'weapon hit the enemy');
  assert.ok(enemy.maxHp>base*2,'enemy survives the hit, so the event carries the full amount');
  assert.ok(Math.abs(seen!-base*2)<1e-9,`damage ${seen} = base ${base} × might 2`);
});

test('victory beats a defeat decided in the same tick, and the outcome is decided once',()=>{
  const s=sim(1),p=s.players.get('p0')!;
  const boss=createEnemy(s.world,'gosma',{x:12,y:12},1);boss.boss=true;
  // Same tick: the boss dies on the killing blow while the last player falls.
  s.world.clearSystems().register({id:'players',step(ctx){ctx.damageEnemy(boss.id,1e6,'p0');ctx.damagePlayer(p.id,1e6,'x');}});
  s.run.revive && s.world.register(s.run.revive);
  s.step();
  assert.equal(s.outcome,'victory');
  s.step();
  assert.equal(s.outcome,'victory','stays decided');
});

test('the snapshot extends protocol 3: enemy kind/maxHp/flags, tombstones once removed, and horde extras',()=>{
  const s=sim(1);
  const e=createEnemy(s.world,'fiscal',{x:12,y:12},1);e.elite=true;
  s.step();
  const wire=s.snapshot().enemies.find(w=>w[0]===e.id)!;
  assert.deepEqual(wire.slice(4),['fiscal',e.maxHp,1]);
  s.world.damageEnemy(e.id,1e6,'p0');
  s.step();
  const tomb=s.snapshot().enemies.find(w=>w[0]===e.id)!;
  assert.equal(tomb[3],0,'dead enemy sent as tombstone');
  for(let i=0;i<12;i++)s.step();
  assert.equal(s.snapshot().enemies.some(w=>w[0]===e.id),false,'tombstone expires');
  const x=s.snapshot().x!;
  assert.ok(x.round&&x.team&&Array.isArray(x.pickups)&&Array.isArray(x.events));
  const view=s.view('p0');
  assert.equal(view.players[0].id,'p0');assert.ok(Array.isArray(view.offers));
});

const untilWave=(s:Simulation)=>{for(let t=0;t<3000&&s.world.round.phase!=='wave';t++)s.step();assert.equal(s.world.round.phase,'wave');};

test('elite extras (plan §2 item 1): damage and xp from the catalog, applied once on top of the director scaling',()=>{
  const s=sim(1);
  const e=createEnemy(s.world,'tio-pave',{x:12,y:12},6);e.elite=true;
  const base={damage:e.damage,xp:e.xp,hp:e.maxHp,radius:e.radius};
  applyEliteExtras(s.world);applyEliteExtras(s.world);
  assert.equal(e.damage,Math.round(base.damage*ELITE.damage));assert.equal(e.xp,base.xp*ELITE.xp);
  assert.equal(e.maxHp,base.hp,'hp stays with the director (D-010)');assert.equal(e.radius,base.radius);
  const boss=createEnemy(s.world,'gosma',{x:14,y:14},1);boss.elite=true;boss.boss=true;const bossDamage=boss.damage;
  applyEliteExtras(s.world);assert.equal(boss.damage,bossDamage,'the boss is never treated as an elite');
});

test('every class skill casts inside the integrated run (36 kits, SpatialHash, real systems)',()=>{
  for(const kit of KITS){
    const s=new Simulation(7);s.add('a','A',kit.classId);s.add('b','B','cidadao-comum');s.resetRun();untilWave(s);
    const a=s.players.get('a')!;
    for(let i=0;i<5;i++)createEnemy(s.world,'gosma',{x:a.x+1+i*.3,y:a.y+.5},1);
    let casts=0;
    for(let seq=1;seq<=60;seq++){
      s.input('a',{seq,x:1,y:0,attack:false,skill:true});s.input('b',{seq,x:0,y:0,attack:false});
      s.step();
      if(s.events.some(e=>e.type==='fire'&&e.weapon===`skill:${kit.classId}`))casts++;
    }
    assert.ok(casts>=1,`${kit.classId} never cast ${kit.skill.name}`);
    assert.equal(a.skillReadyTick,(a as SkillPlayer).skillReady??0,'wire cooldown follows the skill state');
  }
});

test('skill refunds reach the wire: skillReadyTick mirrors the skill state after every step',()=>{
  const s=sim(1),p=s.players.get('p0')!;
  (p as SkillPlayer).skillReady=s.tick+500;s.step();assert.equal(p.skillReadyTick,s.tick+499);
  (p as SkillPlayer).skillReady=s.tick+3;s.step();assert.equal(p.skillReadyTick,s.tick+2,'a refund moves the wire cooldown too');
});

test('wire hp is rounded up: fractions from regen or might never show as 0 or as 86.667',()=>{
  const s=sim(1),p=s.players.get('p0')!;p.hp=86.0001;
  assert.equal(s.snapshot().players[0][3],87);
  p.hp=.0004;assert.equal(s.snapshot().players[0][3],1);
  p.hp=0;assert.equal(s.snapshot().players[0][3],0);
  assert.equal(packEnemy({id:'e',x:0,y:0,hp:12.2,kind:'gosma',maxHp:30.5} as never)[3],13);
});

test('deltas drop unchanged enemy kind/maxHp/flags and diff pickups/projectiles; applyDelta rebuilds the full state',()=>{
  const s=sim(2);untilWave(s);
  const w=s.world;
  for(let i=0;w.enemies.size<MAX_ENEMIES&&i<4000;i++){const a=i*.37,r=6+i%7;createEnemy(w,'gosma',{x:20+Math.cos(a)*r,y:20+Math.sin(a)*r},1);}
  for(let i=0;i<MAX_PROJECTILES;i++)w.projectiles.set(`pr-${i}`,{id:`pr-${i}`,owner:'p0',source:'chinelo',x:10+i*.0123,y:11+i*.0456,vx:3.1,vy:-2.4,radius:.25,damage:5,pierce:0,untilTick:w.tick+1e6,hostile:false,hit:[]});
  for(let i=0;i<MAX_PICKUPS;i++)w.pickups.set(`pk-${i}`,{id:`pk-${i}`,kind:'xp',x:5+i*.0371,y:7+i*.0219,value:3});
  let state=s.snapshot();const fullBytes=JSON.stringify(state).length;
  let previous=state,deltaBytes=0,n=0,cursor=state.x!.events.at(-1)?.eventId??-1;
  for(let t=1;t<=20;t++){
    s.step();
    if(t%2)continue;
    // Same event cursor as the Room: each event goes out once.
    const next=s.snapshot(cursor),patch=delta(previous,next);cursor=next.x!.events.at(-1)?.eventId??cursor;
    assert.equal(patch.terrain,undefined,'terrain only travels in full snapshots');
    for(const e of patch.enemies)if(e.length>4)assert.ok(!previous.enemies.some(p=>p[0]===e[0]&&p[4]===e[4]&&p[5]===e[5]&&p[6]===e[6]),'tail resent unchanged');
    deltaBytes+=JSON.stringify(patch).length;n++;
    state=applyDelta(state,patch);
    // Protocol 3 never lists removed enemies: a tombstone (hp 0) stays until the next full snapshot. Compare by id.
    const byId=<T extends [string,...unknown[]]>(list:readonly T[])=>new Map(list.map(i=>[i[0],i]));
    const got=byId(state.enemies);
    for(const e of next.enemies)assert.deepEqual(got.get(e[0]),e,`enemy ${e[0]} at tick ${next.tick}`);
    for(const [id,e] of got)if(!next.enemies.some(n=>n[0]===id))assert.equal(e[3],0,`${id} left without a tombstone`);
    assert.deepEqual(byId(state.players),byId(next.players));
    assert.deepEqual(byId(state.x!.pickups),byId(next.x!.pickups));assert.deepEqual(byId(state.x!.projectiles),byId(next.x!.projectiles));
    assert.deepEqual({...state.x,pickups:[],projectiles:[]},{...next.x,pickups:[],projectiles:[]});
    assert.equal(state.tick,next.tick);assert.deepEqual(state.run,next.run);
    previous=next;
  }
  // Lab numbers for the 042a JSON (protocol 4 in VGM-042b is ~27 KB/s): full ~44 KB, delta ~30 KB at the worst case.
  const kbps=deltaBytes/n*10/1024;
  assert.ok(fullBytes<64*1024,`full snapshot ${fullBytes} B`);
  assert.ok(kbps<400,`delta ${kbps.toFixed(0)} KB/s at 10 Hz`);
});

test('plan §2 item 8: a 2-minute boss fight against 6 players (both phases) stays under MAX_TELEGRAPHS',()=>{
  const s=sim(6);untilWave(s);
  assert.ok(s.run.boss.spawnBoss(s.world,{x:22,y:22}));
  let peak=0;
  for(let t=0;t<2400;t++){
    // Players never fall and never shoot, so the boss keeps casting through phase 1 and 2.
    for(const p of s.players.values()){p.hp=p.stats.maxHp;delete p.downed;p.build.weapons=[];}
    const boss=s.run.boss.boss(s.world);if(boss&&t===600)boss.hp=boss.maxHp*.4;
    s.step();peak=Math.max(peak,s.world.telegraphs.size);
  }
  assert.ok(peak>0&&peak<=MAX_TELEGRAPHS,`peak telegraphs ${peak}`);
  assert.equal(s.outcome,undefined);
});
