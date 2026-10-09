import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {BASE_STATS,ticks} from '../src/game/sim/types.ts';
import type {EnemyState,SimContext,SimEvent,SimPlayer,SpatialIndex,Telegraph} from '../src/game/sim/types.ts';
import type {TerrainField} from '../src/game/terrain/field.ts';
import {RADIUS,walkable} from '../src/game/world.ts';
import {defaultTerrain} from '../src/game/terrain/field.ts';
import {BOSS_KIND,BOSS_LINES,BOSS_TUNING,KEY_LINE_RETRY_TICKS,MINION_KINDS,MINION_READY_TICKS,PHASE_ASSEMBLY,PHASE_ENRAGED,SUMMON_WARNING_TICKS,bossMaxHp,createBoss} from '../src/game/sim/boss.ts';
import type {BossOptions} from '../src/game/sim/boss.ts';
import {BARK_GAP,EnemyAi} from '../src/game/sim/enemies/ai.ts';
import {ENEMIES} from '../src/game/sim/enemies/catalog.ts';
import {MAX_ENEMIES} from '../src/game/sim/budget.ts';
import {MIN_TELEGRAPH_TICKS,DEFAULT_CONE_ANGLE,addTelegraph,cancelTelegraphs,canBeHit,canBeTargeted,telegraphHits,telegraphSystem,createTelegraphSystem} from '../src/game/sim/telegraphs.ts';
import type {TelegraphShapeData} from '../src/game/sim/telegraphs.ts';

const player=(id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer=>({
  id,classId:'test',x,y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
  build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra,
});
const enemy=(id:string,x:number,y:number,extra:Partial<EnemyState>={}):EnemyState=>({
  id,kind:'boss',x,y,hp:500,maxHp:500,speed:1,damage:10,radius:.6,xp:0,spawnTick:0,readyTick:0,boss:true,...extra,
});
function naiveIndex<T extends {id:string;x:number;y:number}>():SpatialIndex<T>{
  let items:T[]=[];
  const query=(x:number,y:number,r:number,out:T[]=[])=>{for(const i of items)if(Math.hypot(i.x-x,i.y-y)<=r)out.push(i);return out;};
  return {rebuild(src){items=[...src];},query,
    nearest(x,y,r,filter){let best:T|undefined,bd=Infinity;for(const i of query(x,y,r)){const d=Math.hypot(i.x-x,i.y-y);if(d<bd&&(!filter||filter(i))){best=i;bd=d;}}return best;}};
}
type FakeCtx=SimContext&{tick:number;events:SimEvent[];playerDamage:{id:string;amount:number;source?:string}[]};
function fakeCtx(opts:{players?:SimPlayer[];enemies?:EnemyState[];tick?:number;terrain?:TerrainField;seed?:number}={}):FakeCtx{
  let counter=0;
  const players=new Map((opts.players??[]).map(p=>[p.id,p] as const));
  const ctx:FakeCtx={
    tick:opts.tick??0,
    terrain:opts.terrain??undefined as unknown as TerrainField,
    rng:new Rng(opts.seed??1),
    players,
    enemies:new Map((opts.enemies??[]).map(e=>[e.id,e] as const)),
    pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},
    round:{index:10,total:10,phase:'wave',phaseEndsTick:99999,remaining:1},
    enemyIndex:naiveIndex<EnemyState>(),
    events:[],playerDamage:[],
    nextId(prefix){return `${prefix}${++counter}`;},
    emit(event){ctx.events.push(event);},
    damageEnemy(){return false;},
    damagePlayer(id,amount,source){ctx.playerDamage.push({id,amount,source});const p=players.get(id);if(p)p.hp=Math.max(0,p.hp-amount);},
  };
  return ctx;
}
const circle=(x:number,y:number,radius:number):TelegraphShapeData=>({shape:'circle',x,y,radius});

test('circle hits inside, misses outside and respects padding on the edge',()=>{
  const c=circle(5,5,2);
  assert.ok(telegraphHits(c,{x:5,y:5}));
  assert.ok(telegraphHits(c,{x:7,y:5}));
  assert.ok(!telegraphHits(c,{x:7.1,y:5}));
  assert.ok(telegraphHits(c,{x:7.2,y:5},.22));
  assert.ok(!telegraphHits(c,{x:7.3,y:5},.22));
  assert.ok(!telegraphHits(circle(NaN,5,2),{x:5,y:5}));
  assert.ok(!telegraphHits(c,{x:Infinity,y:5}));
});

test('line covers a padded rectangle from its start along the direction',()=>{
  const l:TelegraphShapeData={shape:'line',x:0,y:0,radius:10,dx:1,dy:0,width:2};
  assert.ok(telegraphHits(l,{x:0,y:0}));
  assert.ok(telegraphHits(l,{x:5,y:.9}));
  assert.ok(telegraphHits(l,{x:10,y:-1}));
  assert.ok(!telegraphHits(l,{x:10.5,y:0}),'beyond length');
  assert.ok(telegraphHits(l,{x:10.2,y:0},.22),'beyond length within padding');
  assert.ok(!telegraphHits(l,{x:5,y:1.3}),'beside width');
  assert.ok(telegraphHits(l,{x:5,y:1.2},.22),'beside width within padding');
  assert.ok(!telegraphHits(l,{x:-.5,y:0}),'behind start');
  assert.ok(telegraphHits(l,{x:-.2,y:0},.22),'behind start within padding');
  assert.ok(telegraphHits({shape:'line',x:0,y:0,radius:4,dx:1,dy:0},{x:2,y:.5}),'default width 1');
  assert.ok(!telegraphHits({shape:'line',x:0,y:0,radius:4,dx:1,dy:0},{x:2,y:.6}));
  assert.ok(!telegraphHits({shape:'line',x:0,y:0,radius:4,dx:0,dy:0},{x:0,y:0}),'zero direction');
  assert.ok(!telegraphHits({shape:'line',x:0,y:0,radius:4},{x:0,y:0}),'missing direction');
});

