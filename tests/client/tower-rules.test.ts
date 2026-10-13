/**
 * torres-render (D-041, design/proximos/08-TORRES.md): the pure rules of the defenses' drawing.
 *  1. The client's table (TOWER_LOOK) and phase rule match the sim's catalog (the client may not import the sim).
 *  2. Base frames (4 views × 6 rows) and weapon rows (8 directions S, SW, W, NW, N, NE, E, SE), turning one step a time.
 *  3. Volley detection from consecutive views, aiming (range, minRange, ground/air).
 *  4. Calibre → effects (explosives leave craters, the Gustavão the largest and the only map-wide shake) and the shake
 *     envelope (none under prefers-reduced-motion).
 *  5. The art lookup through the manifest (group `torres`, base + idle + mount), procedural when absent.
 *  6. The wire (torres-fio): TowerFeed turns the snapshot's structures (multiplayer defenseView) into TowerViews — only
 *     the defenses, the server's phase and aim, the sim's footprint radius — and a changed aim into one volley.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFENSES,DEFENSE_IDS,phaseOf,DAMAGED_AT} from '../../src/sim/towers/catalog.ts';
import {SIM_HZ} from '../../src/contract/index.ts';
import {setArtIndex,parseArtIndex} from '../../src/client/art/manifest.ts';
import {defenseView} from '../../multiplayer/simulation.ts';
import type {DefenseState} from '../../src/sim/index.ts';
import {AIM_TOLERANCE,TowerFeed,aimMoved,aimedIndex,towerRadius,type TowerKind,type TowerView} from '../../src/client/render/towers/tower-rules.ts';
import {CALIBRE,CRATER,DIRS8,TOWER_DAMAGED_AT,TOWER_KINDS,TOWER_LOOK,TOWER_PHASES,aimIndex,baseColumn,baseFrame,canFire,dir8,dirVector,firedNow,
  flightMs,lobHeight,phaseRow,shakeAt,shakeOffset,towerArt,towerPhase,turnToward,weaponFrame,type Dir8} from '../../src/client/render/towers/tower-rules.ts';

test('1. TOWER_LOOK matches the sim catalog (kinds, footprint, range, cadence, hits, shots, area, branch)',()=>{
  assert.deepEqual([...TOWER_KINDS].sort(),[...DEFENSE_IDS].sort());
  assert.equal(TOWER_DAMAGED_AT,DAMAGED_AT);
  for(const kind of TOWER_KINDS){
    const l=TOWER_LOOK[kind],d=DEFENSES[kind];
    assert.deepEqual([...l.footprint],[...d.footprint],kind);
    assert.equal(l.range,d.range,kind);assert.equal(l.minRange,d.minRange,kind);
    assert.equal(Math.round(l.cooldown*SIM_HZ),d.cooldown,kind);
    assert.equal(l.hits,d.hits,kind);assert.equal(l.shots,d.shots,kind);assert.equal(l.area,d.area,kind);
    assert.equal(l.branch,d.branch??'T',kind);
    assert.ok(CALIBRE[l.calibre],kind);
  }
});

test('1. towerPhase mirrors the sim phaseOf (obra thirds, pronta, danificada at ≤ 50 %, ruina)',()=>{
  const base={hp:100,maxHp:100,startTick:30,readyTick:120};
  for(const hp of [100,51,50,1])for(let tick=0;tick<=150;tick+=7)for(const ruined of [false,true]){
    const d={...base,hp,...(ruined?{ruined:true as const}:{})};
    assert.equal(towerPhase(d,tick),phaseOf(d,tick),`${hp} ${tick} ${ruined}`);
  }
  assert.deepEqual(TOWER_PHASES,['obra-1','obra-2','obra-3','pronta','danificada','ruina']);
  assert.deepEqual(TOWER_PHASES.map(canFire),[false,false,false,true,true,false]);
});

test('2. base frame: row by phase, column by camera view (4 views; fewer views clamp)',()=>{
  assert.equal(baseFrame('obra-1',0),0);
  assert.equal(baseFrame('pronta',2),3*4+2);
  assert.equal(baseFrame('ruina',3),5*4+3);
  assert.equal(baseFrame('danificada',-1),4*4+3);
  assert.equal(baseFrame('pronta',3,1),3);
  assert.deepEqual([0,1,2,3,4,5].map(baseColumn),[0,1,2,3,0,1]);
  assert.equal(phaseRow('obra-3'),2);
});

test('2. dir8: screen vectors to the rows S, SW, W, NW, N, NE, E, SE; dirVector is its inverse',()=>{
  const v:[number,number][]=[[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1],[1,0],[1,1]];
  assert.deepEqual(v.map(([x,y])=>DIRS8[dir8(x,y)]),['S','SW','W','NW','N','NE','E','SE']);
  assert.equal(dir8(0,0,5),5,'zero vector keeps the fallback');
  assert.equal(dir8(.2,1),0,'within 22.5° of S');
  for(let d=0;d<8;d++){const u=dirVector(d);assert.equal(dir8(u.x,u.y),d);}
});

test('2. turnToward: one 45° step the shorter way, ties clockwise, settles on the target',()=>{
  assert.equal(turnToward(0,2),1);
  assert.equal(turnToward(0,6),7);
  assert.equal(turnToward(0,4),1);
  assert.equal(turnToward(3,3),3);
  for(let a=0;a<8;a++)for(let b=0;b<8;b++){
    let d=a as Dir8,steps=0;
    while(d!==b){d=turnToward(d,b as Dir8);steps++;assert.ok(steps<=4);}
  }
});

test('2. weapon frame: 8 rows × N frames',()=>{
  assert.equal(weaponFrame(0,0,4),0);
  assert.equal(weaponFrame(7,3,4),31);
  assert.equal(weaponFrame(2,5,4),9);
  assert.equal(weaponFrame(3,9,1),3);
});

test('3. firedNow: a changed fireTick after ready is a volley; a new obra or the first view is not',()=>{
  const d={fireTick:130,readyTick:100};
  assert.equal(firedNow(100,d,100),true);
  assert.equal(firedNow(130,d,110),false,'same fireTick');
  assert.equal(firedNow(undefined,d,100),false,'first view');
  assert.equal(firedNow(90,{fireTick:300,readyTick:300},120),false,'upgrade: fireTick = new readyTick');
  assert.equal(firedNow(100,{...d,ruined:true},100),false);
});

test('3. aimIndex: the nearest reachable enemy (range, minRange, ground/air)',()=>{
  const xs=[1,3,8,2.5],ys=[0,0,0,0],air=[0,0,0,1];
  assert.equal(aimIndex(TOWER_LOOK['vigia-do-predio'],0,0,4,xs,ys,air),0);
  assert.equal(aimIndex(TOWER_LOOK.morteiro,0,0,4,xs,ys,air),1,'minRange 2 skips the closest; the flyer is not ground');
  assert.equal(aimIndex(TOWER_LOOK['antiaerea-quadrupla'],0,0,4,xs,ys,air),3,'only flyers');
  assert.equal(aimIndex(TOWER_LOOK['vigia-do-predio'],0,0,4,xs,ys,undefined,.1),-1,'out of range');
  assert.equal(aimIndex(TOWER_LOOK.gustavao,0,0,4,xs,ys,air),2);
});

test('4. calibres: explosives blast and leave craters; the Gustavão is the biggest and alone shakes hard',()=>{
  for(const kind of TOWER_KINDS){
    const l=TOWER_LOOK[kind],c=CALIBRE[l.calibre];
    if(l.branch==='B'){assert.ok(c.blast>0&&c.crater,kind);assert.ok(Math.abs(c.blast-l.area)<1e-9,`${kind} blast = sim area`);}
    if(l.branch==='A'||l.branch==='T')assert.equal(c.shot,'tracer',kind);
  }
  const g=CALIBRE.gustavao;
  assert.equal(g.crater,'gustavao');
  for(const [id,c] of Object.entries(CALIBRE)){
    if(id==='gustavao')continue;
    assert.ok(c.shake<g.shake/3,id);assert.ok(c.blast<g.blast,id);
  }
  assert.ok(Object.values(CRATER).every((c,i,a)=>i===0||c.radius>a[i-1].radius),'craters grow p < m < g < gustavão');
  assert.equal(flightMs(CALIBRE.holofote,5),0);
  assert.ok(flightMs(CALIBRE.morteiro,8)>flightMs(CALIBRE.fuzil,8));
  assert.equal(lobHeight(CALIBRE.morteiro,0),0);assert.equal(lobHeight(CALIBRE.morteiro,1),0);
  assert.equal(lobHeight(CALIBRE.morteiro,.5),CALIBRE.morteiro.arc);
});

test('4. shake envelope: peak at the impact, decays to 0, none with reduced motion',()=>{
  const g=CALIBRE.gustavao;
  assert.equal(shakeAt(g,0,false),g.shake);
  let last=Infinity;
  for(let ms=0;ms<=g.shakeMs+50;ms+=25){const a=shakeAt(g,ms,false);assert.ok(a<=last&&a>=0);last=a;}
  assert.equal(shakeAt(g,g.shakeMs,false),0);
  assert.equal(shakeAt(g,-5,false),0);
  for(let ms=0;ms<g.shakeMs;ms+=50)assert.equal(shakeAt(g,ms,true),0);
  assert.equal(shakeAt(CALIBRE.fuzil,0,false),0);
  const o=shakeOffset(10,123);assert.ok(Math.abs(o.x)<=10&&Math.abs(o.y)<=6);
  assert.deepEqual(shakeOffset(10,123),o,'deterministic');
});

test('5. towerArt: the manifest piece (base sheet, idle sheet, mount), else procedural',()=>{
  setArtIndex(parseArtIndex({version:2,groups:{}}));
  assert.equal(towerArt('morteiro'),undefined);
  setArtIndex(parseArtIndex({version:2,groups:{torres:{output:'public/art/towers',pieces:{
    morteiro:{kind:'views',meta:{footprint:[2,2],mount:[120,80]},files:{base:{file:'morteiro/base.webp',cell:[448,448],views:4,rows:6,anchor:[.5,.8]},idle:{file:'morteiro/idle.webp',cell:[256,256],frames:4,directions:8}}},
    holofote:{kind:'views',files:{idle:{file:'holofote/idle.webp',cell:[128,128]}}}}}}}));
  const a=towerArt('morteiro');
  assert.deepEqual(a?.mount,[120,80]);
  assert.equal(a?.base?.cell[0],448);assert.equal(a?.idle?.frames,4);
  assert.equal(towerArt('holofote'),undefined,'no base sheet: procedural');
  setArtIndex(parseArtIndex({version:2,groups:{}}));
});

const CELL=.88;
const defense=(id:string,kind:TowerKind,extra:Partial<DefenseState>={}):DefenseState=>({id,kind,site:'s',owner:'p',x:10,y:20,hp:400,maxHp:400,
  r:(DEFENSES[kind].size??4)*CELL/2,startTick:0,readyTick:60,fireTick:0,...extra} as DefenseState);
/** The wire's 1-byte aim (protocol 11 `unit`). */
const byte=(turn:number)=>Math.round(turn*255)/255;

