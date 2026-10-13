/**
 * P1 cast (NEW-20261012-ORQ-elenco-p1-coach-motoboy-influencer) on a real SimWorld with the projectile and telegraph
 * systems, on open ground of the endless world (like elenco.test.ts and tio-charge.test.ts).
 *   coach: the palestra buffs allies within PALESTRA.radius for PALESTRA.duration (not coaches, not the boss), their damage
 *     is ×PALESTRA.damageMult once (two coaches never stack), EnemyView.phase 1 lecturing / 2 coached; no melee; he is
 *     the weapons' priority target right after the tapped one
 *   motoboy: warned 'investida' line (≥ 0.8 s, length = capped speed × charge + body), straight run at the peak cap, a
 *     hero who sidesteps is never touched, the 'explosao' blast (≥ 0.8 s, env:marmita:<id>), one death with no credit and
 *     XP once (full run), no blast outside the wave, no line (budget full) → no charge
 *   influencer: a friendly linear shot that hits him while posing comes back hostile and hurts its shooter; orbit/zone
 *     still hurt him; a shot outside the pose hurts him normally
 *   determinism: same seed → same state
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,SIM_HZ,type SimEvent,type SimPlayer,type Telegraph} from '../../src/contract/types.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {ACTION_PEAK_MAX,AGIOTA_SHOT,BUFFED_LINES,ENEMIES,MARMITA_BOOM_LINES,MOLOTOV,MOTOBOY,MOTOBOY_HONK_LINES,PALESTRA,PALESTRA_LINES,POSE,
  POSE_LINES,REFLECT,REFLECT_LINES,createEnemy,hazardKind,isReflecting,type CoachedEnemy} from '../../src/sim/enemies/catalog.ts';
import {ENEMY_PHASE,EnemyAi,STATE,type EnemyAiOptions} from '../../src/sim/enemies/ai.ts';
import {createProjectileSystem,spawnProjectile,type WeaponProjectile} from '../../src/sim/projectiles.ts';
import {createWeaponSystem} from '../../src/sim/weapons/system.ts';
import {MIN_TELEGRAPH_TICKS,createTelegraphSystem,telegraphHits} from '../../src/sim/telegraphs.ts';
import {MAX_PROJECTILES} from '../../src/rules/budget.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RADIUS,SPEED,walkable,type Point} from '../../src/maps/world.ts';
import {DEFAULT_SEED,TerrainField} from '../../src/maps/terrain/field.ts';

const TERRAIN=new TerrainField(DEFAULT_SEED,{world:'infinito'});
function openSpot(r:number):Point{
  const clear=(c:Point)=>{
    for(let dx=-r;dx<=r;dx+=.5)for(let dy=-r;dy<=r;dy+=.5)if(dx*dx+dy*dy<=r*r&&!walkable({x:c.x+dx,y:c.y+dy},TERRAIN))return false;
    return true;
  };
  for(let x=-60;x<=60;x+=2)for(let y=-60;y<=60;y+=2)if(clear({x,y}))return {x,y};
  throw new Error(`no open disc of radius ${r}`);
}
const O=openSpot(10);
const at=(dx:number,dy=0):Point=>({x:O.x+dx,y:O.y+dy});

interface Made {tick:number;t:Telegraph}
function arena(seed=1,round=3,options:EnemyAiOptions={},weapons=false){
  const world=new SimWorld({terrain:TERRAIN,seed});
  world.round.index=round;world.round.phase='wave';
  const ai=new EnemyAi({projectileCap:MAX_PROJECTILES,...options});
  world.register(ai);
  if(weapons)world.register(createWeaponSystem({cap:MAX_PROJECTILES}));
  world.register(createProjectileSystem({cap:MAX_PROJECTILES})).register(createTelegraphSystem());
  world.onKill((enemy,_by,ctx)=>ai.onKill(ctx,enemy));
  const events:(SimEvent&{tick:number})[]=[];
  const made:Made[]=[];
  const record=(list:readonly SimEvent[])=>{
    for(const e of list){
      events.push({...e,tick:world.tick});
      if(e.type==='telegraph'){const t=world.telegraphs.get(e.telegraph);if(t)made.push({tick:world.tick,t:{...t}});}
    }
  };
  const step=(n:number,each?:()=>void)=>{for(let i=0;i<n;i++){record(world.step());each?.();}};
  return {world,ai,events,made,step};
}
function addPlayer(world:SimWorld,id:string,p:Point,extra:Partial<SimPlayer>={}){
  const player:SimPlayer={id,classId:'test',x:p.x,y:p.y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
  world.players.set(id,player);
  return player;
}
const damageTo=(events:readonly (SimEvent&{tick:number})[],target:string,source:string)=>
  events.flatMap(e=>e.type==='damage'&&e.target===target&&e.source===source?[e.amount]:[]);
const near=(a:number,b:number,eps=1e-9)=>Math.abs(a-b)<=eps;
const coachedUntil=(e:object)=>(e as CoachedEnemy).coachedUntil;

// ---------- Coach ----------
test('palestra: allies within PALESTRA.radius are coached for PALESTRA.duration (not coaches, not far ones); phases 1 then 2',()=>{
  const A=arena(1,1);
  addPlayer(A.world,'p',at(5));
  const coach=createEnemy(A.world,'coach',O);
  const ally=createEnemy(A.world,'bebado',at(-2));
  const edge=createEnemy(A.world,'bebado',at(0,PALESTRA.radius-.01));
  const far=createEnemy(A.world,'bebado',at(-PALESTRA.radius-.3));
  const other=createEnemy(A.world,'coach',at(0,-1));
  for(const e of [ally,edge,far,other])e.frozenUntil=1e9;
  A.step(1);
  assert.equal(coach.memory!.state,STATE.lecture,'he lectures at once (player within PALESTRA.trigger)');
  assert.equal(coach.phase,ENEMY_PHASE.acting,'phase 1 while lecturing');
  assert.ok(A.events.some(e=>e.type==='bark'&&e.enemy===coach.id),'the palestra line, through the limiter');
  const started=A.world.tick;
  const x0={x:coach.x,y:coach.y};
  A.step(PALESTRA.lecture-1);
  assert.equal(coachedUntil(ally),undefined,'nothing before the lecture ends');
  assert.ok(near(coach.x,x0.x)&&near(coach.y,x0.y),'he stands still to lecture');
  A.step(1);
  const end=started+PALESTRA.lecture;
  assert.equal(A.world.tick,end);
  assert.equal(coachedUntil(ally),end+PALESTRA.duration,'ally coached for PALESTRA.duration');
  assert.equal(coachedUntil(edge),end+PALESTRA.duration,'inside the radius');
  assert.equal(coachedUntil(far),undefined,'outside the radius');
  assert.equal(coachedUntil(other),undefined,'a coach never coaches a coach');
  assert.equal(ally.phase,ENEMY_PHASE.coached,'phase 2 while coached');
  assert.equal(far.phase,undefined);
  assert.equal(coach.phase,undefined,'lecture over: no phase');
  A.step(PALESTRA.duration-1);
  assert.equal(ally.phase,ENEMY_PHASE.coached,'still coached on the last tick');
  A.step(1);
  assert.equal(ally.phase,undefined,'buff over');
  assert.equal(coachedUntil(ally),undefined,'expired buff dropped');
});

test('palestra: a coached ally hits ×PALESTRA.damageMult once (two coaches do not stack), the coach never hits in melee',()=>{
  const A=arena(2,1);
  const p=addPlayer(A.world,'p',at(5));
  const c1=createEnemy(A.world,'coach',O),c2=createEnemy(A.world,'coach',at(0,1));
  const buffed=createEnemy(A.world,'bebado',at(-1.5)),plain=createEnemy(A.world,'bebado',at(-8));
  for(const e of [buffed,plain])e.frozenUntil=1e9;
  A.step(PALESTRA.lecture+1);
  assert.equal(c1.memory!.state,STATE.walk);assert.equal(c2.memory!.state,STATE.walk);
  assert.equal(coachedUntil(buffed),1+PALESTRA.lecture+PALESTRA.duration,'both lectures: one window, not extended');
  // Contact tests: each bebado gets its own player at touching distance, the coaches are frozen far from both.
  for(const c of [c1,c2]){c.frozenUntil=1e9;c.x=O.x+20;}
  p.x=O.x+40;
  const q=addPlayer(A.world,'q',{x:buffed.x-(buffed.radius+RADIUS),y:buffed.y});
  const r=addPlayer(A.world,'r',{x:plain.x-(plain.radius+RADIUS),y:plain.y});
  delete buffed.frozenUntil;delete plain.frozenUntil;
  A.step(2,()=>{for(const pl of [q,r])pl.hp=100;});
  assert.deepEqual(damageTo(A.events,q.id,buffed.id),[ENEMIES.bebado.damage*PALESTRA.damageMult],'×1.3 once, not ×1.69');
  assert.deepEqual(damageTo(A.events,r.id,plain.id),[ENEMIES.bebado.damage],'uncoached: plain damage');
  // No melee: a player hugging a coach takes nothing from him.
  const B=arena(3,1);
  const hug=addPlayer(B.world,'h',at(.3+RADIUS));
  const coach=createEnemy(B.world,'coach',O);
  B.step(SIM_HZ*3,()=>{hug.x=coach.x+.3+RADIUS;hug.y=coach.y;});
  assert.deepEqual(damageTo(B.events,hug.id,coach.id),[],'the coach has no contact hit');
});

test('palestra: the agiota boleto and enemy hazards are set ×mult at spawn; the boss is never coached',()=>{
  const A=arena(4,3);
  addPlayer(A.world,'p',at(6));
  const ag=createEnemy(A.world,'agiota',at(-1)),an=createEnemy(A.world,'anao-molotov',at(0,1));
  for(const e of [ag,an])e.frozenUntil=1e9;
  const boss=createEnemy(A.world,'chefe',at(1,-1));
  createEnemy(A.world,'coach',O);
  A.step(PALESTRA.lecture+1);
  assert.equal(coachedUntil(boss),undefined,'the boss is never coached');
  assert.ok(coachedUntil(ag)!==undefined&&coachedUntil(an)!==undefined);
  A.world.enemies.delete(boss.id);
  for(const e of [ag,an])delete e.frozenUntil;
  let shot:WeaponProjectile|undefined;
  A.step(SIM_HZ*2,()=>{for(const pr of A.world.projectiles.values())if(pr.owner===ag.id)shot??=pr as WeaponProjectile;});
  assert.ok(shot,'the agiota fired');
  assert.ok(near(shot.damage,AGIOTA_SHOT.damage*PALESTRA.damageMult),`boleto ${shot.damage}`);
  const molotov=A.made.find(m=>m.t.owner===`env:molotov:${an.id}`&&m.t.kind==='molotov');
  assert.ok(molotov,'the anão threw');
  assert.ok(near(molotov.t.damage,MOLOTOV.damage*PALESTRA.damageMult),`molotov ${molotov.t.damage}`);
});

test('weapons aim at a live coach in range right after the tapped target, before the nearest enemy',()=>{
  const shoot=(tapped:boolean,coachAlive=true)=>{
    const A=arena(5,1,{},true);
    const p=addPlayer(A.world,'p',O,{build:{weapons:[{id:'boleto',level:1}],passives:[]}});
    const bebado=createEnemy(A.world,'bebado',at(1.5));
    const coach=createEnemy(A.world,'coach',at(0,-4));
    const pombo=createEnemy(A.world,'pombos',at(-2.5));
    for(const e of A.world.enemies.values())e.frozenUntil=1e9;
    if(!coachAlive)A.world.enemies.delete(coach.id);
    if(tapped)p.target=pombo.id;
    A.step(1);
    const shot=[...A.world.projectiles.values()].find(pr=>pr.owner==='p');
    assert.ok(shot,'fired');
    const d=Math.hypot(shot.vx,shot.vy);
    return {x:shot.vx/d,y:shot.vy/d,bebado,coach,pombo};
  };
  const coachFirst=shoot(false);
  assert.ok(near(coachFirst.x,0,1e-6)&&near(coachFirst.y,-1,1e-6),`aims at the coach (${coachFirst.x},${coachFirst.y}), not the nearer bebado`);
  const tapped=shoot(true);
  assert.ok(near(tapped.x,-1,1e-6)&&near(tapped.y,0,1e-6),'the tapped target still comes first');
  const none=shoot(false,false);
  assert.ok(near(none.x,1,1e-6)&&near(none.y,0,1e-6),'no coach: nearest as before');
});

// ---------- Motoboy ----------
/** A motoboy at O and a player `along` u ahead (+x); one step: honk and aim. */
function aim(options:EnemyAiOptions={},along=5,phase:'wave'|'prepare'='wave'){
  const A=arena(6,3,options);
  A.world.round.phase=phase;
  const p=addPlayer(A.world,'p',at(along));
  const e=createEnemy(A.world,'motoboy',O);
  A.step(1);
  const line=A.made.find(m=>m.t.owner===e.id&&m.t.kind==='investida');
  return {...A,p,e,line};
}