test('diagonal line uses the true axis',()=>{
  const s=Math.SQRT1_2,l:TelegraphShapeData={shape:'line',x:1,y:1,radius:Math.hypot(4,4),dx:s,dy:s,width:.5};
  assert.ok(telegraphHits(l,{x:3,y:3}));
  assert.ok(telegraphHits(l,{x:5,y:5}));
  assert.ok(!telegraphHits(l,{x:3,y:3.5}));
  assert.ok(!telegraphHits(l,{x:5.3,y:5.3}));
  assert.ok(!telegraphHits(l,{x:5,y:1}));
});

test('cone hits within aperture and range, with apex padding and ±π wrap',()=>{
  const c:TelegraphShapeData={shape:'cone',x:0,y:0,radius:5,dx:1,dy:0};
  const at=(deg:number,r:number)=>({x:Math.cos(deg*Math.PI/180)*r,y:Math.sin(deg*Math.PI/180)*r});
  assert.equal(DEFAULT_CONE_ANGLE,Math.PI/3);
  assert.ok(telegraphHits(c,at(0,3)));
  assert.ok(telegraphHits(c,at(29,3)));
  assert.ok(telegraphHits(c,at(-29,3)));
  assert.ok(!telegraphHits(c,at(35,3)),'outside angle');
  assert.ok(!telegraphHits(c,at(0,5.1)),'beyond range');
  assert.ok(telegraphHits(c,at(0,5.1),.22),'range padding');
  assert.ok(telegraphHits(c,at(170,.1),.22),'apex padding covers any angle');
  assert.ok(!telegraphHits(c,at(170,.3),.22));
  assert.ok(telegraphHits(c,at(33,3),.22),'angular padding');
  const back:TelegraphShapeData={shape:'cone',x:0,y:0,radius:5,dx:-1,dy:0,width:Math.PI/2};
  assert.ok(telegraphHits(back,at(179,3)));
  assert.ok(telegraphHits(back,at(-179,3)));
  assert.ok(telegraphHits(back,at(-140,3)));
  assert.ok(!telegraphHits(back,at(-130,3)));
  assert.ok(!telegraphHits(back,at(0,3)));
  assert.ok(telegraphHits({...c,width:100},at(180,3)),'aperture clamped to full circle');
  assert.ok(!telegraphHits({...c,width:0},at(0,3)),'non-positive aperture');
  assert.ok(!telegraphHits({...c,dx:0,dy:0},at(0,3)),'zero direction');
});

test('addTelegraph enforces minimum warning, normalizes direction and emits',()=>{
  const ctx=fakeCtx({tick:100});
  assert.equal(MIN_TELEGRAPH_TICKS,16);
  const a=addTelegraph(ctx,{shape:'circle',x:1,y:1,radius:2,damage:10,owner:'env:lava'},0);
  assert.equal(a.fireTick,116);
  assert.equal(ctx.telegraphs.get(a.id),a);
  assert.deepEqual(ctx.events,[{type:'telegraph',telegraph:a.id}]);
  assert.equal(addTelegraph(ctx,{shape:'circle',x:1,y:1,radius:2,damage:10,owner:'env:lava'},40).fireTick,140);
  assert.equal(addTelegraph(ctx,{shape:'circle',x:1,y:1,radius:2,damage:10,owner:'env:lava'},NaN).fireTick,116);
  const l=addTelegraph(ctx,{shape:'line',x:0,y:0,radius:5,dx:3,dy:4,damage:5,owner:'b1'},20);
  assert.ok(Math.abs(l.dx!-.6)<1e-12&&Math.abs(l.dy!-.8)<1e-12);
  assert.notEqual(l.id,a.id);
  assert.throws(()=>addTelegraph(ctx,{shape:'line',x:0,y:0,radius:5,dx:0,dy:0,damage:5,owner:'b1'},20));
  assert.throws(()=>addTelegraph(ctx,{shape:'cone',x:0,y:0,radius:5,damage:5,owner:'b1'},20));
  assert.throws(()=>addTelegraph(ctx,{shape:'cone',x:0,y:0,radius:5,dx:NaN,dy:1,damage:5,owner:'b1'},20));
  assert.equal(ctx.telegraphs.size,4);
});

test('system fires exactly at fireTick, only on hittable players inside, then removes it',()=>{
  const inside=player('in',5,5),outside=player('out',9,9),edge=player('edge',7+RADIUS,5);
  const downed=player('down',5,5,{downed:{sinceTick:0,bleedOutTick:999,progress:0}});
  const offline=player('off',5,5,{online:false}),spectator=player('spec',5,5,{spectator:true});
  const gone=player('gone',5,5,{eliminated:true}),dead=player('dead',5,5,{hp:0});
  const ctx=fakeCtx({players:[inside,outside,edge,downed,offline,spectator,gone,dead],enemies:[enemy('b1',0,0)],tick:10});
  const t=addTelegraph(ctx,{shape:'circle',x:5,y:5,radius:2,damage:25,owner:'b1'},20);
  assert.ok(!canBeHit(downed)&&!canBeHit(spectator)&&!canBeHit(gone)&&!canBeHit(dead)&&canBeHit(inside));
  assert.ok(canBeHit(offline)&&!canBeTargeted(offline)&&canBeTargeted(inside),'offline bodies are hit (D-011) but not chased');
  for(ctx.tick=10;ctx.tick<30;ctx.tick++){telegraphSystem.step(ctx);assert.equal(ctx.playerDamage.length,0);}
  assert.ok(ctx.telegraphs.has(t.id));
  ctx.tick=30;telegraphSystem.step(ctx);
  assert.deepEqual(ctx.playerDamage,[{id:'in',amount:25,source:'b1'},{id:'edge',amount:25,source:'b1'},{id:'off',amount:25,source:'b1'}]);
  assert.equal(inside.hp,75);
  assert.ok(!ctx.telegraphs.has(t.id));
  ctx.tick=31;telegraphSystem.step(ctx);
  assert.equal(ctx.playerDamage.length,3);
});

