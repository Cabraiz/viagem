/**
 * BUG-20261013-ORQ-oferta-e-dicas-menores: the offer window is compact: one header row (the clock a thin bar on its top
 * edge, a clock icon for "vai no automático se acabar o tempo", a small "Depois" with a 48 px target) and one row of
 * whole tags that shrink together (no "Mais N", no scrolling), at most half of the old window at 1335x620, 844x390 and
 * 390x844 (the budget below, read from hud.css). The pure "Mais N" helpers of overflow.ts keep their tests.
 *
 * Before (BUG-20261012-ORQ-oferta-cortada-retrato): in a 390x844 portrait the "Tudo novo!" window cut its third tag at the list's
 * bottom edge with no sign of scrolling. Three one-line tags must fit the 32% window at 100% text; what still does not
 * fit (125%, a caído ficha, long effects) shows "Mais N" (a 48 px target) in the cut strip or in its own row under the
 * list, never over a whole tag and 8 px clear of the foot's buttons, and a soft fade over the cut part. Landscape
 * (844x390): both buttons in the header row and one column of tags in a window only as wide as the caído/chefe arrows
 * allow beside it: two whole tags and "Mais N" in the cut strip. Pure parts only (no DOM): the counts, the step, the
 * cue copy and placement, and the budgets read from hud.css.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {CUE_TARGET,CUT_TOLERANCE,FOOT_GAP,FADE_MAX,cueClear,cueLayout,cutRoom,hiddenCards,moreCue,nextCardScroll,scrollBehavior,type Box,type Span} from '../../src/client/hud/overflow.ts';
import {AUTO_NOTE,LANDSCAPE_QUERY,LATER_LABEL,TAKE_ALL_LABEL,isAllNew} from '../../src/client/hud/offer.ts';
import {MIN_PLAY_SIDE,computeZones,crosses,type ZoneInput} from '../../src/client/hud/zones.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';
import {HUD_CSS} from './hud-css.ts';

/** A column of `heights` tags `gap` apart, starting `pad` px under the list's top, scrolled by `scroll`. */
function column(heights:readonly number[],gap:number,pad=6,scroll=0):Span[]{
  let y=pad-scroll;
  return heights.map(h=>{const s={top:y,bottom:y+h};y+=h+gap;return s;});
}

test('hiddenCards counts the tags cut below the visible part, not the ones above or the tilt',()=>{
  const view={top:0,bottom:160};
  assert.equal(hiddenCards(column([46,46,46],4),view),0,'three one-line tags in 160 px');
  // The production window before the fix: about 145 px for the list, the third tag cut.
  assert.equal(hiddenCards(column([46,46,46],6),{top:0,bottom:145}),1);
  assert.equal(hiddenCards(column([62,62,62,62],4),{top:0,bottom:145}),2,'two below the second');
  // A tilted tag pokes ~2.4 px past its box: within the tolerance it is still whole.
  assert.equal(hiddenCards([{top:6,bottom:view.bottom+CUT_TOLERANCE}],view),0);
  assert.equal(hiddenCards([{top:6,bottom:view.bottom+CUT_TOLERANCE+1}],view),1);
  // Scrolled to the end: the first tag went up (read already), nothing waits below, so the cue goes.
  const tall=column([62,62,62],4);const end=tall[2].bottom+6-145;
  assert.equal(hiddenCards(column([62,62,62],4,6,end),{top:0,bottom:145}),0);
  // A hidden list (zero box) or display:none tags (zero height) never show the cue.
  assert.equal(hiddenCards(column([46,46,46],4),{top:0,bottom:0}),0);
  assert.equal(hiddenCards([{top:200,bottom:200}],view),0);
});

test('hiddenCards on the 2x2 of four tags counts both tags of a cut row',()=>{
  const row=(top:number,h:number):Span[]=>[{top,bottom:top+h},{top,bottom:top+h}];
  const grid=[...row(6,120),...row(130,120)];
  assert.equal(hiddenCards(grid,{top:0,bottom:160}),2);
  assert.equal(hiddenCards(grid,{top:0,bottom:100}),4);
});