test('6a. TowerFeed: only the defenses, with the server phase, the sim radius and no volley on first sight',()=>{
  const feed=new TowerFeed(),tick=100;
  const structures=[
    {id:'muralha',kind:'muralha',x:0,y:0,hp:900,maxHp:1000},
    {id:'t1',kind:'torre-chinelo',x:1,y:1,hp:50,maxHp:50,untilTick:400},
    defenseView(defense('d1','vigia-do-predio',{startTick:90,readyTick:150}),tick),
    defenseView(defense('d2','morteiro',{readyTick:10,aim:Math.PI/2}),tick),
    defenseView(defense('d3','gustavao',{readyTick:10,hp:0,ruined:true}),tick),
  ];
  const views=feed.views(structures,tick,CELL);
  assert.deepEqual(views.map(v=>v.id),['d1','d2','d3']);
  const [v1,v2,v3]=views as [TowerView,TowerView,TowerView];
  assert.equal(v1.phase,'obra-1');assert.equal(v1.aim,undefined);
  assert.equal(v2.phase,'pronta');assert.ok(Math.abs(v2.aim!-.25)<1e-9);
  assert.equal(v3.phase,'ruina');assert.equal(v3.ruined,true);
  // The sim's footprint radius: size × cell / 2 (the root takes size 1; the Gustavão its rail's width, 4 cells).
  assert.equal(v1.r,CELL/2);assert.equal(v2.r,2*CELL/2);assert.equal(v3.r,4*CELL/2);
  for(const kind of TOWER_KINDS)assert.equal(towerRadius(kind,CELL),defense('x',kind).r,kind);
  for(const v of views)assert.equal(firedNow(undefined,v,tick),false,'first sight is not a volley');
});

