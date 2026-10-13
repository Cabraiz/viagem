/**
 * torres-sim (D-041, design/proximos/08-TORRES.md §3): the tower defense in the simulation.
 *  1. Catalog: the tree (root, A2–A5 + A4b/A5b, B2–B6, C2–C5), costs per tier, sizes from the art's footprints, the
 *     branch picks, the obra phases and the payment rule.
 *  2. Build sites (E1's pontos-de-obra, through towers/sites.ts): valid on the city and the endless map, none on the island.
 *  3. Commands: build/upgrade refusals, limits (12 standing, one Gustavão), the rail, sizes, request ids.
 *  4. Life: obra-1..3 → pronta → danificada → ruina through the structures system's single damage path (D-017).
 *  5. Combat: damage, shots, area, ground/air, minRange, slow and dazzle, anti-air only against flyers, the radar.
 *  6. Determinism and JSON round trip; the island byte-identical (no `defenses` key, no sites).
 * D-031: results only (state, events), no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks,type EnemyState,type RoundPhase,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {cityTerrainFrom,type CityTerrain} from '../../src/maps/city/terrain.ts';
import {defaultTerrain,TerrainField} from '../../src/maps/terrain/field.ts';
import {createStonewardsSystem,structureTargets,type StonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {prizeBlocks} from '../../src/sim/assemble.ts';
import {ENEMIES,isFlying} from '../../src/sim/enemies/catalog.ts';
import {DAMAGED_AT,DEFENSES,DEFENSE_IDS,DEFENSE_LIMIT,GUSTAVAO_COST,RAIL,ROOT_DEFENSE,TIER_BUILD_SECONDS,TIER_COST,childrenOf,payUnits,phaseOf,pickChild,type DefenseId} from '../../src/sim/towers/catalog.ts';
import {buildPlanFor,validateBuildPlan} from '../../src/sim/towers/sites.ts';
import {defensePhase,defensesStep,radarBonus,type DefenseState} from '../../src/sim/towers/system.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),
  (JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

// ---------- Fixtures ----------
type FakeCtx=SimContext&{tick:number;events:SimEvent[];round:{index:number;total:number;phase:RoundPhase;phaseEndsTick:number;remaining:number}};
function player(id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x,y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
function enemy(id:string,x:number,y:number,extra:Partial<EnemyState>={}):EnemyState{
  return {id,kind:'bebado',x,y,hp:30,maxHp:30,speed:1,damage:10,radius:.35,xp:1,spawnTick:0,readyTick:0,...extra};
}
const byId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
function fakeCtx(terrain:SimContext['terrain'],players:SimPlayer[],seed=1):FakeCtx{
  const events:SimEvent[]=[],enemies=new Map<string,EnemyState>();
  const counters=new Map<string,number>();
  return {
    tick:0,runStartTick:0,events,terrain,
    // Re-derived every tick, like the core's (SimContext.rng).
    get rng(){return new Rng((seed*0x9e3779b1+(this as {tick:number}).tick)>>>0);},
    players:new Map(players.map(p=>[p.id,p])),
    enemies,pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},
    round:{index:2,total:10,phase:'prepare',phaseEndsTick:ticks(600),remaining:0},
    enemyIndex:{rebuild(){},
      query(x,y,r,out=[]){out.length=0;for(const e of [...enemies.values()].sort(byId))if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;},
      nearest(x,y,r,filter){let best:EnemyState|undefined,bd=Infinity;for(const e of [...enemies.values()].sort(byId)){const d=Math.hypot(e.x-x,e.y-y);if(d<=r&&d<bd&&(!filter||filter(e))){best=e;bd=d;}}return best;}},
    nextId:prefix=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`;},
    emit:e=>{events.push(e);},
    damageEnemy(enemyId,amount,_source,weapon){
      const e=enemies.get(enemyId);if(!e||!(e.hp>0)||!(amount>0))return false;
      const dealt=Math.min(e.hp,amount);e.hp-=dealt;events.push({type:'damage',target:e.id,amount:dealt,weapon});
      if(e.hp<=0){enemies.delete(enemyId);return true;}return false;
    },
    damagePlayer(){},
  } as FakeCtx;
}
/** A city structures system on its own terrain fork, one standing player 'a' at the fountain, a rich balance. */
function citySetup(units=1000){
  const terrain=city.fork(),ctx=fakeCtx(terrain,[player('a',83.9,90.5),player('b',84,88)]);
  const sys=createStonewardsSystem({terrain,barricadesLater:false});
  sys.state.balance.coco=Math.floor(units/2);sys.state.balance.pedra=units-Math.floor(units/2);
  return {ctx,sys,terrain};
}
const at=(ctx:FakeCtx,tick:number,phase:RoundPhase='prepare')=>{ctx.tick=tick;ctx.round.phase=phase;};
/** Builds the root on `site` and evolves it along `path` (branch args), each obra finished; returns the defense. */
function grow(ctx:FakeCtx,sys:StonewardsSystem,site:string,path:(string|undefined)[]=[]):DefenseState{
  const b=sys.build(ctx,'a',site);
  assert.ok(b.ok,`build on ${site}: ${JSON.stringify(b)}`);
  const id=(b as {defense:string}).defense,d=()=>sys.state.defenses!.list.find(x=>x.id===id)!;
  at(ctx,d().readyTick);
  for(const branch of path){
    const u=sys.upgrade(ctx,'a',id,branch);
    assert.ok(u.ok,`upgrade ${d().kind} → ${branch}: ${JSON.stringify(u)}`);
    at(ctx,d().readyTick);
  }
  return d();
}

