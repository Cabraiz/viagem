import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ICON_NAMES,icon,compass} from '../src/ui/icon.ts';
import {BADGES} from '../src/game/hud/team.ts';

const svg=readFileSync(new URL('../src/ui/icons.svg',import.meta.url),'utf8');
const symbols=[...svg.matchAll(/<symbol id="i-([a-z-]+)"/g)].map(m=>m[1]);

test('the sticker sprite has exactly the icons icon.ts names (DSG-icones-sistema)',()=>{
  assert.deepEqual([...symbols].sort(),[...ICON_NAMES].sort());
  assert.equal(new Set(symbols).size,symbols.length,'no duplicate symbol');
  for(const name of ICON_NAMES)if(name!=='agulha'&&name!=='letra-n')assert.match(svg,new RegExp(`<symbol id="i-${name}"[^>]*><title>[^<]+</title><use href="#s-${name}" class="ik-sombra"/><use href="#s-${name}" class="ik-papel"/>`),`${name}: shadow and paper edge`);
});

test('the sprite paints only through token classes: no hex, rgb or named colors inside',()=>{
  assert.doesNotMatch(svg,/#[0-9a-f]{3,8}\b(?!-)/i,'no hex color');
  assert.doesNotMatch(svg,/\b(rgba?|hsla?)\(/i);
  assert.doesNotMatch(svg,/(fill|stroke)="(?!none")[^"]+"/,'no paint attributes besides none');
  assert.doesNotMatch(svg,/\p{Extended_Pictographic}|✦/u);
  assert.doesNotMatch(svg,/style=/,'no inline style: one contour for every sticker (design onda 5)');
});

test('icon() is a decorative <use> unless labelled; compass carries the view angle',()=>{
  assert.equal(icon('boia'),'<svg class="ic" viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-icon="boia"><use href="#i-boia"/></svg>');
  assert.match(icon('fechar',{size:32,label:'Fechar "já"'}),/class="ic ic-32" viewBox="0 0 48 48" role="img" aria-label="Fechar &quot;já&quot;"/);
  assert.match(compass(3),/--vista:270deg/);assert.match(compass(-1),/--vista:270deg/);assert.match(compass(4),/--vista:0deg/);
  assert.match(compass(0),/translate\(0 -15\)/,'N on top in view 0');assert.match(compass(1),/translate\(15 0\)/,'N on the right in view 1');
});

test('team badges are stickers for every state that needs one (no emoji)',()=>{
  assert.deepEqual(BADGES,{ok:'',low:'',downed:'boia',eliminated:'saiu',offline:'sem-linha',spectator:'pipoca'});
});