test('motoboy: warned investida line ≥ 0.8 s as long as the capped run, then a straight run at the peak cap',()=>{
  const M=aim();
  assert.equal(M.e.memory!.state,STATE.joke,'honk and aim');
  assert.equal(M.e.phase,ENEMY_PHASE.acting,'phase 1 while aiming');
  assert.ok(M.line,'the line is drawn');
  assert.equal(M.line.t.damage,0,'the line is only a warning');
  assert.ok(M.line.t.fireTick-M.line.tick>=MIN_TELEGRAPH_TICKS,'≥ 0.8 s of warning');
  const cap=SPEED*ACTION_PEAK_MAX,body=M.e.radius+.05;
  assert.ok(ENEMIES.motoboy.speed*MOTOBOY.chargeSpeed>cap,'his charge always hits the cap');
  assert.ok(near(M.line.t.radius,cap*MOTOBOY.charge/SIM_HZ+2*body),`line length ${M.line.t.radius}`);
  assert.ok(near(M.line.t.width!,2*body),'line width');
  assert.ok(near(M.line.t.dx!,1)&&near(M.line.t.dy!,0),'locked on the player');
  // The hero sidesteps once warned: out of the band.
  M.p.y+=body+RADIUS+.3;
  const ys:number[]=[],steps:number[]=[];
  for(let i=0;i<MOTOBOY.aim+MOTOBOY.charge+2;i++){
    const before={x:M.e.x,y:M.e.y},was=M.e.memory?.state;
    M.step(1);
    if(was===STATE.charge&&M.world.enemies.has(M.e.id)){steps.push(Math.hypot(M.e.x-before.x,M.e.y-before.y));ys.push(M.e.y);}
    if(was===STATE.charge)assert.equal(M.e.phase??ENEMY_PHASE.acting,ENEMY_PHASE.acting,'phase 1 while charging');
  }
  assert.ok(steps.length>=MOTOBOY.charge-1,`charged ${steps.length} ticks`);
  for(const s of steps)assert.ok(near(s,cap/SIM_HZ,1e-9),`step ${s} = cap ${cap/SIM_HZ}`);
  for(const y of ys)assert.ok(near(y,O.y,1e-9),'straight: no homing on the sidestepping hero');
  assert.deepEqual(damageTo(M.events,'p',M.e.id),[],'the hero who stepped out is never touched');
  assert.ok(!telegraphHits(M.line.t,M.p,RADIUS),'he stood outside the warned band');
});