test('"Mais N" scrolls by one tag: the next row goes to the top, where the list snaps',()=>{
  const view={top:100,bottom:260};
  const tags=column([46,46,46],4).map(s=>({top:s.top+100,bottom:s.bottom+100}));
  assert.equal(nextCardScroll(tags,view),50,'one tag (46) and its gap (4)');
  // After that step the second tag is at the top: the next step is the third.
  const moved=tags.map(s=>({top:s.top-50,bottom:s.bottom-50}));
  assert.equal(nextCardScroll(moved,view),50);
  // Tilt: the first tag's box rises ~2 px above the snap line; it is not "the next one".
  const tilted=[{top:100+6-2.4,bottom:150},...tags.slice(1)];
  assert.equal(nextCardScroll(tilted,view),50);
  // 2x2: both tags of the second row share a top, so a step is a row.
  const grid=[{top:106,bottom:226},{top:106,bottom:226},{top:230,bottom:350},{top:230,bottom:350}];
  assert.equal(nextCardScroll(grid,view),124);
  // No next tag (one tall tag): most of a view.
  assert.equal(nextCardScroll([{top:106,bottom:400}],view),128);
});

test('the cue copy: pt-BR, sentence case, no arrow, no emoji; it shows only while a tag is cut',()=>{
  assert.deepEqual(moreCue(0),{show:false,label:'Mais 0',aria:'Mais 0 opções abaixo. Toca pra rolar.'});
  assert.deepEqual(moreCue(1),{show:true,label:'Mais 1',aria:'Mais 1 opção abaixo. Toca pra rolar.'});
  assert.equal(moreCue(2).label,'Mais 2');assert.equal(moreCue(2).aria,'Mais 2 opções abaixo. Toca pra rolar.');
  for(const n of [1,2,3]){const {label,aria}=moreCue(n);
    for(const text of [label,aria]){assert.doesNotMatch(text,/[→⌄↓]|\p{Extended_Pictographic}/u);assert.notEqual(text,text.toUpperCase());}}
  assert.equal(scrollBehavior(true),'auto','reduced motion: the step jumps');
  assert.equal(scrollBehavior(false),'smooth');
});

test('fixture offer-new is the production "Tudo novo!" window: three Nv 1 tags with the round offer queued',()=>{
  const view=fakeView('offer-new',1);
  assert.equal(view.round?.phase,'prepare');
  assert.equal(view.offers.length,2,'a queue, so "Levar os indicados" shows');
  const [head]=view.offers;
  assert.equal(head.source,'level');assert.equal(head.choices.length,3);
  assert.ok(isAllNew(head),'every tag is a first pick: the title says "Tudo novo!"');
  assert.deepEqual(head.choices.map(c=>c.itemId),['guarda-chuva','bone','pombo']);
});

// ---------- The compact window (BUG-20261013-ORQ-oferta-e-dicas-menores), from hud.css itself ----------
const CSS=HUD_CSS;
const OFFER_TS=readFileSync(new URL('../../src/client/hud/offer.ts',import.meta.url),'utf8');
type Decl={selector:string;prop:string;value:string;line:number};
const DECLS=declarations(CSS) as Decl[];
const PORTRAIT='@media (min-height:501px)',LANDSCAPE='@media (max-height:500px)';
/** The value of `prop` in the last rule whose whole selector chain is `selector` (inside `media`, if given). */
function value(selector:string,prop:string,media?:string){
  const chain=media?`${media} ${selector}`:selector;
  const found=DECLS.filter(d=>d.selector===chain&&d.prop===prop).at(-1);
  assert.ok(found,`hud.css: ${chain} { ${prop} }`);
  return found.value;
}
const px=(v:string)=>{const m=v.match(/^(-?[\d.]+)(?:px)?$/);assert.ok(m,`px value: ${v}`);return Number(m[1]);};
const box=(v:string)=>{const p=v.split(/\s+/).map(px);return {top:p[0],right:p[1]??p[0],bottom:p[2]??p[0],left:p[3]??p[1]??p[0]};};
const cssVar=(selector:string,name:string,media?:string)=>px(value(selector,name,media));

