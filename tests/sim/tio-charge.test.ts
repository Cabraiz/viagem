/**
 * BUG-20261012-E6-cidade-velocidades-relativas: the Tio do Pavê's charge is escapable in every world.
 *   peak cap: no enemy-ai step (walk, zig-zag, charge) takes an enemy past ACTION_PEAK_MAX × the world's hero speed;
 *   the endless world is unchanged for every kind, city pombos (3.45 u/s after 05c) are held to 1.15 × the hero
 *   warning: the joke draws the whole charge as an 'investida' line (0 damage, ≥ 0.8 s) before he moves
 *   acceptance: a hero in the path who walks out sideways after seeing the line is never touched; standing still is
 *   locked line: the charge does not home on a player who moves; budget full / annulled / knocked → no unwarned charge
 *   wiring: the city run gives the AI the city hero speed, the endless run 3.1
 * Real SimWorld with the telegraph system, on open ground of the endless world (like elenco.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {BASE_STATS,SIM_HZ,type SimEvent,type SimPlayer,type Telegraph} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {ACTION_PEAK_MAX,ENEMIES,TIO_JOKE,applyElite,createEnemy,type EnemyKind} from '../../src/sim/enemies/catalog.ts';
import {ENEMY_TELEGRAPH_CAP,EnemyAi,STATE,type EnemyAiOptions} from '../../src/sim/enemies/ai.ts';
import {MIN_TELEGRAPH_TICKS,createTelegraphSystem,telegraphHits} from '../../src/sim/telegraphs.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {SCALE_PROFILES} from '../../src/rules/scale.ts';
import {RADIUS,SPEED,moveDirection,walkable,type Point} from '../../src/maps/world.ts';
import {STEP} from '../../src/maps/prediction.ts';
import {DEFAULT_SEED,TerrainField} from '../../src/maps/terrain/field.ts';
import {CityTerrain,cityAsField} from '../../src/maps/city/terrain.ts';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {citySpeed} from '../../src/sim/city/speed.ts';

const TERRAIN=new TerrainField(DEFAULT_SEED,{world:'infinito'});
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

const CITY_HERO=SCALE_PROFILES['cidade-nevada'].hero.speed;
/** The Tio in the city as cidade-05c converts him (catalog 0.95 × city common 1.7875 / endless common 1.4 ≈ 1.21, card). */
const CITY_TIO=.95*1.7875/1.4;
/** cidade-05c's conversion of a catalog speed (citySpeed at plan.speed 1: × city common 1.7875 / endless common 1.4). */
// The real city conversion from cidade-05c (catalog speed → city speed, plan speed 1).
const citySpeed05c=(catalog:number)=>citySpeed(catalog);
/** Regular kinds (the boss moves in boss.ts). */
const KINDS:EnemyKind[]=['bebado','anao-molotov','pombos','tio-pave','agiota'];
/** The same Tio if the city kept his share of the hero speed (convertSpeed). */
const CITY_TIO_SHARE=.95/SPEED*CITY_HERO;

interface Made {tick:number;t:Telegraph}
function arena(options:EnemyAiOptions={},seed=1){
  const world=new SimWorld({terrain:TERRAIN,seed});
  world.round.index=3;world.round.phase='wave';
  const ai=new EnemyAi(options);
  world.register(ai).register(createTelegraphSystem());
  const events:(SimEvent&{tick:number})[]=[];
  const made:Made[]=[];
  const step=(n:number,each?:()=>void)=>{
    for(let i=0;i<n;i++){
      for(const e of world.step()){
        events.push({...e,tick:world.tick});
        if(e.type==='telegraph'){const t=world.telegraphs.get(e.telegraph);if(t)made.push({tick:world.tick,t:{...t}});}
      }
      each?.();
    }
  };
  return {world,ai,events,made,step};
}
function addPlayer(world:SimWorld,id:string,p:Point):SimPlayer{
  const player:SimPlayer={id,classId:'test',x:p.x,y:p.y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},};
  world.players.set(id,player);
  return player;
}
const hitsBy=(events:readonly (SimEvent&{tick:number})[],source:string,from:number,to:number)=>
  events.filter(e=>e.type==='damage'&&e.source===source&&e.tick>=from&&e.tick<=to);
const investidas=(made:readonly Made[],owner:string)=>made.filter(m=>m.t.owner===owner&&m.t.kind==='investida');