test('overlapping telegraphs each hit once and late steps still resolve due telegraphs',()=>{
  const p=player('p',0,0),ctx=fakeCtx({players:[p],tick:0});
  addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:10,owner:'env:a'},0);
  addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:5,owner:'env:b'},0);
  const later=addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:1,owner:'env:c'},100);
  ctx.tick=50;createTelegraphSystem().step(ctx);
  assert.deepEqual(ctx.playerDamage.map(d=>d.source),['env:a','env:b']);
  assert.deepEqual([...ctx.telegraphs.keys()],[later.id]);
  assert.equal(createTelegraphSystem().id,'telegraphs');
});

test('dead or missing owners deal no damage; env and player owners work',()=>{
  const p=player('p',0,0),boss=enemy('b1',0,0),ctx=fakeCtx({players:[p,player('ally',9,9)],enemies:[boss]});
  addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:10,owner:'b1'},0);
  addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:10,owner:'ghost'},0);
  addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:3,owner:'env:storm'},0);
  addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:2,owner:'ally'},0);
  boss.hp=0;
  ctx.tick=MIN_TELEGRAPH_TICKS;telegraphSystem.step(ctx);
  assert.deepEqual(ctx.playerDamage,[{id:'p',amount:3,source:'env:storm'},{id:'p',amount:2,source:'ally'}]);
  assert.equal(ctx.telegraphs.size,0);
});

test('cancelTelegraphs removes only the owner pending telegraphs without damage',()=>{
  const ctx=fakeCtx({players:[player('p',0,0)],enemies:[enemy('b1',0,0),enemy('b2',0,0)]});
  addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:10,owner:'b1'},0);
  const keep=addTelegraph(ctx,{shape:'circle',x:0,y:0,radius:1,damage:4,owner:'b2'},0);
  addTelegraph(ctx,{shape:'cone',x:0,y:0,radius:3,dx:1,dy:0,damage:10,owner:'b1'},0);
  assert.equal(cancelTelegraphs(ctx,'b1'),2);
  assert.equal(cancelTelegraphs(ctx,'b1'),0);
  assert.deepEqual([...ctx.telegraphs.keys()],[keep.id]);
  ctx.tick=MIN_TELEGRAPH_TICKS;telegraphSystem.step(ctx);
  assert.deepEqual(ctx.playerDamage,[{id:'p',amount:4,source:'b2'}]);
});

test('telegraph type stays JSON-safe after normalization',()=>{
  const ctx=fakeCtx();
  const c:Telegraph=addTelegraph(ctx,{shape:'circle',x:1,y:2,radius:3,damage:1,owner:'env:x'},0);
  assert.ok(!('dx' in c)&&!('dy' in c));
  assert.deepEqual(JSON.parse(JSON.stringify(c)),c);
});

// ---------- Boss (Síndico Supremo) ----------

/** Players around the island center, far enough for a safe spawn. */
const squad=(n=4)=>[[12,6.5],[17.5,12],[12,17.5],[6.5,12],[8,8],[16,16]].slice(0,n).map(([x,y],i)=>player(`p${i+1}`,x,y));
function arena(opts:{players?:SimPlayer[];seed?:number;boss?:BossOptions}={}){
  const ctx=fakeCtx({players:opts.players??squad(),terrain:defaultTerrain,seed:opts.seed??7});
  const minions:EnemyState[]=[];
  const ai=new EnemyAi(); // D-012: boss barks share the global limiter
  const make=()=>createBoss({say:(c,e,lines,key)=>ai.say(c,e,lines,key),summon:(c,kind,at)=>{const e=enemy(c.nextId('minion'),at.x,at.y,{kind,boss:false,hp:30,maxHp:30});c.enemies.set(e.id,e);minions.push(e);return e;},...opts.boss});
  let controller=make();
  const created=new Map<string,number>();
  let resolving=false;
  const damage=ctx.damagePlayer;
  ctx.damagePlayer=(id,amount,source)=>{assert.ok(resolving,'boss damage must come from a telegraph');damage(id,amount,source);};
  /** One tick of the boss and telegraphs systems, in SYSTEM_ORDER. Checks every new telegraph warns >= 0.8 s. */
  const step=(heal=true)=>{
    controller.step(ctx);
    for(const t of ctx.telegraphs.values())if(!created.has(t.id)){
      created.set(t.id,ctx.tick);
      assert.ok(t.fireTick-ctx.tick>=ticks(.8),`${t.shape} warned only ${t.fireTick-ctx.tick} ticks`);
    }
    resolving=true;telegraphSystem.step(ctx);resolving=false;
    if(heal)for(const p of ctx.players.values())p.hp=100;
    ctx.tick++;
  };
  const run=(n:number,heal=true)=>{for(let i=0;i<n;i++)step(heal);};
  /** Swap in a fresh controller restored from a JSON checkpoint of the current one. */
  const reload=()=>{const saved=JSON.parse(JSON.stringify(controller.state));controller=make();controller.restore(saved);};
  return {ctx,get controller(){return controller;},minions,step,run,reload};
}