// ---------- 1. Catalog ----------
test('catalog: the tree of 08-TORRES §3 with its ids, parents, costs and sizes',()=>{
  const tree:Record<DefenseId,[string,DefenseId|null,number]>={
    'vigia-do-predio':['T1',null,1],
    'vigias-armados':['A2','vigia-do-predio',2],'atiradores-do-telhado':['A3','vigias-armados',2],
    'ninho-de-metralhadora':['A4','atiradores-do-telhado',3],'guarnicao-do-predio':['A5','ninho-de-metralhadora',3],
    'ninho-do-sniper':['A4b','atiradores-do-telhado',2],'equipe-antimaterial':['A5b','ninho-do-sniper',2],
    'rojao-de-festa':['B2','vigia-do-predio',1],'morteiro':['B3','rojao-de-festa',2],'lanca-foguetes':['B4','morteiro',3],
    'obuseiro':['B5','lanca-foguetes',3],'gustavao':['B6','obuseiro',0],
    'holofote':['C2','vigia-do-predio',1],'arame-e-sirene':['C3','holofote',2],'antiaerea-quadrupla':['C4','arame-e-sirene',2],'posto-de-radar':['C5','antiaerea-quadrupla',2],
  };
  assert.deepEqual([...DEFENSE_IDS].sort(),Object.keys(tree).sort());
  for(const id of DEFENSE_IDS){
    const d=DEFENSES[id],[label,from,size]=tree[id];
    assert.equal(d.label,label,id);assert.equal(d.from,from,id);assert.equal(d.size,size||null,`${id}: size from the footprint ${d.footprint} (the root: 1)`);
    assert.ok(Object.isFrozen(d),id);
    assert.equal(d.cost,id==='gustavao'?GUSTAVAO_COST:TIER_COST[d.tier as 1|2|3|4|5],`${id}: card cost`);
    assert.equal(d.buildSeconds,TIER_BUILD_SECONDS[d.tier]);
    assert.ok(d.hp>0&&d.cooldown>0,id);
    if(d.target!=='none')assert.ok(d.range>0&&(d.damage>0||d.slow),`${id}: it does something when it fires`);
  }
  assert.deepEqual([TIER_COST[1],TIER_COST[2],TIER_COST[3],TIER_COST[4],TIER_COST[5],GUSTAVAO_COST,RAIL.cost],[6,10,16,24,36,60,12]);
  assert.equal(DEFENSE_LIMIT,12);assert.equal(ROOT_DEFENSE,'vigia-do-predio');
  assert.equal(DEFENSES.gustavao.rail,true);assert.equal(DEFENSES['antiaerea-quadrupla'].hits,'air');
  for(const id of ['rojao-de-festa','morteiro','lanca-foguetes','obuseiro','gustavao','arame-e-sirene'] as DefenseId[])assert.equal(DEFENSES[id].hits,'ground',id);
  assert.ok(DEFENSES.gustavao.cooldown>=ticks(15)&&DEFENSES.gustavao.area>=5,'the Gustavão fires rarely, with a huge area');
  assert.equal(isFlying(enemy('p',0,0,{kind:'pombos'})),true);
  assert.deepEqual(Object.values(ENEMIES).filter(e=>e.flying).map(e=>e.id),['pombos'],'the pombos are the flyers today');
});