/** A Tio at O, a player `along` u ahead (+x), the joke started (one step). */
function joke(options:EnemyAiOptions,tioSpeed:number|undefined,along:number){
  const A=arena(options);
  const p=addPlayer(A.world,'p',at(along));
  const e=createEnemy(A.world,'tio-pave',O);
  if(tioSpeed!==undefined)e.speed=tioSpeed;
  A.step(1);
  assert.equal(e.memory!.state,STATE.joke,'the joke starts at once (in range, bark free)');
  const [line]=investidas(A.made,e.id);
  return {...A,p,e,line};
}

// ---------- Peak cap ----------
test('peak cap: the charge never passes ACTION_PEAK_MAX × the hero; the endless charge is unchanged',()=>{
  const measure=(options:EnemyAiOptions,tioSpeed:number|undefined)=>{
    const J=joke(options,tioSpeed,2.2);
    // The player steps far aside once warned, so the charge runs its full length.
    J.p.y+=4;
    let fastest=0,travel=0,charging=0;
    for(let i=0;i<TIO_JOKE.pause+TIO_JOKE.charge+5;i++){
      const before={x:J.e.x,y:J.e.y},was=J.e.memory!.state;
      J.step(1);
      if(was===STATE.charge){const d=Math.hypot(J.e.x-before.x,J.e.y-before.y);fastest=Math.max(fastest,d);travel+=d;charging++;}
    }
    return {...J,fastest,travel,charging};
  };
  // City hero (1.994) with the converted city Tio (1.21 × 2.6 = 3.15 u/s): capped at 1.994 × 1.15.
  const cap=CITY_HERO*ACTION_PEAK_MAX;
  assert.ok(CITY_TIO*TIO_JOKE.chargeSpeed>cap,'the uncapped city charge would outrun the cap');
  const city=measure({heroSpeed:CITY_HERO},CITY_TIO);
  assert.equal(city.charging,TIO_JOKE.charge,'full charge');
  assert.ok(city.fastest<=cap/SIM_HZ+1e-9,`city step ${city.fastest} ≤ ${cap/SIM_HZ}`);
  assert.ok(Math.abs(city.fastest-cap/SIM_HZ)<1e-9,'the cap is what limits it');
  assert.ok(Math.abs(city.ai.paceSpeed(city.e,TIO_JOKE.chargeSpeed)/CITY_HERO-ACTION_PEAK_MAX)<1e-12,'peak/hero = 1.15');
  // The line is as long as the capped charge (plus his body at both ends).
  const body=city.e.radius+.05;
  assert.ok(Math.abs(city.line.t.radius-(cap*TIO_JOKE.charge/SIM_HZ+2*body))<1e-9,`line length ${city.line.t.radius}`);
  // Endless (default heroSpeed = SPEED = 3.1): 0.95 × 2.6 = 2.47 < 3.565, the old charge step exactly.
  const endless=measure({},undefined);
  assert.equal(endless.ai.heroSpeed,SPEED);
  const old=.95*TIO_JOKE.chargeSpeed/SIM_HZ;
  assert.ok(Math.abs(endless.fastest-old)<1e-12,`endless step ${endless.fastest} vs ${old}`);
  assert.ok(Math.abs(endless.travel-old*TIO_JOKE.charge)<1e-9,'endless travel unchanged');
  // Walking is capped too (Orquestrador: every step), below the cap it is the plain speed; slows apply after the cap.
  assert.equal(city.ai.paceSpeed({speed:9},1),cap);
  assert.equal(city.ai.paceSpeed({speed:1},1),1);
  const slowed=joke({heroSpeed:CITY_HERO},CITY_TIO,2.2);slowed.p.y+=4;
  slowed.step(TIO_JOKE.pause);
  assert.equal(slowed.e.memory!.state,STATE.charge);
  slowed.e.slowUntil=slowed.world.tick+10;
  const q={x:slowed.e.x,y:slowed.e.y};slowed.step(1);
  assert.ok(Math.abs(Math.hypot(slowed.e.x-q.x,slowed.e.y-q.y)-cap/2/SIM_HZ)<1e-9,'slow halves the capped step');
  // Bad heroSpeed values fall back to SPEED.
  for(const bad of [NaN,0,-1,Infinity])assert.equal(new EnemyAi({heroSpeed:bad}).heroSpeed,SPEED,String(bad));
});

