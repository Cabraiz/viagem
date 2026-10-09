import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {Rng} from '../src/game/sim/rng.ts';
import {BASE_STATS,SIM_HZ,type EnemyState,type LevelOffer,type PickupState,type ProjectileState,type RoundState,type SimContext,type SimEvent,type SimPlayer,type SpatialIndex,type TeamProgress,type Telegraph} from '../src/game/sim/types.ts';
import {ELITE,ENEMIES,ENEMY_KINDS,FISCAL_SHOT,TIO_JOKE,applyElite,createEnemy,deathLineFor,enemyName,type EnemyKind} from '../src/game/sim/enemies/catalog.ts';
import {BARK_GAP,EnemyAi,STATE,moveSafely} from '../src/game/sim/enemies/ai.ts';
import {RADIUS,clearSegment,obstacles,walkable,type Point} from '../src/game/world.ts';
import {DEFAULT_SEED,TerrainField} from '../src/game/terrain/field.ts';

// ---------- Fake core (the real SimContext is built elsewhere) ----------
const TERRAIN=new TerrainField(DEFAULT_SEED);
const CENTER={x:12,y:12};
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

/** Naive O(n) spatial index: reads live positions at query time. */
class NaiveIndex implements SpatialIndex<EnemyState> {
  items:EnemyState[]=[];
  rebuild(items:Iterable<EnemyState>){this.items=[...items];}
  query(x:number,y:number,radius:number,out:EnemyState[]=[]){const r2=radius*radius;for(const e of this.items){const dx=e.x-x,dy=e.y-y;if(dx*dx+dy*dy<=r2)out.push(e);}return out;}
  nearest(x:number,y:number,radius:number,filter?:(item:EnemyState)=>boolean){
    let best:EnemyState|undefined,bd=Infinity;
    for(const e of this.items){const d=Math.hypot(e.x-x,e.y-y);if(d<=radius&&d<bd&&(!filter||filter(e))){bd=d;best=e;}}
    return best;
  }
}
/** Uniform grid (cell 2, like the production SpatialHash of D-004), used only by the bench. Positions snapshotted on rebuild. */
class GridIndex implements SpatialIndex<EnemyState> {
  private cells=new Map<number,EnemyState[]>();
  private key(cx:number,cy:number){return (cx+64)*256+(cy+64);}
  rebuild(items:Iterable<EnemyState>){for(const c of this.cells.values())c.length=0;for(const e of items){const k=this.key(Math.floor(e.x/2),Math.floor(e.y/2));let c=this.cells.get(k);if(!c)this.cells.set(k,c=[]);c.push(e);}}
  query(x:number,y:number,radius:number,out:EnemyState[]=[]){
    out.length=0;const r2=radius*radius;
    for(let cx=Math.floor((x-radius)/2);cx<=Math.floor((x+radius)/2);cx++)for(let cy=Math.floor((y-radius)/2);cy<=Math.floor((y+radius)/2);cy++){
      const c=this.cells.get(this.key(cx,cy));if(c)for(const e of c){const dx=e.x-x,dy=e.y-y;if(dx*dx+dy*dy<=r2)out.push(e);}
    }
    return out;
  }
  nearest(x:number,y:number,radius:number,filter?:(item:EnemyState)=>boolean){let best:EnemyState|undefined,bd=Infinity;for(const e of this.query(x,y,radius))if((!filter||filter(e))){const d=Math.hypot(e.x-x,e.y-y);if(d<bd){bd=d;best=e;}}return best;}
}
interface Hit {id:string;amount:number;source?:string;tick:number}
class FakeCtx implements SimContext {
  tick=0;
  readonly terrain=TERRAIN;
  readonly rng:Rng;
  readonly players=new Map<string,SimPlayer>();
  readonly enemies=new Map<string,EnemyState>();
  readonly pickups=new Map<string,PickupState>();
  readonly projectiles=new Map<string,ProjectileState>();
  readonly telegraphs=new Map<string,Telegraph>();
  readonly team:TeamProgress={xp:0,level:1,nextXp:5};
  readonly offers=new Map<string,LevelOffer[]>();
  readonly round:RoundState={index:0,total:5,phase:'wave',phaseEndsTick:1e9,remaining:0};
  enemyIndex:SpatialIndex<EnemyState>=new NaiveIndex();
  readonly events:SimEvent[]=[];
  readonly hits:Hit[]=[];
  private n=0;
  constructor(seed=1){this.rng=new Rng(seed);}
  nextId(prefix:string){return `${prefix}${++this.n}`;}
  emit(event:SimEvent){this.events.push(event);}
  damageEnemy(enemyId:string,amount:number){const e=this.enemies.get(enemyId);if(!e||e.hp<=0)return false;e.hp-=amount;return e.hp<=0;}
  damagePlayer(playerId:string,amount:number,source?:string){
    this.hits.push({id:playerId,amount,source,tick:this.tick});
    const p=this.players.get(playerId);
    if(!p||this.tick<(p.invulnerableUntil??-Infinity))return;
    p.hp=Math.max(0,p.hp-amount);
  }
  barks(){return this.events.filter((e):e is Extract<SimEvent,{type:'bark'}>=>e.type==='bark');}
}
function addPlayer(ctx:FakeCtx,id:string,at:Point,extra:Partial<SimPlayer>={}){
  const p:SimPlayer={id,classId:'test',x:at.x,y:at.y,hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
  ctx.players.set(id,p);return p;
}
function run(ctx:FakeCtx,ai:EnemyAi,n:number,each?:()=>void){for(let i=0;i<n;i++){ctx.tick++;ai.step(ctx);each?.();}}
const heal=(ctx:FakeCtx)=>()=>{for(const p of ctx.players.values())p.hp=100;};

// ---------- Real land positions ----------
const WALK:Point[]=[];
for(let y=1;y<=23;y+=.25)for(let x=1;x<=23;x+=.25)if(walkable({x,y},TERRAIN))WALK.push({x,y});
const BY_CENTER=[...WALK].sort((a,b)=>dist(a,CENTER)-dist(b,CENTER));
/** Walkable point with walkable rings up to radius r around it. */
function open(p:Point,r:number){
  if(!walkable(p,TERRAIN))return false;
  for(let k=1;k<=3;k++)for(let i=0;i<16;i++){const a=i*Math.PI/8;if(!walkable({x:p.x+Math.cos(a)*r*k/3,y:p.y+Math.sin(a)*r*k/3},TERRAIN))return false;}
  return true;
}
const openPoint=(r:number,skip=0)=>BY_CENTER.filter(p=>open(p,r))[skip];
/** Straight obstacle-free strip of length `len` and half-width `width`, nearest to the island center. */
function corridor(len:number,width=.8){
  const dirs=Array.from({length:8},(_,i)=>({x:Math.cos(i*Math.PI/4),y:Math.sin(i*Math.PI/4)}));
  for(const a of BY_CENTER)for(const u of dirs){
    const n={x:-u.y,y:u.x};
    const ok=[-width,-width/2,0,width/2,width].every(o=>{const s={x:a.x+n.x*o,y:a.y+n.y*o};return clearSegment(s,{x:s.x+u.x*len,y:s.y+u.y*len},TERRAIN);});
    if(ok)return {a,u,n,at:(t:number,o=0):Point=>({x:a.x+u.x*t+n.x*o,y:a.y+u.y*t+n.y*o})};
  }
  throw new Error(`no corridor of length ${len}`);
}
const MIX:EnemyKind[]=['gosma','gosma','gosma','gosma','gosma','gosma','gosma','gosma','pernilongo','pernilongo','pernilongo','pernilongo','pernilongo','pernilongo','tio-pave','tio-pave','tio-pave','fiscal','fiscal','fiscal'];
function horde(ctx:FakeCtx,count:number,spawn:Rng,eliteEvery=0){
  for(let i=0;i<count;i++)createEnemy(ctx,MIX[i%MIX.length],spawn.pick(WALK),1,{elite:eliteEvery>0&&i%eliteEvery===0});
}
function placePlayers(ctx:FakeCtx,count:number,spawn:Rng){for(let i=0;i<count;i++)addPlayer(ctx,`p${i}`,spawn.pick(WALK));}

// ---------- 1. Catalog ----------
test('catalog: five kinds plus elite, with enough short unique lines and positive stats',()=>{
  assert.deepEqual([...ENEMY_KINDS],['gosma','pernilongo','tio-pave','fiscal','chefe']);
  assert.deepEqual(Object.keys(ENEMIES).sort(),[...ENEMY_KINDS].sort());
  const all:string[]=[];
  for(const kind of ENEMY_KINDS){
    const d=ENEMIES[kind];
    assert.equal(d.id,kind);assert.ok(d.name.length>0,kind);
    assert.ok(d.barks.length>=5,`${kind} barks`);assert.ok(d.deathLines.length>=5,`${kind} deathLines`);
    for(const k of ['hp','speed','damage','radius','xp','contactCooldown'] as const)assert.ok(d[k]>0&&Number.isFinite(d[k]),`${kind}.${k}`);
    if(kind!=='chefe')assert.ok(d.reactionLines.length>0,`${kind} reactionLines`);
    all.push(...d.barks,...d.deathLines,...d.reactionLines);
  }
  assert.equal(ENEMIES.chefe.behavior,'boss');
  assert.ok(ELITE.name.length>0);assert.ok(ELITE.barks.length>=5);assert.ok(ELITE.deathLines.length>=5);
  for(const k of ['hp','speed','damage','radius','xp'] as const)assert.ok(ELITE[k]>0,`ELITE.${k}`);
  all.push(...ELITE.barks,...ELITE.deathLines,...ELITE.reactionLines);
  for(const line of all){assert.ok(line.trim().length>0);assert.ok([...line].length<=32,`too long (${[...line].length}): ${line}`);}
  const seen=new Set<string>();
  for(const line of all){assert.ok(!seen.has(line),`duplicate line: ${line}`);seen.add(line);}
  assert.ok(ENEMIES['tio-pave'].barks.includes('É pavê ou pa comê?'));
});

// ---------- 2. createEnemy ----------
test('createEnemy registers, scales hp only, applies elite/boss, readyIn; death lines and names are stable',()=>{
  const ctx=new FakeCtx();ctx.tick=10;
  const at=BY_CENTER[0];
  const g=createEnemy(ctx,'gosma',at);
  assert.equal(g.id,'e1');assert.equal(ctx.enemies.get('e1'),g);
  assert.equal(g.hp,ENEMIES.gosma.hp);assert.equal(g.maxHp,g.hp);assert.equal(g.x,at.x);assert.equal(g.y,at.y);
  assert.equal(g.spawnTick,10);assert.equal(g.readyTick,10);assert.ok(!g.elite&&!g.boss);
  const s=createEnemy(ctx,'gosma',at,2.5);
  assert.equal(s.id,'e2');assert.equal(s.hp,Math.round(ENEMIES.gosma.hp*2.5));assert.equal(s.maxHp,s.hp);
  assert.deepEqual([s.speed,s.damage,s.radius,s.xp],[g.speed,g.damage,g.radius,g.xp]);
  for(const bad of [0,-1,NaN,Infinity]){const b=createEnemy(ctx,'fiscal',at,bad);assert.equal(b.hp,ENEMIES.fiscal.hp,`scale ${bad}`);}
  const el=createEnemy(ctx,'tio-pave',at,2,{elite:true});
  const t=ENEMIES['tio-pave'];
  assert.equal(el.elite,true);
  assert.equal(el.maxHp,Math.round(t.hp*2*ELITE.hp));assert.equal(el.hp,el.maxHp);
  assert.ok(Math.abs(el.radius-t.radius*ELITE.radius)<1e-12);assert.equal(el.xp,t.xp*ELITE.xp);
  assert.ok(Math.abs(el.speed-t.speed*ELITE.speed)<1e-12);assert.equal(el.damage,Math.round(t.damage*ELITE.damage));
  const boss=createEnemy(ctx,'chefe',at);assert.equal(boss.boss,true);assert.ok(!boss.elite);
  const late=createEnemy(ctx,'pernilongo',at,1,{readyIn:30});assert.equal(late.readyTick,40);
  assert.equal(createEnemy(ctx,'gosma',at,1,{readyIn:-5}).readyTick,10);
  assert.throws(()=>createEnemy(ctx,'dragao' as EnemyKind,at));
  // Death lines: deterministic and from the right list.
  for(const e of ctx.enemies.values()){
    const line=deathLineFor(e);
    assert.equal(deathLineFor({id:e.id,kind:e.kind,elite:e.elite}),line);
    const list=e.elite?ELITE.deathLines:ENEMIES[e.kind as EnemyKind].deathLines;
    assert.ok(list.includes(line),`${e.id} ${line}`);
  }
  const lines=new Set(Array.from({length:60},(_,i)=>deathLineFor({id:`e${i}`,kind:'gosma'})));
  assert.ok(lines.size>1,'death lines vary by id');
  assert.ok(ELITE.deathLines.includes(deathLineFor({id:'e9',kind:'gosma',elite:true})));
  assert.equal(enemyName({kind:'fiscal'}),ENEMIES.fiscal.name);
  assert.equal(enemyName({kind:'fiscal',elite:true}),`${ENEMIES.fiscal.name} ${ELITE.name}`);
});

// ---------- 3. Chase ----------
test('gosma chases the nearest live player, ignores downed/offline/spectator/eliminated/dead ones, idles without targets',()=>{
  const c=corridor(7);
  const variants:Partial<SimPlayer>[]=[{downed:{sinceTick:0,bleedOutTick:999,progress:0}},{online:false},{spectator:true},{eliminated:true},{hp:0}];
  for(const v of variants){
    const ctx=new FakeCtx();
    const live=addPlayer(ctx,'live',c.at(7)),decoy=addPlayer(ctx,'decoy',c.at(1),v);
    const e=createEnemy(ctx,'gosma',c.at(3));const ai=new EnemyAi();
    const d0=dist(e,live),k0=dist(e,decoy);
    run(ctx,ai,10);
    const moved=(e.x-c.at(3).x)*c.u.x+(e.y-c.at(3).y)*c.u.y;
    assert.ok(dist(e,live)<d0-.6,`${JSON.stringify(v)}: closes on live player`);
    assert.ok(dist(e,decoy)>k0+.6,`${JSON.stringify(v)}: leaves decoy`);
    assert.ok(Math.abs(moved-10*ENEMIES.gosma.speed/SIM_HZ)<1e-6,`${JSON.stringify(v)}: full speed along the line (${moved})`);
  }
  {// Memory is optional on EnemyState: the AI initializes it.
    const ctx=new FakeCtx();const live=addPlayer(ctx,'live',c.at(7));
    const e=createEnemy(ctx,'gosma',c.at(3));delete e.memory;const d0=dist(e,live);
    run(ctx,new EnemyAi(),5);
    assert.ok(dist(e,live)<d0-.3);assert.ok(e.memory&&Number.isFinite(e.memory.seed)&&e.memory.state===STATE.walk);
  }
  // Only invalid targets: no movement at all.
  const ctx=new FakeCtx();
  variants.forEach((v,i)=>addPlayer(ctx,`x${i}`,c.at(1+i*.5),v));
  const e=createEnemy(ctx,'gosma',c.at(5));const start={x:e.x,y:e.y};
  run(ctx,new EnemyAi(),40);
  assert.deepEqual({x:e.x,y:e.y},start);
  assert.equal(ctx.hits.length,0);
});

// ---------- 4. Terrain safety ----------
test('enemies never enter the sea or obstacles; an off-land spawn walks ashore and stays',()=>{
  const spawn=new Rng(404),ctx=new FakeCtx(4);
  // Pairs (player side, enemy side) across each obstacle, so the straight chase line crosses it.
  const across:{p:Point;e:Point}[]=[];
  for(const o of obstacles)for(let i=0;i<8;i++){
    const a=i*Math.PI/4,u={x:Math.cos(a),y:Math.sin(a)};
    const p={x:o.x+u.x*(o.radius+RADIUS+.2),y:o.y+u.y*(o.radius+RADIUS+.2)},e={x:o.x-u.x*(o.radius+1.2),y:o.y-u.y*(o.radius+1.2)};
    if(walkable(p,TERRAIN)&&walkable(e,TERRAIN)){across.push({p,e});break;}
  }
  assert.ok(across.length>=10,`pairs across obstacles: ${across.length}`);
  const coast=WALK.filter(p=>!TERRAIN.land(p.x,p.y,RADIUS+.7));
  assert.ok(coast.length>20,'coast points');
  const kinds:EnemyKind[]=['gosma','pernilongo','tio-pave','fiscal'];
  across.forEach((x,i)=>createEnemy(ctx,kinds[i%4],x.e,1,{elite:i%5===0}));
  while(ctx.enemies.size<60)createEnemy(ctx,kinds[ctx.enemies.size%4],spawn.pick(WALK));
  const players=Array.from({length:4},(_,i)=>addPlayer(ctx,`p${i}`,across[i].p));
  const ai=new EnemyAi();
  for(const e of ctx.enemies.values())assert.ok(walkable(e,TERRAIN));
  for(let t=0;t<400;t++){
    if(t%50===0&&t)players.forEach((p,i)=>{const q=(t/50)%2?coast[spawn.int(0,coast.length-1)]:across[(t/50*4+i)%across.length].p;p.x=q.x;p.y=q.y;});
    run(ctx,ai,1,heal(ctx));
    for(const e of ctx.enemies.values())assert.ok(walkable(e,TERRAIN),`tick ${ctx.tick}: ${e.id} (${e.kind}) left land at ${e.x.toFixed(3)},${e.y.toFixed(3)}`);
    for(const p of players)assert.ok(walkable(p,TERRAIN),`tick ${ctx.tick}: ${p.id} shoved off land`);
  }
  assert.ok(ctx.hits.length>0,'enemies did reach players');
  // Off-land spawn: a point in shallow sea just past a radial strip of walkable ground.
  let found:{p:Point;s:Point}|undefined;
  for(let i=0;i<72&&!found;i++){
    const a=i*Math.PI/36,u={x:Math.cos(a),y:Math.sin(a)};
    for(let r=6;r<12&&!found;r+=.05){
      const p={x:CENTER.x+u.x*r,y:CENTER.y+u.y*r};
      if(!open(p,.7))continue;
      const s={x:p.x+u.x*1.4,y:p.y+u.y*1.4};
      if(!TERRAIN.land(s.x,s.y)&&clearSegment(p,{x:p.x+u.x*.7,y:p.y+u.y*.7},TERRAIN))found={p,s};
    }
  }
  assert.ok(found,'shallow-sea spawn point');
  const sea=new FakeCtx(5);addPlayer(sea,'p',found.p);
  const e=createEnemy(sea,'gosma',found.s);assert.ok(!walkable(e,TERRAIN));
  const ai2=new EnemyAi();let ashore=-1;
  for(let t=0;t<200;t++){
    run(sea,ai2,1,heal(sea));
    if(ashore<0&&walkable(e,TERRAIN))ashore=sea.tick;
    if(ashore>=0)assert.ok(walkable(e,TERRAIN),`tick ${sea.tick}: left land after reaching it`);
  }
  assert.ok(ashore>0,'reached walkable ground within 200 ticks');
});

// ---------- 5. Contact damage ----------
test('contact damage goes through damagePlayer with the enemy id and respects contactCooldown',()=>{
  const c=corridor(3),ctx=new FakeCtx();
  const p=addPlayer(ctx,'p1',c.at(2));
  const e=createEnemy(ctx,'gosma',c.at(1.5));const ai=new EnemyAi();
  run(ctx,ai,60,heal(ctx));
  assert.ok(ctx.hits.length>=3);
  for(const h of ctx.hits)assert.deepEqual({id:h.id,amount:h.amount,source:h.source},{id:p.id,amount:e.damage,source:e.id});
  assert.equal(ctx.hits[0].tick,1);
  for(let i=1;i<ctx.hits.length;i++)assert.equal(ctx.hits[i].tick-ctx.hits[i-1].tick,ENEMIES.gosma.contactCooldown);
  // Hp is subtracted by the core, invulnerability honored by the fake core (not by the AI).
  const before=ctx.hits.length;run(ctx,ai,ENEMIES.gosma.contactCooldown);
  assert.equal(ctx.hits.length,before+1);assert.equal(p.hp,100-e.damage);
});

// ---------- 6. Pernilongo zig-zag ----------
test('pernilongo zig-zags sideways while closing distance',()=>{
  const c=corridor(9,1.2),ctx=new FakeCtx();
  const p=addPlayer(ctx,'p1',c.at(9));
  const e=createEnemy(ctx,'pernilongo',c.at(0));const ai=new EnemyAi();
  const d0=dist(e,p);let lo=Infinity,hi=-Infinity;
  for(let t=0;t<45;t++){
    run(ctx,ai,1);
    const off=(e.x-c.a.x)*c.n.x+(e.y-c.a.y)*c.n.y;lo=Math.min(lo,off);hi=Math.max(hi,off);
  }
  assert.ok(hi-lo>.25,`lateral range ${(hi-lo).toFixed(3)}`);
  assert.ok(dist(e,p)<d0-3,`closed distance ${(d0-dist(e,p)).toFixed(3)}`);
  assert.ok(walkable(e,TERRAIN));
});

// ---------- 7. Tio do Pavê ----------
test('tio do pave stops for a joke, barks a reaction, charges faster, shoves and cools down',()=>{
  const c=corridor(9),ctx=new FakeCtx(7);
  const p=addPlayer(ctx,'p1',c.at(2.2));
  const e=createEnemy(ctx,'tio-pave',c.at(0));const ai=new EnemyAi();
  assert.equal(ai.lastBarkTick,-Infinity);
  assert.ok(dist(e,p)<=TIO_JOKE.range);
  run(ctx,ai,1,heal(ctx));
  assert.equal(e.memory!.state,STATE.joke);
  const barks=ctx.barks();
  assert.equal(barks.length,1);assert.equal(barks[0].enemy,e.id);
  assert.ok(ENEMIES['tio-pave'].reactionLines.includes(barks[0].line),barks[0].line);
  const jokeStart=ctx.tick,pos={x:e.x,y:e.y};
  while(ctx.tick<jokeStart+TIO_JOKE.pause){run(ctx,ai,1,heal(ctx));assert.deepEqual({x:e.x,y:e.y},pos,`still at tick ${ctx.tick}`);}
  assert.equal(e.memory!.state,STATE.charge);
  // Charge until the shove.
  let fastest=0,shoved=false;
  for(let t=0;t<TIO_JOKE.charge&&!shoved;t++){
    const ep={x:e.x,y:e.y},pp={x:p.x,y:p.y},hits=ctx.hits.length;
    run(ctx,ai,1,heal(ctx));
    if(ctx.hits.length>hits){
      shoved=true;
      assert.equal(ctx.hits[hits].source,e.id);assert.equal(ctx.hits[hits].amount,e.damage);
      const push=dist(p,pp);
      assert.ok(push>TIO_JOKE.shove*.9,`shove ${push.toFixed(3)}`);
      assert.ok(dist(p,e)>dist(pp,ep)+.5,'player pushed away from the tio');
      assert.ok(walkable(p,TERRAIN));
      assert.equal(e.memory!.state,STATE.walk);assert.equal(e.memory!.actReady,ctx.tick+TIO_JOKE.cooldown);
    }else fastest=Math.max(fastest,dist(e,ep));
  }
  assert.ok(shoved,'charge reached the player');
  const walkStep=ENEMIES['tio-pave'].speed/SIM_HZ;
  assert.ok(Math.abs(fastest-walkStep*TIO_JOKE.chargeSpeed)<1e-6,`charge step ${fastest}`);
  // Cooldown: no new joke before actReady, a new joke after it.
  const ready=e.memory!.actReady;
  while(ctx.tick<ready-1){run(ctx,ai,1,heal(ctx));assert.notEqual(e.memory!.state,STATE.joke,`joke during cooldown at ${ctx.tick}`);}
  let again=false;
  for(let t=0;t<40&&!again;t++){run(ctx,ai,1,heal(ctx));again=e.memory!.state===STATE.joke;}
  assert.ok(again,'jokes again after the cooldown');
  assert.ok(ctx.tick>=ready);
  {// Touching during the joke: no hit until the charge, which then shoves.
    const ctx=new FakeCtx(7);const p=addPlayer(ctx,'p1',c.at(.6));
    const e=createEnemy(ctx,'tio-pave',c.at(0));const ai=new EnemyAi();
    run(ctx,ai,TIO_JOKE.pause,heal(ctx));
    assert.equal(e.memory!.state,STATE.joke);assert.equal(ctx.hits.length,0,'no hit mid-joke');
    const pp={x:p.x,y:p.y};run(ctx,ai,2,heal(ctx));
    assert.equal(ctx.hits.length,1);assert.ok(dist(p,pp)>TIO_JOKE.shove*.9,'charge shove');assert.ok(walkable(p,TERRAIN));
  }
});

// ---------- 8. Fiscal ----------
test('fiscal keeps distance, aims still and fires hostile fines with a cooldown',()=>{
  const c=corridor(10);
  {// Approach when far (shot on cooldown).
    const ctx=new FakeCtx();const p=addPlayer(ctx,'p',c.at(9));
    const e=createEnemy(ctx,'fiscal',c.at(0));e.memory!.actReady=1e9;const d0=dist(e,p);
    run(ctx,new EnemyAi(),10);
    assert.ok(dist(e,p)<d0-.5,'approaches beyond maxRange');
    assert.ok(d0>FISCAL_SHOT.maxRange);
  }
  {// Retreat when close.
    const ctx=new FakeCtx();const p=addPlayer(ctx,'p',c.at(7.5));
    const e=createEnemy(ctx,'fiscal',c.at(5));e.memory!.actReady=1e9;const d0=dist(e,p);
    assert.ok(d0<FISCAL_SHOT.minRange);
    run(ctx,new EnemyAi(),10);
    assert.ok(dist(e,p)>d0+.5,'retreats inside minRange');
    assert.equal(ctx.hits.length,0);
  }
  {// Hugged: backs off instead of standing still, and still hits on contact.
    const ctx=new FakeCtx();const p=addPlayer(ctx,'p',c.at(5.5));
    const e=createEnemy(ctx,'fiscal',c.at(5));e.memory!.actReady=1e9;const d0=dist(e,p);
    run(ctx,new EnemyAi(),10);
    assert.ok(dist(e,p)>d0+.5,`backs off when touching (${dist(e,p).toFixed(3)})`);
    assert.equal(ctx.hits.length,1);assert.equal(ctx.hits[0].source,e.id);
  }
  // Aim and shoot.
  const ctx=new FakeCtx(8);const p=addPlayer(ctx,'p',c.at(5));
  const e=createEnemy(ctx,'fiscal',c.at(0));const ai=new EnemyAi();
  run(ctx,ai,1);
  assert.equal(e.memory!.state,STATE.aim);
  const pos={x:e.x,y:e.y},aimStart=ctx.tick;
  while(!ctx.projectiles.size&&ctx.tick<aimStart+FISCAL_SHOT.aim+5){run(ctx,ai,1);assert.deepEqual({x:e.x,y:e.y},pos,'stands still while aiming');}
  assert.equal(ctx.projectiles.size,1);assert.equal(ctx.tick,aimStart+FISCAL_SHOT.aim);
  const shot=[...ctx.projectiles.values()][0];
  assert.equal(shot.owner,e.id);assert.equal(shot.hostile,true);assert.equal(shot.source,'multa');
  assert.ok(shot.untilTick>ctx.tick);assert.deepEqual(shot.hit,[]);assert.ok(shot.damage>0);
  const to={x:p.x-e.x,y:p.y-e.y},len=Math.hypot(to.x,to.y),speed=Math.hypot(shot.vx,shot.vy);
  assert.ok(Math.abs(speed-FISCAL_SHOT.speed)<1e-9);
  assert.ok((shot.vx*to.x+shot.vy*to.y)/(speed*len)>.999,'velocity points to the player');
  // Cooldown between shots.
  const fired=[ctx.tick];let count=1;
  run(ctx,ai,300,()=>{if(ctx.projectiles.size>count){count=ctx.projectiles.size;fired.push(ctx.tick);}});
  assert.ok(fired.length>=4,`shots ${fired.length}`);
  for(let i=1;i<fired.length;i++)assert.equal(fired[i]-fired[i-1],FISCAL_SHOT.cooldown+FISCAL_SHOT.aim);
  assert.ok([...ctx.projectiles.values()].every(s=>s.owner===e.id&&s.hostile));
});

// ---------- 9. Slow, freeze, knock, ready ----------
test('slow halves the step, freeze stops moving and hitting, knock displaces and stuns, readyTick delays',()=>{
  const c=corridor(8);
  {// Slow.
    const ctx=new FakeCtx();addPlayer(ctx,'p',c.at(8));
    const e=createEnemy(ctx,'gosma',c.at(0));const ai=new EnemyAi();
    let q={x:e.x,y:e.y};run(ctx,ai,1);const d1=dist(e,q);
    e.slowUntil=ctx.tick+10;q={x:e.x,y:e.y};run(ctx,ai,1);const d2=dist(e,q);
    assert.ok(Math.abs(d1-ENEMIES.gosma.speed/SIM_HZ)<1e-9);
    assert.ok(Math.abs(d2-d1/2)<1e-9,`slowed ${d2} vs ${d1}`);
  }
  {// Freeze.
    const ctx=new FakeCtx();addPlayer(ctx,'p',c.at(1.5));
    const e=createEnemy(ctx,'gosma',c.at(1));e.frozenUntil=30;const ai=new EnemyAi();const q={x:e.x,y:e.y};
    run(ctx,ai,29);
    assert.deepEqual({x:e.x,y:e.y},q);assert.equal(ctx.hits.length,0);
    run(ctx,ai,1);assert.equal(ctx.hits.length,1,'hits once thawed');
  }
  {// Knock away from the player.
    const ctx=new FakeCtx();const p=addPlayer(ctx,'p',c.at(6));
    const e=createEnemy(ctx,'gosma',c.at(3));const ai=new EnemyAi();
    e.knock={x:-c.u.x*.3,y:-c.u.y*.3};
    const d=[dist(e,p)];
    for(let t=0;t<3;t++){run(ctx,ai,1);d.push(dist(e,p));}
    assert.ok(Math.abs(d[1]-d[0]-.3)<1e-9,'first knock step');
    assert.ok(d[2]>d[1]&&d[3]>d[2],'no chase while stunned');
    assert.ok(Math.abs(d[3]-d[0]-(.3+.18+.108))<1e-9,`decaying knock ${d[3]-d[0]}`);
    run(ctx,ai,10);
    assert.equal(e.knock,undefined);assert.ok(dist(e,p)<d[3],'chases again');
  }
  {// Ready delay.
    const ctx=new FakeCtx();addPlayer(ctx,'p',c.at(1.5));
    const e=createEnemy(ctx,'gosma',c.at(1),1,{readyIn:40});const ai=new EnemyAi();const q={x:e.x,y:e.y};
    run(ctx,ai,39);
    assert.deepEqual({x:e.x,y:e.y},q);assert.equal(ctx.hits.length,0);assert.equal(ctx.barks().length,0);
    run(ctx,ai,20);assert.ok(ctx.hits.length>=1);assert.equal(ctx.hits[0].tick,40,'acts exactly at readyTick');
  }
});

// ---------- 10. Separation ----------
test('stacked gosmas spread apart without NaN',()=>{
  const at=openPoint(2.2);
  for(const n of [2,10]){
    const ctx=new FakeCtx();
    for(let i=0;i<n;i++)createEnemy(ctx,'gosma',at);
    const ai=new EnemyAi(),list=[...ctx.enemies.values()];
    const minPair=()=>{let m=Infinity;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)m=Math.min(m,dist(list[i],list[j]));return m;};
    const series=[minPair()];
    for(const k of [5,40,200]){run(ctx,ai,k-ctx.tick);series.push(minPair());}
    for(const e of list){assert.ok(Number.isFinite(e.x)&&Number.isFinite(e.y));assert.ok(walkable(e,TERRAIN));}
    assert.equal(series[0],0);
    assert.ok(series[1]>0&&series[2]>series[1],`${n}: grows ${series.map(s=>s.toFixed(3))}`);
    assert.ok(series[3]>(n===2?.55:.35),`${n}: final min distance ${series[3].toFixed(3)}`);
  }
});