test('boss hp scales with 1 to 6 players and the spawn is safe, idempotent and announced',()=>{
  const hp=[1,2,3,4,5,6].map(n=>bossMaxHp(n));
  for(let i=1;i<hp.length;i++)assert.ok(hp[i]>hp[i-1]);
  assert.equal(bossMaxHp(0),hp[0]);assert.equal(bossMaxHp(9),hp[5]);
  for(const n of [1,6]){
    const {ctx,controller}=arena({players:squad(n)});
    const boss=controller.spawnBoss(ctx)!;
    assert.equal(boss.kind,BOSS_KIND);assert.ok(boss.boss);assert.equal(boss.maxHp,bossMaxHp(n));assert.equal(boss.damage,0);
    assert.ok(walkable(boss,defaultTerrain));
    for(const p of ctx.players.values())assert.ok(Math.hypot(p.x-boss.x,p.y-boss.y)>=4);
    assert.equal(controller.spawnBoss(ctx),boss,'second call returns the living boss');
    assert.equal([...ctx.enemies.values()].filter(e=>e.boss).length,1);
    assert.deepEqual(ctx.events.filter(e=>e.type==='boss-phase'),[{type:'boss-phase',enemy:boss.id,phase:1}]);
    assert.ok(ctx.events.some(e=>e.type==='bark'&&e.enemy===boss.id));
  }
  const mixed=arena({players:[...squad(2),player('ghost',3,3,{online:false}),player('watch',3,3,{spectator:true})]});
  assert.equal(mixed.controller.spawnBoss(mixed.ctx)!.maxHp,bossMaxHp(2),'offline players and spectators do not inflate hp');
});

test('every boss hit is telegraphed at least 0.8 s ahead in all phases, and the boss stays on land',()=>{
  const {ctx,controller,run}=arena();
  const boss=controller.spawnBoss(ctx)!;
  const onLand=(n:number)=>{for(let i=0;i<n;i++){run(1);assert.ok(walkable(boss,defaultTerrain),`boss left the island at ${boss.x},${boss.y}`);}};
  onLand(ticks(40));
  boss.hp=boss.maxHp*.4;onLand(ticks(40));
  controller.enrage(ctx);onLand(ticks(30));
  assert.ok(ctx.playerDamage.length>10,`boss landed hits (${ctx.playerDamage.length})`);
  assert.ok(ctx.events.filter(e=>e.type==='telegraph').length>30);
});

test('phase 1 slams and charges; phase 2 changes behavior: fines, rotating cones, summons and more speed',()=>{
  const a=arena();const boss=a.controller.spawnBoss(a.ctx)!;
  const seen1=new Set<string>();
  for(let i=0;i<ticks(60);i++){a.run(1);for(const t of a.ctx.telegraphs.values())seen1.add(t.shape);}
  assert.ok(seen1.has('circle')&&seen1.has('line'),'phase 1 uses slam and charge');
  assert.ok(!seen1.has('cone'),'no cone in phase 1');
  assert.equal(a.minions.length,0,'no summons in phase 1');
  assert.equal(boss.phase,1);

  const mark=a.ctx.events.length;
  boss.hp=Math.floor(boss.maxHp*.5);
  a.run(1);
  assert.equal(boss.phase,PHASE_ASSEMBLY);
  assert.deepEqual(a.ctx.events.slice(mark).filter(e=>e.type==='boss-phase'),[{type:'boss-phase',enemy:boss.id,phase:2}]);
  const warnings=a.ctx.events.slice(mark).filter(e=>e.type==='spawn-warning');
  assert.equal(a.minions.length,0,'minions are announced, not dropped instantly');
  assert.ok(warnings.length>0&&warnings.length<=BOSS_TUNING.summonCount,'summons announced on entering phase 2');
  for(const w of warnings)if(w.type==='spawn-warning')assert.equal(w.atTick-(a.ctx.tick-1),SUMMON_WARNING_TICKS);
  a.run(SUMMON_WARNING_TICKS);
  assert.ok(a.minions.length>0&&a.minions.length<=warnings.length,'announced minions arrive');
  for(const m of a.minions){assert.ok(walkable(m,defaultTerrain));for(const p of a.ctx.players.values())assert.ok(Math.hypot(p.x-m.x,p.y-m.y)>=1.5);}
  const seen2=new Set<string>();let maxCircles=0;
  for(let i=0;i<ticks(60);i++){
    a.run(1);
    for(const t of a.ctx.telegraphs.values())seen2.add(t.shape);
    maxCircles=Math.max(maxCircles,[...a.ctx.telegraphs.values()].filter(t=>t.shape==='circle').length);
  }
  assert.ok(seen2.has('cone'),'rotating cone in phase 2');
  assert.ok(maxCircles>=3,'area fine hits several players at once');
  assert.ok(a.minions.length>BOSS_TUNING.summonCount,'keeps summoning');
  assert.ok(a.minions.filter(m=>a.ctx.enemies.has(m.id)).length<=BOSS_TUNING.minionCap,'minion cap');

  // Same idle walk for one tick, phase 1 vs phase 2.
  const walk=(phase:number)=>{
    const w=arena({players:[player('p1',12,5)]});const b=w.controller.spawnBoss(w.ctx,{x:12,y:15})!;
    b.phase=phase;b.readyTick=0;b.memory!.next=1e9;b.memory!.summonAt=1e9;
    const y=b.y;w.run(1);return y-b.y;
  };
  assert.ok(walk(1)>0);
  assert.ok(walk(2)>walk(1)*1.2,'phase 2 walks faster');
});