test('6b. TowerFeed: a changed (or new) aim is one volley; the same aim, or less than half a wire step, is none',()=>{
  const feed=new TowerFeed();
  const wire=(tick:number,aim?:number)=>{
    const s=defenseView(defense('d','vigias-armados',{readyTick:0,...(aim===undefined?{}:{aim})}),tick);
    return feed.views([{...s,...(s.aim===undefined?{}:{aim:byte(s.aim)})}],tick,CELL)[0]!;
  };
  let prev=wire(10).fireTick;
  const step=(tick:number,aim:number|undefined,volley:boolean)=>{
    const v=wire(tick,aim);
    assert.equal(firedNow(prev,v,tick),volley,`tick ${tick} aim ${aim}`);
    prev=v.fireTick;
  };
  step(12,undefined,false);           // ready, never fired
  step(14,0,true);                    // its first volley: the aim appears
  step(16,0,false);                   // same aim: nothing new
  step(18,Math.PI,true);              // turned and fired
  step(20,Math.PI,false);
  step(22,-Math.PI/2,true);           // atan2's negative half wraps to turns .75
  assert.equal(aimMoved(.5,.5+.4/255),false);assert.equal(aimMoved(.5,.5+.6/255),true);assert.equal(aimMoved(.0005,.9995),false,"across the wrap");
  // A world swap forgets every defense: its next sight is a first one again.
  feed.reset();
  const again=wire(30,Math.PI/4);assert.equal(firedNow(undefined,again,30),false);
});