// ---------- 11. Bark limiter ----------
test('barks are rare, globally spaced by BARK_GAP and always catalog lines',()=>{
  const ctx=new FakeCtx(11),spawn=new Rng(111);
  placePlayers(ctx,6,spawn);horde(ctx,300,spawn,25);
  const catalog=new Set([...Object.values(ENEMIES).flatMap(d=>[...d.barks,...d.reactionLines]),...ELITE.barks]);
  const ai=new EnemyAi(),ticksOf:number[]=[];
  for(let t=0;t<800;t++){const n=ctx.events.length;run(ctx,ai,1,heal(ctx));for(let i=n;i<ctx.events.length;i++)if(ctx.events[i].type==='bark')ticksOf.push(ctx.tick);}
  const barks=ctx.barks();
  assert.ok(barks.length>0,'at least one bark');
  for(let i=1;i<ticksOf.length;i++)assert.ok(ticksOf[i]-ticksOf[i-1]>=BARK_GAP,`barks at ${ticksOf[i-1]} and ${ticksOf[i]}`);
  for(const b of barks){assert.ok(catalog.has(b.line),b.line);assert.ok(ctx.enemies.has(b.enemy));}
  assert.ok(barks.length<=800/BARK_GAP+1);
});

// ---------- 12. Determinism ----------
function scenario(ctxSeed:number,ticksToRun:number){
  const ctx=new FakeCtx(ctxSeed),spawn=new Rng(1212),cmd=new Rng(99);
  placePlayers(ctx,4,spawn);horde(ctx,80,spawn,10);
  const ai=new EnemyAi(),players=[...ctx.players.values()];
  for(let t=0;t<ticksToRun;t++){
    if(t%30===0){const p=players[cmd.int(0,players.length-1)],q=cmd.pick(WALK);p.x=q.x;p.y=q.y;}
    run(ctx,ai,1,heal(ctx));
  }
  return ctx;
}
test('same seeds and commands replay identically; another rng seed changes the barks',()=>{
  const a=scenario(5,300),b=scenario(5,300),c=scenario(6,300);
  const dump=(ctx:FakeCtx)=>JSON.stringify({enemies:[...ctx.enemies.values()],events:ctx.events,projectiles:[...ctx.projectiles.values()],hits:ctx.hits,players:[...ctx.players.values()]});
  assert.equal(dump(a),dump(b));
  assert.ok(a.barks().length>0);
  assert.notDeepEqual(c.barks(),a.barks());
});

