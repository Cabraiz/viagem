/**
 * Face avatars in the HUD (NEW-20261012-ORQ-rostos-hud): the portrait crop table and its math, the expression by state,
 * the imported-face lookup with its fallbacks, the HTML helper, and that the team strip, result cards, edge arrows and
 * waiting-room chips draw their faces through src/client/ui/face-crop.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classes} from '../../src/rules/index.ts';
import {setArtIndex,type ArtIndex} from '../../src/client/art/manifest.ts';
import {DEFAULT_FACE,FACE_CROP,FACE_EXPRESSIONS,FULL_FRAME,HURT_FRACTION,faceCrop,faceExpression,faceFrame,faceHtml,faceKey,faceSource,
  faceVars,importedFaceUrl,manifestFace,needsLargePortrait,portrait768,portraitClass,varsText,type ExactFace,type FaceExpression} from '../../src/client/ui/face-crop.ts';
import {HUD_CSS} from './hud-css.ts';

const src=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const close=(a:number,b:number,eps=1e-3)=>Math.abs(a-b)<=eps;

/** The frame covers the circle: image box [left, left+side] contains [0, 100] on both axes. */
function assertCovers(classId:string){
  const f=faceFrame(classId),side=f.zoom*100;
  assert.ok(f.zoom>=1,`${classId}: zoom ≥ 1`);
  assert.ok(f.left<=1e-9&&f.top<=1e-9,`${classId}: image starts at or before the circle (${f.left}, ${f.top})`);
  assert.ok(f.left+side>=100-1e-3&&f.top+side>=100-1e-3,`${classId}: image ends at or after the circle`);
}

test('FACE_CROP: one entry per class (all 28), sorted by id, every value a sane crop',()=>{
  const ids=classes.map(c=>c.id);
  assert.equal(ids.length,28);
  assert.deepEqual(Object.keys(FACE_CROP).sort(),[...ids].sort(),'same ids as src/rules/classes.ts');
  assert.deepEqual(Object.keys(FACE_CROP),[...Object.keys(FACE_CROP)].sort(),'the table is kept sorted by id');
  for(const id of ids){
    const c=FACE_CROP[id];
    assert.ok(c.size>0&&c.size<=1&&c.cx>=0&&c.cx<=1&&c.cy>=0&&c.cy<=1,`${id}: fractions of the image`);
    assertCovers(id);
  }
  // Measured per class, not the placeholder: every crop is a head-and-shoulders window in the top half of the portrait.
  for(const id of ids){
    const c=FACE_CROP[id];
    assert.notDeepEqual({...c},{...DEFAULT_FACE},`${id}: measured, not the default`);
    const k=faceCrop(id);// as drawn: clamped inside the image
    assert.ok(k.size>=.3&&k.size<=.5&&k.cy-k.size/2>=0&&k.cy+k.size/2<=.55&&Math.abs(k.cx-.5)<=.1,`${id}: head and shoulders near the top`);
  }
  assert.ok(Object.isFrozen(FACE_CROP)&&Object.isFrozen(DEFAULT_FACE));
});

test('faceFrame: the crop centre maps to the circle centre and the crop side to the circle side',()=>{
  for(const id of [...classes.map(c=>c.id),'nao-existe']){
    const c=faceCrop(id),f=faceFrame(id),side=f.zoom*100;
    assert.ok(close(f.zoom,1/c.size),`${id}: zoom = 1/size`);
    // Image point (cx, cy) lands at 50% of the circle.
    assert.ok(close(f.left+c.cx*side,50)&&close(f.top+c.cy*side,50),`${id}: centre`);
    // The crop's side (size × image) is the circle's side.
    assert.ok(close(c.size*side,100),`${id}: side`);
  }
  // The default (unknown ids): 42% of the image, centred at (.5, .21) (cy .2 moved down to keep the square inside the image).
  const d=faceFrame('nao-existe');
  assert.ok(close(d.zoom,1/.42)&&close(d.left,50-.5*100/.42)&&close(d.top,0,1e-9));
});