/**
 * The window's box with `cards` tags (and the "Levar os indicados" tile when `takeAll`) at 100% text, each tag only its
 * sticker (image-only tags, user 13/10), from the sizes in hud.css; `room` is the width the screen leaves it.
 */
function compact(orientation:'portrait'|'landscape',cards:number,takeAll:boolean,room:number){
  const media=orientation==='landscape'?LANDSCAPE:undefined;
  const pad=box(value('.rh-offer','padding',media)),border=2;
  const card=media?cssVar('.rh-offer','--of-card',LANDSCAPE):cssVar('.rh-offer','--of-card');
  const gap=px(value('.rh-offer-cards','gap'));
  const tile=takeAll?card+6+px(value('.rh-offer-foot','margin-left')):0;
  const natural=cards*card+(cards-1)*gap+tile+pad.left+pad.right+2*border;
  const width=Math.min(natural,room);
  const head=px(value('.rh-offer-head','min-height'))+px(value('.rh-offer-head','margin-bottom'));
  const cp=box(value('.rh-card','padding')),icon=px(value('.rh-card-icon','height'));
  const tag=2*border+cp.top+cp.bottom+icon;
  const height=pad.top+pad.bottom+2*border+head+tag;
  return {width,height,area:width*height,natural,card:(width-natural+cards*card)/cards};
}

test('the offer is one header row and one row of whole tags: no "Mais N", no scrolling list, no foot line',()=>{
  // No "Mais N" cue, fade or scroll box any more (offer.ts builds none; hud.css draws none).
  assert.equal(DECLS.some(d=>d.selector.includes('rh-offer-more')),false,'no "Mais N" rules');
  assert.doesNotMatch(OFFER_TS,/rh-offer-more|watchOverflow|cueLayout/,'offer.ts has no "Mais N" cue');
  assert.equal(DECLS.some(d=>/rh-offer/.test(d.selector)&&/^overflow(-y)?$/.test(d.prop)&&/auto|scroll/.test(d.value)),false,'nothing in the window scrolls');
  assert.equal(DECLS.some(d=>/rh-offer\[data-mode=intermission\]$/.test(d.selector)&&d.prop==='max-height'),false,'no height cap that would cut a tag');
  // One row: every tag a column, at most --of-card wide, all shrinking together (minmax(0, …)).
  assert.equal(value('.rh-offer-cards','grid-auto-flow'),'column');
  assert.equal(value('.rh-offer-cards','grid-auto-columns'),'minmax(0,var(--of-card))');
  assert.equal(DECLS.some(d=>d.selector.includes('.rh-offer-cards[data-count')),false,'no 2x2 for four: one row');
  // The window is as wide as its row and never wider than the screen leaves it (the tags shrink, never cut).
  assert.equal(value('.rh-offer','width'),'max-content');
  assert.equal(value('.rh-offer','max-width'),'calc(100vw - var(--rh-l) - var(--of-left) - var(--rh-r))');
  assert.equal(value('.rh-offer','max-width',LANDSCAPE),'var(--of-w)');
  // The tag: sticker, short name (two lines at most), price; the effect is a tooltip (hover, focus, a held finger).
  assert.equal(value('.rh-card-name','-webkit-line-clamp'),'2');
  assert.equal(value('.rh-card-blurb','position'),'absolute');
  assert.equal(value('.rh-card-blurb','visibility'),'hidden');
  assert.equal(value('.rh-card:is(:focus-visible,:active) .rh-card-blurb','visibility'),'visible');
  assert.equal(value('@media (hover:hover) .rh-card:hover .rh-card-blurb','visibility'),'visible');
  assert.ok(px(value('.rh-card','min-height'))>=44,'a tag is still a 44 px target');
  // The clock: a thin bar on the top edge (absolute: it costs no row) and a clock icon for the old foot line.
  assert.equal(value('.rh-offer-deadline','position'),'absolute');
  assert.ok(px(value('.rh-offer-deadline','height'))<=4,'a thin bar');
  assert.match(OFFER_TS,/el\('span','rh-offer-auto',head\);note\.setAttribute\('role','img'\);note\.setAttribute\('aria-label',AUTO_NOTE\)/,'the clock icon says the old line');
  assert.equal(AUTO_NOTE,'vai no automático se acabar o tempo');
  assert.equal(value('.rh-offer-auto','border-radius'),'var(--r-circulo)');
});

