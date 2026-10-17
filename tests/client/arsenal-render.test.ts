// NEW-20261016-ORQ-armas-caixas-render (bloco 8 do PLANO, D-051): the crates, the items on the ground, the hand and the
// arsenal's shots wear the imported art (render/arsenal-rules.ts, render/arsenal-fx.ts), and the client's mirror of
// the crate numbers matches the sim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,parseArtIndex,artPiece} from '../../src/client/art/manifest.ts';
import {baseFrame} from '../../src/client/art/base-art.ts';
import {projectileArtId,projectileLook} from '../../src/client/art/horde-art.ts';
import {ARSENAL_ITEMS,CRATE_ART,CRATE_OPEN_REACH,CRATE_OPEN_SECONDS,FIRE_LOOK,arsenalLoads,crateProgress,crateRow,fxKey,iconKey,isWeaponItem,
  itemIcon,rarityOf,shotFrame} from '../../src/client/render/arsenal-rules.ts';
import {PICKUP_KINDS,pickupTexture} from '../../src/client/render/keys.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';
import {ARSENAL_PUSH_MS,arsenalView} from '../../src/client/sandboxes/arsenal-view.ts';
import {OPEN_REACH,OPEN_SECONDS} from '../../src/sim/crates.ts';
import {CONSUMABLE_IDS,NEW_WEAPONS,legendaryId} from '../../src/sim/weapons/arsenal.ts';
import {WEAPON_IDS} from '../../src/sim/weapons/catalog.ts';
import type {RunView} from '../../src/contract/index.ts';

const index=parseArtIndex(JSON.parse(readFileSync(new URL('../../public/art/manifest.json',import.meta.url),'utf8')));
const withArt=(fn:()=>void)=>()=>{setArtIndex(index);try{fn();}finally{setArtIndex(parseArtIndex({version:2,groups:{}}));}};

test('the client mirrors the crate numbers of the sim',()=>{
  assert.equal(CRATE_OPEN_REACH,OPEN_REACH);
  assert.deepEqual(CRATE_OPEN_SECONDS,OPEN_SECONDS);
});

test('every arsenal item of the sim has a HUD entry and a sticker in the art',withArt(()=>{
  const sim=[...NEW_WEAPONS.map(w=>w.id),...WEAPON_IDS.map(legendaryId),...CONSUMABLE_IDS];
  for(const id of sim)assert.ok(ARSENAL_ITEMS.includes(id),`${id} in ARSENAL_ITEMS`);
  for(const id of ARSENAL_ITEMS){
    const icon=itemIcon(id);
    assert.ok(icon,`${id}: HUD entry`);
    assert.ok(artPiece('ui',icon as string),`${id}: ui/${icon} imported`);
    assert.equal(itemDisplay(id).icon,icon);
  }
  assert.ok(isWeaponItem('pistola')&&isWeaponItem('cafe-lendario'));
  assert.ok(!isWeaponItem('coxinha')&&!isWeaponItem('nada'));
}));

test('every arsenal weapon fires something the art has: a projectile piece or a shot strip',withArt(()=>{
  for(const w of NEW_WEAPONS){
    const look=FIRE_LOOK[w.id];
    assert.ok(look,`${w.id}: FIRE_LOOK`);
    if(look.art)assert.ok(artPiece('efeitos',look.art),`${w.id}: efeitos/${look.art}`);
  }
  // The firearms and the rojão fly their own projectile art; a legendary its old weapon's best one.
  const expect:Record<string,string>={pistola:'bala-revolver',submetralhadora:'bala-metralhadora',rifle:'bala-fuzil',rojao:'rojao',
    'chinelo-lendario':'chinelo-evo','boleto-lendario':'boleto-evo','cafe-lendario':'cafe-evo','guarda-chuva-lendario':'guarda-chuva',
    'pombo-lendario':'pombo','audio-lendario':'audio'};
  for(const [source,art] of Object.entries(expect)){
    assert.equal(projectileArtId(source),art,source);
    assert.ok(artPiece('projeteis',art),`projeteis/${art}`);
    assert.equal(projectileLook(false,source)?.key,`art:proj:${art}`,`${source} wears its art`);
  }
  // A shot the influencer reflects back is hostile-looking (undefined: the hostile star), never the weapon's art.
  assert.equal(projectileLook(true,'pistola'),undefined);
}));

