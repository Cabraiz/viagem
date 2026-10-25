/**
 * NEW-20261014-ORQ-hud-mobile-minimo: the phone (touch input) sees only its skill, the minimap top-left, the team as a
 * fan of half-size portraits, the gear top-right and, in the middle, the team's bar with the level (the chaveiro's clock
 * inside it). Pins (1) that fone.css/explore.css draw what hud/fone-layout.ts says, scoped to the phone only (the desktop
 * keeps hud.css as it is), and (2) the layout's guarantees at 390×844, 360×800, 412×915, 844×390 and 667×375, with 1 to 6
 * players and the boss bar: nothing over the hero (± 40), no top ficha over another, the announcement slot under the
 * minimap in portrait, the minimap in the left edge column in landscape, the useful area holds the hero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {foneLayout,fanWidth,gearRect,teamColumnVar,FONE,DESKTOP_RING} from '../../src/client/hud/fone-layout.ts';
import {barClock} from '../../src/client/hud/camp.ts';
import {SIM_HZ,type RunView} from '../../src/contract/index.ts';
import {auditBoxes,crosses,bottom,right,EDGE_COLUMN,HERO_MARGIN,MIN_PLAY_SIDE,THUMB_GAP,type AuditBox,type Rect} from '../../src/client/hud/zones.ts';
import {NAME_TAP_MS} from '../../src/client/hud/team.ts';

type Decl={selector:string;prop:string;value:string};
const read=(file:string)=>declarations(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8')) as Decl[];
const FONE_CSS=read('src/client/hud/fone.css'),HUD=read('src/client/hud/hud.css'),EXPLORE=read('src/client/explore.css'),CAMP=read('src/client/hud/camp.css');
const value=(decls:Decl[],selector:string,prop:string)=>{
  const found=decls.filter(d=>d.selector===selector&&d.prop===prop).at(-1);
  assert.ok(found,`${selector} { ${prop} }`);return found.value;
};
const px=(v:string)=>{const m=v.match(/(-?\d+(?:\.\d+)?)px/);assert.ok(m,v);return Number(m[1]);};

/** The thumbs as the shell draws them (explore.css: 112 px stick at 24 px; landscape/≤ 370 px 96 px at 16/18; skill --botao-habilidade 94). */
const thumbs=(v:{width:number;height:number})=>{
  const tight=v.width<=370||v.height<=500,stick=tight?96:112,pad=tight?{x:18,y:16}:{x:24,y:24},skill=94;
  return {joystick:{x:pad.x,y:v.height-pad.y-stick,width:stick,height:stick},skill:{x:v.width-pad.x-skill,y:v.height-pad.y-Math.max(stick,skill)/2-skill/2,width:skill,height:skill}}; // one axis (hud-mobile-rodape)
};
const VIEWPORTS=[{width:390,height:844},{width:360,height:800},{width:412,height:915},{width:844,height:390},{width:667,height:375}];

test('fone.css: everything is scoped to the phone (data-hud=fone), the desktop keeps hud.css',()=>{
  assert.ok(FONE_CSS.length>20);
  for(const d of FONE_CSS)assert.match(d.selector,/\[data-hud=fone\]/,`${d.selector} { ${d.prop} } is the phone's only`);
  // explore.css: the view buttons leave the screen with a finger only; the settings' row shows with a finger only.
  assert.equal(value(EXPLORE,'.explore-shell[data-input=touch] .explore-camera','display'),'none');
  assert.equal(value(EXPLORE,'.explore-shell:not([data-input=touch]) .explore-settings-camera','display'),'none');
});