test('motoboy: the run ends in a warned marmita blast (env:marmita), he dies once with no credit; a hero in the way is hit',()=>{
  const M=aim({},5);
  // The hero stays in the line: contact at the cap → hitDamage, then the crash.
  M.step(MOTOBOY.aim+MOTOBOY.charge+2);
  assert.deepEqual(damageTo(M.events,'p',M.e.id),[MOTOBOY.hitDamage],'one charge hit');
  const kills=M.events.filter(e=>e.type==='kill'&&e.enemy===M.e.id);
  assert.equal(kills.length,1,'dies once');
  assert.ok(kills[0].type==='kill'&&kills[0].by===undefined,'no player credit');
  assert.ok(!M.world.enemies.has(M.e.id));
  const blast=M.made.find(m=>m.t.owner===`env:marmita:${M.e.id}`);
  assert.ok(blast,'the bag explodes');
  assert.equal(blast.t.kind,'explosao');assert.equal(blast.t.radius,MOTOBOY.blastRadius);
  assert.ok(blast.t.fireTick-blast.tick>=MIN_TELEGRAPH_TICKS,'blast warned ≥ 0.8 s');
  assert.equal(hazardKind(blast.t.owner),'motoboy','the hazard names him');
  // Standing in the blast: hit once when it lands (after the dead motoboy, the env owner still fires).
  M.p.hp=100;M.p.x=blast.t.x;M.p.y=blast.t.y;
  M.step(MOTOBOY.blastDelay+2);
  assert.deepEqual(damageTo(M.events,'p',blast.t.owner),[MOTOBOY.blastDamage],'blast hits once');
  assert.equal(M.events.filter(e=>e.type==='kill'&&e.enemy===M.e.id).length,1,'still one kill');
  // A full run of the same: he crashes at the end of the line when nobody is in it.
  const N=aim({},5);N.p.y+=3;
  N.step(MOTOBOY.aim+MOTOBOY.charge+2);
  assert.ok(!N.world.enemies.has(N.e.id),'crashed at the end of the run');
  const end=N.made.find(m=>m.t.owner===`env:marmita:${N.e.id}`)!;
  assert.ok(end&&near(end.t.x-O.x,SPEED*ACTION_PEAK_MAX*MOTOBOY.charge/SIM_HZ,1e-6),`blast at the end of the line (${end?.t.x-O.x})`);
});