test('catalog: branch picks (root A/B/C, A3 → A4 or the alternative A4b, single children by default)',()=>{
  assert.deepEqual(childrenOf('vigia-do-predio').map(d=>d.label),['A2','B2','C2']);
  assert.equal(pickChild('vigia-do-predio'),undefined,'the root needs a branch');
  assert.equal(pickChild('vigia-do-predio','B')?.id,'rojao-de-festa');
  assert.equal(pickChild('vigia-do-predio','C2')?.id,'holofote');
  assert.equal(pickChild('vigia-do-predio','X'),undefined);
  assert.deepEqual(childrenOf('atiradores-do-telhado').map(d=>d.label),['A4','A4b'],'main line first');
  assert.equal(pickChild('atiradores-do-telhado'),undefined,'A3 forks: a branch is needed');
  assert.equal(pickChild('atiradores-do-telhado','A')?.id,'ninho-de-metralhadora','the letter takes the main line');
  assert.equal(pickChild('atiradores-do-telhado','A4b')?.id,'ninho-do-sniper');
  assert.equal(pickChild('atiradores-do-telhado','ninho-do-sniper')?.id,'ninho-do-sniper');
  assert.equal(pickChild('ninho-do-sniper')?.id,'equipe-antimaterial');
  assert.equal(pickChild('ninho-de-metralhadora','A5b'),undefined,'A5b only after A4b');
  assert.equal(pickChild('obuseiro')?.id,'gustavao');
  assert.deepEqual(childrenOf('posto-de-radar'),[]);assert.deepEqual(childrenOf('gustavao'),[]);
});

test('catalog: obra thirds, pronta, danificada at ≤ 50 %, ruina; payment from the larger pile',()=>{
  const d={hp:100,maxHp:100,startTick:0,readyTick:120};
  assert.deepEqual([0,39,40,79,80,119,120].map(t=>phaseOf(d,t)),['obra-1','obra-1','obra-2','obra-2','obra-3','obra-3','pronta']);
  assert.equal(phaseOf({...d,hp:100*DAMAGED_AT},200),'danificada');
  assert.equal(phaseOf({...d,hp:51},200),'pronta');
  assert.equal(phaseOf({...d,hp:0,ruined:true},200),'ruina');
  const b={coco:10,pedra:2};
  assert.equal(payUnits(b,6),true);assert.deepEqual(b,{coco:4,pedra:2},'drains the larger pile first');
  assert.equal(payUnits(b,5),true);assert.deepEqual(b,{coco:0,pedra:1},'gap 2, then the rest split (coco takes the odd unit)');
  assert.equal(payUnits(b,2),false);assert.deepEqual(b,{coco:0,pedra:1},'not enough: nothing charged');
  const c={coco:3,pedra:9};assert.equal(payUnits(c,12),true);assert.deepEqual(c,{coco:0,pedra:0});
});

// ---------- 2. Build sites ----------
test('sites: the city plan and the endless camp are valid (E1 validator), the island has none',()=>{
  const plan=buildPlanFor(city);
  assert.equal(plan,buildPlanFor(city.fork()),'the same plan on a room fork');
  assert.ok(plan.sites.length>=12&&plan.sites.length<=16);assert.ok(plan.rail,'the city has the rail');
  assert.deepEqual(validateBuildPlan(plan,city),[]);
  assert.ok(plan.sites.every(s=>s.maxSize>=DEFENSES[ROOT_DEFENSE].size!),'every site can hold the root');
  assert.deepEqual(buildPlanFor(defaultTerrain).sites,[]);assert.equal(buildPlanFor(defaultTerrain).rail,null);
  assert.deepEqual(buildPlanFor(undefined).sites,[]);
  for(const seed of [7,4242]){
    const t=new TerrainField(seed,{world:'infinito'}),p=buildPlanFor(t);
    assert.equal(p,buildPlanFor(t),'cached per terrain object');
    assert.ok(p.sites.length>0);assert.equal(p.rail,null,'no Gustavão on the endless map');
    assert.deepEqual(validateBuildPlan(p,t),[]);
  }
});