test('"Depois" is small but a 48 px target; "Levar os indicados" is the row\'s last tile; neither is an absolute corner',()=>{
  assert.deepEqual(DECLS.filter(d=>/\.rh-offer-(all|later|foot)$/.test(d.selector)&&d.prop==='position'&&d.value==='absolute').map(d=>d.selector),[]);
  assert.equal(px(value('.rh .rh-offer-later','min-height')),24,'drawn 24 px tall');
  const hit=box(value('.rh .rh-offer-later::before','inset'));
  assert.equal(value('.rh .rh-offer-later::before','position'),'absolute');
  assert.ok(24-hit.top-hit.bottom>=44,`its target is ${24-hit.top-hit.bottom} px tall`);
  assert.equal(value('.rh .rh-offer-later','position'),'relative');
  assert.match(OFFER_TS,/el\('button','rh-offer-later',head\)/,'"Depois" in the header row');
  assert.equal(px(value('.rh .rh-offer-all','min-height')),48,'the tile: a 48 px target');
  assert.equal(value('.rh-offer','grid-template-areas'),"'head head' 'fall fall' 'cards foot'");
  assert.equal(value('.rh-offer:not(:has(.rh-offer-all:not([hidden]))) .rh-offer-foot','display'),'none');
  // The offer list lost the Breu cut edge (the forge keeps it, untouched).
  assert.equal(DECLS.some(d=>d.selector.includes('.rh-offer-cards[data-more=true]')),false);
  assert.equal(value('.rh-forge-tags[data-more=true]::after','border-bottom'),'3px solid var(--c-breu)');
});

/** Today's windows (main before this card), from the old hud.css: what the new one must halve. */
const BEFORE={
  // 1335x620 is a "portrait" layout here (height > 500): 460 px wide, capped at 32% of the height (the tags overflowed).
  desktop:{width:460,height:.32*620},
  // 844x390: --of-w (378 px) wide, from the top band down to 24 px over the skill button (196 px).
  landscape:{width:378,height:196},
  // 390x844: right of the team column (312 px), capped at 32svh (270 px; "Tudo novo!" reached it).
  portrait:{width:390-8-62-8,height:.32*844},
};
test('the compact window is at most half of today\'s at 1335x620, 844x390 and 390x844 (3 tags + tile, and 4 tags)',()=>{
  const rooms={desktop:1335-8-62-8,landscape:Math.min(340,.4*844),portrait:390-8-62-8};
  assert.equal(value('.rh','--of-w',LANDSCAPE),'min(340px,40vw)');
  for(const [name,orientation] of [['desktop','portrait'],['landscape','landscape'],['portrait','portrait']] as const)
    for(const [cards,takeAll] of [[3,true],[4,false],[3,false]] as const){
      const now=compact(orientation,cards,takeAll,rooms[name]),before=BEFORE[name];
      const ratio=now.area/(before.width*before.height);
      assert.ok(ratio<=.5,`${name}, ${cards} tags${takeAll?' + tile':''}: ${Math.round(now.width)}x${Math.round(now.height)} is ${(ratio*100).toFixed(0)}% of ${Math.round(before.width)}x${Math.round(before.height)}`);
      // Whole tags: on a narrow screen they shrink together, never below a readable width.
      assert.ok(now.card>=60,`${name}: tags ${now.card.toFixed(0)} px wide`);
    }
  // The 125% portrait keeps one row too: the column moves right and the tags shrink (taller names, never cut).
  assert.equal(value(':root[data-texto="125"] .rh-offer','--of-left',PORTRAIT),'max(86px,var(--rh-coluna,54px) + 8px)');
  const narrow=compact('portrait',4,false,390-8-86-8);
  assert.ok(narrow.card>=60,`125%: tags ${narrow.card.toFixed(0)} px wide`);
});

