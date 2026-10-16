// NEW-20261016-ORQ-importar-ui-itens-efeitos: the delivery's ui/itens/efeitos/projeteis are in the game, and the art-only
// stickers (new weapons, snacks, kit, passives, buttons, towers) draw their own WebP, never the "mistério" box.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,type ArtIndex} from '../../src/client/art/manifest.ts';
import {ART_STICKER_NAMES,STICKER_NAMES,isStickerName,sticker} from '../../src/client/ui/sticker.ts';
import {ICON_NAMES} from '../../src/client/ui/icon.ts';
import {itemDisplay,UNKNOWN_ITEM_STICKER} from '../../src/client/hud/items.ts';

const json=(file:string)=>JSON.parse(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8'));
const index=json('public/art/manifest.json') as ArtIndex;
const EMPTY:ArtIndex={version:2,groups:{}};

test('every art-only sticker has its ui piece, and none collides with an SVG sticker or an icon',()=>{
  const ui=index.groups.ui?.pieces??{};
  for(const name of ART_STICKER_NAMES)assert.ok(ui[name],`ui/${name} imported`);
  for(const name of ART_STICKER_NAMES){
    assert.ok(!(STICKER_NAMES as readonly string[]).includes(name),`${name}: not in stickers.svg`);
    assert.ok(!(ICON_NAMES as readonly string[]).includes(name),`${name}: not an icon`);
  }
});

test('the delivered items, effects and shots are in the art index the game loads',()=>{
  const g=index.groups;
  for(const id of ['gema-pequena','gema-media','gema-grande','coxinha','ima','bau'])assert.ok(g.itens?.pieces[id],`itens/${id}`);
  for(const id of ['balao-fala','barra-vida-moldura','barra-vida-preenchimento','barra-vida-moldura-elite','barra-vida-preenchimento-elite',
    'telegraph-enchimento','telegraph-borda','morte-poof','impacto-faisca'])assert.ok(g.efeitos?.pieces[id],`efeitos/${id}`);
  // The 9-slices carry the spec's default slice (the delivery's meta had none).
  assert.deepEqual(g.efeitos?.pieces['barra-vida-moldura']?.files.sheet?.slice,[4,3,4,3]);
  for(const id of ['tiro-aliado','tiro-inimigo','chinelo','boleto','cafe','guarda-chuva','pombo','audio'])assert.ok(g.projeteis?.pieces[id],`projeteis/${id}`);
});

test('an art-only sticker is its WebP with the art, the "mistério" drawing without it (same data-sticker)',()=>{
  setArtIndex(index);
  try{assert.match(sticker('pistola'),/^<img class="ic ic-adesivo" src="\/art\/ui\/pistola\.webp" [^>]*data-sticker="pistola"/);}
  finally{setArtIndex(EMPTY);}
  assert.equal(sticker('pistola'),'<svg class="ic ic-adesivo" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-sticker="pistola"><use href="#a-misterio"/></svg>');
});

test('an item id the HUD catalog does not list yet but whose art came is its own sticker, not the box',()=>{
  for(const id of ['faca','pistola','escopeta','submetralhadora','rifle','macarico','rojao','brigadeiro','pacoca','cocada','kit-torre','pente','silenciador']){
    assert.ok(isStickerName(id),id);
    assert.equal(itemDisplay(id).icon,id);
  }
  assert.equal(itemDisplay('who-knows').icon,UNKNOWN_ITEM_STICKER);
});
