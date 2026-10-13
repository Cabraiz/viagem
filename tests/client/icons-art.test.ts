// NEW-20261012-ORQ-importar-arte-b-ligacao: icon()/sticker()/compass() use the imported ui/<id> WebP when the art index
// has it, and today's SVG sprite markup (byte for byte) when it does not; the boot load never throws nor hangs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,hasArt,type ArtIndex,type ArtPiece} from '../../src/client/art/manifest.ts';
import {ICON_NAMES,compass,icon} from '../../src/client/ui/icon.ts';
import {STICKER_NAMES,sticker} from '../../src/client/ui/sticker.ts';
import {bootArt} from '../../src/client/ui/art-boot.ts';

const EMPTY:ArtIndex={version:2,groups:{}};
const piece=(id:string):ArtPiece=>({kind:'icon',files:{sheet:{file:`${id}.webp`,cell:[128,128],frames:1}}});
const withUi=(ids:string[]):ArtIndex=>({version:2,groups:{ui:{output:'public/art/ui',pieces:Object.fromEntries(ids.map(id=>[id,piece(id)]))}}});
const using=(index:ArtIndex,run:()=>void)=>{setArtIndex(index);try{run();}finally{setArtIndex(EMPTY);}};

test('without ui art: icon() and sticker() are today\'s <svg><use> markup, byte for byte',()=>{
  setArtIndex(EMPTY);
  assert.equal(icon('boia'),'<svg class="ic" viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-icon="boia"><use href="#i-boia"/></svg>');
  assert.equal(icon('fechar',{size:32,label:'Fechar'}),'<svg class="ic ic-32" viewBox="0 0 48 48" role="img" aria-label="Fechar" focusable="false" data-icon="fechar"><use href="#i-fechar"/></svg>');
  assert.equal(icon('girar',{size:32,className:'ic-espelho'}),'<svg class="ic ic-32 ic-espelho" viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-icon="girar"><use href="#i-girar"/></svg>');
  assert.equal(sticker('coxinha'),'<svg class="ic ic-adesivo" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-sticker="coxinha"><use href="#a-coxinha"/></svg>');
  assert.equal(sticker('banana',{size:48,label:'Banana'}),'<svg class="ic ic-adesivo ic-48" viewBox="0 0 24 24" role="img" aria-label="Banana" focusable="false" data-sticker="banana"><use href="#a-banana"/></svg>');
  assert.equal(compass(1,{size:32}),'<svg class="ic ic-32 ic-bussola" viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-icon="bussola" data-vista="1" style="--vista:90deg"><use href="#i-bussola"/><g class="ic-agulha"><use href="#i-agulha"/></g><use href="#i-letra-n" transform="translate(15 0) scale(.62)" transform-origin="24 24"/></svg>');
  for(const name of ICON_NAMES)assert.match(icon(name),new RegExp(`^<svg [^>]*data-icon="${name}"><use href="#i-${name}"/></svg>$`));
  for(const name of STICKER_NAMES)assert.match(sticker(name),new RegExp(`^<svg [^>]*data-sticker="${name}"><use href="#a-${name}"/></svg>$`));
});

test('with ui art: icon() is an <img> of /art/ui/<id>.webp with the same classes and data-icon',()=>using(withUi(['boia','fechar','girar']),()=>{
  assert.equal(icon('boia'),'<img class="ic" src="/art/ui/boia.webp" alt="" aria-hidden="true" data-icon="boia" draggable="false" decoding="async">');
  assert.equal(icon('girar',{size:32,className:'ic-espelho'}),'<img class="ic ic-32 ic-espelho" src="/art/ui/girar.webp" alt="" aria-hidden="true" data-icon="girar" draggable="false" decoding="async">');
  // A labelled icon keeps its accessible name (alt, and the same role/aria-label the SVG had).
  assert.equal(icon('fechar',{size:32,label:'Fechar "já"'}),'<img class="ic ic-32" src="/art/ui/fechar.webp" alt="Fechar &quot;já&quot;" role="img" aria-label="Fechar &quot;já&quot;" data-icon="fechar" draggable="false" decoding="async">');
  // A piece the importer did not deliver stays SVG, next to the ones it did.
  assert.match(icon('dado'),/^<svg class="ic" [^>]*data-icon="dado"><use href="#i-dado"\/><\/svg>$/);
}));