// ---------- The "Mais N" helpers (overflow.ts) the offer used before; kept, pure, for any scrolling list ----------
/** Tilted 370 px tags of 44 px (landscape, ±0.5°): their boxes reach 1.6 px past the layout box on both sides. */
const tilted=(layoutTop:number,h=44,tilt=1.6)=>({top:layoutTop-tilt,bottom:layoutTop+h+tilt});
const wide=(s:Span,left=105,right=371):Box=>({...s,left,right});

test('cueLayout (pure): "Mais N" in the cut strip when its 48 px target fits there, else in its own row; never on a whole tag',()=>{
  assert.equal(CUE_TARGET,48,'design CHECKLIST A.11');assert.equal(FOOT_GAP,8);
  // Measured in Chromium (2026-10-12): the list's box, its tags' boxes, the room under it, and where the cue must go.
  const cases:{name:string;view0:Span;tags:Span[];below:number;mode:'over'|'row';hidden:number}[]=[
    // Landscape 100%, 3 tags of 44 px in one column: two whole, the third cut; the strip (44 px) and the window's
    // padding and edge under the list (6) hold the target: no height spent.
    {name:'landscape 100%, 3 tags',view0:{top:106,bottom:250},tags:[tilted(112),tilted(160),tilted(208)],below:6,mode:'over',hidden:1},
    // Portrait 100%, offer-round's 2x2 (tall tags): the first row whole, the second 69% in view; 8 px kept over the foot.
    {name:'portrait 100%, 4 tags',view0:{top:449,bottom:627},tags:[[452,560],[452,560],[562,670],[562,670]].map(([top,bottom])=>({top,bottom})),below:-FOOT_GAP,mode:'over',hidden:2},
    // Portrait 125%, the production "Tudo novo!": two whole tags leave 14 px, the target needs 56 (48 + 8 over the
    // foot): its own row (the pill used to lie on the end of "Boné do Pai"'s effect).
    {name:'portrait 125%, Tudo novo!',view0:{top:452.9,bottom:627},tags:[[456.6,535.2],[535.1,612.8],[612.6,691.2]].map(([top,bottom])=>({top,bottom})),below:-FOOT_GAP,mode:'row',hidden:2},
    // Portrait 100% with a caído ficha (offer-downed): 26 px under the second tag: its own row.
    {name:'portrait 100%, caído',view0:{top:480.5,bottom:627},tags:[[484.1,550.9],[550.6,600.8],[600.5,667.3]].map(([top,bottom])=>({top,bottom})),below:-FOOT_GAP,mode:'row',hidden:2},
    // Portrait 125%, offer-prepare: the second tag cut by 2.5 px reads as whole; its own row keeps the one whole tag.
    {name:'portrait 125%, barely cut',view0:{top:449,bottom:627},tags:[[452.5,531],[531,629.5],[629,708]].map(([top,bottom])=>({top,bottom})),below:-FOOT_GAP,mode:'row',hidden:2},
  ];
  for(const c of cases){
    const cue=cueLayout(c.tags,c.view0,c.below);
    assert.equal(cue.mode,c.mode,`${c.name}: ${cue.mode}`);
    assert.equal(cue.hidden,c.hidden,`${c.name}: "Mais ${cue.hidden}"`);
    assert.equal(cue.row,CUE_TARGET+Math.max(0,-c.below),`${c.name}: the row it would take`);
    const view=cue.mode==='row'?{top:c.view0.top,bottom:c.view0.bottom-cue.row}:c.view0;
    const tags=c.tags.map(t=>wide(t));
    assert.equal(cue.target!.bottom-cue.target!.top,CUE_TARGET,`${c.name}: a 44 px target`);
    assert.ok(cueClear(wide(cue.target!),tags,view),`${c.name}: "Mais ${cue.hidden}" clear of the whole tags`);
    assert.ok(cueClear(wide({top:view.bottom-cue.fade,bottom:view.bottom}),tags,view),`${c.name}: the fade (${cue.fade} px) clear of them`);
    assert.ok(cue.fade>=0&&cue.fade<=FADE_MAX);
    assert.ok(cue.target!.bottom<=c.view0.bottom+c.below,`${c.name}: inside the window, 8 px over the portrait foot (its top is view0's bottom)`);
  }
  // Nothing cut (scrolled to the end): no cue. The old placement (over the list, 8 px above its bottom) failed.
  assert.equal(cueLayout([[386.6,465.2],[465.1,542.8],[542.6,621.2]].map(([top,bottom])=>({top,bottom})),{top:452.9,bottom:627}).mode,'none');
  const prod=cases[2];
  assert.equal(cueClear({top:575,bottom:619,left:274,right:370},prod.tags.map(t=>wide(t)),prod.view0),false);
  // The choice reads the list as tall as without the row, so the row coming in does not flip it back.
  const rowNow=cueLayout(prod.tags,{top:prod.view0.top,bottom:prod.view0.bottom},-FOOT_GAP);
  assert.equal(rowNow.mode,'row');
});

