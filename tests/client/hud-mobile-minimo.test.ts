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
import {foneLayout,fanWidth,gearRect,FONE,DESKTOP_RING} from '../../src/client/hud/fone-layout.ts';
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
  return {joystick:{x:pad.x,y:v.height-pad.y-stick,width:stick,height:stick},skill:{x:v.width-pad.x-skill,y:v.height-pad.y-skill,width:skill,height:skill}};
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
  assert.equal(value(FONE_CSS,'.rh[data-hud=fone] .rh-camp-com-relogio .rh-camp-num','display'),'none');
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
