/**
 * BUG-20261012-ORQ-oferta-cortada-retrato: in a 390x844 portrait the "Tudo novo!" window cut its third tag at the list's
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
import {LANDSCAPE_QUERY,LATER_LABEL,TAKE_ALL_LABEL,isAllNew} from '../../src/client/hud/offer.ts';
import {MIN_PLAY_SIDE,computeZones,crosses,type ZoneInput} from '../../src/client/hud/zones.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';

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

// ---------- The portrait budget, from hud.css itself ----------
const CSS=readFileSync(new URL('../../src/client/hud/hud.css',import.meta.url),'utf8');
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
const box=(v:string)=>{const p=v.split(/\s+/).map(px);return {top:p[0],bottom:p[2]??p[0]};};

/** Text scale of the match tokens (tokens.css --t-N = N px at 100%). */
function budget(scale:1|1.25){
  const t=(n:number)=>n*scale;
  const viewport=844,cap=Number(value('.rh-offer[data-mode=intermission]','max-height',PORTRAIT).replace('svh',''))/100*viewport;
  const pad=box(value('.rh-offer','padding')),border=2;
  const chrome=pad.top+pad.bottom+2*border;
  // Header: title (21 px, 16 at 125%) and clock in one row, never under 22 px.
  const headMin=px(value('.rh-offer[data-mode=intermission] .rh-offer-head','min-height',PORTRAIT));
  const title=(scale===1?21:t(16))*1.05,clock=t(13)*1.2+2;
  const head=Math.max(headMin,title,clock);
  const deadline=px(value('.rh-offer-deadline','height'));
  const dm=box(value('.rh-offer[data-mode=intermission] .rh-offer-deadline','margin',PORTRAIT));
  const clockRow=deadline+dm.top+dm.bottom;
  // Foot: "Depois" and "Levar os indicados", both 48 px, in one row; no margin above it.
  const foot=Math.max(px(value('.rh .rh-offer-later','min-height')),px(value('.rh .rh-offer-all','min-height')));
  assert.equal(px(value('.rh-offer[data-mode=intermission] .rh-offer-foot','margin-top',PORTRAIT)),0);
  const list=cap-chrome-head-clockRow-foot;
  // The list: its top padding sits under a -6 px margin (the stars ride the tags' edge), its bottom one holds the tilt.
  const listPad=box(value('.rh-offer[data-mode=intermission] .rh-offer-cards','padding',PORTRAIT));
  const gap=px(value('.rh-offer[data-mode=intermission] .rh-offer-cards','gap',PORTRAIT));
  const cardPad=box(value('.rh-card','padding'));
  const oneLine=cardPad.top+cardPad.bottom+2*border+t(16)*1.05+t(13)*1.2;
  return {cap,chrome,head,clockRow,foot,list,gap,oneLine,listPad,content:list-listPad.bottom};
}

test('portrait 390x844 at 100%: three tags fit the 32% window without scrolling, offer-prepare\'s too',()=>{
  const b=budget(1);
  assert.ok(Math.abs(b.cap-270.08)<.01,'the cap stays at 32svh (scripts/audit-layout.cjs)');
  assert.ok(b.head<22.1,'the header is title and clock only');
  assert.equal(b.clockRow,11);assert.equal(b.foot,48);assert.equal(b.gap,4);assert.equal(b.listPad.bottom,4);
  const three=3*b.oneLine+2*b.gap;
  assert.ok(three<=b.content,`three tags ${three.toFixed(1)} px <= list ${b.content.toFixed(1)} px`);
  // offer-prepare (1p), measured in Chromium on 2026-10-12 (tilted boxes, from the list's top): its third tag poked
  // 2.8 px out of the old list; the list's box is now `list` + its 6 px top padding tall.
  const prepare=[[3.5,60.5],[60,110.4],[109.9,176.9]].map(([top,bottom])=>({top,bottom}));
  assert.equal(hiddenCards(prepare,{top:0,bottom:b.list+6}),0,`offer-prepare in ${(b.list+6).toFixed(1)} px`);
  assert.equal(hiddenCards(prepare,{top:0,bottom:174.1}),1,'the old list cut it, and now the cue would say so');
  // Before the fix: header 44 (with "Levar os indicados"), clock 16, gap 6: the third tag was cut.
  const before=b.cap-b.chrome-44-16-b.foot-6,beforeThree=3*b.oneLine+2*6;
  assert.ok(beforeThree>before,`before: ${beforeThree.toFixed(1)} > ${before.toFixed(1)}`);
});