test('cutRoom: the strip under the last whole tag, capped, never negative',()=>{
  assert.equal(cutRoom(column([46,46,46],4),{top:0,bottom:120}),Math.floor(120-(6+46+4+46)));
  assert.equal(cutRoom(column([46],4),{top:0,bottom:400}),FADE_MAX,'a long gap fades at most FADE_MAX');
  assert.equal(cutRoom([{top:6,bottom:120.5}],{top:0,bottom:120}),0,'a whole tag at the edge: no fade');
  assert.equal(cutRoom([{top:6,bottom:300}],{top:0,bottom:120}),FADE_MAX,'nothing whole: the fade from the top, capped');
  assert.equal(cutRoom([],{top:0,bottom:0}),0);
});

test('one "Mais N" step brings the next row whole into view, at the top',()=>{
  // Landscape 100%: after the step the second and third tags are whole (the fourth comes next).
  const view={top:107,bottom:250},tags=[tilted(113,44,3.2),tilted(161,44,3.2),tilted(209,44,3.2),tilted(257,44,3.2)];
  const step=nextCardScroll(tags,view);
  const after=tags.map(t=>({top:t.top-step,bottom:t.bottom-step}));
  assert.equal(Math.round(after[1].top),view.top+6,'the next row at the snap line');
  assert.equal(hiddenCards(after.slice(1,3),view),0,'the next row (and the one after) whole');
  // 2x2 of 125%: the row under the first, both its tags at once.
  const grid=[[110.9,178.9],[111.3,178.5],[178.7,266.2],[179.1,265.8]].map(([top,bottom])=>({top,bottom}));
  const g=nextCardScroll(grid,{top:107,bottom:250});
  assert.ok(grid.slice(2).every(t=>t.top-g>=107&&t.bottom-g<=250),'the second row whole in a view that holds it');
});