// ---------- 3. Commands ----------
test('build: intermission only, standing player, free site, balance, limit 12, request ids; ruins free their site',()=>{
  const {ctx,sys}=citySetup(6+5);
  at(ctx,10,'wave');
  assert.deepEqual(sys.build(ctx,'a','obra-01'),{ok:false,reason:'phase'});
  at(ctx,10);
  assert.deepEqual(sys.build(ctx,'zz','obra-01'),{ok:false,reason:'player'});
  (ctx.players.get('b') as SimPlayer).downed=true;
  assert.deepEqual(sys.build(ctx,'b','obra-01'),{ok:false,reason:'player'},'a downed player cannot build');
  assert.deepEqual(sys.build(ctx,'a','obra-99'),{ok:false,reason:'site'});
  assert.equal('defenses' in sys.state,false,'refusals create no state');
  const first=sys.build(ctx,'a','obra-01','r1');
  assert.deepEqual(first,{ok:true,defense:'defesa-1',kind:'vigia-do-predio',cost:6});
  assert.deepEqual(sys.state.balance,{coco:2,pedra:3},'6 units from the larger pile first (5/6 → 2/3)');
  assert.deepEqual(sys.build(ctx,'a','obra-02','r1'),{ok:false,reason:'duplicate'},'a resent command applies once');
  assert.deepEqual(sys.build(ctx,'a','obra-01'),{ok:false,reason:'occupied'});
  assert.deepEqual(sys.build(ctx,'a','obra-02'),{ok:false,reason:'balance'});
  assert.deepEqual(sys.state.balance,{coco:2,pedra:3},'nothing charged on a refusal');
  // Limit: 12 standing, ruins do not count and their site can be built again.
  sys.state.balance.coco=500;
  for(let i=2;i<=12;i++)assert.equal(sys.build(ctx,'a',`obra-${String(i).padStart(2,'0')}`).ok,true,`site ${i}`);
  assert.deepEqual(sys.build(ctx,'a','obra-13'),{ok:false,reason:'limit'});
  sys.hit(ctx,'defesa-3',1e6);
  assert.equal(sys.state.defenses!.list.find(d=>d.id==='defesa-3')!.ruined,true);
  assert.equal(sys.build(ctx,'a','obra-13').ok,true,'a ruin frees a slot of the limit');
  assert.deepEqual(sys.build(ctx,'a','obra-14'),{ok:false,reason:'limit'});
  const rebuilt=sys.build(ctx,'a','obra-03');
  assert.deepEqual(rebuilt,{ok:false,reason:'limit'},'still 12 standing');
  sys.hit(ctx,'defesa-4',1e6);
  const again=sys.build(ctx,'a','obra-03');
  assert.ok(again.ok,'the ruined site is built again');
  assert.equal(sys.state.defenses!.list.filter(d=>d.site==='obra-03').length,1,'the new obra clears the ruin');
  sys.state.wallDown=true;
  assert.deepEqual(sys.build(ctx,'a','obra-14'),{ok:false,reason:'wall-down'});
});

test('upgrade: ready only, branch at the root and at A3, site size, max tier',()=>{
  const {ctx,sys}=citySetup();
  const small=sys.plan.sites.find(x=>x.maxSize===2)!,big=sys.plan.sites.filter(x=>x.maxSize===3);
  const b=sys.build(ctx,'a',small.id);assert.ok(b.ok);
  const id=(b as {defense:string}).defense,d=()=>sys.state.defenses!.list.find(x=>x.id===id)!;
  assert.deepEqual(sys.upgrade(ctx,'a',id,'A'),{ok:false,reason:'building'},'not while the obra runs');
  at(ctx,d().readyTick);
  assert.deepEqual(sys.upgrade(ctx,'a',id),{ok:false,reason:'branch'},'the root needs a branch');
  assert.deepEqual(sys.upgrade(ctx,'a','defesa-99','A'),{ok:false,reason:'defense'});
  at(ctx,d().readyTick,'wave');
  assert.deepEqual(sys.upgrade(ctx,'a',id,'A'),{ok:false,reason:'phase'});
  at(ctx,d().readyTick);
  const before=sys.state.balance.coco+sys.state.balance.pedra;
  assert.deepEqual(sys.upgrade(ctx,'a',id,'A'),{ok:true,defense:id,kind:'vigias-armados',cost:10});
  assert.equal(before-(sys.state.balance.coco+sys.state.balance.pedra),10);
  assert.equal(d().hp,DEFENSES['vigias-armados'].hp,'the new tier at full hp');
  assert.equal(defensePhase(d(),ctx.tick),'obra-1','an upgrade is a new obra');
  at(ctx,d().readyTick);
  assert.ok(sys.upgrade(ctx,'a',id).ok,'A2 → A3 (single child)');
  at(ctx,d().readyTick);
  assert.deepEqual(sys.upgrade(ctx,'a',id),{ok:false,reason:'branch'},'A3 forks');
  assert.deepEqual(sys.upgrade(ctx,'a',id,'A'),{ok:false,reason:'size'},'a maxSize-2 site cannot hold the 3×3 Ninho de Metralhadora');
  assert.deepEqual(sys.upgrade(ctx,'a',id,'A4b'),{ok:true,defense:id,kind:'ninho-do-sniper',cost:24},'the alternative fits');
  at(ctx,d().readyTick);
  assert.deepEqual(sys.upgrade(ctx,'a',id),{ok:true,defense:id,kind:'equipe-antimaterial',cost:36});
  at(ctx,d().readyTick);
  assert.deepEqual(sys.upgrade(ctx,'a',id),{ok:false,reason:'max'});
  // The main line on a size-3 site, and the C line to its end.
  assert.equal(grow(ctx,sys,big[0].id,['A',undefined,'A',undefined]).kind,'guarnicao-do-predio');
  assert.equal(grow(ctx,sys,big[1].id,['C',undefined,undefined,undefined]).kind,'posto-de-radar');
  // On a 1×1 site (the endless camp's) the root may only become a Rojão or a Holofote.
  const tiny=new TerrainField(7,{world:'infinito'}),tctx=fakeCtx(tiny,[player('a',0,0)]),tsys=createStonewardsSystem({terrain:tiny});
  tsys.state.balance.coco=100;
  const one=tsys.plan.sites.find(x=>x.maxSize===1)!,v=grow(tctx,tsys,one.id);
  assert.deepEqual(tsys.upgrade(tctx,'a',v.id,'A'),{ok:false,reason:'size'});
  assert.equal(tsys.upgrade(tctx,'a',v.id,'C').ok,true);
  // A ruin cannot evolve.
  const r=grow(ctx,sys,big[2].id);sys.hit(ctx,r.id,1e6);
  assert.deepEqual(sys.upgrade(ctx,'a',r.id,'B'),{ok:false,reason:'ruined'});
});

