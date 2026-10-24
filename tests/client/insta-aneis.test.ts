import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aneisHtml, INSTA_PERFIS, type InstaPerfil} from '../../src/client/ui/insta.ts';
import {ANEIS_VISIVEIS, emLoop, LANCE_MAX, pousoDe, voltaDe} from '../../src/client/ui/insta-aneis.ts';

// BUG-20261024-ORQ-aneis-herois-carrossel-infinito: with 6 heroes the profile's rings broke into 2 rows; the user wants
// one endless row a finger drags, always with half a face at the right edge, as Instagram's stories.
// Prints (360, 390, 412; before × after, dragging, the loop): viagem-board/evidence/<ID>/.
const css=readFileSync(new URL('../../src/client/ui/insta.css',import.meta.url),'utf8');
const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
const rule=(sel:string)=>css.match(new RegExp(`${sel.replace(/[.[\]"=()]/g,'\$&')} \{([^}]*)\}`))?.[1]??'';
/** `n` profiles for 4 / 10+ heroes (the build has 6): the real ones repeated under other ids. */
const perfis=(n:number):InstaPerfil[]=>Array.from({length:n},(_,i)=>({...INSTA_PERFIS[i%INSTA_PERFIS.length]!,id:`heroi-${i}`}));

test('one row, never two: rings at rest = 3 whole and half of the 4th at the right edge',()=>{
  assert.equal(ANEIS_VISIVEIS,3.5);
  const row=rule('.insta-stories');
  assert.match(row,/--passo: calc\(var\(--u\) \* 730 \/ 3\.5\);/,'the cell is the 730 over ANEIS_VISIVEIS');
  assert.match(row,/display: flex;/);assert.doesNotMatch(row,/grid/);
  assert.match(row,/overflow: clip;/,'the browser never scrolls the row itself (focus)');
  assert.match(row,/touch-action: none;/,'a browser fling after a drag would swallow the next tap');
  assert.match(rule('.insta-aneis-trilho'),/display: flex; flex: none;/,'the track never wraps');
  assert.match(rule('.estadio .insta-story'),/flex: none;[^}]*width: var\(--passo\);/);
  // From x 4 the 4th cell's middle (its face's centre) is the card's right edge, 734.
  const passo=730/3.5;assert.ok(Math.abs(4+3.5*passo-734)<1e-9);
});

test('4, 6 or 10+ heroes loop (the rings twice, the copy hidden from readers and Tab); 3 or fewer stand still',()=>{
  assert.equal(emLoop(3),false);assert.equal(emLoop(4),true);assert.equal(emLoop(6),true);assert.equal(emLoop(12),true);
  for(const n of [4,6,10,13]){
    const html=aneisHtml(perfis(n),()=>true,emLoop(n));
    assert.equal(html.match(/class="insta-story"/g)?.length,2*n,`${n}`);
    assert.equal(html.match(/aria-hidden="true" tabindex="-1"/g)?.length,n,`${n}: only the copy is hidden`);
    // The set is wider than the view: the window [p, p+3.5] always falls inside the two sets.
    assert.ok(2*n>=n+ANEIS_VISIVEIS);
  }
  const tres=aneisHtml(perfis(3),()=>true,false);
  assert.equal(tres.match(/class="insta-story"/g)?.length,3);assert.ok(!tres.includes('aria-hidden'));
  assert.match(aneisHtml(perfis(4),id=>id!=='heroi-1',true),/data-hero="heroi-1" data-bloqueado aria-hidden="true"/,'the lock is on the copy too');
});

test('the loop folds both ways; a release rests on a whole ring, a throw carries at most LANCE_MAX rings',()=>{
  assert.equal(voltaDe(0,6),0);assert.equal(voltaDe(6,6),0);assert.equal(voltaDe(-1,6),5);assert.equal(voltaDe(-6.5,6),5.5);assert.equal(voltaDe(13.25,6),1.25);
  assert.equal(pousoDe(2.3,0),2);assert.equal(pousoDe(2.6,0),3);assert.equal(pousoDe(-.4,0),0);
  assert.ok(Number.isInteger(pousoDe(1.37,.004)));
  assert.ok(pousoDe(1,.004)>1,'a throw to the left carries on');assert.ok(pousoDe(1,-.004)<1,'and to the right');
  assert.equal(LANCE_MAX,3);assert.equal(pousoDe(0,10),3);assert.equal(pousoDe(0,-10),-3);
  assert.ok(LANCE_MAX<4,'never a whole set of the smallest loop (4) round to the same faces');
});

test('main.ts: the chosen one is marked in the row, a tap picks, the row is drawn again only when heroes or locks change',()=>{
  assert.match(main,/const aneis=montarAneis\(insta\.stories\);/);
  assert.match(main,/if\(instaAneis!==assinatura\)\{/);
  assert.match(main,/setAttribute\('aria-current','true'\)/);
  assert.match(css,/\.insta-story\[aria-current="true"\] \.insta-story-nome \{[^}]*text-decoration-color: var\(--insta-roxo\);/);
  assert.match(main,/insta\.stories\.addEventListener\('click'/,'a tap still picks, through the ring click');
  // The tap is read on pointerup (Chrome drops the first tap after a fast flick); the browser's own click of a press on
  // the row is swallowed, the keyboard's (detail 0) passes.
  const aneis=readFileSync(new URL('../../src/client/ui/insta-aneis.ts',import.meta.url),'utf8');
  assert.match(aneis,/if\(e\.type==='pointerup'&&!parou&&anel&&document\.elementFromPoint\(e\.clientX,e\.clientY\)\?\.closest\('\[data-hero\]'\)===anel\) anel\.click\(\);/);
  assert.match(aneis,/addEventListener\('click',e=>\{if\(e\.isTrusted&&e\.detail>0&&performance\.now\(\)-pressEm<CLIQUE_MS\)\{e\.stopImmediatePropagation\(\);e\.preventDefault\(\);\}\},true\)/);
  assert.match(aneis,/prefers-reduced-motion: reduce/);
});
