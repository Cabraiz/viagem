/**
 * NEW-20261023-ORQ-barracas-no-caminho, etapa 2 (the sim), on the REAL Cidade Nevada:
 *  1. The map's barracas: laid once on the first step (after the tralha), rows across the way from the car to a spawn,
 *     side by side, away from the car, the same for the same seed, never shutting the car off a spawn or the moto.
 *  2. A soft wall: solid to the enemies' bodies (forEnemies), unseen by their flow grid (forFlow, cityFlowGrid); the
 *     tranca check and the moto do not count it; every body pressed against it bashes it (bashedAlways).
 *  3. A hero on a barraca walks at BARRACA_HERO_SLOW (heroSlow + slowStep).
 *  4. COLETAR a barraca gives a kit:barraca; DESTRUIR removes it and its blocker; its kit builds it again.
 *  5. Assembled run (chaveiro, manual combat): the critters on their way to the car come up against the barracas and
 *     bash them; none stands inside one; a hero walking through one walks half as far; a checkpoint plays on identically.
 * D-031: results only (state, events), no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks,type EnemyState,type PlayerInput,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {cityTerrainFrom,type CityTerrain} from '../../src/maps/city/terrain.ts';
import {RADIUS,slowStep} from '../../src/maps/index.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {createStonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {BARRACA_HERO_SLOW,BARRACA_ROWS,BARRACA_ROW_MAX,FREE_PIECE_DEFS,KIT_CHARGES,KIT_IDS,UNO_BUILD_CELLS,isFreePiece,kitItem,pieceCells} from '../../src/rules/index.ts';
import {FREE_CELL,bashedAlways,blockingPieces,heroSlow,pieceDisc,reachesAll,pieceRectOf,pieceTargets,type PieceState} from '../../src/sim/towers/free-build.ts';
import {TRALHA_OWNER} from '../../src/sim/towers/tralha.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),
  (JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,CAR=placeWall(city),CAR_R=1;

function rig(seed=7){
  const terrain=city.fork(),events:SimEvent[]=[],counters=new Map<string,number>();
  const ana:SimPlayer={id:'ana',x:CAR.x,y:CAR.y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[],hand:0},stats:{...BASE_STATS},weaponReady:{},grana:0};
  const ctx={tick:1,runStartTick:0,events,terrain,get rng(){return new Rng(seed);},players:new Map([['ana',ana]]),
    enemies:new Map<string,EnemyState>(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),team:{xp:0,level:1,nextXp:5},
    round:{index:2,total:10,phase:'wave',phaseEndsTick:ticks(600),remaining:0},
    enemyIndex:{rebuild(){},query(_x:number,_y:number,_r:number,out:EnemyState[]=[]){out.length=0;return out;},nearest(){return undefined;}},
    nextId:(prefix:string)=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`;},
    emit:(e:SimEvent)=>{events.push(e);},damageEnemy(){return false;},damagePlayer(){}} as unknown as SimContext&{tick:number};
  const given:string[]=[];
  const kits=(p:SimPlayer)=>p.build.weapons.reduce((n,w)=>n+(w.id==='kit:barricada'||w.id==='kit:barraca'?w.level:0),0);
  const sys=createStonewardsSystem({terrain,siegeContact:false,barricades:false,freeBuild:{car:()=>({...CAR,radius:CAR_R})},
    tralha:{carrying:kits,give:(p,kind)=>{given.push(kind);p.build.weapons.push({id:`kit:${kind}`,level:1});return true;}}});
  sys.step(ctx);
  const barracas=()=>(sys.state.defenses?.pieces??[]).filter(p=>p.kind==='barraca');
  const stand=(id:string)=>{const p=barracas().find(q=>q.id===id)!;ana.x=p.x+FREE_CELL*1.5;ana.y=p.y;};
  return {terrain,ctx,sys,ana,events,barracas,stand,kits,given};
}
const rowsOf=(list:readonly PieceState[])=>{
  // Side-by-side squares (2 cells apart on one axis) chain into one row.
  const rows:PieceState[][]=[];
  for(const p of list){
    const row=rows.find(r=>r.some(q=>(q.cell.c===p.cell.c&&Math.abs(q.cell.r-p.cell.r)===2)||(q.cell.r===p.cell.r&&Math.abs(q.cell.c-p.cell.c)===2)));
    if(row)row.push(p);else rows.push([p]);
  }
  return rows;
};

test('rules: the barraca is a 2×2 soft wall piece, never bought, one in a kit', ()=>{
  const def=FREE_PIECE_DEFS.barraca;
  assert.ok(isFreePiece('barraca'));
  assert.deepEqual(pieceCells('barraca'),[2,2]);
  assert.equal(def.blocks,true);assert.equal(def.soft,true);
  assert.equal(FREE_PIECE_DEFS.barricada.soft,undefined,'the barricada stays a hard wall');
  assert.equal(KIT_CHARGES.barraca,1);assert.ok(KIT_IDS.includes('kit:barraca'));
  assert.deepEqual(kitItem('barraca'),{id:'kit:barraca',level:1});
  assert.equal(BARRACA_HERO_SLOW,.5);
});

test('the map\'s barracas: laid once, rows across the way away from the car, the same for the same seed, never shutting the car off', ()=>{
  const g=rig(),laid=g.barracas(),rows=rowsOf(laid);
  console.log(`[barracas] ${laid.length} barracas in ${rows.length} rows (${rows.map(r=>r.length).join(', ')})`);
  assert.ok(laid.length>=BARRACA_ROWS,`laid ${laid.length}`);
  assert.ok(laid.length<=BARRACA_ROWS*BARRACA_ROW_MAX);
  assert.ok(rows.some(r=>r.length>=3),'a row of side-by-side barracas');
  for(const p of laid){
    assert.equal(p.owner,TRALHA_OWNER);
    const r=pieceRectOf(p),gap=Math.hypot(Math.max(r.x-CAR.x,0,CAR.x-(r.x+r.w)),Math.max(r.y-CAR.y,0,CAR.y-(r.y+r.h)));
    assert.ok(gap>=CAR_R+UNO_BUILD_CELLS*FREE_CELL,`${p.id} ${gap.toFixed(2)} u from the car`);
    for(const q of g.sys.state.defenses!.pieces!)if(q!==p){
      const a=pieceRectOf(p),b=pieceRectOf(q);
      assert.ok(!(a.x<b.x+b.w-1e-9&&b.x<a.x+a.w-1e-9&&a.y<b.y+b.h-1e-9&&b.y<a.y+a.h-1e-9),`${p.id} over ${q.id}`);
    }
  }
  // Every barraca a soft blocker; with all of them counted as walls the car still reaches every spawn.
  const soft=g.terrain.blockers().filter(b=>b.soft);
  assert.deepEqual(soft.map(b=>b.id).sort(),laid.map(p=>p.id).sort());
  assert.equal(reachesAll(city,[...blockingPieces(g.sys.state).map(pieceDisc),...laid.map(pieceDisc)],CAR,undefined),true);
  g.ctx.tick++;g.sys.step(g.ctx);
  assert.equal(g.barracas().length,laid.length,'once');
  assert.deepEqual(rig().barracas().map(p=>p.cell),laid.map(p=>p.cell),'same seed, same map');
  assert.notDeepEqual(rig(8).barracas().map(p=>p.cell),laid.map(p=>p.cell),'another seed, other places');
});

test('a soft wall: solid to the enemies\' bodies, unseen by their flow grid, the tranca and the moto; always bashed', ()=>{
  const g=rig(),[a]=g.barracas(),enemies=g.terrain.forEnemies(),flow=g.terrain.forFlow();
  assert.equal(g.terrain.clearDisc(a.x,a.y,RADIUS),true,'the heroes walk in');
  assert.equal(enemies.clearDisc(a.x,a.y,RADIUS),false,'an enemy body is stopped');
  assert.equal(flow.clearDisc(a.x,a.y,RADIUS),true,'the flow field leads through');
  // The flow grid's cell under the barraca stays open.
  const grid=cityFlowGrid(g.terrain),cs=city.asset.unitsPerCell;
  assert.equal(grid.walkable(Math.floor(a.x/cs),Math.floor(a.y/cs)),true);
  // A hard blocker (a barricada) is solid to both views.
  const [t]=(g.sys.state.defenses!.pieces!).filter(p=>p.kind==='barricada');
  assert.equal(flow.clearDisc(t.x,t.y,RADIUS),false);
  assert.equal(enemies.clearDisc(t.x,t.y,RADIUS),false);
  // Not a wall for the tranca check nor the moto (blockingPieces), a blocking siege target, bashed always.
  assert.ok(!blockingPieces(g.sys.state).some(p=>p.kind==='barraca'));
  assert.deepEqual(pieceTargets(g.sys.state).find(s=>s.id===a.id),{id:a.id,x:a.x,y:a.y,radius:pieceDisc(a).r,blocking:true});
  assert.equal(bashedAlways(g.sys.state,a.id),true);
  assert.equal(bashedAlways(g.sys.state,t.id),false,'a barricada only when cut off');
  // A fork from a checkpoint keeps it soft.
  assert.equal(g.terrain.fork().blockers().find(b=>b.id===a.id)?.soft,true);
});

test('a hero on a barraca walks at BARRACA_HERO_SLOW; off it, the whole step', ()=>{
  const g=rig(),[a]=g.barracas();
  assert.equal(heroSlow(g.sys.state,{x:a.x,y:a.y}),BARRACA_HERO_SLOW);
  // The edge on the side with no other barraca (a row runs along one axis).
  const r=pieceRectOf(a),across=g.barracas().some(q=>q!==a&&q.cell.r===a.cell.r);
  const edge=(d:number)=>across?{x:a.x,y:r.y-RADIUS+d}:{x:r.x-RADIUS+d,y:a.y};
  assert.equal(heroSlow(g.sys.state,edge(.01)),BARRACA_HERO_SLOW,'the body\'s edge on it');
  assert.equal(heroSlow(g.sys.state,edge(-.01)),1);
  const from={x:a.x,y:a.y},to={x:a.x+.1,y:a.y};
  assert.deepEqual(slowStep(from,to,.5,city),{x:a.x+.05,y:a.y});
  assert.deepEqual(slowStep(from,to,1,city),to);
});

test('COLETAR a barraca gives a kit:barraca; DESTRUIR removes it; its kit builds it again', ()=>{
  const g=rig(),[a,b]=g.barracas();
  g.stand(a.id);
  assert.equal(g.sys.coletar(g.ctx,'ana',a.id,1).ok,true);
  for(let k=0;k<ticks(1.5);k++){g.ctx.tick++;g.sys.step(g.ctx);}
  assert.deepEqual(g.sys.drainColetas(),[{player:'ana',piece:a.id,req:1,ok:true}]);
  assert.deepEqual(g.given,['barraca']);
  assert.ok(!g.barracas().some(p=>p.id===a.id));
  assert.ok(!g.terrain.blockers().some(x=>x.id===a.id),'its blocker gone');
  // Placed again from the kit (free), anywhere the free build allows; never bought.
  g.ana.grana=100;
  assert.deepEqual(g.sys.build(g.ctx,'ana',{piece:'barraca',c:a.cell.c,r:a.cell.r}),{ok:false,reason:'defense'});
  const built=g.sys.buildKit(g.ctx,'ana',{piece:'barraca',c:a.cell.c,r:a.cell.r});
  assert.equal(built.ok,true,JSON.stringify(built));
  assert.equal(g.terrain.blockers().find(x=>x.id===(built as {defense:string}).defense)?.soft,true);
  // DESTRUIR.
  g.stand(b.id);
  assert.equal(g.sys.destruir(g.ctx,'ana',b.id).ok,true);
  assert.ok(!g.terrain.blockers().some(x=>x.id===b.id));
});

test('assembled run: a hero walks through a barraca at half the step; the critters bash the barracas in their way until one breaks, never stand inside one; a checkpoint plays on identically', ()=>{
  const SEED=21,players=new Map<string,SimPlayer>();
  let move:{x:number;y:number}|undefined,seq=0;
  const takeInput=(id:string):PlayerInput|undefined=>id==='ana'&&move?{seq:++seq,x:move.x,y:move.y,attack:false}:undefined;
  const make=(terrain:CityTerrain,ps:Map<string,SimPlayer>,checkpoint?:ReturnType<RunSystems['state']>)=>{
    const world=new SimWorld({terrain,seed:SEED,players:ps,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    return {world,sys:createRunSystems(world,{takeInput,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',combat:'manual',...(checkpoint?{checkpoint}:{})})};
  };
  const a=make(city.fork(),players);
  const hero=(id:string,dx:number)=>{const p:SimPlayer={id,x:CAR.x+dx,y:CAR.y,classId:'test',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},grana:0};a.world.players.set(id,p);return p;};
  const ana=hero('ana',1.5);hero('bia',-1.5);
  a.world.step();
  const pieces=()=>a.sys.stonewards.state.defenses?.pieces??[];
  const laid=pieces().filter(p=>p.kind==='barraca');
  assert.ok(laid.length>=BARRACA_ROWS,`laid ${laid.length}`);
  // A hero through a barraca: half the step on it.
  const [b]=laid,home={x:ana.x,y:ana.y};
  const stepFrom=(x:number,y:number)=>{ana.x=x;ana.y=y;move={x:0,y:1};a.world.step();move=undefined;return Math.hypot(ana.x-x,ana.y-y);};
  const on=stepFrom(b.x,b.y),off=stepFrom(home.x,home.y);
  assert.ok(off>0,'walks off it');
  assert.ok(Math.abs(on/off-BARRACA_HERO_SLOW)<.02,`on ${on.toFixed(4)} off ${off.toFixed(4)}`);
  ana.x=home.x;ana.y=home.y;
  // Into the waves with both heroes held just behind the middle of a row (the critters chase them; E4's "ir ao Uno" is
  // another card): no critter's centre deep inside a standing barraca's disc; the ones on the far side bash through.
  // The longest row (the compact map's streets are narrower: some rows are a square or two).
  const lines=new Map<string,PieceState[]>();
  for(const p of laid)for(const k of [`r${p.cell.r}`,`c${p.cell.c}`])lines.set(k,[...lines.get(k)??[],p]);
  const row=[...lines.values()].sort((x,y)=>y.length-x.length)[0],mid=row[Math.floor(row.length/2)];
  const across=row.every(p=>p.cell.r===mid.cell.r),behind={x:mid.x+(across?0:2.4),y:mid.y+(across?2.4:0)};
  const hold=()=>{for(const p of a.world.players.values()){p.x=behind.x;p.y=behind.y;}};
  const bashed=new Set<string>();let inside=0,seen=0,closest=Infinity;
  for(let i=0;i<ticks(90);i++){
    hold();a.world.step();
    const standing=pieces().filter(p=>p.kind==='barraca');
    for(const p of standing)if(p.hp<p.maxHp)bashed.add(p.id);
    for(const p of laid)if(!standing.some(q=>q.id===p.id))bashed.add(p.id);
    for(const e of a.world.enemies.values()){
      // A body retreating at the round's end walks out over every blocker (director moveCityRetreats: harmless).
      if(e.memory?.retreat===1)continue;
      seen++;
      for(const p of standing){
        const d=Math.hypot(e.x-p.x,e.y-p.y);closest=Math.min(closest,d);
        if(d<pieceDisc(p).r-.05)inside++;
      }
    }
  }
  const fallen=laid.filter(p=>!pieces().some(q=>q.id===p.id)).length;
  console.log(`[barracas] 90 s behind a row of ${row.length}: ${bashed.size} bashed, ${fallen} fallen, closest critter ${closest.toFixed(2)} u`);
  assert.ok(seen>0,'enemies walked');
  assert.equal(inside,0,'never inside a barraca');
  assert.ok(bashed.size>0,'the critters bash the barracas in their way');
  assert.ok(fallen>0,'until one breaks');
  // Checkpoint: a fresh run on a fresh fork raises the soft blockers again and plays on identically.
  const world=a.world.checkpoint(),systems=structuredClone(a.sys.state());
  const copies=new Map([...players].map(([id,p])=>[id,structuredClone(p)]));
  const fork=city.fork(),c=make(fork,copies,systems);c.world.load(world);
  assert.deepEqual(fork.blockers().filter(x=>x.soft).map(x=>x.id).sort(),pieces().filter(p=>p.kind==='barraca').map(p=>p.id).sort());
  for(let i=0;i<ticks(20);i++){a.world.step();c.world.step();}
  assert.equal(stateHash({world:c.world.state(),systems:c.sys.state()}),stateHash({world:a.world.state(),systems:a.sys.state()}));
});