test('fone.css: the user\'s list — minimap top-left, no round chip, no R$ nor fichas on top, gear untouched',()=>{
  const mm='.rh.rh[data-hud=fone] .rh-minimap.rh-mm';
  assert.equal(value(FONE_CSS,mm,'top'),'var(--rh-t)');assert.equal(value(FONE_CSS,mm,'left'),'var(--rh-l)');
  assert.equal(value(FONE_CSS,mm,'right'),'auto');assert.equal(value(FONE_CSS,mm,'bottom'),'auto');
  // The same square as the desktop's (hud.css .rh-mm --mm-side), so the band starts right of it.
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone]','--rh-mm'),value(HUD,'.rh .rh-minimap.rh-mm','--mm-side'));
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone] .rh-top>.rh-round','display'),'none');
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone] :is(.rh-camp-grana,.rh-camp-token)','display'),'none');
  assert.ok(!FONE_CSS.some(d=>d.selector.includes('explore-config')),'the gear keeps its corner');
  // The band between them: fone-layout's numbers.
  const top='.rh.rh[data-hud=fone] .rh-top';
  assert.equal(value(FONE_CSS,top,'left'),`calc(var(--rh-l) + var(--rh-mm) + ${FONE.bandGap}px)`);
  assert.equal(value(FONE_CSS,top,'right'),`calc(var(--rh-r) + ${FONE.gearRoom}px)`);
  assert.equal(px(value(FONE_CSS,top,'row-gap')),FONE.rowGap);
  // The chaveiro's clock inside the bar: hidden on the desktop (camp.css), shown by the phone's rule.
  assert.equal(value(CAMP,'.rh-camp-relogio','display'),'none');
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone] .rh-camp-relogio','display'),'flex');
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone] .rh-camp-com-relogio :is(.rh-camp-num,.rh-camp-wall>.ic)','display'),'none');
});