test('faceCrop / faceFrame: clamp so the crop never leaves the image; unknown ids get DEFAULT_FACE',()=>{
  assert.deepEqual(faceCrop('nao-existe'),{cx:.5,cy:.21,size:.42});
  assert.deepEqual(faceCrop('constructor'),faceCrop('nao-existe'),'no prototype keys');
  const cases:[{cx:number;cy:number;size:number},{cx:number;cy:number;size:number}][]=[
    [{cx:0,cy:0,size:.4},{cx:.2,cy:.2,size:.4}],
    [{cx:1,cy:1,size:.4},{cx:.8,cy:.8,size:.4}],
    [{cx:.5,cy:.5,size:3},{cx:.5,cy:.5,size:1}],
    [{cx:.5,cy:.5,size:0},{cx:.5,cy:.5,size:.05}],
    [{cx:.5,cy:.5,size:-1},{cx:.5,cy:.5,size:.05}],
    [{cx:Number.NaN,cy:Number.POSITIVE_INFINITY,size:Number.NaN},{cx:.5,cy:.21,size:.42}],
  ];
  for(const [raw,want] of cases){
    const table={x:raw},got=faceCrop('x',table);
    for(const k of ['cx','cy','size'] as const)assert.ok(close(got[k],want[k]),`${JSON.stringify(raw)} ${k}: ${got[k]}`);
    // Even a bad entry gives a frame that covers the circle.
    const f=faceFrame('x',table),side=f.zoom*100;
    assert.ok(f.left<=1e-9&&f.top<=1e-9&&f.left+side>=100-1e-3&&f.top+side>=100-1e-3,JSON.stringify(raw));
  }
  // A full-image crop is the identity frame.
  assert.deepEqual(faceFrame('x',{x:{cx:.5,cy:.5,size:1}}),{...FULL_FRAME});
});

test('faceVars / varsText: the custom properties ui/face.css reads',()=>{
  const v=faceVars('tio-do-churrasco'),f=faceFrame('tio-do-churrasco');
  assert.deepEqual(Object.keys(v),['--face-z','--face-x','--face-y']);
  assert.equal(v['--face-z'],String(f.zoom));assert.equal(v['--face-x'],`${f.left}%`);assert.equal(v['--face-y'],`${f.top}%`);
  assert.equal(varsText(v),`--face-z:${f.zoom};--face-x:${f.left}%;--face-y:${f.top}%`);
  assert.doesNotMatch(varsText(v),/-0%|NaN|Infinity/);
});

test('faceExpression: every state and the documented priority',()=>{
  const base={hp:80,maxHp:100};
  assert.equal(faceExpression(base),'normal');
  assert.equal(faceExpression({hp:31,maxHp:100}),'normal');
  assert.equal(faceExpression({hp:30,maxHp:100}),'ferido','30% is already ferido');
  assert.equal(faceExpression({hp:1,maxHp:100}),'ferido');
  assert.equal(HURT_FRACTION,.3);
  assert.equal(faceExpression({hp:0,maxHp:0}),'normal','no max HP: no ferido');
  assert.equal(faceExpression({hp:0,maxHp:100}),'normal','0 HP and not down (spectator, offline): no ferido');
  assert.equal(faceExpression({hp:-5,maxHp:100}),'normal');
  assert.equal(faceExpression({hp:Number.NaN,maxHp:100}),'normal');
  assert.equal(faceExpression({...base,downed:true}),'caido');
  assert.equal(faceExpression({...base,eliminated:true}),'caido');
  assert.equal(faceExpression({...base,emote:'kkkk'}),'rindo');
  assert.equal(faceExpression({...base,emote:'salva'}),'normal','other emotes keep the face');
  assert.equal(faceExpression({...base,outcome:'victory'}),'rindo');
  assert.equal(faceExpression({...base,outcome:'defeat'}),'bravo');
  assert.equal(faceExpression({...base,outcome:'timeout'}),'normal');
  // Priority: outcome (result screen) > caido > KKKK > ferido > normal. A normal defeat ends with everyone down or out,
  // and the result still shows bravo; a winner who ended down laughs.
  assert.equal(faceExpression({hp:0,maxHp:100,downed:true,outcome:'defeat',emote:'kkkk'}),'bravo');
  assert.equal(faceExpression({hp:0,maxHp:100,eliminated:true,outcome:'defeat'}),'bravo');
  assert.equal(faceExpression({hp:10,maxHp:100,eliminated:true,outcome:'victory'}),'rindo');
  assert.equal(faceExpression({hp:0,maxHp:100,downed:true,outcome:'timeout'}),'caido','timeout is no outcome face');
  assert.equal(faceExpression({hp:0,maxHp:100,downed:true,emote:'kkkk'}),'caido','in the run, down beats the laugh');
  assert.equal(faceExpression({hp:10,maxHp:100,outcome:'defeat',emote:'kkkk'}),'bravo');
  assert.equal(faceExpression({hp:10,maxHp:100,outcome:'victory'}),'rindo');
  assert.equal(faceExpression({hp:10,maxHp:100,emote:'kkkk'}),'rindo','laughing beats hurt');
  assert.deepEqual([...FACE_EXPRESSIONS],['normal','ferido','caido','rindo','bravo']);
  assert.equal(faceKey('tio-do-churrasco','rindo'),'rosto:tio-do-churrasco:rindo');
});