test('with ui art: sticker() is an <img> with the same classes and data-sticker; a pages-only entry uses its first page',()=>{
  const index=withUi(['coxinha']);
  index.groups.ui.pieces.banana={kind:'icon',files:{sheet:{pages:[{file:'banana.webp',columns:1,rows:1,firstFrame:0,frameCount:1}],cell:[128,128]}}};
  using(index,()=>{
    assert.equal(sticker('coxinha',{size:48}),'<img class="ic ic-adesivo ic-48" src="/art/ui/coxinha.webp" alt="" aria-hidden="true" data-sticker="coxinha" draggable="false" decoding="async">');
    assert.match(sticker('banana'),/^<img class="ic ic-adesivo" src="\/art\/ui\/banana\.webp" /);
    assert.match(sticker('galo'),/^<svg [^>]*data-sticker="galo"><use href="#a-galo"\/><\/svg>$/);
  });
});

test('collision rule: an id in both sets (chinelo) is one ui/<id> piece for icon() and sticker()',()=>{
  const both=ICON_NAMES.filter(n=>(STICKER_NAMES as readonly string[]).includes(n));
  assert.deepEqual(both,['chinelo'],'update the collision note in icon.ts when this list changes');
  using(withUi(['chinelo']),()=>{
    assert.match(icon('chinelo'),/^<img [^>]*src="\/art\/ui\/chinelo\.webp"[^>]*data-icon="chinelo"/);
    assert.match(sticker('chinelo'),/^<img [^>]*src="\/art\/ui\/chinelo\.webp"[^>]*data-sticker="chinelo"/);
  });
});

test('compass: SVG unless both bussola and agulha exist; then <image> parts and the needle still turns with --vista',()=>{
  using(withUi(['bussola']),()=>assert.doesNotMatch(compass(2),/<image/));
  using(withUi(['agulha','letra-n']),()=>assert.doesNotMatch(compass(2),/<image/));
  using(withUi(['bussola','agulha']),()=>{
    const c=compass(1,{size:32});
    assert.match(c,/^<svg class="ic ic-32 ic-bussola" viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-icon="bussola" data-vista="1" style="--vista:90deg">/);
    assert.match(c,/<image href="\/art\/ui\/bussola\.webp" width="48" height="48"\/><g class="ic-agulha"><image href="\/art\/ui\/agulha\.webp" width="48" height="48"\/><\/g>/);
    assert.match(c,/<use href="#i-letra-n" transform="translate\(15 0\) scale\(\.62\)" transform-origin="24 24"\/><\/svg>$/,'no letra-n art: the N stays the symbol');
  });
  using(withUi(['bussola','agulha','letra-n']),()=>assert.match(compass(0),/<image href="\/art\/ui\/letra-n\.webp" width="48" height="48" transform="translate\(0 -15\) scale\(\.62\)" transform-origin="24 24"\/><\/svg>$/));
});

test('img.ic sits in the same box as svg.ic: contained, smoothed, no max-width squeeze',()=>{
  const css=readFileSync(new URL('../../src/client/ui/icons.css',import.meta.url),'utf8');
  const rule=css.match(/img\.ic\{([^}]*)\}/)?.[1]??'';
  assert.match(rule,/object-fit:contain/);assert.match(rule,/image-rendering:auto/);assert.match(rule,/max-width:none/);
  assert.match(css,/\.ic\{display:inline-block;[^}]*width:24px;height:24px/);
});