test('charge line and cone sweep only hurt players inside, exactly at fireTick',()=>{
  const findFirst=(shape:string,hp:number)=>{
    for(let seed=1;seed<40;seed++){
      const a=arena({seed,players:[player('p1',12,6.5),player('far',3,20)]});
      const boss=a.controller.spawnBoss(a.ctx,{x:12,y:12})!;boss.hp=boss.maxHp*hp;
      for(let i=0;i<ticks(20);i++){
        a.step(false);
        const t=[...a.ctx.telegraphs.values()].find(t=>t.shape===shape);
        if(t)return {a,t,boss};
      }
    }
    throw new Error(`no ${shape} telegraph`);
  };
  {
    const {a,t,boss}=findFirst('line',1);
    assert.ok(telegraphHits(t,a.ctx.players.get('p1')!,RADIUS));
    const before=a.ctx.playerDamage.length;
    while(a.ctx.tick<t.fireTick){a.step(false);assert.equal(a.ctx.playerDamage.length,before,'no damage before fireTick');}
    const start={x:boss.x,y:boss.y};
    a.step(false);
    const hits=a.ctx.playerDamage.slice(before);
    assert.deepEqual(hits.map(h=>h.id),['p1']);assert.equal(hits[0].source,boss.id);
    a.run(BOSS_TUNING.dashTicks,false);
    assert.ok(Math.hypot(boss.x-start.x,boss.y-start.y)>1,'boss dashes along the line');
    assert.ok(Math.hypot(boss.x-(t.x+t.dx!*t.radius),boss.y-(t.y+t.dy!*t.radius))<1e-9,'dash ends at the line end');
  }
  {
    const {a,t}=findFirst('cone',.4);
    assert.ok(Math.abs(Math.hypot(t.dx!,t.dy!)-1)<1e-9);
    const p1=a.ctx.players.get('p1')!;
    assert.ok(telegraphHits(t,p1,RADIUS),'first cone aims at the nearest player');
    assert.ok(![BOSS_TUNING.fineDamage,BOSS_TUNING.chargeDamage].includes(t.damage),'cone damage is distinguishable');
    const coneHits=()=>a.ctx.playerDamage.filter(h=>h.id==='p1'&&h.amount===t.damage).length;
    const dirs:{x:number;y:number}[]=[{x:t.dx!,y:t.dy!}];
    let firstHit=-1;
    for(let i=0;i<ticks(3);i++){
      const tick=a.ctx.tick;a.step();
      if(firstHit<0&&coneHits())firstHit=tick;
      for(const c of a.ctx.telegraphs.values())if(c.shape==='cone'&&!dirs.some(d=>d.x===c.dx&&d.y===c.dy))dirs.push({x:c.dx!,y:c.dy!});
    }
    assert.equal(firstHit,t.fireTick,'cone lands exactly at fireTick, not before');
    assert.ok(dirs.length>=3,'sweep keeps placing cones');
    for(let i=1;i<dirs.length;i++){
      const turn=Math.atan2(dirs[i-1].x*dirs[i].y-dirs[i-1].y*dirs[i].x,dirs[i-1].x*dirs[i].x+dirs[i-1].y*dirs[i].y);
      assert.ok(Math.abs(Math.abs(turn)-BOSS_TUNING.coneTurn)<1e-6,'cones rotate by a fixed step');
    }
    assert.ok(!a.ctx.playerDamage.some(h=>h.id==='far'),'player outside every zone is never hit');
  }
});

test('killing blow ends the fight once: no posthumous hits, one chest, one victory',()=>{
  let victories=0;
  const a=arena({boss:{onDefeated:()=>{victories++;}}});
  const boss=a.controller.spawnBoss(a.ctx)!;
  while(!a.ctx.telegraphs.size)a.run(1);
  const pending=[...a.ctx.telegraphs.values()][0];
  while(a.ctx.tick<pending.fireTick)a.run(1);
  // Weapons run before telegraphs: the boss dies on the tick its zone would fire.
  boss.hp=0;
  const hitsBefore=a.ctx.playerDamage.length;
  assert.ok(a.controller.bossDefeated(a.ctx),'victory visible on the killing tick');
  telegraphSystem.step(a.ctx); // arena guard throws if this damaged anyone outside resolution
  assert.equal(a.ctx.playerDamage.length,hitsBefore);
  a.ctx.enemies.delete(boss.id);
  a.run(ticks(5));
  assert.equal(victories,1);
  assert.equal([...a.ctx.pickups.values()].filter(p=>p.kind==='chest').length,1);
  assert.equal([...a.ctx.telegraphs.values()].filter(t=>t.owner===boss.id).length,0);
  assert.equal(a.ctx.playerDamage.length,hitsBefore);
  assert.ok(a.controller.bossDefeated(a.ctx));
  assert.equal(a.ctx.events.filter(e=>e.type==='bark'&&e.enemy===boss.id&&/Renuncio|ata!/.test(e.line)).length,1);
});

test('no victory before a spawn; custom chest hook runs once at the boss position',()=>{
  const chests:{x:number;y:number}[]=[];
  const a=arena({boss:{dropChest:(_c,at)=>{chests.push(at);}}});
  assert.equal(a.controller.bossDefeated(a.ctx),false);
  a.run(5);
  assert.equal(a.controller.bossDefeated(a.ctx),false);
  const boss=a.controller.spawnBoss(a.ctx)!;a.run(3);
  a.ctx.enemies.delete(boss.id);a.run(3);
  assert.equal(chests.length,1);assert.equal(a.ctx.pickups.size,0);
  assert.ok(Math.hypot(chests[0].x-boss.x,chests[0].y-boss.y)<1e-9);
});