// ---------- 13. Boss ----------
test('chefe is left to the boss system',()=>{
  const c=corridor(4),ctx=new FakeCtx();addPlayer(ctx,'p',c.at(1));
  const boss=createEnemy(ctx,'chefe',c.at(3));const snap=JSON.stringify(boss);
  run(ctx,new EnemyAi(),60);
  assert.equal(JSON.stringify(boss),snap);
  assert.equal(ctx.hits.length,0);assert.equal(ctx.barks().length,0);
});

// ---------- 15. Director contract (D-010) ----------
test('retreating enemies are left to the director; elite is explicit and never doubles hp',()=>{
  const c=corridor(4),ctx=new FakeCtx();addPlayer(ctx,'p',c.at(1));
  const tio=createEnemy(ctx,'tio-pave',c.at(1.3)),fiscal=createEnemy(ctx,'fiscal',c.at(3.5));
  for(const e of [tio,fiscal]){e.memory!.retreat=1;e.damage=0;}
  const snap=JSON.stringify([tio,fiscal]);
  run(ctx,new EnemyAi(),80);
  assert.equal(JSON.stringify([tio,fiscal]),snap);
  assert.equal(ctx.hits.length,0);assert.equal(ctx.projectiles.size,0);assert.equal(ctx.barks().length,0);
  // Director path: hp scale only, then elite flag and its own radius multiplier.
  const scaled=createEnemy(ctx,'tio-pave',c.at(2),8);scaled.elite=true;scaled.radius*=1.35;
  assert.equal(scaled.maxHp,ENEMIES['tio-pave'].hp*8);assert.equal(scaled.speed,ENEMIES['tio-pave'].speed);
  assert.equal(applyElite(scaled).maxHp,ENEMIES['tio-pave'].hp*8,'applyElite skips enemies already elite');
  const plain=applyElite(createEnemy(ctx,'gosma',c.at(2)));
  assert.equal(plain.maxHp,ENEMIES.gosma.hp*ELITE.hp);assert.equal(plain.hp,plain.maxHp);
  assert.equal(applyElite(plain).maxHp,ENEMIES.gosma.hp*ELITE.hp);
});