const answer=(value:unknown,ok=true)=>({ok,json:async()=>value});
test('bootArt loads the index in time, and keeps the SVG on fetch failure, bad JSON, !ok and timeouts',async()=>{
  try{
    assert.equal(await bootArt({fetcher:async()=>answer(withUi(['boia']))}),true);
    assert.match(icon('boia'),/^<img /);

    assert.equal(await bootArt({fetcher:async()=>{throw new TypeError('offline');}}),false,'a failed fetch resolves false (no throw)');
    assert.match(icon('boia'),/^<svg /);
    setArtIndex(withUi(['boia']));
    await bootArt({fetcher:async()=>({ok:true,json:async()=>{throw new SyntaxError('bad json');}})});
    assert.match(icon('boia'),/^<svg /);
    setArtIndex(withUi(['boia']));
    await bootArt({fetcher:async()=>answer(withUi(['boia']),false)});
    assert.match(icon('boia'),/^<svg /);

    // Hanging fetch: resolves false at the deadline, aborts, and never throws.
    let signal:AbortSignal|undefined;
    const t0=Date.now();
    assert.equal(await bootArt({timeoutMs:30,fetcher:(_u,init)=>{signal=init.signal;return new Promise(()=>{});}}),false);
    assert.ok(Date.now()-t0<1000);assert.equal(signal?.aborted,true);
    assert.match(icon('boia'),/^<svg /);

    // A late answer (after the deadline) is refused: no half-and-half icons mid-session.
    let release!:()=>void;
    const gate=new Promise<void>(r=>{release=r;});
    assert.equal(await bootArt({timeoutMs:20,fetcher:async()=>{await gate;return answer(withUi(['boia']));}}),false);
    release();await new Promise(r=>setTimeout(r,20));
    assert.match(icon('boia'),/^<svg /);

    // Slow JSON body past the deadline is refused too.
    assert.equal(await bootArt({timeoutMs:20,fetcher:async()=>({ok:true,json:()=>new Promise(r=>setTimeout(()=>r(withUi(['boia'])),60))})}),false);
    await new Promise(r=>setTimeout(r,80));
    assert.match(icon('boia'),/^<svg /);
  }finally{setArtIndex(EMPTY);}
});

test('main.ts starts the art index without blocking the menu; the game and the horde sandbox await it before Phaser',()=>{
  const read=(f:string)=>readFileSync(new URL(`../../src/${f}`,import.meta.url),'utf8');
  const main=read('main.ts');
  assert.match(main,/^import \{ startArt \} from '\.\/client\/ui\/art-boot\.ts';$/m);
  assert.ok(!/await (bootArt|artReady|startArt)\(\)|artReady\(/.test(main),'the menu never waits for the network (nor starts the game wait)');
  const boot=main.indexOf('void startArt();'),mount=main.indexOf('mountIcons();');
  assert.ok(mount>=0&&boot>mount,'mountIcons (SVG fallback) → startArt');
  for(const f of ['client/explore.ts','client/sandboxes/sandbox-horde.ts'])assert.match(read(f),/await artReady\(\);/,f);
});
test('artReady() is one boot per page (same promise); startArt() one download',async()=>{
  const {artReady,startArt}=await import('../../src/client/ui/art-boot.ts');
  assert.equal(startArt(),startArt());
  assert.equal(artReady(),artReady());
});
test('bootArt: the seal (until) refuses an answer still on its way, like the deadline (manifesto-enxuto-3g)',async()=>{
  try{
    let seal=()=>{};const until=new Promise<void>(r=>{seal=r;});
    let release=()=>{};const gate=new Promise<void>(r=>{release=r;});
    const boot=bootArt({timeoutMs:10000,until,fetcher:async()=>{await gate;return answer(withUi(['boia']));}});
    seal();release();
    assert.equal(await boot,false);
    assert.equal(hasArt('ui','boia'),false,'a sealed index stays empty');
    // Without a seal, a slow answer inside the long background deadline is taken.
    assert.equal(await bootArt({timeoutMs:10000,fetcher:async()=>{await new Promise(r=>setTimeout(r,60));return answer(withUi(['boia']));}}),true);
  }finally{setArtIndex(EMPTY);}
});