test('round timeout enrages once: phase 3, stronger hits, still telegraphed',()=>{
  const a=arena();
  const boss=a.controller.spawnBoss(a.ctx)!;
  (a.ctx.round as {phaseEndsTick:number}).phaseEndsTick=a.ctx.tick+ticks(3);
  a.run(ticks(3)+1);
  assert.equal(boss.phase,PHASE_ENRAGED);
  const seen=new Set(a.ctx.telegraphs.keys()),damages=new Set<number>();
  for(let i=0;i<ticks(15);i++){a.run(1);for(const t of a.ctx.telegraphs.values())if(!seen.has(t.id)){seen.add(t.id);damages.add(t.damage);}}
  a.controller.enrage(a.ctx);
  boss.hp=1;a.run(2);
  assert.equal(boss.phase,PHASE_ENRAGED,'dropping below 50% does not leave enrage');
  assert.deepEqual(a.ctx.events.flatMap(e=>e.type==='boss-phase'?[e.phase]:[]),[1,3]);
  const enraged=[BOSS_TUNING.fineDamage,BOSS_TUNING.chargeDamage,BOSS_TUNING.coneDamage].map(d=>Math.round(d*BOSS_TUNING.enragedDamage));
  assert.ok(damages.size>0);
  for(const d of damages)assert.ok(enraged.includes(d),`telegraph made while enraged deals ${d}, expected one of ${enraged}`);
});

test('same seed and inputs replay the same fight; state is JSON-safe',()=>{
  const trace=(seed:number)=>{
    const a=arena({seed});const boss=a.controller.spawnBoss(a.ctx)!;
    a.run(ticks(20));boss.hp=boss.maxHp*.3;a.run(ticks(20));
    assert.deepEqual(JSON.parse(JSON.stringify(a.controller.state)),a.controller.state);
    assert.deepEqual(JSON.parse(JSON.stringify(boss)),boss);
    return JSON.stringify({events:a.ctx.events,boss,state:a.controller.state,minions:a.minions.map(m=>[m.kind,m.x,m.y])});
  };
  assert.equal(trace(11),trace(11));
  assert.notEqual(trace(11),trace(12));
});

test('director calling spawnBoss on the tick the boss died settles that victory instead of a rematch',()=>{
  let victories=0;
  const a=arena({boss:{onDefeated:()=>{victories++;}}});
  const boss=a.controller.spawnBoss(a.ctx)!;a.run(ticks(3));
  a.ctx.enemies.delete(boss.id);
  assert.equal(a.controller.spawnBoss(a.ctx),undefined);
  assert.equal(victories,1);
  assert.equal([...a.ctx.enemies.values()].filter(e=>e.boss).length,0);
  a.run(3);
  assert.equal(a.controller.spawnBoss(a.ctx),undefined);
  assert.equal(victories,1);assert.ok(a.controller.bossDefeated(a.ctx));
  assert.equal([...a.ctx.pickups.values()].filter(p=>p.kind==='chest').length,1);
});

test('summons never land on downed players being rescued',()=>{
  let summoned=0;
  for(let seed=1;seed<=40;seed++){
    const downed=player('down',12,9.5,{hp:0,downed:{sinceTick:0,bleedOutTick:600,progress:0}});
    const a=arena({seed,players:[player('p1',12,5),downed]});
    const boss=a.controller.spawnBoss(a.ctx,{x:12,y:12})!;boss.hp=boss.maxHp*.4;boss.readyTick=0;
    a.run(ticks(15));
    summoned+=a.minions.length;
    for(const m of a.minions)assert.ok(Math.hypot(m.x-downed.x,m.y-downed.y)>=1.5,`seed ${seed}: minion on a downed player`);
  }
  assert.ok(summoned>40);
});

test('a controller restored from a JSON checkpoint continues the same fight',()=>{
  const straight=arena({seed:5}),resumed=arena({seed:5});
  for(const a of [straight,resumed]){const b=a.controller.spawnBoss(a.ctx)!;a.run(ticks(15));b.hp=b.maxHp*.45;}
  straight.run(ticks(25));
  resumed.run(ticks(5));resumed.reload();resumed.run(ticks(20));
  assert.equal(JSON.stringify(resumed.ctx.events),JSON.stringify(straight.ctx.events));
  assert.deepEqual(resumed.controller.state,straight.controller.state);
});

test('reset gives a rematch a fresh boss and abort removes one without victory or chest',()=>{
  let victories=0;
  const a=arena({boss:{onDefeated:()=>{victories++;}}});
  const first=a.controller.spawnBoss(a.ctx)!;first.hp=first.maxHp*.4;a.run(ticks(10));
  assert.ok(a.ctx.telegraphs.size+a.controller.state.pending.length>0||a.minions.length>0);
  // Rematch: the world drops its enemies and the integration resets the same controller.
  a.ctx.enemies.clear();a.ctx.telegraphs.clear();a.controller.reset();
  assert.equal(a.controller.bossDefeated(a.ctx),false);
  assert.deepEqual(a.controller.state,{defeated:false,lastX:0,lastY:0,minions:[],pending:[]});
  a.run(3);
  assert.equal(victories,0,'a reset is not a victory');
  const second=a.controller.spawnBoss(a.ctx)!;
  assert.ok(second&&second.id!==first.id&&second.hp===second.maxHp&&second.phase===1);
  a.run(ticks(5));
  // Cleanup path: abort removes the boss and its pending hits, no chest, no victory.
  a.controller.abort(a.ctx);
  assert.equal(a.ctx.enemies.has(second.id),false);
  assert.equal([...a.ctx.telegraphs.values()].filter(t=>t.owner===second.id).length,0);
  a.run(ticks(3));
  assert.equal(victories,0);assert.equal(a.controller.bossDefeated(a.ctx),false);
  assert.equal([...a.ctx.pickups.values()].filter(p=>p.kind==='chest').length,0);
});