test('importedFaceUrl / faceSource: exact expression, else the class normal, else the portrait crop',()=>{
  const have=new Set(['tio-do-churrasco-normal','tio-do-churrasco-rindo','streamer-bravo']);
  const exact:ExactFace=(id,expr)=>have.has(`${id}-${expr}`)?`/art/rostos/${id}-${expr}.webp`:null;
  assert.equal(importedFaceUrl('tio-do-churrasco','rindo',exact),'/art/rostos/tio-do-churrasco-rindo.webp');
  assert.equal(importedFaceUrl('tio-do-churrasco','caido',exact),'/art/rostos/tio-do-churrasco-normal.webp','missing expression: the normal face');
  assert.equal(importedFaceUrl('streamer','bravo',exact),'/art/rostos/streamer-bravo.webp');
  assert.equal(importedFaceUrl('streamer','ferido',exact),null,'no normal either: null');
  assert.equal(importedFaceUrl('pedreiro','normal',exact),null);

  const art=faceSource('tio-do-churrasco',{expression:'caido',exact});
  assert.deepEqual(art,{src:'/art/rostos/tio-do-churrasco-normal.webp',frame:{...FULL_FRAME},art:true,expression:'caido'},'an imported face fills the circle');
  const crop=faceSource('pedreiro',{expression:'ferido',exact});
  assert.deepEqual(crop,{src:'/art/portraits/pedreiro-thumb.webp',frame:faceFrame('pedreiro'),art:false,expression:'ferido'});
  assert.equal(faceSource('pedreiro',{portrait:id=>`/x/${id}.webp`}).src,'/x/pedreiro.webp','the HUD hands its own portrait URL');
  // Default lookup: the art manifest, empty today, so every class and expression is the crop.
  for(const {id} of classes)for(const e of FACE_EXPRESSIONS){
    assert.equal(importedFaceUrl(id,e),null);
    assert.equal(faceSource(id,{expression:e}).art,false);
  }
});

test('faceSource px: the 768 portrait when the thumb crop would upscale past 1.2x at DPR 3',()=>{
  // Result cards at 64 px: every class (crop at most .5 × 256 = 128 thumb px, the circle wants 192).
  for(const {id} of classes){
    assert.equal(needsLargePortrait(id,64),true,id);
    assert.equal(faceSource(id,{px:64}).src,`/art/portraits/${id}-768.webp`,id);
    assert.deepEqual(faceSource(id,{px:64}).frame,faceFrame(id),'same framing, same crop');
    // The arrows (26 px) and the chips (24) never need it; the team strip (38 px) does not pass px (it stays on the thumb).
    for(const px of [26,24])assert.equal(needsLargePortrait(id,px),false,`${id} at ${px}`);
  }
  // The rule itself: px × 3 > size × 256 × 1.2.
  const edge=faceCrop('maromba').size*256*1.2/3;
  assert.equal(needsLargePortrait('maromba',Math.floor(edge)),false);
  assert.equal(needsLargePortrait('maromba',Math.ceil(edge+.01)),true);
  assert.equal(faceSource('tio-do-churrasco').src,'/art/portraits/tio-do-churrasco-thumb.webp','no px: the thumb');
  assert.equal(faceSource('tio-do-churrasco',{px:64,portraitLarge:id=>`/big/${id}.webp`}).src,'/big/tio-do-churrasco.webp');
  assert.equal(portrait768('motogirl'),'/art/portraits/motogirl-768.webp');
  // An imported face is used whatever the size.
  assert.equal(faceSource('tio-do-churrasco',{px:64,exact:()=>'/art/rostos/tio-do-churrasco-normal.webp'}).src,'/art/rostos/tio-do-churrasco-normal.webp');
});

