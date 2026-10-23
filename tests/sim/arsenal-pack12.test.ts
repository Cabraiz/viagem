// NEW-20261022-ORQ-arsenal-completo-no-bau, passo 0: the 34 Pack 12 weapons as data (sim/weapons/pack12.ts), built
// like the firearms, none playable yet (the crates keep the seven firearms), the four ids that were tomes renamed, and
// the hooks of the fatia A2 (ricochet/mine/turret) in place and inert.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {PACK12,PACK12_PLAYABLE} from '../../src/sim/weapons/pack12.ts';
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

test('pack12 passo 0: only the fatia A2 is playable, so the arsenal, the catalog and the crates are the firearms plus it', ()=>{
  // Fatia A2 (E7, tests/sim/arsenal-pack12-a2.test.ts) made its three playable; the A1 ones are not yet.
  assert.deepEqual([...PACK12_PLAYABLE].sort(),['bola-murcha','carro-de-som','panela-de-pressao']);
  assert.deepEqual(ARSENAL_WEAPONS.map(w=>w.id),[...NEW_WEAPONS.map(w=>w.id),...PACK12.filter(w=>PACK12_PLAYABLE.has(w.id)).map(w=>w.id)]);
  for(const w of PACK12)if(!PACK12_PLAYABLE.has(w.id)){assert.equal(getWeapon(w.id),undefined,w.id);assert.ok(!WEAPON_CATALOG.has(w.id));}
  assert.deepEqual(CRATE_WEAPONS[1],['pistola']);
  assert.deepEqual([...CRATE_WEAPONS[2]].sort(),['bola-murcha','escopeta','pistola','submetralhadora']);
  assert.ok(CRATE_WEAPONS[5].every(id=>id.endsWith('-lendario')));
  // The verde is the pistol alone: one draw, every time (VERDE_PISTOL only splits a verde with more weapons).
  assert.ok(VERDE_PISTOL>0&&VERDE_PISTOL<1);
  const rng=new Rng(3);
  for(let i=0;i<200;i++)assert.equal(rollPrize(rng,1).items[0].id,'pistola');
  assert.equal(weaponNoise('pistola'),12);
});

test('pack12: the A2 patterns are the three new mechanics', ()=>{
  assert.deepEqual(PACK12.filter(w=>w.pattern==='ricochet'||w.pattern==='mine'||w.pattern==='turret').map(w=>w.id).sort(),['bola-murcha','carro-de-som','panela-de-pressao']);
});