test('motoboy: telegraph budget full → no line, no charge; outside the wave → no line, no blast',()=>{
  const full=aim({telegraphCap:0});
  assert.equal(full.line,undefined);
  full.step(MOTOBOY.aim+MOTOBOY.charge+5);
  assert.ok(full.world.enemies.has(full.e.id),'never charged, never crashed');
  assert.notEqual(full.e.memory!.state,STATE.charge);
  assert.equal(full.made.length,0,'no hazard at all');
  const prepare=aim({},5,'prepare');
  assert.equal(prepare.line,undefined,'no aim in the intermission');
  // Charge started in the wave, round over mid-run: he crashes into the intermission without a blast.
  const late=aim({},5);late.p.y+=3;
  late.step(MOTOBOY.aim+2);
  assert.equal(late.e.memory!.state,STATE.charge);
  late.world.round.phase='prepare';
  late.step(MOTOBOY.charge+2);
  assert.ok(!late.world.enemies.has(late.e.id),'he still crashes');
  assert.equal(late.made.filter(m=>m.t.owner.startsWith('env:marmita:')).length,0,'no blast outside the wave');
  assert.equal([...late.world.telegraphs.values()].length,0,'nothing pending');
});

test('motoboy: a line annulled mid-aim calls the charge off; a crowd pushing him as he starts to aim does not',()=>{
  const M=aim();
  assert.ok(M.line);
  M.world.telegraphs.delete(M.line.t.id);
  M.step(MOTOBOY.aim+MOTOBOY.charge);
  assert.notEqual(M.e.memory!.state,STATE.charge,'no unwarned charge');
  assert.ok(M.world.enemies.has(M.e.id),'no crash either');
  assert.equal(M.made.filter(m=>m.t.owner.startsWith('env:marmita:')).length,0);
  // A neighbor overlapping him when the aim starts: he stays on the line he drew and charges.
  const A=arena(6,3);
  const p=addPlayer(A.world,'p',at(5));
  const e=createEnemy(A.world,'motoboy',O),crowd=createEnemy(A.world,'bebado',at(-.2,.1));
  crowd.frozenUntil=1e9;
  A.step(1);
  assert.equal(e.memory!.state,STATE.joke);
  assert.ok(near(e.x,O.x)&&near(e.y,O.y),'not pushed off the start of his line');
  p.y+=3;
  A.step(MOTOBOY.aim+1);
  assert.equal(e.memory!.state,STATE.charge,'he charges');
});

