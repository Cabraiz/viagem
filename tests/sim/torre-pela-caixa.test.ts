/**
 * Kits de torre (card NEW-20261020-ORQ-torre-pela-caixa), on the REAL Cidade Nevada:
 *  1. Rules: rarity = tier (verde the Vigia and the wall pieces … lendária tier 5), no Gustavão, the kit ids in the DICT.
 *  2. The crate's draw: a kit of its tier about KIT_CHANCE of the time, else its row; the dourada's old kit-torre is a kit.
 *  3. place: a tier-N kit builds that tower straight away, free (no ficha, no Grana), as an obra of its tier's time;
 *     the kit is spent. Refused (off the ground, far, taken, the limit): the kit stays. A muro kit lays its charges.
 *  4. The bots: a kit in a lull is built on the nearest cell that takes it (placeNear).
 * D-031: results only (state, events), no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks,type EnemyState,type SimPlayer} from '../../src/contract/types.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {DEFENSES,DEFENSE_LIMIT,KIT_CHANCE,KIT_CHARGES,KIT_IDS,KIT_POOL,TIER_BUILD_SECONDS,isKitId,kitId,kitItem,kitPiece,kitRarity} from '../../src/rules/index.ts';
import {FREE_CELL,onGround} from '../../src/sim/towers/free-build.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {rollCrate,rollPrize} from '../../src/sim/crates.ts';
import {planLoot} from '../../src/sim/bot-loot.ts';
import {DICT} from '../../src/protocol/protocol4.ts';
import type {Rarity} from '../../src/sim/weapons/arsenal.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),
  (JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const CAR=placeWall(city);

function player(id:string,x:number,y:number):SimPlayer{
  return {id,x,y,classId:'test',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[{id:'faca',level:1}],passives:[],hand:0},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},grana:0};
}
const centre=(c:number,r:number)=>({x:(c+.5)*FREE_CELL,y:(r+.5)*FREE_CELL});
/** Walkable cells on Chebyshev ring `k` (cells) around the car's cell. */
function ring(k:number):{c:number;r:number}[]{
  const cc=Math.floor(CAR.x/FREE_CELL),cr=Math.floor(CAR.y/FREE_CELL),out:{c:number;r:number}[]=[];
  for(let i=-k;i<k;i++)out.push({c:cc+i,r:cr-k},{c:cc+k,r:cr+i},{c:cc-i,r:cr+k},{c:cc-k,r:cr-i});
  return out.filter(o=>onGround(city,o,1,1));
}
/** A manual-combat chaveiro run on the city with Ana by the car (no grana, no fichas). */
function run(){
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:city.fork(),seed:21,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',combat:'manual'});
  const ana=player('ana',CAR.x+1.5,CAR.y);players.set('ana',ana);
  world.step();
  sys.stonewards.state.balance.units=0;
  return {world,sys,ana,inv:sys.inventory!};
}
/** A free square of `size` cells around ring `k`: every cell walkable. */
function square(k:number,size:number){
  return ring(k).find(o=>onGround(city,o,size,size))!;
}

test('rules: rarity = tier, the wall pieces are verde, no Gustavão; every kit id is in the DICT', ()=>{
  assert.deepEqual([...KIT_POOL[1]].sort(),['barricada','muro','vigia-do-predio']);
  for(const r of [2,3,4,5] as const){
    assert.ok(KIT_POOL[r].length>0);
    for(const p of KIT_POOL[r])assert.equal(DEFENSES[p as keyof typeof DEFENSES].tier,r,`${p} in pool ${r}`);
  }
  assert.ok(!Object.values(KIT_POOL).flat().includes('gustavao' as never),'the Gustavão rides the rail');
  assert.equal(kitRarity('muro'),1);assert.equal(kitRarity('morteiro'),3);assert.equal(kitRarity('obuseiro'),5);
  assert.equal(kitPiece(kitId('morteiro')),'morteiro');assert.equal(kitPiece('pistola'),undefined);assert.equal(isKitId('kit:gustavao'),false);
  assert.deepEqual(kitItem('muro'),{id:'kit:muro',level:KIT_CHARGES.muro});assert.deepEqual(kitItem('holofote'),{id:'kit:holofote',level:1});
  for(const id of KIT_IDS)assert.ok(DICT.includes(id),`${id} in the DICT`);
  assert.ok(DICT.length<255,'255 is the inline escape');
});