test('fone.css: the fan — half-size portraits overlapping like cards, names only on a tap',()=>{
  const ring=px(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member-ring','width')),desk=px(value(HUD,'.rh-member-ring','width'));
  assert.equal(ring,FONE.ring);assert.equal(desk,DESKTOP_RING);
  assert.ok(Math.abs(ring/desk-.5)<=.06,`"50 % menores": ${ring} of ${desk} px`);
  assert.equal(px(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member','width')),FONE.card);
  assert.equal(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member','margin'),`0 -${FONE.overlap.upTo4}px`);
  assert.equal(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-team:is([data-count="5"],[data-count="6"]) .rh-member','margin'),`0 -${FONE.overlap.more}px`);
  assert.equal(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-top>.rh-team','flex-direction'),'row');
  assert.match(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member','rotate'),/--leque-giro/);
  assert.equal(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member-name','display'),'none');
  assert.equal(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member[data-nome] .rh-member-name','display'),'block');
  assert.ok(NAME_TAP_MS>=1000&&NAME_TAP_MS<=3000,'the name stays a moment after the finger lifts');
  // The caído still reads: the downed ring (hud.css, not overridden), the seconds badge in the life bar's place.
  assert.ok(!FONE_CSS.some(d=>d.selector.includes('data-state')),'the states keep the desktop\'s look');
  assert.ok(px(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member-timer','top'))>=FONE.ring-4,'the seconds sit under the ring');
});

test('the fan fits the band with 1 to 6 players on every phone',()=>{
  assert.equal(fanWidth(1),FONE.card);
  for(let n=2;n<=6;n++)assert.ok(fanWidth(n)>fanWidth(n-1)-1,`grows with ${n}`);
  for(const viewport of VIEWPORTS)for(let n=1;n<=6;n++){
    const l=foneLayout({viewport,players:n,...thumbs(viewport)});
    assert.ok(l.fan.x>=l.band.x-.5&&right(l.fan)<=right(l.band)+.5,`${viewport.width}×${viewport.height}, ${n}: fan ${l.fan.width} in band ${l.band.width}`);
    assert.ok(l.level.x>=l.band.x-.5&&right(l.bar)<=right(l.band)+.5,`${viewport.width}×${viewport.height}: level + bar in the band`);
    assert.ok(l.bar.width>=FONE.bar[l.orientation].min,`${viewport.width}×${viewport.height}: the bar keeps ${FONE.bar[l.orientation].min} px (${l.bar.width})`);
  }
});

for(const viewport of VIEWPORTS)for(const boss of [false,true])test(`${viewport.width}×${viewport.height}${boss?' (chefe)':''}: nothing over the hero, no top ficha over another, the slot under the band`,()=>{
  for(let n=1;n<=6;n++){
    const l=foneLayout({viewport,players:n,boss,...thumbs(viewport)}),z=l.zones,name=`${viewport.width}×${viewport.height} ${n}`;
    const top:AuditBox[]=[{name:'minimapa',rect:l.minimap,topReadout:true,target:true,edgeColumn:true},{name:'engrenagem',rect:l.gear,target:true},
      {name:'nivel',rect:l.level,topReadout:true},{name:'barra',rect:l.bar,topReadout:true},{name:'leque',rect:l.fan,topReadout:true},...(l.boss?[{name:'chefe',rect:l.boss,topReadout:true}]:[])];
    const t=thumbs(viewport),boxes:AuditBox[]=[...top,{name:'joystick',rect:t.joystick,thumb:true,target:true},{name:'habilidade',rect:t.skill,thumb:true,target:true}];
    const audit=auditBoxes(boxes,z,l.hero,HERO_MARGIN);
    assert.deepEqual(audit.heroCrossed,[],`${name}: over the hero`);
    assert.deepEqual(audit.topCrossed,[],`${name}: top fichas`);
    assert.deepEqual(audit.thumbGaps,[],`${name}: ${THUMB_GAP} px from the thumbs`);
    assert.deepEqual(audit.offColumn,[],`${name}: the minimap in the edge column`);
    // The gear and the minimap keep apart from the band (no ficha under the gear).
    assert.equal(crosses(l.gear,l.band),false,`${name}: band clear of the gear`);assert.equal(crosses(l.minimap,l.band),false,`${name}: band clear of the minimap`);
    assert.ok(l.gear.width>=44&&l.minimap.width>=44,'targets ≥ 44 px');
    // The useful area holds the hero, which stands in it.
    assert.ok(z.useful.width>=MIN_PLAY_SIDE&&z.useful.height>=MIN_PLAY_SIDE,`${name}: useful ${z.useful.width}×${z.useful.height}`);
    assert.ok(crosses(l.hero,z.useful),`${name}: the hero is in the useful area`);
    if(l.orientation==='portrait'){
      assert.ok(z.announce.y>=bottom(l.minimap),`${name}: the announcement slot starts under the minimap`);
      assert.ok(z.useful.y>=bottom(l.minimap),`${name}: the field (and its arrows) start under the minimap`);
      assert.equal(audit.inPlay.length,0,`${name}: nothing of the band in the field (${audit.inPlay})`);
    }else{
      assert.ok(right(l.minimap)<=EDGE_COLUMN+20,`${name}: the minimap hugs the left edge`);
      assert.equal(crosses(l.minimap,t.joystick),false,`${name}: minimap clear of the joystick`);
      assert.ok(z.announce.y<bottom(l.minimap),'landscape: the slot is beside the minimap, not under it');
    }
  }
});

test('gear: explore.css .explore-config numbers (18 px corner; 12/14 on a narrow or landscape phone)',()=>{
  assert.deepEqual(gearRect({width:390,height:844}),{x:324,y:18,width:48,height:48});
  assert.deepEqual(gearRect({width:360,height:800}),{x:298,y:12,width:48,height:48});
  assert.deepEqual(gearRect({width:844,height:390}),{x:782,y:12,width:48,height:48});
  assert.equal(value(EXPLORE,'.explore-config','width'),'48px');
});

test('review 1: on the phone the fan writes no --rh-coluna and the 125 % combat strip takes the width',()=>{
  assert.equal(teamColumnVar(true,358),undefined,'the fan is not a column');
  assert.equal(teamColumnVar(false,53.2),'54px','the desktop column keeps its width');
  const sel='@media (min-height:501px) .rh.rh[data-hud=fone] .rh-offer[data-mode=combat]';
  assert.equal(value(FONE_CSS,sel,'max-width'),'calc(100vw - var(--rh-l) - var(--rh-r))');
  // hud.css's 125 % rule (0,4,0) loses to the phone's (0,5,0): the strip is never capped by a team column on the phone.
  assert.ok(HUD.some(d=>d.selector.includes(':root[data-texto="125"] .rh-offer[data-mode=combat]')));
});

test('review 2: the forge head keeps three cells, the R$ under the title (never a fourth column)',()=>{
  assert.equal(value(CAMP,'.rh-forge','grid-template-columns'),'auto minmax(0,1fr) 44px');
  assert.equal(value(CAMP,'.rh-forge-titulo','grid-column'),'1');assert.equal(value(CAMP,'.rh-forge-titulo','flex-direction'),'column');
  assert.equal(value(CAMP,'.rh-forge-note','grid-column'),'2');assert.equal(value(CAMP,'.rh .rh-forge-close','grid-column'),'3');
  assert.ok(!CAMP.some(d=>d.selector==='.rh-forge-grana'&&d.prop==='grid-column'),"the R$ rides in the title's cell");
  // Landscape: the head is one row (the standing line goes, an answer is one line cut with an ellipsis).
  assert.equal(value(CAMP,'@media (max-height:500px) .rh-forge-note','white-space'),'nowrap');
  assert.equal(value(CAMP,'@media (max-height:500px) .rh-forge-note[data-padrao]','visibility'),'hidden');
});

/** A RunView with only what roundInfo reads. */
const viewOf=(round:Partial<NonNullable<RunView['round']>>|undefined,objective?:Partial<NonNullable<RunView['objective']>>)=>({tick:0,round:round&&{index:3,total:10,remaining:7,phase:'wave',phaseEndsTick:0,...round},objective,enemies:[],players:[],events:[],structures:[]}) as unknown as RunView;
test("review 3–4: the bar's clock — the intermission countdown (urgent at 5 s), the chaveiro's wins, words for the screen reader",()=>{
  assert.equal(barClock(viewOf({phase:'wave'})),undefined,'nothing in a wave');
  const prep=barClock(viewOf({phase:'prepare',phaseEndsTick:SIM_HZ*12}));
  assert.ok(prep&&prep.icon==='relogio'&&/^\d+ s$/.test(prep.text),JSON.stringify(prep));
  assert.equal(prep!.urgent,false);assert.match(prep!.aria,/^Intervalo \d+ s$/);
  const late=barClock(viewOf({phase:'prepare',phaseEndsTick:SIM_HZ*4}));
  assert.equal(late?.urgent,true,'≤ 5 s: urgent, like the round chip');
  const moto=barClock(viewOf({phase:'prepare',phaseEndsTick:SIM_HZ*12},{ended:false,etaS:532,moto:{mode:'anda'} as never}));
  assert.deepEqual(moto&&{icon:moto.icon,text:moto.text},{icon:undefined,text:'8:52'},"the chaveiro's clock wins, no moto before it (topo-sem-icone)");
  assert.match(moto!.aria,/Chaveiro chega em 8:52/);
  // D-051 nests (ninhos-rounds-fora): the clock plus the nests still standing, and no intermission countdown at all.
  const nest=(hp:number)=>({id:`n${hp}`,kind:'ninho',x:0,y:0,hp,maxHp:40,phase:hp?'dormindo':'destruido'});
  const withNests=(v:RunView)=>({...v,structures:[nest(40),nest(40),nest(0)]}) as RunView;
  const ninhos=barClock(withNests(viewOf({phase:'prepare',phaseEndsTick:SIM_HZ*12},{ended:false,etaS:532,moto:{mode:'anda'} as never})));
  assert.equal(ninhos?.nests,'2/3');assert.match(ninhos!.aria,/2 de 3 ninhos de pé/);
  assert.equal(barClock(withNests(viewOf({phase:'prepare',phaseEndsTick:SIM_HZ*12}))),undefined,'no countdown in the nests mode');
  // On the phone the clock is shown (fone.css) and its words are an .rh-sr span (camp.ts), the picture aria-hidden.
  const camp=readFileSync(new URL('../../src/client/hud/camp.ts',import.meta.url),'utf8');
  assert.match(camp,/el\('span','rh-sr',clock\)/);assert.match(camp,/clockPicture\.setAttribute\('aria-hidden','true'\)/);
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone] .rh-camp-relogio[data-urgente] b','background'),'var(--c-cone)');
});

test("review 5–6: each fan card has a hit area past its edge; the clock rides over the bar's row, not inside the track",()=>{
  assert.equal(value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member::after','position'),'absolute');
  const inset=value(FONE_CSS,'.rh.rh[data-hud=fone] .rh-member::after','inset').split(/\s+/).map(px);
  assert.ok(inset.every(v=>v<0),'past the card on every side');
  assert.ok(FONE.card-2*inset[1]+0>=FONE.card,'wider than the card');
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone] .rh-camp-relogio','inset'),'0');
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone] .rh-camp-com-relogio :is(.rh-camp-num,.rh-camp-wall>.ic)','display'),'none');
  const camp=readFileSync(new URL('../../src/client/hud/camp.ts',import.meta.url),'utf8');
  assert.match(camp,/el\('span','rh-camp-relogio',wallRow\)/,'not a child of the track (overflow: hidden)');
});
