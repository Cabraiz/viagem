/**
 * torres-render (D-041, design/proximos/08-TORRES.md): the pure rules of the defenses' drawing.
 *  1. The client's table (TOWER_LOOK) and phase rule match the sim's catalog (the client may not import the sim).
 *  2. Base frames (4 views × 6 rows) and weapon rows (8 directions S, SW, W, NW, N, NE, E, SE), turning one step a time.
 *  3. Volley detection from consecutive views, aiming (range, minRange, ground/air).
 *  4. Calibre → effects (explosives leave craters, the Gustavão the largest and the only map-wide shake) and the shake
 *     envelope (none under prefers-reduced-motion).
 *  5. The art lookup through the manifest (group `torres`, base + idle + mount), procedural when absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFENSES,DEFENSE_IDS,phaseOf,DAMAGED_AT} from '../../src/sim/towers/catalog.ts';
import {SIM_HZ} from '../../src/contract/index.ts';
import {setArtIndex,parseArtIndex} from '../../src/client/art/manifest.ts';
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