test('portrait at 125%: the header stays one row; tags past the list scroll under "Mais N"',()=>{
  const b=budget(1.25);
  assert.ok(b.head<=22,'title (20 px) and clock (16 px) in one 22 px row');
  const tags=column([b.oneLine+t125Wrap(),b.oneLine+t125Wrap(),b.oneLine+t125Wrap()],b.gap);
  const hidden=hiddenCards(tags,{top:0,bottom:b.list});
  assert.ok(hidden>=1,'two-line effects at 125% do not fit: the cue shows');
  assert.equal(moreCue(hidden).show,true);
});
/** At 125% an effect line of ~30 characters wraps in the portrait window: one more 16.25 px line. */
function t125Wrap(){return 13*1.25*1.2;}

test('hud.css: "Levar os indicados" is never an absolute corner; portrait puts it in the foot beside "Depois"',()=>{
  assert.deepEqual(DECLS.filter(d=>/\.rh-offer-(all|later|foot)$/.test(d.selector)&&d.prop==='position').map(d=>d.selector),[]);
  assert.equal(px(value('.rh .rh-offer-all','min-height')),48,'a 48 px target, like "Depois"');
  assert.equal(px(value('.rh .rh-offer-later','min-height')),48);
  assert.equal(DECLS.some(d=>d.selector.startsWith(LANDSCAPE)&&/rh-offer-(all|later)$/.test(d.selector)&&d.prop==='min-height'),false,'48 px in landscape too');
  assert.equal(value('.rh-offer-foot','gap'),'8px','8 px between "Depois" and the choice');
  // The 125% portrait no longer stacks the clock under the title.
  assert.equal(DECLS.some(d=>d.selector.startsWith(PORTRAIT)&&/rh-offer-head$/.test(d.selector)&&d.prop==='flex-direction'),false);
  // The offer list lost the Breu cut edge (the forge keeps it, untouched); the fade uses tokens only.
  assert.equal(DECLS.some(d=>d.selector.includes('.rh-offer-cards[data-more=true]')),false);
  assert.equal(value('.rh-forge-tags[data-more=true]::after','border-bottom'),'3px solid var(--c-breu)');
  assert.match(value('.rh-offer-more::before','background'),/var\(--c-lilas\)/);
  assert.equal(value('.rh-offer-more::before','height'),'var(--of-fade,0px)','the fade only over the cut part');
  assert.equal(value('.rh-offer-more::before','bottom'),'100%','it lies over the list, from its bottom edge up');
  // A scrolled tag never covers the clock (portrait) or the header row (landscape), nor takes their taps: the list's
  // top padding (under them, for the first row's stars) is clipped once it scrolls, and the landscape header is above.
  assert.equal(value('.rh-offer[data-mode=intermission] .rh-offer-cards[data-scrolled=true]','clip-path'),'inset(6px 0 0)');
  assert.equal(value('.rh-offer[data-mode=intermission] .rh-offer-cards','margin',PORTRAIT),'-6px -8px 0');
  assert.equal(value('.rh-offer[data-mode=intermission] .rh-offer-cards','margin',LANDSCAPE),'-6px -6px 0');
  assert.equal(value('.rh-offer[data-mode=intermission] .rh-offer-head','z-index',LANDSCAPE),'1');
  assert.equal(DECLS.some(d=>d.selector.includes('rh-offer-fall-foot')),false,'no dead ficha rules');
});

/** Tilted 370 px tags of 44 px (landscape, ±0.5°): their boxes reach 1.6 px past the layout box on both sides. */
const tilted=(layoutTop:number,h=44,tilt=1.6)=>({top:layoutTop-tilt,bottom:layoutTop+h+tilt});
const wide=(s:Span,left=105,right=371):Box=>({...s,left,right});