test('announced summons skip a spot a player walked onto and respect the cap with pending ones',()=>{
  const a=arena({players:[player('p1',12,5)]});
  const boss=a.controller.spawnBoss(a.ctx,{x:12,y:12})!;boss.hp=boss.maxHp*.4;boss.readyTick=0;
  a.run(1);
  const pending=a.controller.state.pending;
  assert.ok(pending.length>0);
  for(const s of pending)assert.ok(Math.hypot(s.x-12,s.y-5)>=2.5,'placed away from players');
  // A player steps onto the first marker before it resolves.
  const spot=pending[0],p1=a.ctx.players.get('p1')!;
  a.ctx.players.set('p2',player('p2',spot.x,spot.y));
  a.run(SUMMON_WARNING_TICKS);
  const free=pending.filter(s=>Math.hypot(s.x-spot.x,s.y-spot.y)>=1.5&&Math.hypot(s.x-p1.x,s.y-p1.y)>=1.5);
  assert.ok(free.length<pending.length);
  assert.equal(a.minions.length,free.length,'only the occupied markers are skipped');
  for(const m of a.minions)assert.ok(Math.hypot(m.x-spot.x,m.y-spot.y)>=1.5);
  assert.ok(p1);
  const cap=arena({players:[player('p1',12,5)],boss:{tuning:{minionCap:2,summonCount:5,summonEvery:1}}});
  const b2=cap.controller.spawnBoss(cap.ctx,{x:12,y:12})!;b2.hp=b2.maxHp*.4;b2.readyTick=0;
  for(let i=0;i<ticks(6);i++){cap.run(1);assert.ok(cap.controller.state.minions.length+cap.controller.state.pending.length<=2);}
});

test('boss hp uses the injected peak player count and never shrinks below present players',()=>{
  const a=arena({players:squad(2),boss:{scalePlayers:()=>5}});
  assert.equal(a.controller.spawnBoss(a.ctx)!.maxHp,bossMaxHp(5));
  const b=arena({players:squad(4),boss:{scalePlayers:()=>1}});
  assert.equal(b.controller.spawnBoss(b.ctx)!.maxHp,bossMaxHp(4));
});

test('boss walks around rocks and stops at the coast, chasing only online standing players',()=>{
  for(const target of [player('p1',15,12),player('p1',12,.5)]){
    const a=arena({players:[target]});
    const boss=a.controller.spawnBoss(a.ctx,target.x===15?{x:8.5,y:12}:{x:12,y:8})!;
    boss.readyTick=0;boss.memory!.next=1e9;
    for(let i=0;i<ticks(8);i++){a.run(1);assert.ok(walkable(boss,defaultTerrain),`boss at ${boss.x},${boss.y}`);}
  }
  // Downed, offline and spectating players are not chased: the boss walks to the standing one.
  const standing=player('up',12,4);
  const a=arena({players:[player('down',12,18,{hp:0,downed:{sinceTick:0,bleedOutTick:999,progress:0}}),player('off',12,17,{online:false}),player('spec',12,17,{spectator:true}),standing]});
  const boss=a.controller.spawnBoss(a.ctx,{x:12,y:12})!;boss.readyTick=0;boss.memory!.next=1e9;
  const y=boss.y;a.run(ticks(1));
  assert.ok(boss.y<y,'moves toward the standing player');
});

test('boss spawn keeps 4 units from players when the center is crowded',()=>{
  const crowd=[player('c',12,12),player('n',12,9),player('e',15,12)];
  const a=arena({players:crowd});
  const boss=a.controller.spawnBoss(a.ctx)!;
  assert.ok(walkable(boss,defaultTerrain));
  for(const p of crowd)assert.ok(Math.hypot(p.x-boss.x,p.y-boss.y)>=4,`spawned ${Math.hypot(p.x-boss.x,p.y-boss.y).toFixed(2)} from ${p.id}`);
});

test('boss barks only through the injected global limiter (D-012) and the lines are pt-BR jokes',()=>{
  const silent=fakeCtx({players:squad(),terrain:defaultTerrain,seed:3});
  const quiet=createBoss({summon:()=>undefined});
  const qb=quiet.spawnBoss(silent)!;qb.hp=qb.maxHp*.4;
  for(let i=0;i<ticks(30);i++){quiet.step(silent);telegraphSystem.step(silent);silent.tick++;}
  assert.equal(silent.events.filter(e=>e.type==='bark').length,0,'no say wired: the boss never emits barks itself');
  const a=arena({seed:3});
  const boss=a.controller.spawnBoss(a.ctx)!;a.run(ticks(20));boss.hp=boss.maxHp*.4;a.run(ticks(40));
  const barks=a.ctx.events.map((e,i)=>({e,i})).filter(({e})=>e.type==='bark');
  assert.ok(barks.length>=5,`boss talks (${barks.length})`);
  for(const {e} of barks)if(e.type==='bark')assert.ok(Object.values(BOSS_LINES).some(l=>(l as readonly string[]).includes(e.line)));
  // Global gap: the shared EnemyAi limiter spaces every balloon by at least BARK_GAP ticks.
  const b=arena({seed:3});const ticked:number[]=[];
  b.controller.spawnBoss(b.ctx);
  for(let i=0;i<ticks(60);i++){const before=b.ctx.events.length;b.run(1);if(b.ctx.events.slice(before).some(e=>e.type==='bark'))ticked.push(b.ctx.tick-1);}
  for(let i=1;i<ticked.length;i++)assert.ok(ticked[i]-ticked[i-1]>=BARK_GAP,`barks ${ticked[i-1]} and ${ticked[i]} too close`);
  for(const lines of Object.values(BOSS_LINES))assert.ok(lines.length>=2&&lines.every(l=>l.length<=60),'short lines for the phone balloon');
});