test('motoboy: in a full run his crash drops his XP once (kill hook, no credit)',()=>{
  const sim=new Simulation(7);sim.add('a','Ana','pedreiro');sim.resetRun();
  const w=sim.world;
  for(let i=0;i<20000&&!(w.round.phase==='wave'&&w.enemies.size>1);i++)sim.step();
  const d=(sim as unknown as {systems:{director:{state:{nextGroup:number;plan:{groups:unknown[]};pending:unknown[]}}}}).systems.director.state;
  d.nextGroup=d.plan.groups.length;d.pending=[];
  const ids=[...w.enemies.keys()],p=sim.players.get('a')!;
  for(const id of ids.slice(2))w.damageEnemy(id,1e6,'a');
  const moto=createEnemy(w,'motoboy',{x:p.x+5,y:p.y});
  const other=w.enemies.get(ids[1])!;other.x=p.x+15;other.frozenUntil=1e9;   // keeps the wave going
  w.damageEnemy(ids[0],1e6,'a');
  p.invulnerableUntil=1e9;p.build.weapons=[];
  const xpBefore=[...w.pickups.values()].filter(k=>k.kind==='xp').reduce((n,k)=>n+k.value,0);
  const events:SimEvent[]=[];
  for(let i=0;i<MOTOBOY.aim+MOTOBOY.charge+10&&w.enemies.has(moto.id);i++){events.push(...sim.step());p.x=moto.x-5;p.y=moto.y+3;}
  assert.ok(!w.enemies.has(moto.id),'crashed');
  const kills=events.filter(e=>e.type==='kill'&&e.enemy===moto.id);
  assert.equal(kills.length,1);
  const xpAfter=[...w.pickups.values()].filter(k=>k.kind==='xp').reduce((n,k)=>n+k.value,0);
  assert.equal(xpAfter-xpBefore,ENEMIES.motoboy.xp,'his XP dropped once');
});

