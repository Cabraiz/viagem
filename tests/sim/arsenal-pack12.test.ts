// NEW-20261022-ORQ-arsenal-completo-no-bau, passo 0: the 34 Pack 12 weapons as data (sim/weapons/pack12.ts), built
// like the firearms, the fatia A1's eleven playable (catalog, crates), the four ids that were tomes renamed, and
// the hooks of the fatia A2 (ricochet/mine/turret) in place and inert.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {A1_PLAYABLE,PACK12,PACK12_PLAYABLE} from '../../src/sim/weapons/pack12.ts';
import {isRetired} from '../../src/sim/retired-items.ts';
import {ARSENAL_DAMAGE,ARSENAL_WEAPONS,NEW_WEAPONS,PACK12_WEAPONS,RARITY_DAMAGE,weaponNoise,type Rarity} from '../../src/sim/weapons/arsenal.ts';
import {WEAPON_CATALOG,getWeapon} from '../../src/sim/weapons/catalog.ts';
import {PASSIVE_IDS} from '../../src/rules/passives.ts';
import {CRATE_WEAPONS,VERDE_PISTOL,rollPrize} from '../../src/sim/crates.ts';
import {Rng} from '../../src/contract/rng.ts';
import {allItemDisplays} from '../../src/client/hud/items.ts';
import {isStickerName} from '../../src/client/ui/sticker.ts';

test('pack12: 34 weapons, unique ids that clash with no tome nor catalog weapon, 7/7/7/7/6 by minimum rarity', ()=>{
  assert.equal(PACK12.length,34);
  const ids=PACK12.map(w=>w.id);
  assert.equal(new Set(ids).size,34);
  for(const id of ids){
    assert.ok(!(PASSIVE_IDS as readonly string[]).includes(id),`${id} is a tome id`);
    assert.ok(!NEW_WEAPONS.some(w=>w.id===id),`${id} is a firearm id`);
  }
  const count=(r:number)=>PACK12.filter(w=>w.minRarity===r).length;
  assert.deepEqual([1,2,3,4,5].map(count),[7,7,7,7,6]);
  // The four renamed ones keep the Pack's art.
  const icon=(id:string)=>PACK12.find(w=>w.id===id)?.icon;
  assert.deepEqual(['baladeira','tampa-voadora','nuvem-de-incenso','galho-de-arruda'].map(icon),['estilingue','tampa-de-panela','defumador','arruda']);
});

test('pack12: every weapon has its sticker, and the HUD names it like the sim', ()=>{
  const hud=new Map(allItemDisplays().map(i=>[i.id,i]));
  for(const w of PACK12){
    assert.ok(existsSync(`public/art/ui/${w.icon}.webp`),`ui/${w.icon}.webp`);
    if(w.id!=='corneta')assert.ok(isStickerName(w.icon),`${w.icon} is a sticker name`);
    if(isRetired(w.id))continue; // the rings left the game (sem-arma-girando-no-chao)
    const shown=hud.get(w.id);
    assert.ok(shown,`${w.id} in hud/items.ts`);
    assert.equal(shown.kind,'weapon');assert.equal(shown.name,w.name);assert.equal(shown.icon,w.id==='corneta'?'misterio':w.icon);
  }
});

test('pack12: rows like the firearms (verde × ARSENAL_DAMAGE × rarity), 4 rarities, 5 for the lendária-only', ()=>{
  for(const w of PACK12_WEAPONS){
    const top=w.minRarity===5?5:4,src=PACK12.find(p=>p.id===w.id)!;
    assert.equal(w.maxLevel,top,w.id);assert.equal(w.levels.length,top,w.id);
    for(let r=1;r<=top;r++)assert.equal(w.levels[r-1].damage,Math.round(src.verde[0]*ARSENAL_DAMAGE*RARITY_DAMAGE[r as Rarity]*10)/10,`${w.id} r${r}`);
    assert.equal(w.packType,src.type);
  }
});

test('pack12 A1: its eight are playable (arsenal, catalog, noise, crates by minimum rarity); the others wait', ()=>{
  const a1=['baladeira','espeto','sacole','tampa-voadora','buscape','traque','tijolo-baiano','taro-vencido'];
  assert.deepEqual([...A1_PLAYABLE].sort(),[...a1].sort());
  assert.ok(a1.every(id=>PACK12_PLAYABLE.has(id)));
  assert.deepEqual(ARSENAL_WEAPONS.map(w=>w.id),[...NEW_WEAPONS.map(w=>w.id),...PACK12.filter(w=>PACK12_PLAYABLE.has(w.id)).map(w=>w.id)]);
  for(const w of PACK12){
    const playable=PACK12_PLAYABLE.has(w.id);
    assert.equal(WEAPON_CATALOG.has(w.id),playable,w.id);
    if(!playable)continue;
    assert.equal(weaponNoise(w.id),w.noise,w.id);
    for(const r of [1,2,3,4] as Rarity[])assert.equal(CRATE_WEAPONS[r].includes(w.id),w.minRarity<=r,`${w.id} in ${r}`);
  }
  assert.ok(CRATE_WEAPONS[1].includes('pistola')&&VERDE_PISTOL===.4);
  // 200 verde crates of one seed: never only the pistol now.
  const rng=new Rng(3),got=new Set<string>();
  for(let i=0;i<200;i++)got.add(rollPrize(rng,1).items[0].id);
  assert.ok(got.size>1&&got.has('pistola'));
  assert.equal(weaponNoise('pistola'),12);
});

test('pack12: the A2 patterns are the three new mechanics (fatia A2: tests/sim/arsenal-pack12-a2.test.ts)', ()=>{
  assert.deepEqual(PACK12.filter(w=>w.pattern==='ricochet'||w.pattern==='mine'||w.pattern==='turret').map(w=>w.id).sort(),['bola-murcha','carro-de-som','panela-de-pressao']);
});

test('pack12 A1 render: the lobbed objects (traque, tijolo) are drawn at their own size on their burst zone, not stretched to it', async ()=>{
  const {shotDrawScale}=await import('../../src/client/render/arsenal-rules.ts');
  for(const id of ['traque','tijolo-baiano']){const r=getWeapon(id)!.levels[0].area;assert.ok(shotDrawScale(false,id)*Math.min(3,r*2*46/64)<=1.1,id);}
  assert.equal(shotDrawScale(false,'baladeira'),1);
});
