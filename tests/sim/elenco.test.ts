/**
 * D-033 cast (NEW-20261012-ORQ-elenco-adult-swim, phase A): the new hazards of enemy-ai on a real SimWorld with the
 * projectile and telegraph systems, on open ground of the endless world.
 *   bêbado: burp cone (only a player in front, from round 2, cooldown, fizzles if he dies)
 *   anão: molotov at the player with ≥ 0.8 s of warning, pulsing ground fire, caps, death explosion (no double kill)
 *   pombos: poop telegraphs under the bird, per-bird cooldown and a global cap
 *   agiota: boleto-juros marks "devendo" (one say per mark), ×DEVENDO.mult damage until it expires
 *   determinism: same seed → same telegraphs
 *   aim: the city steer bends the walk only; the boleto and the burp cone still aim straight at the player
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,type SimEvent,type SimPlayer,type Telegraph} from '../../src/contract/types.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {AGIOTA_SHOT,BAND_CADENCE,BAND_DAMAGE,BURP,DEVENDO,DEVENDO_LINES,MOLOTOV,POOP,createEnemy,hazardKind,markDevendo,type DevendoPlayer,type EnemyKind} from '../../src/sim/enemies/catalog.ts';
import {BARK_GAP,ENEMY_TELEGRAPH_CAP,EnemyAi,type EnemyAiOptions} from '../../src/sim/enemies/ai.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';
import {MIN_TELEGRAPH_TICKS,createTelegraphSystem} from '../../src/sim/telegraphs.ts';
import {downPlayer} from '../../src/sim/revive.ts';
import {MAX_PROJECTILES,MAX_TELEGRAPHS} from '../../src/rules/budget.ts';
import {walkable,type Point} from '../../src/maps/world.ts';
import {DEFAULT_SEED,TerrainField} from '../../src/maps/terrain/field.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
// A deterministic run script: the whole roster (ROSTER_ONLY_WITH_ART off); tests/rules/enemy-art-ids.test.ts plays art only.
setRosterOnlyWithArt(false);

const TERRAIN=new TerrainField(DEFAULT_SEED,{world:'infinito'});
/** First point of the endless world with a fully walkable disc of radius r around it (the island is too cluttered). */
function openSpot(r:number):Point{
  const clear=(c:Point)=>{
    for(let dx=-r;dx<=r;dx+=.5)for(let dy=-r;dy<=r;dy+=.5)if(dx*dx+dy*dy<=r*r&&!walkable({x:c.x+dx,y:c.y+dy},TERRAIN))return false;
    return true;
  };
  for(let x=-60;x<=60;x+=2)for(let y=-60;y<=60;y+=2)if(clear({x,y}))return {x,y};
  throw new Error(`no open disc of radius ${r}`);
}
const O=openSpot(9);
const at=(dx:number,dy=0):Point=>({x:O.x+dx,y:O.y+dy});