test('crate draw: a kit of the crate\'s tier about KIT_CHANCE of the time, else a weapon (pure: same stream, same prize)', ()=>{
  for(const r of [1,2,3,4,5] as Rarity[]){
    let kits=0;const seen=new Set<string>();
    for(let s=0;s<2000;s++){
      const prize=rollCrate(new Rng(s).fork('kit'),r);
      assert.deepEqual(rollCrate(new Rng(s).fork('kit'),r),prize);
      const kit=prize.items.find(i=>isKitId(i.id));
      if(!kit)continue;
      kits++;seen.add(kit.id);
      assert.equal(kitRarity(kitPiece(kit.id)!),r,`${kit.id} from a ${r}`);
    }
    // bau-so-arma-ou-torre: KIT_CHANCE is the whole kit share (the dourada's own kit row is gone).
    const want=KIT_CHANCE;
    assert.ok(Math.abs(kits/2000-want)<.04,`${r}: ${kits}/2000`);
    assert.deepEqual([...seen].sort(),KIT_POOL[r].map(kitId).sort(),`every kit of tier ${r} shows up`);
  }
  for(let s=0;s<500;s++)assert.ok(!rollPrize(new Rng(s).fork('d'),4).items.some(i=>i.id==='kit-torre'),'no ficha kit from the dourada');
});

test('place: a tier-N kit builds that tower straight away, free, as an obra of its tier; the kit is spent', ()=>{
  const {world,sys,ana,inv}=run();
  const at=square(5,DEFENSES.morteiro.size!);
  ana.x=centre(at.c,at.r).x+FREE_CELL*3;ana.y=centre(at.c,at.r).y;
  ana.build.weapons.push(kitItem('morteiro'));
  const slot=ana.build.weapons.length-1,grana=ana.grana,units=sys.stonewards.state.balance.units;
  const ok=inv.place('ana',slot,{c:at.c,r:at.r},'k1');
  assert.equal(ok.ok,true,JSON.stringify(ok));
  const d=sys.stonewards.state.defenses!.list.find(x=>x.id===(ok as {defense:string}).defense)!;
  assert.equal(d.kind,'morteiro','built straight at tier 3');
  assert.deepEqual(d.cell,at);assert.equal(d.hp,DEFENSES.morteiro.hp);
  assert.equal(d.readyTick-d.startTick,ticks(TIER_BUILD_SECONDS[3]),'an obra of its tier');
  assert.equal(ana.grana,grana);assert.equal(sys.stonewards.state.balance.units,units,'no Grana, no ficha');
  assert.ok(!ana.build.weapons.some(i=>isKitId(i.id)),'the kit is spent');
  assert.equal(ana.build.hand,0,'the hand keeps its weapon');
  // The same request again: a duplicate, nothing built.
  ana.build.weapons.push(kitItem('morteiro'));
  assert.deepEqual(inv.place('ana',ana.build.weapons.length-1,{c:at.c,r:at.r},'k1'),{ok:false,reason:'duplicate'});
  assert.equal(ana.build.weapons.filter(i=>isKitId(i.id)).length,1,'a refused place keeps the kit');
  while(world.tick<d.readyTick)world.step();
  assert.equal(sys.stonewards.state.defenses!.list.find(x=>x.id===d.id)?.ruined,undefined);
});