test('the Gustavão: needs the laid, finished rail, moves onto it, frees its site, one per run',()=>{
  const {ctx,sys}=citySetup(2000);
  const big=sys.plan.sites.filter(x=>x.maxSize===3);
  const howitzer=grow(ctx,sys,big[0].id,['B',undefined,undefined,undefined]);
  assert.equal(howitzer.kind,'obuseiro');
  assert.deepEqual(sys.upgrade(ctx,'a',howitzer.id),{ok:false,reason:'rail'},'no rail yet');
  const units=()=>sys.state.balance.coco+sys.state.balance.pedra,u0=units();
  assert.deepEqual(sys.build(ctx,'a','trilho'),{ok:true,defense:'trilho',kind:'linha-ferrea',cost:12});
  assert.equal(u0-units(),12);
  assert.deepEqual(sys.build(ctx,'a','trilho'),{ok:false,reason:'occupied'},'one rail');
  assert.deepEqual(sys.upgrade(ctx,'a',howitzer.id),{ok:false,reason:'rail'},'the rail is still being laid');
  at(ctx,sys.state.defenses!.rail!.readyTick);
  const u1=units();
  assert.deepEqual(sys.upgrade(ctx,'a',howitzer.id),{ok:true,defense:howitzer.id,kind:'gustavao',cost:60});
  assert.equal(u1-units(),60);
  const g=sys.state.defenses!.list.find(d=>d.id===howitzer.id)!,rail=sys.plan.rail!;
  assert.deepEqual({site:g.site,x:g.x,y:g.y},{site:'trilho',x:rail.x,y:rail.y});
  assert.equal(sys.build(ctx,'a',big[0].id).ok,true,'its site is free again');
  const second=grow(ctx,sys,big[1].id,['B',undefined,undefined,undefined]);
  assert.deepEqual(sys.upgrade(ctx,'a',second.id),{ok:false,reason:'unique'});
  sys.hit(ctx,g.id,1e6);
  assert.deepEqual(sys.upgrade(ctx,'a',second.id),{ok:false,reason:'unique'},'a ruined Gustavão still counts');
  // The endless map has no rail: no Gustavão there.
  const t=new TerrainField(7,{world:'infinito'}),ectx=fakeCtx(t,[player('a',0,0)]),esys=createStonewardsSystem({terrain:t});
  esys.state.balance.coco=1000;
  const site=esys.plan.sites.find(s=>s.maxSize===3)!;
  const e=grow(ectx,esys,site.id,['B',undefined,undefined,undefined]);
  assert.deepEqual(esys.build(ectx,'a','trilho'),{ok:false,reason:'site'});
  assert.deepEqual(esys.upgrade(ectx,'a',e.id),{ok:false,reason:'rail'});
});

// ---------- 4. Life and the single damage path ----------
test('life: obra → pronta → danificada → ruina through the structures system hit (D-017); siege target; prizes avoid it',()=>{
  const {ctx,sys}=citySetup();
  const b=sys.build(ctx,'a','obra-05') as {defense:string};
  const d=sys.state.defenses!.list[0],span=d.readyTick-d.startTick;
  assert.equal(span,ticks(TIER_BUILD_SECONDS[1]));
  assert.deepEqual([0,span/3,2*span/3,span].map(k=>defensePhase(d,d.startTick+Math.floor(k))),['obra-1','obra-2','obra-3','pronta']);
  const target=structureTargets(sys.state).find(s=>s.id===b.defense);
  assert.deepEqual(target,{id:b.defense,x:d.x,y:d.y,radius:.88/2},'a non-blocking siege target of its footprint (the root: 1 cell)');
  assert.ok(prizeBlocks(sys.state).some(p=>p.x===d.x&&p.y===d.y));
  at(ctx,d.readyTick);
  sys.hit(ctx,b.defense,d.maxHp*.5);
  assert.equal(defensePhase(d,ctx.tick),'danificada');
  sys.hit(ctx,b.defense,1e6);
  assert.equal(defensePhase(d,ctx.tick),'ruina');assert.equal(d.hp,0);
  assert.equal(structureTargets(sys.state).some(s=>s.id===b.defense),false,'a ruin is no target');
  const hp=sys.state.wall.hp;sys.hit(ctx,'muralha',5);assert.equal(sys.state.wall.hp,hp-5,'the wall still takes its hits');
  sys.hit(ctx,'barricada-N',5);assert.equal(sys.state.barricades!.find(x=>x.id==='barricada-N')!.hp,295,'and the barricades');
});

