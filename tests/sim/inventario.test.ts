// D-051 inventory (NEW-20261014-ORQ-armas-caixas-inventario, proposal §3): the manual combat's 6 slots on a real
// Simulation. Everyone starts with the Faca de Pão in the hand; equip / use / drop / take; items walked over; the
// level cards are passives only; the hand's weapon is the one that fires.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {dropItem,SWAP_TICKS,INVENTORY_SLOTS} from '../../src/sim/inventory.ts';
import {ITEMS,MANUAL_ITEMS} from '../../src/sim/items.ts';
import {weaponNoise,NEW_WEAPONS,legendaryId,RARITY_DAMAGE} from '../../src/sim/weapons/arsenal.ts';
import {getWeapon,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {BASE_STATS} from '../../src/contract/index.ts';
import {UNITS_PER_TOKEN} from '../../src/rules/index.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

function manual(players=1){
  const s=new Simulation(7,{combat:'manual'});
  for(let i=0;i<players;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
  s.resetRun();
  let now=1000;
  const step=(n=1)=>{for(let i=0;i<n;i++)s.step(now+=50);};
  step();
  return {s,step,p:(id='p0')=>s.players.get(id)!,world:(s as unknown as {world:Parameters<typeof dropItem>[0]}).world};
}

test('everyone starts the manual combat with the Faca de Pão in the hand; the automatic game is untouched',()=>{
  const {p}=manual(2);
  for(const id of ['p0','p1']){assert.deepEqual(p(id).build.weapons,[{id:'faca',level:1}]);assert.equal(p(id).build.hand,0);}
  const auto=new Simulation(7,{});auto.add('a','A','cidadao-comum');auto.resetRun();auto.step(1050);
  assert.equal(auto.players.get('a')!.build.hand,undefined,'no inventory with the automatic weapons');
  assert.notEqual(auto.players.get('a')!.build.weapons[0].id,'faca');
  assert.equal(auto.inventory('a',{t:'equip',slot:0}).ok,false);
});

test('items walked over go to a free slot; consumables stack to 3; a full inventory leaves them on the ground',()=>{
  const {s,step,p,world}=manual();
  const me=p();
  dropItem(world,me,{id:'pistola',level:2});step();
  assert.deepEqual(me.build.weapons.map(i=>i.id),['faca','pistola']);assert.equal(me.build.hand,0,'picking up does not change the hand');
  dropItem(world,me,{id:'coxinha',level:2});step();dropItem(world,me,{id:'coxinha',level:2});step();
  assert.deepEqual(me.build.weapons.filter(i=>i.id==='coxinha').map(i=>i.level),[3,1],'3 in a slot, the rest in another');
  for(const id of ['brigadeiro','pacoca'])dropItem(world,me,{id,level:1});
  step();
  assert.equal(me.build.weapons.length,INVENTORY_SLOTS);
  const left=dropItem(world,me,{id:'rifle',level:3});step();
  assert.ok(world.pickups.has(left.id),'full: the rifle stays on the ground');
  // "Trocar": the rifle takes the hand's slot, the faca lands where the rifle was.
  assert.equal(s.inventory('p0',{t:'take',pickup:left.id}).ok,true);
  assert.equal(me.build.weapons[me.build.hand!].id,'rifle');
  assert.ok([...world.pickups.values()].some(x=>x.kind==='item'&&x.resource==='faca'),'the faca on the ground');
});

test('equip puts a weapon in the hand (a short swap), and only the hand fires',()=>{
  const {s,step,p,world}=manual();
  const me=p();
  dropItem(world,me,{id:'pistola',level:1});step();
  assert.equal(s.inventory('p0',{t:'equip',slot:1}).ok,true);
  assert.equal(me.build.hand,1);
  assert.ok((me.weaponReady.pistola??0)>=s.tick+SWAP_TICKS-1,'no shot during the swap');
  assert.equal(s.inventory('p0',{t:'equip',slot:5}).ok,false);
  dropItem(world,me,{id:'coxinha',level:1});step();
  assert.deepEqual(s.inventory('p0',{t:'equip',slot:2}),{ok:false,reason:'not-weapon'});
});

test('use: coxinha heals, the doces are the Dona Cida buffs, the kit de torre is a team ficha; one leaves the stack',()=>{
  const {s,step,p,world}=manual();
  const me=p();
  for(const id of ['coxinha','brigadeiro','kit-torre'])dropItem(world,me,{id,level:1});
  dropItem(world,me,{id:'coxinha',level:1});
  step();
  assert.deepEqual(s.inventory('p0',{t:'use',slot:1}),{ok:false,reason:'unusable'},'full hp: the coxinha is kept');
  me.hp=50;
  assert.equal(s.inventory('p0',{t:'use',slot:1}).ok,true);assert.equal(me.hp,80);
  assert.equal(me.build.weapons[1].level,1,'one of two eaten');
  const slot=me.build.weapons.findIndex(i=>i.id==='brigadeiro');
  assert.equal(s.inventory('p0',{t:'use',slot}).ok,true);assert.ok((me.fastUntil??0)>s.tick);
  assert.equal(me.build.weapons.some(i=>i.id==='brigadeiro'),false,'the last one leaves the slot');
  const units=(s as any).systems.stonewards.state.balance.units;
  assert.equal(s.inventory('p0',{t:'use',slot:me.build.weapons.findIndex(i=>i.id==='kit-torre')}).ok,true);
  assert.equal((s as any).systems.stonewards.state.balance.units,units+UNITS_PER_TOKEN);
  assert.deepEqual(s.inventory('p0',{t:'use',slot:0}),{ok:false,reason:'not-consumable'});
});

test('drop: the item goes to the ground for anyone; the last weapon stays in the hand',()=>{
  const {s,step,p,world}=manual(2);
  const me=p();
  assert.deepEqual(s.inventory('p0',{t:'drop',slot:0}),{ok:false,reason:'last-weapon'});
  dropItem(world,me,{id:'escopeta',level:2});step();
  me.x+=3;
  assert.equal(s.inventory('p0',{t:'drop',slot:1}).ok,true);
  const ground=[...world.pickups.values()].find(x=>x.kind==='item'&&x.resource==='escopeta')!;
  assert.ok(ground);assert.equal(ground.value,2,'the rarity goes with it');
  step(20);
  assert.ok(world.pickups.has(ground.id),'standing on it, the one who dropped it does not take it back');
  const friend=p('p1');friend.x=ground.x;friend.y=ground.y;step();
  assert.ok(friend.build.weapons.some(i=>i.id==='escopeta'&&i.level===2),'the friend picked it up');
});

test('the level cards of the manual combat are passives (the reinforcements included); the automatic ones never see the arsenal',()=>{
  const ids=MANUAL_ITEMS.all().map(d=>d.id);
  assert.ok(ids.every(id=>MANUAL_ITEMS.get(id)!.kind==='passive'),'no weapon card');
  assert.ok(ids.includes('pente')&&ids.includes('silenciador'));
  const auto=ITEMS.all().map(d=>d.id);
  for(const id of ['faca','rojao','pente','silenciador',legendaryId('chinelo'),'coxinha'])assert.equal(auto.includes(id),false,id);
  assert.ok(ITEMS.get('rojao')&&ITEMS.get('coxinha'),'the HUD still finds their names');
});

test('rarity is the weapon level: the dourada hits 1.5× the verde; legendaries are the old weapons at their best; the silenciador quiets',()=>{
  const verde=resolveWeapon(getWeapon('pistola')!,1,BASE_STATS),dourada=resolveWeapon(getWeapon('pistola')!,4,BASE_STATS);
  assert.equal(dourada.damage,Math.round(verde.damage*RARITY_DAMAGE[4]*10)/10);
  assert.ok(dourada.cooldownTicks<verde.cooldownTicks);
  assert.equal(getWeapon(legendaryId('chinelo'))!.evolved?.flingOnCycle,true,'the Havaianas do Caos');
  for(const w of NEW_WEAPONS)assert.ok(w.minRarity>=1&&w.levels.length===4,w.id);
  assert.equal(weaponNoise('faca'),0);assert.equal(weaponNoise('rojao'),10);
  assert.equal(weaponNoise('rojao',[{id:'silenciador',level:2}]),5);
});

test('city, manual combat: the crates stand on the loot points; standing by one fills the inventory; the view carries the hand',async()=>{
  const {readFileSync}=await import('node:fs');const {fileURLToPath}=await import('node:url');const {cityTerrainFrom}=await import('../../src/maps/city/terrain.ts');
  const root=(p:string)=>fileURLToPath(new URL(`../../${p}`,import.meta.url));
  const loaded=await cityTerrainFrom(readFileSync(root('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(root('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
  if(!loaded.ok)throw new Error(loaded.error);
  const s=new Simulation(11,{world:'cidade',terrain:loaded.terrain,cityStructures:true,combat:'manual'});
  s.add('p0','Ana','cidadao-comum');s.resetRun();
  let now=1000;s.step(now+=50);
  const crates=s.view('p0').pickups.filter(k=>k.kind==='chest');
  assert.equal(crates.length,12,'MAX_CRATES on the map');
  assert.ok(crates.every(k=>k.value>=1&&k.value<=4),'placed ones verde..dourada (lendária only drops)');
  const me=s.players.get('p0')!,crate=crates.sort((a,b)=>a.value-b.value)[0];
  for(let i=0;i<80&&s.view('p0').pickups.some(k=>k.id===crate.id);i++){me.x=crate.x+.5;me.y=crate.y;me.hp=me.stats.maxHp;s.step(now+=50);}
  assert.equal(s.view('p0').pickups.some(k=>k.id===crate.id),false,'opened by standing next to it');
  const got=me.build.weapons.length>1||s.view('p0').pickups.some(k=>k.kind==='item')||(s as any).systems.stonewards.state.grana>0;
  assert.ok(got,'a prize came out');
  assert.equal(s.view('p0').players[0].hand,me.build.hand);
});

test('a manual city checkpoint keeps the inventories (repeats, the hand) and the crates, and plays on like the original',async()=>{
  const {readFileSync}=await import('node:fs');const {fileURLToPath}=await import('node:url');const {cityTerrainFrom}=await import('../../src/maps/city/terrain.ts');
  const {RoomBots}=await import('../../multiplayer/room-bots.ts');const {stateHash}=await import('../../src/sim/core.ts');
  const root=(p:string)=>fileURLToPath(new URL(`../../${p}`,import.meta.url));
  const loaded=await cityTerrainFrom(readFileSync(root('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(root('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
  if(!loaded.ok)throw new Error(loaded.error);
  const make=()=>{const s=new Simulation(11,{world:'cidade',terrain:loaded.terrain,cityStructures:true,combat:'manual'});for(const id of ['bot-1','bot-2'])s.addBot(id,id,'cidadao-comum');return s;};
  const sim=make(),bots=new RoomBots();bots.add('bot-1',0);bots.add('bot-2',1);sim.botState=()=>bots.state();sim.resetRun();bots.reset();
  for(let i=0,before=0;i<20*60*8;i++){
    bots.think(sim);sim.step(sim.tick*50);
    if(sim.world.round.index!==before&&sim.world.round.index===2)break;
    before=sim.world.round.index;
  }
  assert.equal(sim.world.round.phase,'prepare');
  const p=sim.players.get('bot-1')!;
  p.build.weapons=[{id:'faca',level:1},{id:'pistola',level:1},{id:'pistola',level:3},{id:'coxinha',level:3},{id:'coxinha',level:1}];p.build.hand=2;
  const json=JSON.stringify(sim.checkpoint());
  const fresh=make();
  assert.equal(fresh.resume(JSON.parse(json)),true,'the inventory and the crates resume');
  assert.deepEqual(fresh.players.get('bot-1')!.build,p.build);
  assert.ok((fresh.run.state() as {crates?:unknown}).crates,'the crates come back');
  assert.equal(stateHash(fresh.run.state()),stateHash(sim.run.state()));
  // A bad hand is refused (the room then starts the round fresh).
  const bad=JSON.parse(json);bad.players.find((x:{id:string})=>x.id==='bot-1').run.build.hand=9;
  assert.equal(make().resume(bad),false);
});