test('endless world: every kind (elite too) steps exactly as before the cap',()=>{
  const TAU=Math.PI*2;
  for(const kind of KINDS)for(const elite of [false,true]){
    const A=arena();
    addPlayer(A.world,'p',at(8.5));
    const e=createEnemy(A.world,kind,at(-8));
    if(elite)applyElite(e);
    assert.ok(Math.abs(e.speed-ENEMIES[kind].speed*(elite?.9:1))<1e-12,`${kind}: catalog speed`);
    const z=ENEMIES[kind].zigzag;
    for(let i=0;i<20;i++){
      const q={x:e.x,y:e.y},ux=(A.world.players.get('p')!.x-e.x),uy=(A.world.players.get('p')!.y-e.y),d=Math.hypot(ux,uy);
      A.step(1);
      // The old step: speed × pace, where only the bêbado's sway (stagger) has a pace above 1 (√(1 + wave²)).
      const wave=z&&kind==='bebado'?Math.sin(A.world.tick*z.freq+e.memory!.seed*TAU)*z.amp:0;
      const before=e.speed*Math.hypot(1,wave)/SIM_HZ,step=Math.hypot(e.x-q.x,e.y-q.y);
      assert.ok(d>3,'far from the player: plain approach');
      assert.ok(Math.abs(step-before)<1e-12,`${kind}${elite?' elite':''} tick ${A.world.tick}: ${step} vs ${before}`);
      assert.ok(step<SPEED*ACTION_PEAK_MAX/SIM_HZ,'under the endless cap');
    }
  }
});

test('city: with the real 05c conversion every kind stays under 1.994 × 1.15; a faster body is held to the cap',()=>{
  const cap=CITY_HERO*ACTION_PEAK_MAX;
  for(const kind of KINDS){
    const A=arena({heroSpeed:CITY_HERO});
    addPlayer(A.world,'p',at(8.5));
    const e=createEnemy(A.world,kind,at(-8));e.speed=citySpeed05c(ENEMIES[kind].speed);
    let fastest=0;
    for(let i=0;i<20;i++){const q={x:e.x,y:e.y};A.step(1);fastest=Math.max(fastest,Math.hypot(e.x-q.x,e.y-q.y));}
    assert.ok(fastest<=cap/SIM_HZ+1e-12,`${kind}: ${fastest} ≤ ${cap/SIM_HZ}`);
    // citySpeed is not linear: the fast pombos land at ~0.98 × the city hero, so no catalog kind needs the cap today.
    assert.ok(fastest<cap/SIM_HZ,`${kind}: under the cap, walks as converted`);
  }
  // The cap is the guarantee for anything faster (a future kind, a modifier): a 3.45 u/s body is held to it.
  {
    const A=arena({heroSpeed:CITY_HERO});
    addPlayer(A.world,'p',at(8.5));
    const e=createEnemy(A.world,'pombos',at(-8));e.speed=3.45;
    let fastest=0;
    for(let i=0;i<20;i++){const q={x:e.x,y:e.y};A.step(1);fastest=Math.max(fastest,Math.hypot(e.x-q.x,e.y-q.y));}
    assert.ok(Math.abs(fastest-cap/SIM_HZ)<1e-12,'a 1.73 × hero body is limited by the cap');
  }
  // A hero running straight away at the city hero speed: even a 3.45 u/s body closes in at most (cap − hero) × t.
  const A=arena({heroSpeed:CITY_HERO});
  const p=addPlayer(A.world,'p',at(-4));
  const e=createEnemy(A.world,'pombos',at(-8));e.speed=3.45;
  const gap0=Math.hypot(p.x-e.x,p.y-e.y),n=40;
  A.step(n,()=>{const next=moveDirection(p,{x:1,y:0},STEP,TERRAIN,CITY_HERO);p.x=next.x;p.y=next.y;p.hp=100;});
  const closed=gap0-Math.hypot(p.x-e.x,p.y-e.y);
  assert.ok(closed<=(cap-CITY_HERO)*n/SIM_HZ+1e-9,`closed ${closed.toFixed(3)} u in ${n/SIM_HZ} s`);
});