// ---------- 5. Combat ----------
/** A ready defense of `kind` at the city site obra-02 (maxSize 3), in a wave. */
function armed(kind:DefenseId,path:(string|undefined)[]){
  const {ctx,sys}=citySetup(3000);
  const d=grow(ctx,sys,'obra-02',path);
  assert.equal(d.kind,kind);
  at(ctx,d.readyTick,'wave');
  return {ctx,sys,d};
}
const dmg=(ctx:FakeCtx,id?:string)=>ctx.events.filter(e=>e.type==='damage'&&(id===undefined||e.target===id)) as Extract<SimEvent,{type:'damage'}>[];

test('combat: the Vigia hits the nearest in range on its cooldown, not while building nor in the intermission',()=>{
  const {ctx,sys,d}=armed('vigia-do-predio',[]);
  ctx.enemies.set('e1',enemy('e1',d.x+3,d.y,{hp:100,maxHp:100}));
  ctx.enemies.set('e2',enemy('e2',d.x+5,d.y));
  ctx.enemies.set('far',enemy('far',d.x+6.5,d.y));
  at(ctx,d.readyTick,'prepare');defensesStep(ctx,sys.state);
  assert.equal(dmg(ctx).length,0,'no fire in the intermission');
  at(ctx,d.readyTick,'wave');defensesStep(ctx,sys.state);
  assert.deepEqual(dmg(ctx).map(e=>[e.target,e.amount,e.weapon]),[['e1',8,'vigia-do-predio']]);
  ctx.tick++;defensesStep(ctx,sys.state);assert.equal(dmg(ctx).length,1,'cooldown');
  ctx.tick=d.readyTick+DEFENSES['vigia-do-predio'].cooldown;defensesStep(ctx,sys.state);assert.equal(dmg(ctx).length,2);
  assert.equal(dmg(ctx,'far').length,0,'out of range');
  // Under construction: silent.
  const u=sys.upgrade({...ctx,round:{...ctx.round,phase:'prepare'}} as FakeCtx,'a',d.id,'A');assert.ok(u.ok);
  const n=dmg(ctx).length;ctx.tick+=ticks(1);defensesStep(ctx,sys.state);
  assert.equal(dmg(ctx).length,n,'an obra does not fire');
});

test('combat: A shoots several targets; the sniper picks the strongest',()=>{
  const {ctx,sys}=armed('atiradores-do-telhado',['A',undefined]);
  const d0=sys.state.defenses!.list[0];
  for(let i=0;i<5;i++)ctx.enemies.set(`e${i}`,enemy(`e${i}`,d0.x+1+i,d0.y,{hp:200,maxHp:200}));
  defensesStep(ctx,sys.state);
  assert.deepEqual(dmg(ctx).map(e=>e.target),['e0','e1','e2'],'three shooters, three nearest');
  const s=armed('ninho-do-sniper',['A',undefined,'A4b']);
  s.ctx.enemies.set('small',enemy('small',s.d.x+1,s.d.y,{hp:30}));s.ctx.enemies.set('big',enemy('big',s.d.x+10,s.d.y,{hp:250,maxHp:250}));
  defensesStep(s.ctx,s.sys.state);
  assert.deepEqual(dmg(s.ctx).map(e=>[e.target,e.amount]),[['big',70]]);
});

test('combat: B explodes over an area of ground enemies, never the flyers, and not at its own feet',()=>{
  const {ctx,sys,d}=armed('morteiro',['B',undefined]);
  ctx.enemies.set('near',enemy('near',d.x+1,d.y,{hp:500}));
  ctx.enemies.set('a',enemy('a',d.x+5,d.y,{hp:500}));ctx.enemies.set('b',enemy('b',d.x+5.5,d.y+.5,{hp:500}));ctx.enemies.set('c',enemy('c',d.x+6,d.y-.5,{hp:500}));
  ctx.enemies.set('bird',enemy('bird',d.x+5.2,d.y,{kind:'pombos',hp:500}));
  defensesStep(ctx,sys.state);
  assert.deepEqual(dmg(ctx).map(e=>e.target).sort(),['a','b','c'],'the cluster, all in the blast; the bird untouched; the one at its feet (minRange) too');
  assert.ok(dmg(ctx).every(e=>e.amount===DEFENSES.morteiro.damage));
});