test('6c. aimedIndex: the reachable enemy along the server aim (not the nearest), -1 off the aim',()=>{
  const look=TOWER_LOOK['vigias-armados'];
  // Nearest is straight north (+y, turns .25 is +y); the aim points east (turns 0), where a farther one stands.
  const xs=[0,4,0],ys=[1,0.2,-5],air=[0,0,0];
  assert.equal(aimIndex(look,0,0,3,xs,ys,air),0);
  assert.equal(aimedIndex(look,0,0,0,3,xs,ys,air),1);
  assert.equal(aimedIndex(look,0,0,.25,3,xs,ys,air),0);
  assert.equal(aimedIndex(look,0,0,.75,3,xs,ys,air),2);
  // Nothing along the aim (west), past the tolerance, out of range, or the wrong layer: none.
  assert.equal(aimedIndex(look,0,0,.5,3,xs,ys,air),-1);
  const off=AIM_TOLERANCE+.05;
  assert.equal(aimedIndex(look,0,0,0,1,[Math.cos(off)*3],[Math.sin(off)*3],[0]),-1);
  assert.equal(aimedIndex(look,0,0,0,1,[look.range+.1],[0],[0]),-1);
  assert.equal(aimedIndex(TOWER_LOOK.morteiro,0,0,0,2,[1,5],[0,0],[0,1]),-1,'mortar: under minRange, and a flyer');
  assert.equal(aimedIndex(TOWER_LOOK['antiaerea-quadrupla'],0,0,0,2,[3,5],[0,0],[0,1]),1,'flak: only the flyer');
});
