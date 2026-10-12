import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {buildSprite,STICKER_GRIDS,STICKER_LIST} from '../scripts/make-stickers.mjs';
import {STICKER_NAMES,isStickerName,sticker} from '../src/ui/sticker.ts';
import {ICON_NAMES} from '../src/ui/icon.ts';
import {allItemDisplays,itemDisplay,UNKNOWN_ITEM_STICKER} from '../src/game/hud/items.ts';
import {computeAwards,viceSticker} from '../src/game/hud/awards.ts';
import {ITEMS} from '../src/game/sim/items.ts';
import {SOUND_ART} from '../src/game/audio/recipes.ts';

const svg=readFileSync(new URL('../src/ui/stickers.svg',import.meta.url),'utf8');
const symbols=[...svg.matchAll(/<symbol id="a-([a-z0-9-]+)"/g)].map(m=>m[1]);

test('stickers.svg is exactly what scripts/make-stickers.mjs draws (run it after changing the art)',()=>{
  assert.equal(svg,buildSprite());
  assert.deepEqual([...STICKER_LIST].sort(),[...STICKER_NAMES].sort(),'sticker.ts names = generator names');
  assert.deepEqual([...symbols].sort(),[...STICKER_NAMES].sort());
  assert.equal(new Set(symbols).size,symbols.length,'no duplicate symbol');
});

test('every sticker is pixel art with the sticker edge: title, hard shadow, paper edge, outline, real colors by class',()=>{
  for(const name of STICKER_NAMES){
    const body=svg.match(new RegExp(`<symbol id="a-${name}" viewBox="0 0 24 24">(.*?)</symbol>`))?.[1]??'';
    assert.match(body,/^<title>[^<]+<\/title><path class="px-sombra" d="[^"]+"\/><path class="px-borda" d="[^"]+"\/><path class="px-contorno" d="[^"]+"\/>/,name);
    // Real colors: at least three art colors besides the outline (an object, its shade and its light).
    const colors=[...body.matchAll(/class="px-([a-z-]+)"/g)].map(m=>m[1]).filter(c=>!['sombra','borda','contorno','breu'].includes(c));
    assert.ok(colors.length>=3,`${name}: ${colors.join(',')}`);
    assert.ok(!colors.includes('lilas'),`${name}: lilás is the seal's, not the object's`);
  }
  for(const [name,grid] of Object.entries(STICKER_GRIDS as Record<string,string[]>))
    assert.ok(grid.length===20&&grid.every(row=>row.length===20),name);
  assert.doesNotMatch(svg,/#[0-9a-f]{3,8}\b(?!-)/i,'no hex color');
  assert.doesNotMatch(svg,/\b(rgba?|hsla?)\(/i);
  assert.doesNotMatch(svg,/(fill|stroke)="/,'no paint attributes');
  assert.doesNotMatch(svg,/\p{Extended_Pictographic}|✦/u);
  assert.doesNotMatch(svg,/style=/);
  // Every px-* class the sprite uses is painted by icons.css from a token.
  const css=readFileSync(new URL('../src/ui/icons.css',import.meta.url),'utf8');
  for(const cls of new Set([...svg.matchAll(/class="(px-[a-z-]+)"/g)].map(m=>m[1])))assert.match(css,new RegExp(`\\.${cls}[,{]`),cls);
  assert.ok(svg.length<100_000,`sprite stays light (${svg.length} bytes)`);
});

test('sticker() is a decorative <use> unless labelled, with the icon sizes',()=>{
  assert.equal(sticker('coxinha'),'<svg class="ic ic-adesivo" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-sticker="coxinha"><use href="#a-coxinha"/></svg>');
  assert.match(sticker('boleto',{size:48,label:'Boleto "vencido"'}),/class="ic ic-adesivo ic-48" viewBox="0 0 24 24" role="img" aria-label="Boleto &quot;vencido&quot;"/);
  assert.ok(isStickerName('pombo'));assert.ok(!isStickerName('🐦'));
});

test('every item the run can offer has its own sticker, the same id the sim names (no emoji, no shared drawing)',()=>{
  const items=allItemDisplays();
  for(const item of items)assert.ok(isStickerName(item.icon),`${item.id}: ${item.icon}`);
  assert.equal(new Set(items.map(item=>item.icon)).size,items.length,'one drawing per item');
  for(const def of ITEMS.all()){
    assert.equal(def.icon,itemDisplay(def.id).icon,`${def.id}: the sim and the HUD name the same sticker`);
    assert.ok(isStickerName(def.icon),def.id);
  }
  assert.equal(itemDisplay('heal').icon,'coxinha','the coxinha is a coxinha, not a pastel');
  assert.equal(itemDisplay('who-knows').icon,UNKNOWN_ITEM_STICKER);
});

test('every award and vice has a sticker; the vice medals say the place in shape, not only color',()=>{
  const source=readFileSync(new URL('../src/game/hud/awards.ts',import.meta.url),'utf8');
  const named=[...source.matchAll(/icon:'([a-z0-9-]+)'/g)].map(m=>m[1]);
  assert.ok(named.length>=13,'every award def names a sticker');
  for(const name of named)assert.ok(isStickerName(name),name);
  assert.equal(new Set(named).size,named.length,'one drawing per award');
  assert.deepEqual([1,2,3,4,9].map(viceSticker),['balanca','podio-2','podio-3','trave','trave']);
  // An award computed end to end carries a sticker name.
  const awards=computeAwards({victory:true,players:[
    {id:'a',name:'A',classId:'cidadao',level:3,weapons:[{id:'chinelo',level:2}],passives:[],downed:false,spectator:false,stats:{damage:10,kills:3,revives:0,pickups:2,downs:1,heals:0,magnets:0,chests:0,evolves:0}},
  ]} as never,{players:new Map()} as never);
  assert.ok(awards.length>0);for(const a of awards)assert.ok(isStickerName(a.icon),a.id);
});

test('the sound lab shows stickers and icons that exist (the stamp keeps its word)',()=>{
  const icons=new Set<string>(ICON_NAMES);
  for(const [id,art] of Object.entries(SOUND_ART)){
    if('icon' in art)assert.ok(icons.has(art.icon),id);
    else if('sticker' in art)assert.ok(isStickerName(art.sticker),id);
    else assert.equal(art.word,'tum');
  }
});