// ---------- 16. Review regressions ----------
test('in a crowd, the tio only stops when his joke is on screen and most jokes are heard',()=>{
  const ctx=new FakeCtx(16),spawn=new Rng(1616);
  placePlayers(ctx,4,spawn);horde(ctx,100,spawn);
  const ai=new EnemyAi(),tios=[...ctx.enemies.values()].filter(e=>e.kind==='tio-pave');
  let pauses=0,heard=0;
  for(let t=0;t<1200;t++){
    const before=new Map(tios.map(e=>[e.id,e.memory?.state]));
    const n=ctx.events.length;run(ctx,ai,1,heal(ctx));
    const said=new Set(ctx.events.slice(n).flatMap(e=>e.type==='bark'?[e.enemy]:[]));
    for(const e of tios)if(before.get(e.id)!==STATE.joke&&e.memory!.state===STATE.joke){pauses++;if(said.has(e.id))heard++;}
  }
  assert.ok(pauses>0,'some jokes happened');
  assert.equal(heard,pauses,'every joke pause comes with its line');
});
test('fiscal drops a stale aim, fires single-target fines and respects the projectile cap',()=>{
  const c=corridor(9),ctx=new FakeCtx(17);
  const a=addPlayer(ctx,'a',c.at(4.5));
  const f=createEnemy(ctx,'fiscal',c.at(0));const ai=new EnemyAi({projectileCap:1});
  run(ctx,ai,1,heal(ctx));
  assert.equal(f.memory!.state,STATE.aim);
  a.downed={sinceTick:ctx.tick,bleedOutTick:ctx.tick+600,progress:0};
  run(ctx,ai,1);
  assert.equal(f.memory!.state,STATE.walk,'aim dropped without a live player');
  assert.equal(ctx.projectiles.size,0);
  const b=addPlayer(ctx,'b',c.at(8.9));
  run(ctx,ai,FISCAL_SHOT.aim+2,heal(ctx));
  for(const shot of ctx.projectiles.values()){assert.equal(shot.pierce,0);assert.ok(dist(shot,b)<FISCAL_SHOT.fireRange+1,'never fired from beyond range');}
  // Cap: with one hostile projectile alive no new one is created.
  run(ctx,ai,FISCAL_SHOT.cooldown*3,heal(ctx));
  assert.ok(ctx.projectiles.size<=1,`cap respected: ${ctx.projectiles.size}`);
});
test('tio does not shove a player his hit just downed',()=>{
  const c=corridor(4),ctx=new FakeCtx(18);
  const p=addPlayer(ctx,'p',c.at(1));
  // Downing fake: the hit leaves the player downed.
  const original=ctx.damagePlayer.bind(ctx);
  ctx.damagePlayer=(id,amount,source)=>{original(id,amount,source);const q=ctx.players.get(id)!;q.downed={sinceTick:ctx.tick,bleedOutTick:ctx.tick+600,progress:0};};
  const e=createEnemy(ctx,'tio-pave',c.at(1+ENEMIES['tio-pave'].radius+RADIUS));
  e.memory!.actReady=1e9;
  const before={x:p.x,y:p.y};
  run(ctx,new EnemyAi(),2);
  assert.equal(ctx.hits.length,1);
  assert.deepEqual({x:p.x,y:p.y},before);
});
test('wide bodies do not sink into rocks or trees',()=>{
  const rock=obstacles.find(o=>o.kind==='rock'&&walkable({x:o.x-o.radius-1.5,y:o.y},TERRAIN))!;
  const body={x:rock.x-rock.radius-1.5,y:rock.y},radius=.72;
  for(let i=0;i<40;i++)moveSafely(body,.1,0,TERRAIN,radius);
  assert.ok(dist(body,rock)>=rock.radius+radius-1e-9,`gap ${(dist(body,rock)-rock.radius-radius).toFixed(3)}`);
  // A body already overlapping may still move away.
  const stuck={x:rock.x-rock.radius-.3,y:rock.y};
  if(walkable(stuck,TERRAIN)){const d0=dist(stuck,rock);moveSafely(stuck,-.2,0,TERRAIN,radius);assert.ok(dist(stuck,rock)>d0);}
});
test('structures are targeted when closer and hit through the callback',()=>{
  const c=corridor(6),ctx=new FakeCtx(19);
  addPlayer(ctx,'far',c.at(6));
  const wall={id:'muralha',...c.at(0),radius:.3};
  const hits:{id:string;amount:number;enemy:string}[]=[];
  const g=createEnemy(ctx,'gosma',c.at(1.5));
  const ai=new EnemyAi({structures:()=>[wall],hitStructure:(_ctx,id,amount,enemy)=>hits.push({id,amount,enemy:enemy.id})});
  run(ctx,ai,60);
  assert.ok(hits.length>=1,'wall was hit');
  assert.equal(hits[0].id,'muralha');assert.equal(hits[0].amount,g.damage);assert.equal(hits[0].enemy,g.id);
  assert.equal(ctx.hits.length,0,'player far away was not hit');
});
test('Hora Extra taunt pulls enemies to the CLT until it expires or the CLT goes down',()=>{
  type Taunted=EnemyState&{taunt?:{player:string;untilTick:number}};
  const c=corridor(7);
  const setup=()=>{
    const ctx=new FakeCtx();
    const clt=addPlayer(ctx,'clt',c.at(7)),near=addPlayer(ctx,'near',c.at(1));
    const e=createEnemy(ctx,'gosma',c.at(3)) as Taunted;
    // 0.5 s of taunt: afterwards the other player is the nearer one again.
    e.taunt={player:'clt',untilTick:10};
    return {ctx,clt,near,e,ai:new EnemyAi()};
  };
  {// While taunted it walks away from the nearer player toward the CLT; after untilTick it turns back.
    const {ctx,clt,near,e,ai}=setup();
    const d0=dist(e,clt),n0=dist(e,near);
    run(ctx,ai,9);
    assert.ok(dist(e,clt)<d0-.5&&dist(e,near)>n0+.5,'chases the CLT');
    run(ctx,ai,1);
    assert.equal(e.taunt,undefined,'expired taunt is cleared');
    const n1=dist(e,near);
    run(ctx,ai,10);
    assert.ok(dist(e,near)<n1-.6,'back to the nearest player');
  }
  for(const v of [{downed:{sinceTick:0,bleedOutTick:999,progress:0}},{online:false},{eliminated:true}] as Partial<SimPlayer>[]){
    const {ctx,clt,near,e,ai}=setup();Object.assign(clt,v);
    const n0=dist(e,near);
    run(ctx,ai,5);
    assert.equal(e.taunt,undefined,`${JSON.stringify(v)}: taunt dropped`);
    assert.ok(dist(e,near)<n0-.3,`${JSON.stringify(v)}: normal chase`);
  }
  {// A taunt for a player who left, or a malformed one, is ignored and cleared.
    const {ctx,near,e,ai}=setup();e.taunt={player:'ghost',untilTick:999};
    const n0=dist(e,near);run(ctx,ai,5);
    assert.equal(e.taunt,undefined);assert.ok(dist(e,near)<n0-.3);
    (e as unknown as {taunt:unknown}).taunt={player:42};run(ctx,ai,1);assert.equal(e.taunt,undefined);
  }
  {// Taunted contact damage lands on the CLT, and replays are identical.
    const replay=()=>{const {ctx,e,ai}=setup();e.taunt={player:'clt',untilTick:400};run(ctx,ai,120,heal(ctx));return JSON.stringify([ctx.hits,e.x,e.y]);};
    const once=replay();
    assert.equal(once,replay());
    assert.ok(JSON.parse(once)[0].length>0&&JSON.parse(once)[0].every((h:{id:string})=>h.id==='clt'));
  }
});