test('the arsenal art loads once, as stickers and square-frame strips, and nothing without the manifest',withArt(()=>{
  const loads=arsenalLoads(),keys=loads.map(l=>l.key);
  assert.equal(new Set(keys).size,keys.length,'no texture twice');
  for(const id of ARSENAL_ITEMS)assert.ok(keys.includes(iconKey(itemIcon(id) as string)),`${id} sticker`);
  for(const look of Object.values(FIRE_LOOK))if(look.art)assert.ok(loads.some(l=>l.key===fxKey(look.art as string)&&l.strip),look.art);
  for(const l of loads)assert.match(l.url,/^\/art\/(ui|fx)\/[a-z0-9-]+\.webp$/);
  setArtIndex(parseArtIndex({version:2,groups:{}}));
  assert.deepEqual(arsenalLoads(),[]);
}));

test('the crate opens through its sheet rows with the progress of its rarity',withArt(()=>{
  assert.equal(crateRow(0),'fechada');
  assert.equal(crateRow(.01),'abrindo-1');
  assert.equal(crateRow(.5),'abrindo-3');
  assert.equal(crateRow(1),'abrindo-6');
  const frames=['fechada','abrindo-1','abrindo-2','abrindo-3','abrindo-4','abrindo-5','abrindo-6'].map(row=>baseFrame(CRATE_ART,row,0)?.frame);
  assert.deepEqual(frames,[0,1,2,3,4,5,6],'each row its own cell of caixa-saque');
  assert.equal(crateProgress(1000,1),1,'verde: 1 s');
  assert.equal(crateProgress(1000,5),1/3,'lendária: 3 s');
  assert.equal(crateProgress(-5,3),0);
  assert.equal(rarityOf(9),5);assert.equal(rarityOf(0),1);assert.equal(rarityOf(NaN),1);
}));

test('a muzzle flash starts at its burst; the other shots play the whole strip',()=>{
  assert.equal(shotFrame(FIRE_LOOK.pistola,0,3),1);
  assert.equal(shotFrame(FIRE_LOOK.pistola,FIRE_LOOK.pistola.ms-1,3),2);
  assert.equal(shotFrame(FIRE_LOOK.rojao,0,10),0);
  assert.equal(shotFrame(FIRE_LOOK.rojao,FIRE_LOOK.rojao.ms*2,10),9,'the last frame holds');
});

test('an item on the ground has its own fallback texture (not the XP gem)',()=>{
  assert.ok(PICKUP_KINDS.includes('item'));
  assert.equal(pickupTexture('item'),'horde:pickup:item');
});

test('the sandbox view: manual combat, crates of every rarity, and event ids that only grow',()=>{
  const base:RunView={tick:0,team:{xp:0,level:1,nextXp:5},structures:[],players:[],offers:[],events:[],projectiles:[],telegraphs:[],enemies:[],pickups:[]};
  let last=-1,bursts=0,fires=0;
  for(let t=0;t<9000;t+=ARSENAL_PUSH_MS){
    const v=arsenalView(base,10,10,t,'pistola');
    assert.equal(v.players[0].hand,1);
    assert.deepEqual([...new Set(v.pickups.filter(p=>p.kind==='chest').map(p=>p.value))].sort(),[1,2,3,4,5]);
    for(const e of v.events){assert.ok(e.eventId>last,'ids grow');last=e.eventId;if(e.type==='pickup')bursts++;if(e.type==='fire')fires++;}
  }
  assert.equal(bursts,3);
  assert.ok(fires>=30);
});