// ---------- Influencer ----------
/** An influencer at O, a shooter at `along` (+x), one step (he poses at once: shooter within POSE.trigger). */
function poser(along=4.5,pose=true){
  const A=arena(9,3);
  const p=addPlayer(A.world,'p',at(along));
  const e=createEnemy(A.world,'influencer',O);
  if(!pose)e.memory!.actReady=1e9;
  A.step(1);
  return {...A,p,e};
}
const shot=(A:{world:SimWorld},from:Point,to:Point,extra:Partial<WeaponProjectile>={})=>{
  const d=Math.hypot(to.x-from.x,to.y-from.y),speed=10;
  return spawnProjectile(A.world,{owner:'p',source:'boleto',motion:'linear',x:from.x,y:from.y,vx:(to.x-from.x)/d*speed,vy:(to.y-from.y)/d*speed,
    radius:.25,damage:10,pierce:2,untilTick:A.world.tick+SIM_HZ,hostile:false,knockback:.3,...extra})!;
};

test('influencer: a friendly linear shot that hits his pose comes back hostile (×REFLECT.mult, pierce 0) and hurts the shooter',()=>{
  const I=poser();
  assert.equal(I.e.memory!.state,STATE.pose,'he poses');
  assert.equal(I.e.phase,ENEMY_PHASE.acting,'phase 1 while posing');
  assert.ok(isReflecting(I.e,I.world.tick));
  const hp=I.e.hp;
  const s=shot(I,{x:I.p.x-.5,y:I.p.y},O);
  let turned=-1;
  I.step(SIM_HZ,()=>{if(turned<0&&s.hostile)turned=I.world.tick;});
  assert.ok(turned>0,'reflected');
  assert.equal(I.e.hp,hp,'no damage to him');
  assert.equal(s.owner,I.e.id,'owned by him');
  assert.ok(s.vx>0,'velocity reversed (back to the shooter)');
  assert.equal(s.pierce,0);
  assert.deepEqual(damageTo(I.events,'p',I.e.id),[10*REFLECT.mult],'the shooter eats his own shot ×0.6');
  // His line asks for the limiter afterwards (the pose line came first).
  assert.ok(I.events.filter(e=>e.type==='bark'&&e.enemy===I.e.id).length>=1);
});

