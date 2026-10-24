// NEW-20261024-ORQ-tirar-drops-cedula-girando: a kill's Grana falls as a cédula ('grana' pickup) a second after the
// kill, where the enemy fell; whoever walks by takes it, else it flies to its owner; nearby ones join, a cap on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,ticks,type EnemyState,type SimEvent,type SimPlayer} from '../../src/contract/index.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {CEDULA_CAP,CEDULA_DELAY_SECONDS,CEDULA_MERGE_RADIUS,CEDULA_PULL_RADIUS,CEDULA_WAIT_SECONDS,COLLECT_RADIUS} from '../../src/sim/progression.ts';
import {GRANA_PER_KILL} from '../../src/rules/index.ts';
import {walletOf} from '../../src/sim/wallet.ts';
import {DICT,FrameDecoder,FrameEncoder} from '../../src/protocol/protocol4.ts';

function body(id:string,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},x:0,y:0,...extra} as SimPlayer;
}
/** A run with heroes where we put them; only the pickups system steps (nothing else moves or spawns). */
function rig(...heroes:SimPlayer[]){
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:defaultTerrain,seed:5,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const run=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{}});
  world.step();
  for(const h of heroes)players.set(h.id,h);
  const events:SimEvent[]=[];
  const kill=(id:string,at:{x:number;y:number},by?:string,extra:Partial<EnemyState>={})=>{
    world.enemies.set(id,{id,kind:'bebado',x:at.x,y:at.y,hp:1,maxHp:1,speed:1,damage:1,radius:.4,xp:0,spawnTick:0,readyTick:0,...extra});
    world.damageEnemy(id,1e9,by);
  };
  const step=(n=1)=>{for(let i=0;i<n;i++){world.tick++;run.progression.pickups.step(world);events.push(...world.flush());}};
  const notes=()=>[...world.pickups.values()].filter(p=>p.kind==='grana');
  return {world,run,kill,step,notes,events};
}

test('a kill pays no Grana at once: the cédula appears a second later where the enemy fell, worth the kill, owned by the killer',()=>{
  const a=body('a',{x:20,y:20}),r=rig(a);
  r.kill('k1',{x:10,y:10},'a');
  assert.equal(walletOf(a),0);
  r.step(ticks(CEDULA_DELAY_SECONDS)-1);
  assert.equal(r.notes().length,0,'not before the second');
  r.step(1);
  const [note]=r.notes();
  assert.ok(note,'there it is');
  assert.deepEqual({x:note.x,y:note.y,value:note.value,owner:note.owner,expires:note.expiresTick!-note.spawnTick},
    {x:10,y:10,value:GRANA_PER_KILL.normal,owner:'a',expires:ticks(CEDULA_WAIT_SECONDS)});
  assert.deepEqual(r.run.progression.state.cedulas,undefined,'nothing left pending');
});

test('whoever walks by takes it into their own wallet (a short magnet), with a pickup event for the sound',()=>{
  const a=body('a',{x:40,y:40}),b=body('b',{x:10+CEDULA_PULL_RADIUS-.1,y:10}),r=rig(a,b);
  r.kill('k1',{x:10,y:10},'a',{elite:true});
  r.step(ticks(CEDULA_DELAY_SECONDS)+10);
  assert.deepEqual([walletOf(a),walletOf(b)],[0,GRANA_PER_KILL.elite],'b walked by: b\'s');
  assert.ok(r.events.some(e=>e.type==='pickup'&&e.kind==='grana'&&e.player==='b'&&e.value===GRANA_PER_KILL.elite));
  // Out of the magnet's reach it stays on the ground.
  const c=body('c',{x:10+CEDULA_PULL_RADIUS+.3,y:10}),s=rig(c);
  s.kill('k2',{x:10,y:10},'c');s.step(ticks(CEDULA_DELAY_SECONDS)+10);
  assert.equal(s.notes().length,1);assert.equal(walletOf(c),0);
  assert.ok(COLLECT_RADIUS<CEDULA_PULL_RADIUS);
});

test('nobody takes it: after CEDULA_WAIT_SECONDS it flies to its owner (never lost); with no owner, to the nearest hero',()=>{
  const a=body('a',{x:30,y:10}),b=body('b',{x:10,y:30}),r=rig(a,b);
  r.kill('k1',{x:10,y:12},'a');
  r.step(ticks(CEDULA_DELAY_SECONDS+CEDULA_WAIT_SECONDS)-1);
  assert.equal(r.notes().length,1,'still waiting');
  r.step(ticks(4));
  assert.deepEqual([walletOf(a),walletOf(b)],[1,0],'flew to its owner, past b who is nearer');
  r.kill('k2',{x:10,y:12});
  r.step(ticks(CEDULA_DELAY_SECONDS+CEDULA_WAIT_SECONDS+4));
  assert.deepEqual([walletOf(a),walletOf(b)],[1,1],'nobody\'s kill: the nearest hero');
});

test('cédulas join: one nearby takes the newcomer\'s value; past CEDULA_CAP on the ground every newcomer joins the nearest; R$ never lost',()=>{
  const a=body('a',{x:60,y:60}),r=rig(a);
  for(let i=0;i<5;i++)r.kill(`m${i}`,{x:10+i*CEDULA_MERGE_RADIUS*.15,y:10},'a');
  r.step(ticks(CEDULA_DELAY_SECONDS));
  assert.deepEqual(r.notes().map(n=>n.value),[5],'one pile of 5');
  // A horde: 60 kills spread out far apart.
  for(let i=0;i<60;i++)r.kill(`h${i}`,{x:5+(i%10)*3,y:20+Math.floor(i/10)*3},'a');
  r.step(ticks(CEDULA_DELAY_SECONDS));
  const notes=r.notes();
  assert.equal(notes.length,CEDULA_CAP);
  assert.equal(notes.reduce((s,n)=>s+n.value,0),65);
});

test('the boss is still split at once; pending cédulas are plain data (checkpoint) and the wire carries the kind, not the owner',()=>{
  const a=body('a',{x:30,y:30}),b=body('b',{x:31,y:30}),r=rig(a,b);
  r.kill('boss',{x:10,y:10},'a',{boss:true});
  assert.equal(walletOf(a)+walletOf(b),GRANA_PER_KILL.boss);
  r.kill('k1',{x:10,y:10},'a');
  assert.deepEqual(JSON.parse(JSON.stringify(r.run.progression.state.cedulas)),r.run.progression.state.cedulas);
  r.step(ticks(CEDULA_DELAY_SECONDS));
  const note=r.notes()[0];
  assert.ok(DICT.includes('grana'));
  const view={tick:r.world.tick,team:{xp:0,level:1,nextXp:5},round:{index:1,total:10,phase:'wave' as const,phaseEndsTick:0,remaining:1},
    players:[],enemies:[],pickups:[{...note}],projectiles:[],telegraphs:[],structures:[]};
  const got=new FrameDecoder().decode(new FrameEncoder().encode(view as never));
  assert.ok(got.ok);
  assert.deepEqual(got.view.pickups.map(p=>({kind:p.kind,value:p.value,owner:(p as {owner?:string}).owner})),[{kind:'grana',value:1,owner:undefined}]);
});