interface Made {tick:number;t:Telegraph}
function arena(seed=1,round=3,options:EnemyAiOptions={}){
  const world=new SimWorld({terrain:TERRAIN,seed});
  world.round.index=round;world.round.phase='wave';
  const ai=new EnemyAi({projectileCap:MAX_PROJECTILES,...options});
  world.register(ai).register(createProjectileSystem({cap:MAX_PROJECTILES})).register(createTelegraphSystem());
  world.onKill((enemy,_by,ctx)=>ai.onKill(ctx,enemy));
  const events:(SimEvent&{tick:number})[]=[];
  const made:Made[]=[];
  let peak=0;
  const record=(list:readonly SimEvent[])=>{
    for(const e of list){
      events.push({...e,tick:world.tick});
      if(e.type==='telegraph'){const t=world.telegraphs.get(e.telegraph);if(t)made.push({tick:world.tick,t:{...t}});}
    }
  };
  const step=(n:number,each?:()=>void)=>{
    for(let i=0;i<n;i++){record(world.step());peak=Math.max(peak,world.telegraphs.size);each?.();}
  };
  /** Events emitted outside a step (direct damageEnemy/damagePlayer calls). */
  const flush=()=>record(world.flush());
  return {world,ai,events,made,step,flush,peak:()=>peak};
}
function addPlayer(world:SimWorld,id:string,p:Point,extra:Partial<SimPlayer>={}){
  const player:SimPlayer={id,classId:'test',x:p.x,y:p.y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
  world.players.set(id,player);
  return player;
}
const healAll=(world:SimWorld)=>()=>{for(const p of world.players.values())p.hp=p.stats.maxHp;};
const damageFrom=(events:readonly SimEvent[],target:string,source:string)=>
  events.flatMap(e=>e.type==='damage'&&e.target===target&&e.source===source?[e.amount]:[]);
const near=(a:number,b:number,eps=1e-9)=>Math.abs(a-b)<=eps;

// ---------- Bêbado ----------
test('bêbado burps a cone at a player in front, ≥ 0.8 s ahead, with a cooldown; it hurts when it fires',()=>{
  const A=arena(1);const p=addPlayer(A.world,'p',at(2));
  const e=createEnemy(A.world,'bebado',O);
  // Pinned 2 u from the player (inside BURP.trigger) so only the burp logic decides.
  A.step(600,()=>{e.x=O.x;e.y=O.y;healAll(A.world)();});
  const burps=A.made.filter(m=>m.t.owner===e.id);
  assert.ok(burps.length>=3,`burps: ${burps.length}`);
  for(const {tick,t} of burps){
    assert.equal(t.shape,'cone');assert.ok(near(t.x,O.x)&&near(t.y,O.y),'apex on him');
    assert.ok(t.dx!>.9,`aimed at the player (${t.dx},${t.dy})`);
    assert.equal(t.radius,BURP.range);assert.equal(t.width,BURP.angle);assert.equal(t.damage,BURP.damage);
    assert.ok(t.fireTick-tick>=MIN_TELEGRAPH_TICKS,'at least 0.8 s of warning');
  }
  for(let i=1;i<burps.length;i++)assert.ok(burps[i].tick-burps[i-1].tick>=BURP.cooldown,'cooldown between burps');
  const hits=damageFrom(A.events,p.id,e.id);
  assert.ok(hits.length>=burps.length-1&&hits.every(a=>a===BURP.damage),`burp hits ${hits.join(',')}`);
});

test('bêbado never burps at a player behind him, out of range, or in round 1',()=>{
  const cases:{name:string;player:Point;round:number;away?:boolean}[]=[
    {name:'behind',player:at(2),round:3,away:true},
    {name:'out of range',player:at(BURP.trigger+1),round:3},
    {name:'round 1',player:at(2),round:1},
  ];
  for(const c of cases){
    const A=arena(2,c.round);addPlayer(A.world,'p',c.player);
    const e=createEnemy(A.world,'bebado',O);
    // "Behind": his last walking direction keeps pointing away from the player.
    const pin=()=>{e.x=O.x;e.y=O.y;if(c.away){e.memory!.fx=-1;e.memory!.fy=0;}healAll(A.world)();};
    pin();
    A.step(400,pin);
    assert.equal(A.made.filter(m=>m.t.owner===e.id).length,0,c.name);
  }
});

test('a burp fizzles when the bêbado dies during the wind-up',()=>{
  const A=arena(3);const p=addPlayer(A.world,'p',at(2));
  const e=createEnemy(A.world,'bebado',O);
  for(let i=0;i<400&&!A.made.some(m=>m.t.owner===e.id);i++)A.step(1,()=>{e.x=O.x;e.y=O.y;});
  const burp=A.made.find(m=>m.t.owner===e.id);assert.ok(burp,'he burped');
  A.world.damageEnemy(e.id,999,'p');A.flush();
  A.step(MIN_TELEGRAPH_TICKS+5);
  assert.deepEqual(damageFrom(A.events,p.id,e.id),[],'no posthumous burp');
});

// ---------- Anão do Molotov ----------
test('anão lobs a molotov at the player (≥ 0.8 s), the fire pulses MOLOTOV.pulses times at the spot and stops',()=>{
  const A=arena(4);const p=addPlayer(A.world,'p',at(5));
  const a=createEnemy(A.world,'anao-molotov',O);
  const owner=`env:molotov:${a.id}`;
  for(let i=0;i<400&&!A.made.some(m=>m.t.owner===owner);i++)A.step(1,healAll(A.world));
  const first=A.made.find(m=>m.t.owner===owner);assert.ok(first,'he threw');
  a.memory!.actReady=1e9;
  assert.equal(first.t.shape,'circle');assert.ok(near(first.t.x,p.x)&&near(first.t.y,p.y),'lands where the player stood');
  assert.equal(first.t.radius,MOLOTOV.radius);assert.equal(first.t.damage,MOLOTOV.damage);
  assert.ok(first.t.fireTick-first.tick>=MIN_TELEGRAPH_TICKS);assert.equal(first.t.fireTick-first.tick,MOLOTOV.flight);
  A.step(200,healAll(A.world));
  const chain=A.made.filter(m=>m.t.owner===owner);
  assert.equal(chain.length,1+MOLOTOV.pulses,'landing plus the pulses, then out');
  for(const {t} of chain.slice(1)){
    assert.ok(near(t.x,first.t.x)&&near(t.y,first.t.y),'same spot');
    assert.equal(t.radius,MOLOTOV.pulseRadius);assert.equal(t.damage,MOLOTOV.pulseDamage);
  }
  for(let i=1;i<chain.length;i++){
    assert.ok(chain[i].t.fireTick-chain[i-1].t.fireTick>=MIN_TELEGRAPH_TICKS,'pulses spaced ≥ 0.8 s');
    assert.ok(chain[i].t.fireTick-chain[i].tick>=MIN_TELEGRAPH_TICKS,'each pulse warned ≥ 0.8 s');
  }
  assert.deepEqual(damageFrom(A.events,p.id,owner),[MOLOTOV.damage,...Array(MOLOTOV.pulses).fill(MOLOTOV.pulseDamage)]);
  assert.ok(![...A.world.telegraphs.values()].some(t=>t.owner===owner),'fire is out');
});

test('a thrown molotov still lands and burns after the anão dies; he keeps 4-6 u from the player',()=>{
  const A=arena(5);const p=addPlayer(A.world,'p',at(5));
  const a=createEnemy(A.world,'anao-molotov',O);
  const owner=`env:molotov:${a.id}`;
  let min=Infinity,max=0;
  for(let i=0;i<400&&!A.made.some(m=>m.t.owner===owner);i++)A.step(1,()=>{
    const d=Math.hypot(a.x-p.x,a.y-p.y);min=Math.min(min,d);max=Math.max(max,d);healAll(A.world)();
  });
  assert.ok(min>=MOLOTOV.minRange-.2&&max<=MOLOTOV.maxRange+.2,`distance band ${min.toFixed(2)}..${max.toFixed(2)}`);
  A.world.damageEnemy(a.id,999,'p');A.flush();
  A.step(200,healAll(A.world));
  assert.equal(damageFrom(A.events,p.id,owner).length,1+MOLOTOV.pulses,'the whole chain lands');
});

test('molotov caps: per anão, global, and the enemies telegraph budget; a crowd never passes them',()=>{
  const preload=(world:SimWorld,owners:string[])=>{owners.forEach((owner,i)=>world.telegraphs.set(`pre${i}`,{id:`pre${i}`,shape:'circle',x:O.x-8,y:O.y,radius:.1,damage:0,owner,fireTick:1e9}));};
  const tries=(owners:(id:string)=>string[])=>{
    const A=arena(6);addPlayer(A.world,'p',at(5));
    const a=createEnemy(A.world,'anao-molotov',O);
    preload(A.world,owners(a.id));
    A.step(300,healAll(A.world));
    return A.made.filter(m=>m.t.owner.startsWith('env:molotov:')).length;
  };
  assert.equal(tries(id=>Array(MOLOTOV.maxActive).fill(`env:molotov:${id}`)),0,'per anão');
  assert.equal(tries(()=>Array.from({length:MOLOTOV.maxGlobal},(_,i)=>`env:molotov:x${i}`)),0,'global');
  assert.equal(tries(()=>Array(ENEMY_TELEGRAPH_CAP).fill('env:other')),0,'telegraph budget');
  assert.ok(tries(()=>[])>0,'and without the preload he throws');

  // A crowd of every hazard kind around two players.
  const A=arena(7,5);addPlayer(A.world,'p1',at(0,-1));addPlayer(A.world,'p2',at(0,1));
  const ring=(kind:EnemyKind,n:number,r:number)=>{for(let i=0;i<n;i++){const t=i/n*Math.PI*2;createEnemy(A.world,kind,at(Math.cos(t)*r,Math.sin(t)*r));}};
  ring('anao-molotov',12,5);ring('pombos',10,2);ring('bebado',10,3);
  let worstChains=0,worstPoop=0,worstPerAnao=0;
  A.step(800,()=>{
    healAll(A.world)();
    const owners=[...A.world.telegraphs.values()].map(t=>t.owner);
    worstChains=Math.max(worstChains,owners.filter(o=>o.startsWith('env:molotov:')).length);
    worstPoop=Math.max(worstPoop,owners.filter(o=>o.startsWith('env:poop:')).length);
    const per=new Map<string,number>();for(const o of owners)if(o.startsWith('env:molotov:'))per.set(o,(per.get(o)??0)+1);
    worstPerAnao=Math.max(worstPerAnao,...per.values(),0);
  });
  assert.ok(A.made.length>10,`hazards happened: ${A.made.length}`);
  assert.ok(A.peak()<=ENEMY_TELEGRAPH_CAP&&ENEMY_TELEGRAPH_CAP<MAX_TELEGRAPHS,`peak ${A.peak()}`);
  assert.ok(worstChains<=MOLOTOV.maxGlobal,`molotov chains ${worstChains}`);
  assert.ok(worstPoop<=POOP.maxGlobal,`poop ${worstPoop}`);
  assert.ok(worstPerAnao<=MOLOTOV.maxActive,`per anão ${worstPerAnao}`);
});

test('anão explodes on death: telegraphed, hurts players once, hits neighbors once, chains, never double-kills',()=>{
  const A=arena(8);const p=addPlayer(A.world,'p',at(1));
  const a=createEnemy(A.world,'anao-molotov',O);
  const weak=createEnemy(A.world,'bebado',at(-1));            // 20 hp ≤ deathEnemyDamage: dies
  const killedFirst=createEnemy(A.world,'bebado',at(0,-1));   // dies to the player before the blast lands
  const second=createEnemy(A.world,'anao-molotov',at(0,1.5));second.hp=10; // dies, explodes in turn
  const tough=createEnemy(A.world,'tio-pave',at(-1.5,-.8));    // in the first blast only: survives with less hp
  const far=createEnemy(A.world,'bebado',at(-6));              // outside the blast
  for(const e of A.world.enemies.values())e.frozenUntil=1e9;   // keep everyone where the blast is
  const toughHp=tough.hp,farHp=far.hp;
  A.world.damageEnemy(a.id,999,'p');A.flush();
  const blast=A.made.find(m=>m.t.owner===`env:explosion:${a.id}`);
  assert.ok(blast,'explosion telegraph');assert.equal(blast.t.radius,MOLOTOV.deathRadius);
  assert.ok(blast.t.fireTick-blast.tick>=MIN_TELEGRAPH_TICKS,'warned ≥ 0.8 s');
  A.world.damageEnemy(killedFirst.id,999,'p');A.flush();
  A.step(MOLOTOV.deathDelay+MIN_TELEGRAPH_TICKS+10,healAll(A.world));
  assert.deepEqual(damageFrom(A.events,p.id,`env:explosion:${a.id}`),[MOLOTOV.deathDamage],'one hit on the player');
  assert.ok(!A.world.enemies.has(weak.id)&&!A.world.enemies.has(second.id),'neighbors in the blast died');
  assert.equal(tough.hp,toughHp-MOLOTOV.deathEnemyDamage,'one blast hit on the tio');assert.equal(far.hp,farHp,'far one untouched');
  assert.ok(A.made.some(m=>m.t.owner===`env:explosion:${second.id}`),'the second anão exploded too');
  const kills=A.events.flatMap(e=>e.type==='kill'?[e.enemy]:[]);
  assert.equal(new Set(kills).size,kills.length,`no double kill: ${kills.join(',')}`);
  for(const id of [a.id,weak.id,killedFirst.id,second.id])assert.equal(kills.filter(k=>k===id).length,1,id);
  const blastKill=A.events.find(e=>e.type==='kill'&&e.enemy===weak.id);
  assert.ok(blastKill&&blastKill.type==='kill'&&blastKill.by===undefined,'no player credit for the blast');
});

// ---------- Pombos ----------
test('pombos drop poop telegraphs under themselves near a player, with a per-bird cooldown and a global cap',()=>{
  const A=arena(9);const p=addPlayer(A.world,'p',at(1));
  const bird=createEnemy(A.world,'pombos',O);
  const owner=`env:poop:${bird.id}`;
  const where:Point[]=[];
  A.step(600,()=>{where[A.world.tick]={x:bird.x,y:bird.y};healAll(A.world)();});
  const poops=A.made.filter(m=>m.t.owner===owner);
  assert.ok(poops.length>=2,`poops: ${poops.length}`);
  for(const {tick,t} of poops){
    assert.equal(t.shape,'circle');assert.equal(t.radius,POOP.radius);assert.equal(t.damage,POOP.damage);
    assert.ok(t.fireTick-tick>=MIN_TELEGRAPH_TICKS);
    const after=where[tick];assert.ok(Math.hypot(after.x-t.x,after.y-t.y)<.5,'dropped where the bird was');
  }
  for(let i=1;i<poops.length;i++)assert.ok(poops[i].tick-poops[i-1].tick>=POOP.cooldown);
  assert.ok(damageFrom(A.events,p.id,owner).every(a=>a===POOP.damage));
  // A flock: never more than POOP.maxGlobal poops pending.
  const F=arena(10);addPlayer(F.world,'p',O);
  for(let i=0;i<24;i++)createEnemy(F.world,'pombos',at(Math.cos(i)*1.5,Math.sin(i)*1.5));
  let worst=0;
  F.step(400,()=>{worst=Math.max(worst,[...F.world.telegraphs.values()].filter(t=>t.owner.startsWith('env:poop:')).length);healAll(F.world)();});
  assert.ok(worst>0&&worst<=POOP.maxGlobal,`poop pending ${worst}`);
});

// ---------- Agiota ----------
test('agiota boleto marks the player devendo: one say per mark, ×DEVENDO.mult before armor, expires',()=>{
  const A=arena(11);const p=addPlayer(A.world,'p',at(5));p.stats.armor=2;
  const ag=createEnemy(A.world,'agiota',O);
  let hitTick=-1;
  for(let i=0;i<400&&hitTick<0;i++){A.step(1,healAll(A.world));if(damageFrom(A.events,p.id,ag.id).length)hitTick=A.world.tick;}
  assert.ok(hitTick>0,'the boleto hit');
  ag.memory!.actReady=1e9;
  const marked=p as SimPlayer&DevendoPlayer;
  assert.equal(marked.devendoUntil,hitTick+DEVENDO.ticks);
  assert.equal(damageFrom(A.events,p.id,ag.id)[0],AGIOTA_SHOT.damage-2,'the marking hit itself is not multiplied');
  A.step(DEVENDO.ticks-10,healAll(A.world));
  const says=A.events.filter((e):e is Extract<SimEvent,{type:'say'}>&{tick:number}=>e.type==='say');
  assert.equal(says.length,1,'one line per mark');
  assert.equal(says[0].source,p.id);assert.equal(says[0].key,DEVENDO.key);assert.ok(DEVENDO_LINES.includes(says[0].line));
  // While marked: 8 × DEVENDO.mult − 2 armor.
  A.world.damagePlayer(p.id,8,'test');assert.equal(p.hp,100-(8*DEVENDO.mult-2));
  // Hit again while marked: the mark is refreshed, no second line.
  p.hp=100;
  A.world.projectiles.set('pj',{id:'pj',owner:ag.id,source:AGIOTA_SHOT.source,x:p.x-1,y:p.y,vx:AGIOTA_SHOT.speed,vy:0,radius:AGIOTA_SHOT.radius,
    damage:AGIOTA_SHOT.damage,pierce:0,untilTick:A.world.tick+40,hostile:true,hit:[],marks:'devendo'} as never);
  A.step(10,healAll(A.world));
  assert.ok(marked.devendoUntil!>hitTick+DEVENDO.ticks,'refreshed');
  A.step(DEVENDO.ticks,healAll(A.world));
  assert.equal(A.events.filter(e=>e.type==='say').length,1,'still one line');
  // Expired: plain damage again.
  assert.ok(A.world.tick>=marked.devendoUntil!);
  A.world.damagePlayer(p.id,8,'test');assert.equal(p.hp,100-(8-2));
});

test('a boleto blocked by invulnerability does not mark',()=>{
  const A=arena(12);const p=addPlayer(A.world,'p',at(5));
  createEnemy(A.world,'agiota',O);
  A.step(300,()=>{p.invulnerableUntil=A.world.tick+5;});
  assert.ok(A.events.some(e=>e.type==='damage'&&e.target==='p')===false,'nothing got through');
  assert.equal((p as SimPlayer&DevendoPlayer).devendoUntil,undefined);
  assert.equal(A.events.filter(e=>e.type==='say').length,0);
});

// ---------- What got you / determinism ----------
test('a hazard that outlives its thrower still names the kind behind it',()=>{
  assert.equal(hazardKind('env:molotov:e9'),'anao-molotov');assert.equal(hazardKind('env:explosion:e9'),'anao-molotov');
  assert.equal(hazardKind('env:poop:e2'),'pombos');
  for(const other of ['env:boss','env:constructor:e1','e9','boss-1'])assert.equal(hazardKind(other),undefined,other);
  const A=arena(13);const p=addPlayer(A.world,'p',O);
  downPlayer(A.world,p,'env:molotov:e77');
  const downed=A.world.flush().find(e=>e.type==='downed');
  assert.deepEqual(downed&&{by:(downed as {by?:string}).by,source:(downed as {source?:string}).source},{by:'env:molotov:e77',source:'anao-molotov'});
});

test('same seed, same telegraphs and state; the hazards are deterministic',()=>{
  const play=(seed:number)=>{
    const A=arena(seed,6);addPlayer(A.world,'p1',at(0,-1));addPlayer(A.world,'p2',at(1,1));
    const kinds:EnemyKind[]=['bebado','anao-molotov','pombos','tio-pave','agiota'];
    for(let i=0;i<20;i++){const t=i*.7;createEnemy(A.world,kinds[i%kinds.length],at(Math.cos(t)*(2+i%5),Math.sin(t)*(2+i%5)));}
    A.step(600,healAll(A.world));
    return {made:JSON.stringify(A.made),hash:stateHash(A.world.state()),ai:JSON.stringify(A.ai.state()),n:A.made.length};
  };
  const a=play(21),b=play(21);
  assert.ok(a.n>5,`telegraphs: ${a.n}`);
  assert.equal(a.made,b.made);assert.equal(a.hash,b.hash);assert.equal(a.ai,b.ai);
});

// ---------- Aim vs. walk (city flow field) ----------
/** A steer that always answers perpendicular to the target, like a flow field leading around a corner. */
const sideways:EnemyAiOptions['steer']=(_ctx,e,target,out)=>{
  const dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy);out.x=-dy/d;out.y=dx/d;return true;
};
test('steered walking never bends the aim: the boleto and the burp cone point straight at the player',()=>{
  // Agiota pinned 5 u west of the player: the boleto must fly east even though the steer says north/south.
  const A=arena(14,3,{steer:sideways});addPlayer(A.world,'p',at(5));
  const ag=createEnemy(A.world,'agiota',O);
  let shot:{vx:number;vy:number}|undefined;
  for(let i=0;i<400&&!shot;i++){
    A.step(1,()=>{ag.x=O.x;ag.y=O.y;healAll(A.world)();});
    shot=[...A.world.projectiles.values()].find(q=>q.owner===ag.id);
  }
  assert.ok(shot,'the agiota fired');
  assert.ok(near(shot.vx,AGIOTA_SHOT.speed,1e-6)&&near(shot.vy,0,1e-6),`boleto velocity (${shot.vx},${shot.vy}) points at the player`);
  // Bêbado pinned 2 u west of the player, facing him; the steer still walks him sideways.
  const B=arena(15,3,{steer:sideways});addPlayer(B.world,'p',at(2));
  const e=createEnemy(B.world,'bebado',O);
  const pin=()=>{e.x=O.x;e.y=O.y;e.memory!.fx=1;e.memory!.fy=0;healAll(B.world)();};
  pin();
  for(let i=0;i<400&&!B.made.some(m=>m.t.owner===e.id);i++)B.step(1,pin);
  const burp=B.made.find(m=>m.t.owner===e.id);
  assert.ok(burp,'he burped');
  assert.ok(near(burp.t.dx!,1,1e-6)&&near(burp.t.dy!,0,1e-6),`cone (${burp.t.dx},${burp.t.dy}) points at the player`);
});