test('manifestFace: reads group rostos `<id>-<expr>` from the art manifest',()=>{
  const index:ArtIndex={version:2,groups:{rostos:{output:'public/art/rostos',pieces:{
    'tio-do-churrasco-normal':{kind:'face',files:{sheet:{file:'tio-do-churrasco-normal.webp',cell:[256,256]}}},
  }}}};
  setArtIndex(index);
  try{
    assert.equal(manifestFace('tio-do-churrasco','normal'),'/art/rostos/tio-do-churrasco-normal.webp');
    assert.equal(manifestFace('tio-do-churrasco','bravo'),null);
    assert.equal(importedFaceUrl('tio-do-churrasco','bravo'),'/art/rostos/tio-do-churrasco-normal.webp');
    assert.equal(faceSource('tio-do-churrasco',{expression:'bravo'}).art,true);
    assert.equal(faceSource('streamer').art,false);
  }finally{setArtIndex({version:2,groups:{}});}
});

test('faceHtml: circle + img with the crop vars, empty circle for an unknown class, escaped',()=>{
  const html=faceHtml('tio-do-churrasco',{className:'coop-wait-face',tag:'i'});
  assert.match(html,/^<i class="face coop-wait-face" data-face="normal" data-art="false" style="--face-z:[\d.]+;--face-x:-[\d.]+%;--face-y:[\d.-]+%" aria-hidden="true"><img class="face-img" alt="" decoding="async" draggable="false" src="\/art\/portraits\/tio-do-churrasco-thumb\.webp"><\/i>$/);
  assert.equal(faceHtml(undefined,{className:'x'}),'<span class="face x" aria-hidden="true"></span>');
  assert.match(faceHtml('tio-do-churrasco',{src:'/a"b.webp'}),/src="\/a&quot;b\.webp"/);
  assert.match(faceHtml('tio-do-churrasco',{alt:'Tio do Churrasco'}),/alt="Tio do Churrasco"/);
  assert.doesNotMatch(faceHtml('tio-do-churrasco',{alt:'Tio do Churrasco'}),/aria-hidden/);
  const expr:FaceExpression='caido';
  assert.match(faceHtml('tio-do-churrasco',{expression:expr}),/data-face="caido"/);
});

test('portraitClass: the class id of a portrait URL (edge arrows get a URL only)',()=>{
  assert.equal(portraitClass('/art/portraits/merendeira-thumb.webp'),'merendeira');
  assert.equal(portraitClass('/art/portraits/merendeira.webp'),'merendeira');
  assert.equal(portraitClass('/art/portraits/merendeira-768.webp'),'merendeira');
  assert.equal(portraitClass('https://x.test/art/portraits/streamer-thumb.webp?v=2'),'streamer');
  assert.equal(portraitClass('/art/lite/sprites/tio-do-churrasco.webp'),undefined);
  assert.equal(portraitClass(undefined),undefined);
});