test('place refused: the kit stays (taken, off the ground, too far, not a kit, the limit)', ()=>{
  const {sys,ana,inv}=run();
  const at=square(5,1);
  ana.x=centre(at.c,at.r).x+FREE_CELL*1.5;ana.y=centre(at.c,at.r).y;
  ana.build.weapons.push(kitItem('vigia-do-predio'),kitItem('holofote'));
  const v=ana.build.weapons.length-2;
  assert.equal(inv.place('ana',v,{c:at.c,r:at.r},'a').ok,true);
  const h=ana.build.weapons.findIndex(i=>i.id==='kit:holofote');
  assert.deepEqual(inv.place('ana',h,{c:at.c,r:at.r},'b'),{ok:false,reason:'ocupado'});
  assert.deepEqual(inv.place('ana',h,{c:-1,r:0},'c'),{ok:false,reason:'fora'});
  const far=ring(12).find(o=>onGround(city,o,1,1))!;
  assert.deepEqual(inv.place('ana',h,far,'d'),{ok:false,reason:'away'});
  assert.deepEqual(inv.place('ana',0,{c:at.c,r:at.r},'e'),{ok:false,reason:'not-kit'},'the faca is no kit');
  assert.deepEqual(inv.place('ana',5,{c:at.c,r:at.r},'f'),{ok:false,reason:'slot'});
  // DEFENSE_LIMIT standing towers: the next kit is refused 'limite'.
  const list=sys.stonewards.state.defenses!.list,model=list[0];
  while(list.length<DEFENSE_LIMIT)list.push({...model,id:`fake-${list.length}`,cell:{c:-100-list.length,r:-100}});
  const spot=ring(6).find(o=>onGround(city,o,1,1))!;
  ana.x=centre(spot.c,spot.r).x+FREE_CELL*1.5;ana.y=centre(spot.c,spot.r).y;
  assert.deepEqual(inv.place('ana',h,spot,'g'),{ok:false,reason:'limite'});
  assert.ok(ana.build.weapons.some(i=>i.id==='kit:holofote'),'every refusal kept the kit');
});

test('a muro kit lays its charges one by one, then leaves the slot', ()=>{
  const {sys,ana,inv}=run();
  ana.build.weapons.push(kitItem('muro'));
  const slot=ana.build.weapons.length-1,cells=ring(7);
  let laid=0;
  for(const [i,o] of cells.entries()){
    if(laid>=KIT_CHARGES.muro)break;
    ana.x=centre(o.c,o.r).x;ana.y=centre(o.c,o.r).y;
    const r=inv.place('ana',slot,o,`m${i}`);
    if(r.ok)laid++;
    else assert.ok(r.reason==='tranca'||r.reason==='ocupado',JSON.stringify(r));
    if(laid<KIT_CHARGES.muro)assert.equal(ana.build.weapons[slot]?.level,KIT_CHARGES.muro-laid);
  }
  assert.equal(laid,KIT_CHARGES.muro);
  assert.equal(sys.stonewards.state.defenses!.pieces!.filter(p=>p.kind==='muro').length,KIT_CHARGES.muro);
  assert.ok(!ana.build.weapons.some(i=>isKitId(i.id)),'the empty kit left the slot');
  assert.equal(ana.grana,0,'the muros were free');
});

test('bots: a kit in a lull is built on the nearest cell around the hero that takes it', ()=>{
  const {sys,ana,inv}=run();
  const at=square(6,1);ana.x=centre(at.c,at.r).x;ana.y=centre(at.c,at.r).y;
  ana.build.weapons.push(kitItem('rojao-de-festa'));
  const me={...ana,weapons:ana.build.weapons,hand:0,maxHp:ana.stats.maxHp} as never;
  assert.deepEqual(planLoot({players:[me],pickups:[],enemies:[]},me,ana).command,{t:'kit',slot:1});
  assert.equal(planLoot({players:[me],pickups:[],enemies:[{id:'e',x:ana.x+1,y:ana.y,hp:5} as never]},me,ana).command,undefined,'not with a critter near');
  const r=inv.placeNear('ana',1);
  assert.equal(r.ok,true,JSON.stringify(r));
  const d=sys.stonewards.state.defenses!.list.find(x=>x.kind==='rojao-de-festa')!;
  const cell={c:Math.floor(ana.x/FREE_CELL),r:Math.floor(ana.y/FREE_CELL)};
  assert.ok(Math.max(Math.abs(d.cell!.c-cell.c),Math.abs(d.cell!.r-cell.r))<=2,'next to the bot');
  assert.ok(!(d.cell!.c===cell.c&&d.cell!.r===cell.r),'never on its own cell');
  assert.ok(!ana.build.weapons.some(i=>isKitId(i.id)));
});