// ---------- Review regressions (NEW-20261012-ORQ-elenco-adult-swim) ----------
type Says=Extract<SimEvent,{type:'say'}>;
const devendoSays=(list:readonly SimEvent[])=>list.filter((e):e is Says=>e.type==='say'&&e.key===DEVENDO.key);

test('B1: a rematch clears the devendo mark: no stale ×mult and no stale line',()=>{
  const sim=new Simulation(7);sim.add('a','Ana','pedreiro');sim.resetRun();
  for(let i=0;i<3000;i++)sim.step();
  const p=sim.players.get('a')! as SimPlayer&DevendoPlayer;
  markDevendo(p,sim.world.tick);
  assert.ok(p.devendoUntil!>DEVENDO.ticks&&p.devendoSay===1,'marked late in the first run, line pending');
  sim.resetRun();
  assert.equal(p.devendoUntil,undefined,'mark gone');assert.equal(p.devendoSay,undefined,'pending line gone');
  const hp=p.hp;p.invulnerableUntil=0;sim.world.damagePlayer('a',10,'x');
  assert.equal(hp-p.hp,Math.max(0,10-p.stats.armor),'plain damage right after the rematch');
  const events:SimEvent[]=[];
  for(let i=0;i<DEVENDO.ticks+BARK_GAP;i++)events.push(...sim.step());
  assert.deepEqual(devendoSays(events),[],'no stale devendo line');
});