test('combat: C2 slows and dazzles (deterministic), C3 scratches and slows the ground around it, never the boss',()=>{
  const run=()=>{
    const {ctx,sys,d}=armed('holofote',['C']);
    ctx.enemies.set('e',enemy('e',d.x+3,d.y,{hp:1e6}));ctx.enemies.set('boss',enemy('boss',d.x+3.5,d.y,{hp:1e6,boss:true}));
    const dazzled:number[]=[];
    for(let k=0;k<60;k++){ctx.tick=d.readyTick+k*DEFENSES.holofote.cooldown;const was=ctx.enemies.get('e')!.frozenUntil;defensesStep(ctx,sys.state);if(ctx.enemies.get('e')!.frozenUntil!==was)dazzled.push(k);}
    const e=ctx.enemies.get('e')!,boss=ctx.enemies.get('boss')!;
    assert.ok(e.slowUntil!>ctx.tick,'slowed');assert.equal(dmg(ctx).length,0,'the searchlight does no damage');
    assert.equal(boss.slowUntil,undefined,'the boss is not slowed');assert.equal(boss.frozenUntil,undefined,'nor dazzled');
    return dazzled;
  };
  const a=run();
  assert.ok(a.length>5&&a.length<40,`dazzled in ${a.length} of 60 volleys (chance ${DEFENSES.holofote.dazzle!.chance})`);
  assert.deepEqual(run(),a,'same volleys, same dazzles');
  const {ctx,sys,d}=armed('arame-e-sirene',['C',undefined]);
  ctx.enemies.set('g',enemy('g',d.x+2,d.y));ctx.enemies.set('bird',enemy('bird',d.x+1,d.y,{kind:'pombos'}));ctx.enemies.set('out',enemy('out',d.x+5,d.y));
  defensesStep(ctx,sys.state);
  assert.deepEqual(dmg(ctx).map(e=>[e.target,e.amount]),[['g',5]]);
  assert.ok(ctx.enemies.get('g')!.slowUntil!>ctx.tick);assert.equal(ctx.enemies.get('bird')!.slowUntil,undefined);assert.equal(ctx.enemies.get('out')!.slowUntil,undefined);
});

test('combat: C4 anti-air hits only the flyers; C5 radar gives the defenses around it more range',()=>{
  const {ctx,sys,d}=armed('antiaerea-quadrupla',['C',undefined,undefined]);
  ctx.enemies.set('walker',enemy('walker',d.x+1,d.y));
  for(let i=0;i<5;i++)ctx.enemies.set(`p${i}`,enemy(`p${i}`,d.x+2+i,d.y,{kind:'pombos',hp:6,maxHp:6}));
  defensesStep(ctx,sys.state);
  assert.deepEqual(dmg(ctx).map(e=>e.target),['p0','p1','p2','p3'],'four barrels, four birds');
  assert.equal(dmg(ctx,'walker').length,0);
  // Radar: a Vigia (range 6) next to a radar reaches 6 × 1.3.
  const r=citySetup(3000);
  const radar=grow(r.ctx,r.sys,'obra-02',['C',undefined,undefined,undefined]),guard=grow(r.ctx,r.sys,'obra-03');
  assert.equal(radar.kind,'posto-de-radar');
  assert.ok(Math.hypot(radar.x-guard.x,radar.y-guard.y)<=DEFENSES['posto-de-radar'].radar!.reach);
  at(r.ctx,guard.readyTick,'wave');
  assert.equal(radarBonus(r.sys.state,guard,r.ctx.tick),.3);
  assert.equal(radarBonus(r.sys.state,radar,r.ctx.tick),0,'not its own');
  r.ctx.enemies.set('e',enemy('e',guard.x,guard.y+7.5));
  defensesStep(r.ctx,r.sys.state);
  assert.deepEqual(dmg(r.ctx).map(e=>e.target),['e'],'7.5 u: beyond 6, within 7.8');
  assert.equal(dmg(r.ctx).filter(e=>e.weapon==='posto-de-radar').length,0,'the radar itself does not fire');
});