test('limiter and rng state round-trip through JSON',()=>{
  const make=()=>{const ctx=new FakeCtx(20),spawn=new Rng(2020);placePlayers(ctx,3,spawn);horde(ctx,60,spawn);return ctx;};
  const a=make(),b=make(),ai=new EnemyAi();
  run(a,ai,200,heal(a));run(b,new EnemyAi(),0);
  // Copy world state and the saved ai state, then continue both.
  b.tick=a.tick;b.enemies.clear();for(const e of a.enemies.values())b.enemies.set(e.id,structuredClone(e));
  for(const p of a.players.values())Object.assign(b.players.get(p.id)!,structuredClone(p));
  const restored=new EnemyAi();restored.restore(JSON.parse(JSON.stringify(ai.state())));
  const na=a.events.length;
  run(a,ai,200,heal(a));run(b,restored,200,heal(b));
  assert.deepEqual(b.barks(),a.barks().filter((_,i,all)=>a.events.indexOf(all[i])>=na));
  assert.equal(JSON.stringify([...b.enemies.values()]),JSON.stringify([...a.enemies.values()]));
});

// ---------- 14. Performance ----------
function bench(index:SpatialIndex<EnemyState>){
  const ctx=new FakeCtx(14),spawn=new Rng(1414);ctx.enemyIndex=index;
  const pts=[0,1,2,3,4,5].map(i=>openPoint(1,i*40));
  pts.forEach((q,i)=>addPlayer(ctx,`p${i}`,q));
  for(let i=0;i<300;i++)createEnemy(ctx,i<120?'gosma':i<210?'pernilongo':i<255?'tio-pave':'fiscal',spawn.pick(WALK));
  const ai=new EnemyAi();
  run(ctx,ai,50,heal(ctx));
  const times:number[]=[];
  for(let t=0;t<200;t++){ctx.tick++;const t0=performance.now();ai.step(ctx);times.push(performance.now()-t0);heal(ctx)();}
  const sorted=[...times].sort((a,b)=>a-b),avg=times.reduce((a,b)=>a+b,0)/times.length;
  for(const e of ctx.enemies.values())assert.ok(walkable(e,TERRAIN));
  return {avg,median:sorted[100],p95:sorted[190]};
}
test('300 enemies step well under budget',()=>{
  const grid=bench(new GridIndex()),naive=bench(new NaiveIndex());
  const fmt=(r:{avg:number;median:number;p95:number})=>`avg ${r.avg.toFixed(3)} ms, median ${r.median.toFixed(3)} ms, p95 ${r.p95.toFixed(3)} ms`;
  console.log(`[bench] 300 enemies, grid index: ${fmt(grid)}`);
  console.log(`[bench] 300 enemies, naive index: ${fmt(naive)}`);
  // Median resists load spikes from other processes on the machine; the card budget is 4 ms.
  assert.ok(grid.median<4,`grid median ${grid.median} ms`);
});