test('B2: the last anão of a round explodes into the intermission without hurting anyone',()=>{
  /** Wave on, every enemy but one (or two) gone and no more groups; the first becomes an anão next to the hero. */
  const setup=(keepAnother:boolean)=>{
    const sim=new Simulation(7);sim.add('a','Ana','pedreiro');sim.resetRun();
    const w=sim.world;
    for(let i=0;i<20000&&!(w.round.phase==='wave'&&w.enemies.size>(keepAnother?1:0));i++)sim.step();
    const d=(sim as unknown as {systems:{director:{state:{nextGroup:number;plan:{groups:unknown[]};pending:unknown[]}}}}).systems.director.state;
    d.nextGroup=d.plan.groups.length;d.pending=[];
    const ids=[...w.enemies.keys()],p=sim.players.get('a')!;
    const anao=w.enemies.get(ids[0])!,other=keepAnother?w.enemies.get(ids[1])!:undefined;
    for(const id of ids.slice(keepAnother?2:1))w.damageEnemy(id,1e6,'a');
    anao.kind='anao-molotov';anao.x=p.x+.8;anao.y=p.y;
    // A round-1 body carries the tutorial's numbers (TUTORIAL_ART_TUNE, waves.ts); the anão blasts at full damage.
    if(anao.memory){delete anao.memory[BAND_DAMAGE];delete anao.memory[BAND_CADENCE];}
    // The one left alive (wave case) stays far and frozen, so the round goes on and only the blast can hurt.
    if(other){other.x=p.x+12;other.y=p.y;other.frozenUntil=1e9;}
    p.invulnerableUntil=0;
    w.damageEnemy(anao.id,1e6,'a');
    const owner=`env:explosion:${anao.id}`;
    assert.ok([...w.telegraphs.values()].some(t=>t.owner===owner),'his explosion is telegraphed');
    const events:SimEvent[]=[];const phases=new Set<string>();
    for(let i=0;i<MOLOTOV.deathDelay+20;i++){events.push(...sim.step());phases.add(w.round.phase);p.hp=p.stats.maxHp;}
    return {phases,armor:p.stats.armor,hits:damageFrom(events,'a',owner),left:[...w.telegraphs.values()].filter(t=>t.owner.startsWith('env:'))};
  };
  const last=setup(false);
  assert.ok(last.phases.has('prepare'),'the round ended');
  assert.deepEqual(last.hits,[],'no blast in the intermission');assert.deepEqual(last.left,[],'hazards dropped');
  const wave=setup(true);
  assert.deepEqual([...wave.phases],['wave'],'control: still the wave');
  assert.deepEqual(wave.hits,[MOLOTOV.deathDamage-wave.armor],'control: during the wave the blast hurts (after armor)');
});