test('combat: the Gustavão shells the densest crowd across the map, rarely',()=>{
  const {ctx,sys}=citySetup(3000);
  const g0=grow(ctx,sys,'obra-02',['B',undefined,undefined,undefined]);
  sys.build(ctx,'a','trilho');at(ctx,sys.state.defenses!.rail!.readyTick);
  assert.ok(sys.upgrade(ctx,'a',g0.id).ok);
  const g=sys.state.defenses!.list.find(x=>x.id===g0.id)!;at(ctx,g.readyTick,'wave');
  ctx.enemies.set('lone',enemy('lone',g.x+10,g.y,{hp:5000}));
  for(let i=0;i<6;i++)ctx.enemies.set(`c${i}`,enemy(`c${i}`,84+i*.5,80,{hp:5000}));
  defensesStep(ctx,sys.state);
  assert.deepEqual(dmg(ctx).map(e=>e.target).sort(),['c0','c1','c2','c3','c4','c5']);
  assert.ok(dmg(ctx).every(e=>e.amount===600));
  ctx.tick+=DEFENSES.gustavao.cooldown-1;defensesStep(ctx,sys.state);assert.equal(dmg(ctx).length,6,'not again before its long cooldown');
});

// ---------- 6. Determinism, checkpoints, the island ----------
test('determinism: same commands, same state; a JSON checkpoint resumes identically',()=>{
  const script=(sys:StonewardsSystem,ctx:FakeCtx,from=0)=>{
    const out:string[]=[];
    for(let t=from;t<ticks(40);t++){
      ctx.tick=t;ctx.round.phase=t<ticks(20)?'prepare':'wave';
      if(t===2)out.push(JSON.stringify(sys.build(ctx,'a','obra-02')),JSON.stringify(sys.build(ctx,'a','obra-03')));
      if(t===ticks(8))out.push(JSON.stringify(sys.upgrade(ctx,'a','defesa-1','C')),JSON.stringify(sys.upgrade(ctx,'a','defesa-2','B')));
      if(t===ticks(20))for(let i=0;i<8;i++)ctx.enemies.set(`e${i}`,enemy(`e${i}`,72+i*.4,77,{hp:200,maxHp:200}));
      defensesStep(ctx,sys.state);
    }
    return out;
  };
  const a=citySetup(),b=citySetup();
  assert.deepEqual(script(a.sys,a.ctx),script(b.sys,b.ctx));
  assert.deepEqual(JSON.parse(JSON.stringify(a.sys.state)),JSON.parse(JSON.stringify(b.sys.state)));
  assert.deepEqual(a.ctx.events,b.ctx.events);
  assert.ok(a.ctx.events.some(e=>e.type==='damage'),'they fought');
  // Checkpoint at tick 25 s: a restored system goes on exactly like the original.
  const c=citySetup(),d=citySetup();
  const run=(sys:StonewardsSystem,ctx:FakeCtx,until:number,from=0)=>{
    for(let t=from;t<until;t++){
      ctx.tick=t;ctx.round.phase=t<ticks(20)?'prepare':'wave';
      if(t===2){sys.build(ctx,'a','obra-02');sys.build(ctx,'a','obra-03');}
      if(t===ticks(8)){sys.upgrade(ctx,'a','defesa-1','C');sys.upgrade(ctx,'a','defesa-2','B');}
      if(t===ticks(20))for(let i=0;i<8;i++)ctx.enemies.set(`e${i}`,enemy(`e${i}`,72+i*.4,77,{hp:200,maxHp:200}));
      defensesStep(ctx,sys.state);
    }
  };
  run(c.sys,c.ctx,ticks(40));
  run(d.sys,d.ctx,ticks(25));
  const restored=createStonewardsSystem({terrain:d.terrain,barricadesLater:false},JSON.parse(JSON.stringify(d.sys.state)));
  run(restored,d.ctx,ticks(40),ticks(25));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.state)),JSON.parse(JSON.stringify(c.sys.state)));
});

test('the island is untouched: no sites, every build refused, no defenses key, same state as a system that never heard of towers',()=>{
  const ctx=fakeCtx(defaultTerrain,[player('a',12,14)]),sys=createStonewardsSystem({terrain:defaultTerrain}),plain=createStonewardsSystem({terrain:defaultTerrain});
  sys.state.balance.coco=plain.state.balance.coco=50;
  assert.deepEqual(sys.plan.sites,[]);assert.equal(sys.plan.rail,null);
  assert.deepEqual(sys.build(ctx,'a','obra-01'),{ok:false,reason:'site'});
  assert.deepEqual(sys.build(ctx,'a','trilho'),{ok:false,reason:'site'});
  for(let t=1;t<200;t++){ctx.tick=t;sys.step(ctx);}
  const ctx2=fakeCtx(defaultTerrain,[player('a',12,14)]);for(let t=1;t<200;t++){ctx2.tick=t;plain.step(ctx2);}
  assert.equal('defenses' in sys.state,false);
  assert.deepEqual(JSON.stringify(sys.state),JSON.stringify(plain.state));
  assert.deepEqual(structureTargets(sys.state),[{id:'muralha',x:sys.state.wall.x,y:sys.state.wall.y,radius:sys.state.wall.radius}]);
});