// ---------- Warning ----------
test('the joke draws the charge as an investida line (0 damage, ≥ 0.8 s) and he only moves when it fires',()=>{
  const J=joke({},undefined,2.2);
  const {line,e,p}=J;
  assert.ok(line,'investida line when the joke starts');
  assert.equal(line.tick,J.world.tick,'created on the joke tick');
  assert.equal(line.t.shape,'line');assert.equal(line.t.damage,0);assert.equal(line.t.owner,e.id);
  assert.ok(Math.abs(line.t.dx!-1)<1e-12&&Math.abs(line.t.dy!)<1e-12,'aimed at the player');
  assert.ok(Math.abs(line.t.width!-2*(e.radius+.05))<1e-12,'his body plus the contact margin');
  assert.ok(line.t.fireTick-line.tick>=MIN_TELEGRAPH_TICKS,'at least 0.8 s of warning');
  assert.equal(line.t.fireTick-line.tick,TIO_JOKE.pause,'the whole joke');
  assert.ok(telegraphHits(line.t,p,RADIUS),'the player in the path is inside the line');
  const still={x:e.x,y:e.y};
  while(J.world.tick<line.t.fireTick){
    assert.equal(e.memory!.state,STATE.joke);assert.deepEqual({x:e.x,y:e.y},still,`still at ${J.world.tick}`);
    J.step(1);
  }
  // Fire tick: the line resolves (no damage, no slow, no slide) and the charge starts.
  assert.equal(e.memory!.state,STATE.charge);
  assert.equal(J.world.telegraphs.size,0,'the line is gone');
  assert.equal(p.hp,100);assert.equal(J.events.filter(ev=>ev.type==='damage').length,0,'a 0-damage line hurts nobody');
  assert.equal(p.slowUntil,undefined);assert.equal(p.slipUntil,undefined);
  J.step(1);
  assert.ok(e.x>still.x,'and now he runs');
});

// ---------- Acceptance ----------
test('ACCEPTANCE: a hero who walks out of the line after seeing it is never touched; standing still is shoved',()=>{
  const worlds=[
    {name:'endless 3.1, Tio 0.95',heroSpeed:SPEED,tio:undefined as number|undefined},
    {name:'city 1.994, Tio 1.21 (05c)',heroSpeed:CITY_HERO,tio:CITY_TIO},
    {name:'city 1.994, Tio at his share of the hero',heroSpeed:CITY_HERO,tio:CITY_TIO_SHARE},
  ];
  const REACT=MIN_TELEGRAPH_TICKS;// the hero reacts only after the minimum warning
  let escapes=0;
  for(const w of worlds)for(const along of [1,1.7,2.35])for(const side of [1,-1]){
    const label=`${w.name}, ${along} u ahead, side ${side}`;
    const J=joke({heroSpeed:w.heroSpeed},w.tio,along);
    const {line,e,p}=J;
    const end=line.t.fireTick+TIO_JOKE.charge;
    let walking=0,farthest=0;
    J.step(end-J.world.tick+2,()=>{
      p.hp=100;farthest=Math.max(farthest,e.x-O.x);
      if(J.world.tick-line.tick<REACT||!telegraphHits(line.t,p,RADIUS))return;
      // Walks straight out of the band at this world's hero speed (one sim tick of input).
      const next=moveDirection(p,{x:0,y:side},STEP,TERRAIN,w.heroSpeed);p.x=next.x;p.y=next.y;walking++;
    });
    assert.ok(walking>0,`${label}: had to walk`);
    assert.ok(J.world.tick-line.tick>=REACT+walking,`${label}: out in time`);
    assert.deepEqual(hitsBy(J.events,e.id,line.tick,end),[],`${label}: untouched by the charge`);
    const reach=line.t.radius-2*(e.radius+.05);
    assert.ok(farthest>=reach-1e-9,`${label}: the charge ran its whole line (${farthest.toFixed(2)} of ${reach.toFixed(2)} u)`);
    escapes++;
    // Control: the same hero standing still is hit and shoved.
    const C=joke({heroSpeed:w.heroSpeed},w.tio,along);
    const start={x:C.p.x,y:C.p.y};
    let shove=0;
    C.step(end-C.world.tick+2,()=>{C.p.hp=100;});
    const hits=hitsBy(C.events,C.e.id,C.line.t.fireTick,end);
    assert.equal(hits.length,1,`${label}: standing still is hit by the charge`);
    shove=Math.hypot(C.p.x-start.x,C.p.y-start.y);
    assert.ok(shove>TIO_JOKE.shove*.9,`${label}: shoved ${shove.toFixed(2)}`);
  }
  assert.equal(escapes,18);
});