test('B2: pending molotov, fire and poop are dropped outside the wave and land during it',()=>{
  const run=(phase:'wave'|'prepare')=>{
    const A=arena(30);const p=addPlayer(A.world,'p',O);A.world.round.phase=phase;
    const owners=['env:molotov:e90','env:poop:e91','env:explosion:e92'];
    owners.forEach((owner,i)=>A.world.telegraphs.set(`h${i}`,{id:`h${i}`,shape:'circle',x:O.x,y:O.y,radius:1,damage:5,owner,fireTick:A.world.tick+MIN_TELEGRAPH_TICKS,pulses:1} as Telegraph));
    A.step(MIN_TELEGRAPH_TICKS*3,healAll(A.world));
    return owners.flatMap(o=>damageFrom(A.events,p.id,o)).length;
  };
  assert.equal(run('prepare'),0,'intermission is safe');
  assert.ok(run('wave')>=3,'wave: they land (plus the fire pulse)');
});

test('R1a: the devendo line respects the bark limiter (two fresh marks inside the gap: one line, the next after it)',()=>{
  const A=arena(31);const p1=addPlayer(A.world,'p1',O),p2=addPlayer(A.world,'p2',at(2));
  markDevendo(p1,A.world.tick);markDevendo(p2,A.world.tick);
  A.step(1);
  assert.equal(devendoSays(A.events).length,1,'one line on the first tick');
  A.step(BARK_GAP-2);
  assert.equal(devendoSays(A.events).length,1,'still one inside the gap');
  A.step(5);
  const says=devendoSays(A.events) as (Says&{tick:number})[];
  assert.equal(says.length,2,'the second mark speaks after the gap');
  assert.deepEqual(says.map(s=>s.source),['p1','p2']);
  assert.ok(says[1].tick-says[0].tick>=BARK_GAP);
});