// ---------- Landscape 844x390 ----------
test('landscape 844x390: the window keeps the right column under the top band, its four tags whole in --of-w',()=>{
  assert.equal(value('.rh-offer','top',LANDSCAPE),'calc(var(--rh-t) + 52px)');
  assert.equal(value('.rh-offer','right',LANDSCAPE),'var(--rh-r)');
  assert.equal(value('.rh-offer','bottom',LANDSCAPE),'auto');
  const four=compact('landscape',4,false,Math.min(340,.4*844));
  assert.equal(four.width,four.natural,`four tags of ${cssVar('.rh-offer','--of-card',LANDSCAPE)} px fit ${Math.round(four.width)} px whole`);
  // 24 px over the skill button (94 px at 100%, 16 px floor), with room to spare.
  const rhT=8,botao=14+80;
  assert.ok(rhT+52+four.height+24<=390-16-botao,`the window ends at ${Math.round(rhT+52+four.height)}`);
  // The XP bar and the announcement slot keep left of it (their rules read --of-w, untouched by this card).
  assert.match(value('.rh:has(.rh-offer[data-mode=intermission]:not([hidden])) .rh-stack','right',LANDSCAPE),/var\(--of-w\)/);
});

/** The arrows (caído, chefe) need the field beside the window at least this wide: Chromium, 844x390, cenario=bordas
 * (the audit's "soma" and "janela" scenes): they all went at 302 px and stayed at 312 px and more. */
const ARROWS_FIELD=312;
test('landscape: the window leaves the field room for the hero and the caído/chefe arrows (zones.besideOffer)',()=>{
  const c=compact('landscape',4,false,Math.min(340,.4*844)),width=Math.round(c.width),offer={x:844-8-width,y:8+52,width,height:Math.ceil(c.height)};
  assert.ok(width<=Math.min(340,.4*844),`${width} px, within --of-w`);
  // The top band as laid out with the window open: the XP bar ends 16 px before the window.
  const xp={x:158,y:52,width:844-width-8-8-166,height:20};
  assert.ok(xp.x+xp.width<=offer.x-8,'the XP bar keeps left of the window');
  const input:ZoneInput={viewport:{width:844,height:390},status:[{x:14,y:12,width:136,height:44},{x:241,y:8,width:210,height:40},{x:460,y:8,width:228,height:40},{x:788,y:8,width:48,height:48},xp],
    team:{x:258,y:318,width:328,height:64},joystick:{x:14,y:280,width:96,height:96},skill:{x:744,y:286,width:82,height:82},chip:{x:670,y:307,width:52,height:52},
    minimap:{x:14,y:84,width:76,height:76},offer};
  const z=computeZones(input);
  assert.ok(z.useful.width>=ARROWS_FIELD&&z.useful.height>=MIN_PLAY_SIDE,`useful ${Math.round(z.useful.width)}x${Math.round(z.useful.height)}`);
  assert.equal(crosses(z.useful,offer),false,'the field is beside the window');
  assert.equal(crosses(z.useful,input.minimap!),false);
  // The window: under the top band's fichas, 24 px over the skill button and the chip, clear of the team row and the minimap.
  for(const r of input.status)assert.equal(crosses(offer,r!),false);
  assert.ok(offer.y+offer.height+24<=input.chip!.y&&offer.y+offer.height+24<=input.skill!.y);
  assert.equal(crosses(offer,input.team!),false);assert.equal(crosses(offer,input.minimap!),false);
  // The two-column window of the last round (min(60vw, 520px)) left 196 px: the arrows went.
  const old=computeZones({...input,offer:{...offer,x:844-8-506.4,width:506.4,height:196}});
  assert.ok(old.useful.width<ARROWS_FIELD);
});

test('LANDSCAPE_QUERY is hud.css\'s landscape breakpoint',()=>{
  assert.ok(DECLS.some(d=>d.selector.startsWith(`@media ${LANDSCAPE_QUERY}`)),LANDSCAPE_QUERY);
  assert.equal(`@media ${LANDSCAPE_QUERY}`,LANDSCAPE);
});

test('the foot labels stay sentence case pt-BR',()=>{
  assert.equal(TAKE_ALL_LABEL,'Levar os indicados');assert.equal(LATER_LABEL,'Depois');
});