test('default minions come from the enemy catalog, wait a moment after arriving and respect the enemy budget',()=>{
  const run=(fill:number)=>{
    const ctx=fakeCtx({players:[player('p1',12,5)],terrain:defaultTerrain,seed:2});
    for(let i=0;i<fill;i++)ctx.enemies.set(`x${i}`,enemy(`x${i}`,3,3,{boss:false,kind:'gosma'}));
    const c=createBoss();
    const boss=c.spawnBoss(ctx,{x:12,y:12})!;boss.hp=boss.maxHp*.4;boss.readyTick=0;
    for(let i=0;i<=SUMMON_WARNING_TICKS+1;i++){c.step(ctx);ctx.tick++;}
    return {ctx,c,minions:c.state.minions.map(id=>ctx.enemies.get(id)!)};
  };
  const {minions}=run(0);
  assert.ok(minions.length>0);
  for(const m of minions){
    assert.ok((MINION_KINDS as readonly string[]).includes(m.kind));
    assert.equal(m.maxHp,ENEMIES[m.kind as 'gosma'].hp,'catalog stats');
    assert.equal(m.readyTick-m.spawnTick,MINION_READY_TICKS);
    assert.ok(!m.boss);
  }
  const full=run(MAX_ENEMIES);
  assert.equal(full.minions.length,0,'no minions over MAX_ENEMIES');
  assert.equal(full.ctx.enemies.size,MAX_ENEMIES+1);
});

test('spawnBoss uses the director coastal point when walkable and falls back inland otherwise',()=>{
  const coast={x:12,y:20.5};
  assert.ok(walkable(coast,defaultTerrain));
  const a=arena({players:[player('p1',12,5)]});
  const boss=a.controller.spawnBoss(a.ctx,coast)!;
  assert.deepEqual({x:boss.x,y:boss.y},coast);
  const b=arena({players:[player('p1',12,5)]});
  const wet=b.controller.spawnBoss(b.ctx,{x:12,y:30})!;
  assert.ok(walkable(wet,defaultTerrain),'sea point replaced by a walkable one');
});

test('minions never arrive on offline bodies, which can reconnect and still get hit',()=>{
  for(let seed=1;seed<=20;seed++){
    const a=arena({seed,players:[player('p1',12,5)]});
    const boss=a.controller.spawnBoss(a.ctx,{x:12,y:12})!;boss.hp=boss.maxHp*.4;boss.readyTick=0;
    a.run(1);
    const spot=a.controller.state.pending[0];
    assert.ok(spot,`seed ${seed}: a summon is pending`);
    a.ctx.players.set('afk',player('afk',spot.x,spot.y,{online:false}));
    a.run(SUMMON_WARNING_TICKS);
    for(const m of a.minions)assert.ok(Math.hypot(m.x-spot.x,m.y-spot.y)>=1.5,`seed ${seed}: minion on an offline body`);
    // New summons are not even placed next to the offline body.
    a.run(ticks(15));
    for(const s of a.controller.state.pending)assert.ok(Math.hypot(s.x-spot.x,s.y-spot.y)>=2.5);
  }
});

test('key lines refused by the global limiter are retried, so the defeat line is not lost',()=>{
  let allow=false;const said:string[]=[];
  const say=(_c:SimContext,_e:EnemyState,lines:readonly string[],key:string)=>{if(!allow)return false;said.push(key);return true;};
  const ctx=fakeCtx({players:squad(),terrain:defaultTerrain});
  const c=createBoss({say,summon:()=>undefined});
  const boss=c.spawnBoss(ctx)!;
  assert.deepEqual(c.state.queued,{key:'spawn',until:ctx.tick+KEY_LINE_RETRY_TICKS});
  allow=true;c.step(ctx);ctx.tick++;
  assert.deepEqual(said,['chefe:spawn']);assert.equal(c.state.queued,undefined);
  allow=false;ctx.enemies.delete(boss.id);c.step(ctx);ctx.tick++;
  assert.ok(c.bossDefeated(ctx));assert.equal(c.state.queued?.key,'defeat');
  const saved=JSON.parse(JSON.stringify(c.state));
  allow=true;c.step(ctx);ctx.tick++;
  assert.deepEqual(said,['chefe:spawn','chefe:defeat'],'defeat line said once the limiter frees up');
  c.step(ctx);assert.equal(said.length,2,'said once');
  // Expired retries are dropped without a bark, also after a checkpoint restore.
  const late=createBoss({say,summon:()=>undefined});late.restore(saved);
  ctx.tick+=KEY_LINE_RETRY_TICKS+1;late.step(ctx);
  assert.equal(said.length,2);assert.equal(late.state.queued,undefined);
});

test('reset drops the random stream and restore keeps pending summons',()=>{
  // Barks are left out: the arena's shared EnemyAi limiter remembers the first fight.
  const fight=(a:ReturnType<typeof arena>)=>{const b=a.controller.spawnBoss(a.ctx,{x:12,y:12})!;b.hp=b.maxHp*.4;b.readyTick=0;a.run(ticks(4));return JSON.stringify(a.ctx.events.filter(e=>e.type!=='bark'));};
  const fresh=arena({seed:9,players:[player('p1',12,5)]}),reused=arena({seed:9,players:[player('p1',12,5)]});
  fight(reused);
  reused.ctx.enemies.clear();reused.ctx.telegraphs.clear();reused.ctx.events.length=0;reused.ctx.tick=0;reused.controller.reset();
  // Same seed, same tick, reset controller: identical fight (a kept stream would diverge).
  const ids=(a:ReturnType<typeof arena>)=>fight(a).replace(/"(boss|tg|minion|e)\d+"/g,'"id"');
  assert.equal(ids(reused),ids(fresh));
  const a=arena({seed:4,players:[player('p1',12,5)]});
  const b=a.controller.spawnBoss(a.ctx,{x:12,y:12})!;b.hp=b.maxHp*.4;b.readyTick=0;a.run(1);
  const pending=a.controller.state.pending.length;assert.ok(pending>0);
  a.reload();
  assert.equal(a.controller.state.pending.length,pending);
  a.run(SUMMON_WARNING_TICKS);
  assert.ok(a.minions.length>0,'restored pending summons still arrive');
});