test('"Mais N" lies in the cut strip when its 48 px target fits there, else in its own row; never on a whole tag',()=>{
  assert.equal(CUE_TARGET,48,'design CHECKLIST A.11');assert.equal(FOOT_GAP,8);
  assert.equal(value('.rh-offer-more','height'),'var(--of-row,48px)','the row: the target (+ 8 px over the portrait foot)');
  assert.equal(px(value('.rh-offer-more[data-place=over]','height')),0,'in the strip it costs no height');
  assert.equal(value('.rh .rh-offer-more[data-place=over] .rh-offer-more-btn','bottom'),'calc(0px - var(--of-below,0px))');
  assert.equal(px(value('.rh .rh-offer-more-btn','min-height')),48);assert.equal(px(value('.rh .rh-offer-more-btn','min-width')),48);
  assert.ok(px(value('.rh-offer-more-pill','min-height'))<=28,'the pill draws at most 28 px');
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
test('landscape 844x390: header row with both buttons; the list keeps two whole tags and the cue costs no height',()=>{
  // The window: --of-w wide, from --rh-t + 52 down to 24 px over the skill button (94 px at 100%, 16 px floor).
  assert.equal(value('.rh-offer[data-mode=intermission]','width',LANDSCAPE),'var(--of-w)');
  assert.equal(value('.rh','--of-w',LANDSCAPE),'max(min(40vw,360px),min(420px,calc(100vw - var(--rh-l) - var(--rh-r) - 450px)))');
  assert.match(value('.rh-offer[data-mode=intermission]','max-height',LANDSCAPE),/100vh - var\(--rh-t\) - 52px - \(max\(16px,env\(safe-area-inset-bottom\)\) \+ var\(--botao-habilidade\) \+ 24px\)/);
  const rhT=8,botao=14+80,maxH=390-rhT-52-(16+botao+24);
  const pad=box(value('.rh-offer','padding',LANDSCAPE)),padTop=px(value('.rh-offer[data-mode=intermission]','padding-top',LANDSCAPE));
  const content=maxH-padTop-pad.bottom-4;
  // The wide tags tilt half as much: a 370 px tag at ±0.5° pokes ~1.6 px past its box.
  assert.equal(value('.rh-offer[data-mode=intermission]','--of-tilt-a',LANDSCAPE),'-.5deg');
  const tilt=Math.round(185*Math.sin(.5*Math.PI/180)*10)/10;
  // Header row: the 48 px buttons set it (title over seconds and clock on the left).
  assert.equal(value('.rh-offer[data-mode=intermission] .rh-offer-head','grid-template-areas',LANDSCAPE),"'title title foot' 'time bar foot'");
  assert.equal(px(value('.rh-offer[data-mode=intermission] .rh-offer-head','min-height',LANDSCAPE)),48);
  const list=content-48+6;// the list's box, its top padding under a -6 px margin
  assert.equal(Math.round(list),144,'as measured');
  // One column of tags (44 px at least: they are touch targets); three need 6 + 3 x 44 + 2 x 4 + the tilt.
  assert.equal(value(".rh-offer[data-mode=intermission] .rh-offer-cards[data-count='4']",'grid-template-columns',LANDSCAPE),'minmax(0,1fr)');
  assert.equal(px(value('.rh-card','min-height')),44);
  const tags=[tilted(6,44,tilt),tilted(54,44,tilt),tilted(102,44,tilt),tilted(150,44,tilt)];
  const cue=cueLayout(tags.slice(0,3),{top:0,bottom:list},6);
  assert.equal(cue.mode,'over');assert.equal(cue.hidden,1,'"Mais 1": two whole tags and the third under the cue');
  assert.equal(cueLayout(tags,{top:0,bottom:list},6).hidden,2,'four of luck: "Mais 2"');
});

/** The arrows (caído, chefe) need the field beside the window at least this wide: Chromium, 844x390, cenario=bordas
 * (the audit's "soma" and "janela" scenes): they all went at 302 px and stayed at 312 px and more. */
const ARROWS_FIELD=312;
test('landscape: the window leaves the field room for the hero and the caído/chefe arrows (zones.besideOffer)',()=>{
  const width=Math.max(Math.min(.4*844,360),Math.min(420,844-8-8-450)),offer={x:844-8-width,y:8+52,width,height:196};
  assert.equal(width,378);
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
  const old=computeZones({...input,offer:{...offer,x:844-8-506.4,width:506.4}});
  assert.ok(old.useful.width<ARROWS_FIELD);
});

test('the clock and the foot move into the header at hud.css\'s landscape breakpoint',()=>{
  assert.ok(DECLS.some(d=>d.selector.startsWith(`@media ${LANDSCAPE_QUERY}`)),LANDSCAPE_QUERY);
  assert.equal(`@media ${LANDSCAPE_QUERY}`,LANDSCAPE);
});

test('the foot labels stay sentence case pt-BR',()=>{
  assert.equal(TAKE_ALL_LABEL,'Levar os indicados');assert.equal(LATER_LABEL,'Depois');
});
