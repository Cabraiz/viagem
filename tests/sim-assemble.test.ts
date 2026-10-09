import test from 'node:test';
import assert from 'node:assert/strict';
import {ITEMS} from '../src/game/sim/items.ts';
import {itemMaxLevel} from '../src/game/sim/evolutions.ts';
import {WEAPON_CATALOG,weaponLevel} from '../src/game/sim/weapons/catalog.ts';
import {Simulation} from '../src/game/net/shared.ts';
import {RUN_ORDER} from '../src/game/sim/systems/players.ts';
import {KILL_SCORE} from '../src/game/sim/assemble.ts';
import {createEnemy} from '../src/game/sim/enemies/catalog.ts';

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