test('R1b: the anão explosion never damages the boss',()=>{
  const A=arena(32);addPlayer(A.world,'p',at(6));
  const a=createEnemy(A.world,'anao-molotov',O);
  const boss=createEnemy(A.world,'chefe',at(-1));const tio=createEnemy(A.world,'tio-pave',at(1));
  for(const e of A.world.enemies.values())e.frozenUntil=1e9;
  const bossHp=boss.hp,tioHp=tio.hp;
  A.world.damageEnemy(a.id,999,'p');A.flush();
  A.step(MOLOTOV.deathDelay+5);
  assert.equal(tio.hp,tioHp-MOLOTOV.deathEnemyDamage,'control: the neighbor took the blast');
  assert.equal(boss.hp,bossHp,'the boss did not');
});

test('R2: a bêbado who starts retreating drops his pending burp',()=>{
  const A=arena(33);const p=addPlayer(A.world,'p',at(2));
  const e=createEnemy(A.world,'bebado',O);
  for(let i=0;i<400&&!A.made.some(m=>m.t.owner===e.id);i++)A.step(1,()=>{e.x=O.x;e.y=O.y;});
  assert.ok(A.made.some(m=>m.t.owner===e.id),'he burped');
  e.memory!.retreat=1;
  A.step(MIN_TELEGRAPH_TICKS+5,healAll(A.world));
  assert.deepEqual(damageFrom(A.events,p.id,e.id),[],'no damage from a retreater');
  assert.ok(![...A.world.telegraphs.values()].some(t=>t.owner===e.id),'telegraph cancelled');
});

test('a boleto that downs the player does not mark them devendo',()=>{
  const A=arena(34);const p=addPlayer(A.world,'p',O);p.hp=5;
  A.world.onPlayerZero((player,source,ctx)=>{downPlayer(ctx,player,source);});
  A.world.projectiles.set('pj',{id:'pj',owner:'e-x',source:AGIOTA_SHOT.source,x:O.x-1,y:O.y,vx:AGIOTA_SHOT.speed,vy:0,radius:AGIOTA_SHOT.radius,
    damage:AGIOTA_SHOT.damage,pierce:0,untilTick:A.world.tick+40,hostile:true,hit:[],marks:'devendo'} as never);
  A.step(10);
  assert.ok(p.downed,'the boleto downed them');
  assert.equal((p as SimPlayer&DevendoPlayer).devendoUntil,undefined);assert.equal((p as SimPlayer&DevendoPlayer).devendoSay,undefined);
});