test('wiring: team strip, result cards, edge arrows and lobby chips draw faces through ui/face-crop.ts',()=>{
  const team=src('src/client/hud/team.ts'),result=src('src/client/hud/result.ts'),edges=src('src/client/hud/edges.ts'),lobby=src('src/client/lobby.ts');
  for(const [name,code] of [['team',team],['result',result],['edges',edges],['lobby',lobby]] as const)
    assert.match(code,/from '\.{1,2}\/ui\/face-crop\.ts'/,`${name} imports face-crop`);
  // Team strip: the face replaces the full-body <img>; the ring, the badge and the state filters stay.
  assert.match(team,/faceImg\(document,player\.classId,\{className:'rh-member-img'/);
  assert.match(team,/setFace\(nodes\.face,player\.classId,\{expression/);
  assert.match(team,/faceExpression\(\{hp:player\.hp,maxHp:player\.maxHp,downed:!!player\.downed,eliminated:player\.eliminated,emote:ctx\.mood\?\.\(player\.id\)\}\)/);
  assert.doesNotMatch(team,/el\('img','rh-member-img'/);
  assert.match(team,/el\('div','rh-member-ring',item\)/);
  // Result card: face with the run's outcome.
  assert.match(result,/faceImg\(document,player\.classId,\{className:'rh-rcard-img',expression/);
  assert.match(result,/outcome:ctx\.victory\?'victory':'defeat'/);
  assert.match(result,/portrait:ctx\.portrait,px:ctx\.facePx\}/);
  assert.match(result,/facePx:count<=2\?RESULT_FACE_PX\.big:RESULT_FACE_PX\.card/);
  for(const [name,code] of [['team',team],['edges',edges],['lobby',lobby]] as const)assert.doesNotMatch(code,/(faceHtml|faceImg|setFace)\([^)]*\bpx:/,`${name} stays on the thumb`);
  assert.doesNotMatch(result,/el\('img','rh-rcard-img'/);
  // Edge arrow: the ally's face from the portrait URL it was handed.
  assert.match(edges,/faceHtml\(id,a\.portrait\?\{src:a\.portrait\}:\{\}\)/);
  // Lobby chips: a 24 px face left of the name in both chip shapes; robot and crown stay.
  assert.match(lobby,/faceHtml\(m\.classId,\{className:'coop-wait-face',tag:'i'\}\)/);
  assert.match(lobby,/\$\{ask\?icon\(out\):status\}\$\{face\}<span>/);
  assert.match(lobby,/\$\{robot\}\$\{status\}\$\{face\}<span/);
  assert.match(lobby,/coop-wait-botmark/);assert.match(lobby,/coop-wait-crown/);
  // CSS: one shared .face rule set, loaded once by style.css (main.ts: the game and every sandbox) before the parts' own
  // CSS; the parts keep only size, ring and filters.
  const hudCss=HUD_CSS,coopCss=src('src/client/coop.css'),faceCss=src('src/client/ui/face.css');
  assert.match(src('src/client/style.css'),/^@import url\('\.\/ui\/tokens\.css'\);\n@import url\('\.\/ui\/face\.css'\);/);
  assert.match(src('src/main.ts'),/^import '\.\/client\/style\.css';/);
  const loads=['src/client/hud/hud.ts','src/client/lobby.ts','src/client/hud/hud.css','src/client/coop.css'].filter(f=>/(import\s*\(?\s*|@import url\()'[^']*face\.css'/.test(src(f)));
  assert.deepEqual(loads,[],'face.css is loaded from style.css only');
  assert.match(faceCss,/\.face\{[^}]*overflow:hidden[^}]*border-radius:var\(--r-circulo\)/);
  assert.match(faceCss,/\.face-img\{[^}]*left:var\(--face-x[^}]*top:var\(--face-y[^}]*width:calc\(var\(--face-z/);
  assert.doesNotMatch(hudCss,/object-position:50% 12%/,'no more squeezed full body');
  assert.match(hudCss,/\.rh-member\[data-state=downed\] \.rh-member-img\{filter:grayscale/);
  assert.match(hudCss,/\.rh-member\[data-state=eliminated\] \.rh-member-img\{filter:grayscale/);
  assert.match(coopCss,/\.coop-wait-members \.coop-wait-face\{width:24px;height:24px/);
});

test('no faces on minimap marks or emote balloons (too small / over the hero itself)',()=>{
  for(const path of ['src/client/fun/emotes.ts']){
    const code=src(path);
    assert.doesNotMatch(code,/face-crop\.ts/,path);
    assert.match(code,/rostos-hud/,`${path} says why`);
  }
  // The WC3 minimap draws teammates as coloured dots on its canvas (wc-minimap/*), never a face.
  for(const path of ['src/client/hud/wc-minimap/minimap.ts','src/client/hud/wc-minimap/driver.ts'])assert.doesNotMatch(src(path),/face-crop\.ts/,path);
});