// ---------- Locked line ----------
test('the charge runs the locked line: a player moving sideways does not bend it',()=>{
  const J=joke({heroSpeed:CITY_HERO},CITY_TIO,2.2);
  const {e,p,line}=J;
  J.step(line.t.fireTick-J.world.tick);
  assert.equal(e.memory!.state,STATE.charge);
  // Runs alongside, 1.2 u off the line (out of the band), moving the way homing would have bent him.
  p.y=O.y+1.2;
  let off=0,charged=0;
  for(let i=0;i<TIO_JOKE.charge;i++){
    p.x=e.x+.5;J.step(1,()=>{p.hp=100;});
    off=Math.max(off,Math.abs(e.y-O.y));charged++;
  }
  assert.ok(off<1e-9,`stayed on the line (off by ${off})`);
  assert.equal(charged,TIO_JOKE.charge);
  assert.ok(Math.abs(e.x-O.x-CITY_HERO*ACTION_PEAK_MAX*TIO_JOKE.charge/SIM_HZ)<1e-9,'full reach along the line');
  assert.deepEqual(hitsBy(J.events,e.id,line.tick,J.world.tick),[],'never touched beside the line');
});

// ---------- Never unwarned ----------
test('no line, no charge: budget full, annulled, knocked off the spot or the player gone',()=>{
  const neverCharges=(label:string,A:ReturnType<typeof joke>,ticks=TIO_JOKE.pause+TIO_JOKE.charge+40)=>{
    let charged=false;
    A.step(ticks,()=>{A.p.hp=100;if(A.e.memory!.state===STATE.charge)charged=true;});
    assert.equal(charged,false,`${label}: never charges`);
  };
  {// Budget full: he still jokes (the line is the only thing refused), then walks.
    const A=arena({heroSpeed:CITY_HERO});
    for(let i=0;i<ENEMY_TELEGRAPH_CAP;i++)A.world.telegraphs.set(`x${i}`,{id:`x${i}`,shape:'circle',x:O.x+500,y:O.y,radius:.1,damage:0,owner:'env:other',fireTick:1e9});
    const p=addPlayer(A.world,'p',at(2.2));const e=createEnemy(A.world,'tio-pave',O);e.speed=CITY_TIO;
    A.step(1);
    assert.equal(e.memory!.state,STATE.joke,'still jokes');
    assert.equal(investidas(A.made,e.id).length,0,'no room for the line');
    let charged=false;
    A.step(600,()=>{p.hp=100;if(e.memory!.state===STATE.charge)charged=true;});
    assert.equal(charged,false,'budget full: never an unwarned charge');
    assert.ok(A.made.length===0,'nothing created over the budget');
  }
  {// Annulled (skills.ts annul deletes his pending line): the joke ends without a charge, on cooldown.
    const J=joke({},undefined,2.2);
    J.world.telegraphs.delete(J.line.t.id);
    J.step(TIO_JOKE.pause,()=>{J.p.hp=100;});
    assert.equal(J.e.memory!.state,STATE.walk);
    assert.equal(J.e.memory!.actReady,J.world.tick+TIO_JOKE.cooldown);
    neverCharges('annulled',J,TIO_JOKE.charge);
  }
  {// Knocked off the spot mid-joke: the line no longer starts at him.
    const J=joke({},undefined,2.2);
    J.step(10);J.e.knock={x:0,y:.2};
    neverCharges('knocked',J,TIO_JOKE.pause);
  }
  {// The player falls mid-joke: the line goes with the joke.
    const J=joke({},undefined,2.2);
    J.step(10);J.p.downed={sinceTick:J.world.tick,bleedOutTick:J.world.tick+600,progress:0};
    J.step(1);
    assert.equal(J.e.memory!.state,STATE.walk);
    assert.equal([...J.world.telegraphs.values()].filter(t=>t.owner===J.e.id).length,0,'line cancelled');
    assert.equal(J.e.memory!.cx,undefined,'locked line forgotten');
  }
});

// ---------- Wiring ----------
test('the run gives the enemy AI its world hero speed: city 1.994, endless 3.1',()=>{
  const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
  const text=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
  const hash=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
  const decoded=decodeCityAsset(text);
  if(!decoded.ok)throw new Error(decoded.error);
  const city=new Simulation(7,{world:'cidade',terrain:cityAsField(new CityTerrain(decoded.asset,hash))});
  assert.equal(city.run.enemyAi.heroSpeed,CITY_HERO);
  assert.ok(Math.abs(CITY_HERO-1.994)<.001);
  assert.equal(new Simulation(7,{world:'infinito'}).run.enemyAi.heroSpeed,SCALE_PROFILES.infinito.hero.speed);
  assert.equal(SCALE_PROFILES.infinito.hero.speed,SPEED);
});