test('influencer: orbit and zone still hurt him in the pose; outside the pose a linear shot hurts him normally',()=>{
  const I=poser();
  const hp=I.e.hp;
  spawnProjectile(I.world,{owner:'p',source:'chinelo',motion:'orbit',anchor:'p',angle:Math.PI,orbitRadius:Math.hypot(I.p.x-O.x,I.p.y-O.y),spin:0,
    x:O.x,y:O.y,vx:0,vy:0,radius:.4,damage:7,pierce:999,untilTick:I.world.tick+5,hostile:false,rehit:10,group:'p:chinelo'});
  spawnProjectile(I.world,{owner:'p',source:'cafe',motion:'linear',x:O.x,y:O.y,vx:0,vy:0,radius:.6,damage:3,pierce:999,
    untilTick:I.world.tick+5,hostile:false,rehit:10,group:'p:cafe'});
  I.step(2);
  assert.ok(isReflecting(I.e,I.world.tick),'still posing');
  assert.equal(I.e.hp,hp-7-3,'orbit and zone hit him');
  assert.ok([...I.world.projectiles.values()].every(pr=>!pr.hostile),'nothing reflected');
  // Not posing: plain hit.
  const N=poser(4.5,false);
  assert.equal(N.e.memory!.state,STATE.walk);
  const before=N.e.hp;
  const s=shot(N,{x:N.p.x-.5,y:N.p.y},N.e);
  N.step(SIM_HZ/2);
  assert.ok(!s.hostile,'not reflected');
  assert.equal(N.e.hp,before-10,'he takes it');
  // The pose lasts POSE.duration ticks, then the cooldown.
  const P=poser();
  P.step(POSE.duration-1);
  assert.ok(isReflecting(P.e,P.world.tick),'still posing on its last tick');
  P.step(1);
  assert.equal(P.e.memory!.state,STATE.walk,'pose over');
  assert.ok(!isReflecting(P.e,P.world.tick));
  assert.equal(P.e.phase,undefined);
});

// ---------- Determinism ----------
test('same seed, same P1 behaviors and state',()=>{
  const run=()=>{
    const A=arena(11,5,{},true);
    addPlayer(A.world,'p',at(5),{build:{weapons:[{id:'boleto',level:2}],passives:[]}});
    addPlayer(A.world,'q',at(-4,3));
    for(const [k,dx,dy] of [['coach',0,0],['motoboy',-2,2],['influencer',2,-2],['bebado',1,1],['tio-pave',-1,-1],['agiota',3,3]] as const)createEnemy(A.world,k,at(dx,dy));
    A.step(SIM_HZ*12,()=>{for(const p of A.world.players.values())p.hp=100;});
    return {hash:stateHash(A.world.state()),made:A.made.map(m=>`${m.tick}:${m.t.owner}:${m.t.kind}`).join(','),events:A.events.length};
  };
  const a=run(),b=run();
  assert.equal(a.hash,b.hash);assert.equal(a.made,b.made);assert.equal(a.events,b.events);
  assert.ok(a.made.includes('investida'),'the motoboy aimed');
});

test('P1 text: frozen mechanics lists, every line 1-30 characters and unique across the catalog',()=>{
  const lists={PALESTRA_LINES,BUFFED_LINES,MOTOBOY_HONK_LINES,MARMITA_BOOM_LINES,POSE_LINES,REFLECT_LINES};
  const all=[...Object.values(ENEMIES).flatMap(d=>[...d.barks,...d.deathLines,...d.reactionLines])];
  for(const [name,list] of Object.entries(lists)){
    assert.ok(Object.isFrozen(list),`${name} frozen`);assert.ok(list.length>=5,`${name} count`);
    all.push(...list);
  }
  for(const k of ['coach','motoboy','influencer'] as const){
    const d=ENEMIES[k];assert.ok(d.barks.length>=8&&d.deathLines.length>=6&&d.reactionLines.length>=6,k);
  }
  for(const line of all)assert.ok(line.trim()===line&&line.length>0&&[...line].length<=30,`"${line}"`);
  assert.equal(new Set(all).size,all.length,'no repeated line');
});
