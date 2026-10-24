/**
 * Cidade Nevada HUD (card NEW-20261012-ORQ-cidade-ux-01): the minimap's slot, edge arrows and the lobby map selector.
 * Written against the API contract (scratchpad city-hud-api.md) and design/cidade-hud.md §0–§5, not the implementation.
 * Every numbered block below maps to one of the 9 assertions of §5 ("Asserções do teste"), checked in portrait 390×844
 * and landscape 844×390, at 100% and 125% text, with and without the 47 px notch, with the offer/forge window open and
 * closed, and with the hero at the centre of the useful area and shifted 24 px in 8 directions. Pure (no DOM), fixed data.
 * Run: node --experimental-strip-types --test tests/client/city-hud.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as city from '../../src/client/hud/city/index.ts';
import * as deps from '../../src/client/hud/city/deps.ts';
import {edgeTag} from '../../src/client/hud/edges.ts';
import * as edgesMod from '../../src/client/hud/edges.ts';
import {ICON_NAMES} from '../../src/client/ui/icon.ts';
import {cityTerrainFrom} from '../../src/maps/index.ts';
import {readFileSync} from 'node:fs';
import * as nodeModule from 'node:module';
import {cityPlanner} from '../../src/sim/city/grid.ts';
import {Rng} from '../../src/contract/rng.ts';
import type {Rect,ScreenZones,AuditBox,EdgeTarget,EdgeArrow} from '../../src/client/hud/city/deps.ts';
import type {CityLayout,CityLayoutInput,EnemyPoint,EnemyGroup,MapId,SelectorState,SelectorEvent} from '../../src/client/hud/city/index.ts';

const {computeZones,auditBoxes,crosses,gap,THUMB_GAP,HERO_MARGIN,EDGE_COLUMN,MAX_ARROWS}=deps;

// ---------- Geometry helpers and the doc's measured references (§0) ----------
type Orientation='portrait'|'landscape';
type Insets={top:number;right:number;bottom:number;left:number};
const r=(x:number,y:number,width:number,height:number):Rect=>({x,y,width,height});
const right=(a:Rect)=>a.x+a.width,bottom=(a:Rect)=>a.y+a.height;
const ZERO:Insets={top:0,right:0,bottom:0,left:0};
const NOTCH=47,DROP=39;
const VIEWPORT={portrait:{width:390,height:844},landscape:{width:844,height:390}} as const;
const DOC={
  portrait:{gear:r(324,18,48,48),status:[r(14,12,44,44),r(158,8,166,40),r(8,56,56,36),r(70,54,204,40)],team:r(8,120,54,380),
    joystick:r(24,708,112,112),skill:r(284,738,82,82),emote:r(301,666,48,48),skill125:r(252,706,114,114),emote125:r(285,634,48,48),
    chip:r(284-THUMB_GAP-52,753,52,52)},
  landscape:{gear:r(782,12,48,48),status:[r(14,12,44,44),r(296,8,170,40),r(234,10,56,36),r(472,8,230,40)],team:r(258,318,328,64),
    joystick:r(18,278,96,96),skill:r(746,292,82,82),emote:undefined as Rect|undefined,skill125:r(714,260,114,114),emote125:undefined as Rect|undefined,
    chip:r(746-THUMB_GAP-52,307,52,52)},
};
/**
 * Useful area per case (§0 formula on the hud-topo-uma-linha band, under its announcement slot; the minimap floats over a
 * corner of the field and trims nothing; the 125% + notch ones follow from the same formula).
 */
const USEFUL={
  portrait:{n100:r(70,186,320,456),n125:r(70,186,320,424),notch100:r(70,225,320,417),notch125:r(70,225,320,385)},
  landscape:{n100:r(138,136,584,174),n125:r(138,136,552,174),notch100:r(167,136,555,174),notch125:r(167,136,523,174)},
};
/** The WC3 minimap's side at both reference viewports (hud.css .rh-mm clamp(124px, 30vmin, 210px): 30vmin = 117). */
const MM=124;
/** Owner's lobby window in landscape ({150,…,544,…}): only its x span matters, so it takes the full height. */
const OWNER_WINDOW=r(150,0,544,390);
/** Arrow ficha half size at a text scale (76×36, 84×36 at 125%) and the room layoutEdges keeps on the rim. */
const halfW=(scale:number)=>(44+32*scale)/2,HALF_H=18,RIM_PAD=8,TAG_ROOM=16,NAME_ROOM=16;
/** Rail of arrow centres with tag and name (§5) for a useful area. */
const railOf=(u:Rect,scale:number)=>{const hw=halfW(scale)+RIM_PAD,hh=HALF_H+RIM_PAD;return r(u.x+hw,u.y+hh+TAG_ROOM,u.width-2*hw,u.height-2*hh-TAG_ROOM-NAME_ROOM);};
const within=(a:Rect,box:Rect,eps=.5)=>a.x>=box.x-eps&&a.y>=box.y-eps&&right(a)<=right(box)+eps&&bottom(a)<=bottom(box)+eps;
const near=(a:number,b:number,eps=1e-6)=>Math.abs(a-b)<=eps;
/**
 * NEW-20261013-ORQ-cidade-escala-1-7: the city was 1.7× the .w3x map (287.232 u, asset version 2); since asset v4
 * (NEW-20261023-ORQ-mapa-175-com-viaduto) its distances are 1.75× shorter (164.56 u). Map lengths (the city, the plaza,
 * GROUP_RANGE, the avenue match) are × K = CITY_DISTANCE_SCALE, people lengths (danger radii, GROUP_CELL, NEAR_BLOCK)
 * are not. MID shifts the old fixtures (built around the 169 u map's centre 84.5) onto the city's centre by whole 8 u
 * cells, so a blob keeps its group cell.
 */
const K=deps.CITY_DISTANCE_SCALE,MID=Math.round((city.CITY_SIZE/2-84.5)/8)*8;
const fmt=(a:Rect|undefined)=>a?`{${a.x},${a.y},${a.width},${a.height}}`:'undefined';
const lcg=(seed:number)=>{let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/2**32;};};

interface Case {o:Orientation;scale:1|1.25;notch:boolean;windowOpen:boolean;chip?:boolean;name:string}
const CASES:Case[]=[];
for(const o of ['portrait','landscape'] as const)for(const scale of [1,1.25] as const)for(const notch of [false,true])for(const windowOpen of [false,true])
  CASES.push({o,scale,notch,windowOpen,name:`${o} ${scale*100}%${notch?' notch 47':''}${windowOpen?' janela aberta':''}`});
// The offer chip (D-021) joins the right thumb: collisions are checked with it too (no exact rects in the doc for it).
const CHIP_CASES:Case[]=(['portrait','landscape'] as const).flatMap(o=>[false,true].map(windowOpen=>({o,scale:1 as const,notch:false,windowOpen,chip:true,name:`${o} 100% com chip${windowOpen?' janela aberta':''}`})));
const ALL=[...CASES,...CHIP_CASES];
const SHIFTS=[[0,0],[24,0],[-24,0],[0,24],[0,-24],[24,24],[24,-24],[-24,24],[-24,-24]] as const;

const safeOf=(c:Case):Insets|undefined=>c.notch?(c.o==='portrait'?{...ZERO,top:NOTCH}:{...ZERO,left:NOTCH}):undefined;
const insetsOf=(c:Case)=>safeOf(c)??ZERO;
const gearOf=(c:Case)=>c.o==='portrait'&&c.notch?{...DOC.portrait.gear,y:DOC.portrait.gear.y+DROP}:DOC[c.o].gear;
/** The measured controls of a case: REFERENCE_CONTROLS at 100%, the doc's 125% skill/emote, the notch shifts of §0. */
function controlsFor(c:Case):CityLayoutInput['controls']{
  const base=structuredClone(city.REFERENCE_CONTROLS[c.o]) as any;
  const d=DOC[c.o];
  if(c.scale>1){base.skill=d.skill125;if(d.emote125)base.emote=d.emote125;}
  if(c.notch){
    if(c.o==='portrait'){base.status=base.status.map((s:Rect|undefined)=>s&&{...s,y:s.y+DROP});if(base.team)base.team={...base.team,y:base.team.y+DROP};}
    else{base.joystick=r(47,278,96,96);base.status=base.status.map((s:Rect|undefined)=>s&&s.x<100?{...s,x:s.x+33}:s);}
  }
  if(c.chip)base.chip=d.chip;
  return base;
}
const inputOf=(c:Case):CityLayoutInput=>({viewport:{...VIEWPORT[c.o]},safe:safeOf(c),textScale:c.scale,windowOpen:c.windowOpen,controls:controlsFor(c)});
const layoutOf=(c:Case):CityLayout=>city.cityHudLayout(inputOf(c));
const expectedUseful=(c:Case)=>USEFUL[c.o][`${c.notch?'notch':'n'}${c.scale===1?100:125}` as 'n100'];
/**
 * Collapsed minimap (minimapa-wc3), floating over a corner of the field: narrow portrait in the bottom-left corner as in
 * WC3, 24 px above the joystick (x max(8, safe left), y H − max(24, safe bottom) − 112 − 24 − side); landscape --rh-t + 52,
 * window open the left column.
 */
const expectedMinimap=(c:Case)=>c.o==='portrait'?r(8,560,MM,MM):c.windowOpen?r(c.notch?47:14,84,MM,MM):r(706,60,MM,MM);
const expectedSelector=(c:Case)=>c.o==='portrait'?r(32,194+(c.notch?DROP:0),326,c.scale>1?84:64):r(718,84,112,144);
const expectedSegments=(c:Case):[Rect,Rect]=>{
  if(c.o==='landscape')return [r(724,90,100,64),r(724,158,100,64)];
  const s=expectedSelector(c);return [r(32,s.y,163,s.height),r(195,s.y,163,s.height)];
};
/** Reference zones computed with the zones contract itself (independent of the implementation's numbers). */
const refZones=(c:Case):ScreenZones=>computeZones({viewport:{...VIEWPORT[c.o]},safe:safeOf(c),...controlsFor(c),minimap:expectedMinimap(c)});
const heroAt=(u:Rect,dx:number,dy:number)=>r(u.x+u.width/2-28+dx,u.y+u.height/2-28+dy,56,56);
/**
 * Announcement slot as hud.css draws it (.rh-stack, insets floored at the HUD's 8 px): portrait at the zones' announce y,
 * from left + max(70, team column + 16) to right + 8; landscape at top + 56 (right under the one-row band), from left + 150
 * to right + 290.
 */
const announceOf=(c:Case,z:ScreenZones)=>{
  const s=insetsOf(c),f=(v:number)=>Math.max(8,v),k=controlsFor(c) as any,v=VIEWPORT[c.o];
  if(c.o==='portrait'){const x=f(s.left)+Math.max(70,(k.team&&k.team.height>k.team.width?k.team.width:54)+16);return r(x,z.announce.y,v.width-f(s.right)-8-x,z.announce.height);}
  const x=f(s.left)+150;return r(x,f(s.top)+56,v.width-f(s.right)-290-x,z.announce.height);
};
/** The new rects of a layout, named. */
const newRects=(l:CityLayout)=>{
  return [{name:'minimapa',rect:l.minimap},{name:'seletor',rect:l.selector},{name:'segmento-cidade',rect:l.segments[0]},{name:'segmento-infinito',rect:l.segments[1]}];
};
/** Thumb controls of a case (joystick, skill, emote, chip), as the zones contract names them. */
const thumbControls=(c:Case)=>{const k=controlsFor(c) as any;return ([['joystick',k.joystick],['habilidade',k.skill],['emote',k.emote],['chip',k.chip]] as [string,Rect|undefined][]).filter((e):e is [string,Rect]=>!!e[1]);};

// ---------- Edge-arrow fixtures (§3, assertion 7) ----------
const target=(key:string,kind:EdgeTarget['kind'],x:number,y:number,distance:number,extra:Partial<EdgeTarget>={}):EdgeTarget=>({key,kind,screen:{x,y},distance,...extra});
/** Eleven targets around the hero: a named caído hidden behind `behind`, the boss, 4 groups, 4 active mouths, the base. */
function cityTargets(hero:Rect,behind:Rect):EdgeTarget[]{
  const hx=hero.x+hero.width/2,hy=hero.y+hero.height/2,at=(deg:number,dist:number)=>({x:hx+Math.cos(deg*Math.PI/180)*dist,y:hy+Math.sin(deg*Math.PI/180)*dist});
  const list=[target('b','caido',behind.x+behind.width/2,behind.y+behind.height/2,18,{seconds:12,label:'Zé',name:'Zé'}),target('boss','chefe',hx-900,hy,40)];
  [[30,20,'12'],[100,25,'6'],[200,30,'7'],[300,35,'9']].forEach(([deg,d,n],i)=>{const p=at(deg as number,800);list.push(target(`grupo:g${i}`,'grupo',p.x,p.y,d as number,{label:n as string}));});
  (['N','S','L','O'] as const).forEach((id,i)=>{const p=at(60+90*i,900);list.push(target(`boca:${id}`,'spawn',p.x,p.y,40+5*i));});
  const up=at(270,900);list.push(target('base','base',up.x,up.y,60));
  return list;
}
/**
 * The boxes an arrow takes: the ficha, its tag row above (a caído's clock, a group's distance, the base's horn seconds)
 * and a caído's name row below (subsets of what layoutEdges reserves).
 */
function arrowBoxes(a:EdgeArrow,scale=1):{name:string;rect:Rect}[]{
  const hw=halfW(scale),out=[{name:`seta-${a.key}`,rect:r(a.x-hw,a.y-HALF_H,2*hw,2*HALF_H)}];
  if(edgeTag(a))out.push({name:`seta-${a.key}-etiqueta`,rect:r(a.x-hw+4,a.y-HALF_H-TAG_ROOM,2*hw-8,TAG_ROOM)});
  if(a.kind==='caido'){
    if(a.label)out.push({name:`seta-${a.key}-nome`,rect:r(a.x-hw+4,a.y+HALF_H,2*hw-8,NAME_ROOM)});}
  return out;
}
const MUST_POINT=['caido','chefe'] as const;

// =====================================================================================================================
// Contract surface
// =====================================================================================================================
test('contract: constants and reference controls match the doc (§0, §1, §2, §3, §4)',()=>{
  assert.equal(THUMB_GAP,24);assert.equal(HERO_MARGIN,40);assert.equal(EDGE_COLUMN,120);assert.equal(MAX_ARROWS,6);
  assert.equal(city.GROUP_CELL,8);assert.equal(city.GROUP_MIN,5);assert.equal(city.GROUP_RANGE,60*K);assert.equal(city.GROUP_ARROWS,2);
  assert.equal(K,1.7/1.75);assert.equal(city.CITY_SIZE,164.56);assert.equal(city.DEFAULT_MAP,deps.PROTOCOL_DEFAULT_MAP,'the selector shows the protocol default until the room confirms');assert.equal(city.PENDING_MS,3000);
  for(const o of ['portrait','landscape'] as const){
    const k=city.REFERENCE_CONTROLS[o] as any,d=DOC[o];
    assert.deepEqual(k.joystick,d.joystick,`${o} joystick`);assert.deepEqual(k.skill,d.skill,`${o} skill`);assert.deepEqual(k.team,d.team,`${o} team`);
    if(d.emote)assert.deepEqual(k.emote,d.emote,`${o} emote`);
    for(const s of d.status)assert.ok(k.status.some((x:Rect|undefined)=>x&&x.x===s.x&&x.y===s.y&&x.width===s.width&&x.height===s.height),`${o} status has ${fmt(s)}`);
    assert.equal(k.minimap,undefined,'the layout places the minimap itself');
    assert.equal(city.wcMinimapSide(VIEWPORT[o]),MM,`${o} minimap side`);
  }
});

test('contract: 125% controls (§0) derived by scaled(), when the helper is exported',{skip:typeof (city as any).scaled!=='function'&&'scaled() not exported (the tests derive 125% from the doc)'},()=>{
  const scaled=(city as any).scaled;
  for(const o of ['portrait','landscape'] as const){
    const k=scaled(city.REFERENCE_CONTROLS[o],1.25);
    assert.deepEqual(k.skill,DOC[o].skill125,`${o} skill at 125%`);
    if(DOC[o].emote125)assert.deepEqual(k.emote,DOC[o].emote125,`${o} emote at 125%`);
  }
});

// =====================================================================================================================
// §5 table: exact rects for the reference controls
// =====================================================================================================================
test('§5 table: minimap, selector and segments are the exact rects of the doc',()=>{
  for(const c of CASES){
    const l=layoutOf(c);
    assert.equal(l.orientation,c.o,c.name);
    assert.deepEqual(l.minimap,expectedMinimap(c),`${c.name}: minimapa`);
    assert.deepEqual(l.selector,expectedSelector(c),`${c.name}: seletor`);
    assert.deepEqual(l.segments,expectedSegments(c),`${c.name}: segmentos`);
  }
});

test('§5 table: arrow rail of centres (with tag and name) and the useful area per case',()=>{
  // The literal values of the table.
  const lit:[Partial<Case>,Rect][]=[[{o:'portrait',scale:1,notch:false},r(116,228,228,372)],[{o:'portrait',scale:1.25,notch:false},r(120,228,220,340)],
    [{o:'portrait',scale:1,notch:true},r(116,267,228,333)],[{o:'landscape',scale:1,notch:false},r(184,178,492,90)],
    [{o:'landscape',scale:1.25,notch:false},r(188,178,452,90)],[{o:'landscape',scale:1,notch:true},r(213,178,463,90)]];
  for(const [p,rail] of lit){const c={windowOpen:false,name:'',...p} as Case;assert.deepEqual(layoutOf(c).arrowRail,rail,`${c.o} ${c.scale} notch=${c.notch}`);}
  for(const c of CASES){
    const l=layoutOf(c),u=expectedUseful(c);
    assert.deepEqual(l.zones.useful,u,`${c.name}: área útil`);
    assert.deepEqual(l.zones.useful,refZones(c).useful,`${c.name}: zones = computeZones with the collapsed minimap`);
    assert.deepEqual(l.arrowRail,railOf(u,c.scale),`${c.name}: trilho`);
  }
});

// =====================================================================================================================
// Assertion 1: inside the viewport and the safe area
// =====================================================================================================================
test('1. every new rect is inside the viewport and the safe area',()=>{
  for(const c of ALL){
    const l=layoutOf(c),s=insetsOf(c),v=VIEWPORT[c.o];
    const view=r(0,0,v.width,v.height),safe=r(s.left,s.top,v.width-s.left-s.right,v.height-s.top-s.bottom);
    for(const {name,rect} of [...newRects(l),{name:'trilho',rect:l.arrowRail}]){
      assert.ok(rect.width>0&&rect.height>0,`${c.name}: ${name} is empty`);
      assert.ok(within(rect,view,0),`${c.name}: ${name} ${fmt(rect)} leaves the viewport`);
      assert.ok(within(rect,safe,0),`${c.name}: ${name} ${fmt(rect)} leaves the safe area`);
    }
  }
  // Selector mirror with the notch on the right (§4): opposite side, inside the safe area.
  const c:Case={o:'landscape',scale:1,notch:false,windowOpen:false,name:'landscape notch right'};
  const l=city.cityHudLayout({...inputOf(c),safe:{...ZERO,right:NOTCH}});
  assert.deepEqual(l.selector,r(14,84,112,144),'paisagem, notch à direita: seletor espelhado');
  for(const seg of l.segments)assert.ok(within(seg,l.selector,0)&&within(seg,r(0,0,844-NOTCH,390),0),fmt(seg));
});

// =====================================================================================================================
// Assertion 2 (+ thumb-zone collisions of every new rect)
// =====================================================================================================================
test('2. the minimap never crosses leftThumb/rightThumb and keeps ≥ 24 px from joystick, skill, emote and chip',()=>{
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c);
    const m=l.minimap;
    for(const zones of [z,l.zones]){
      if(zones.leftThumb)assert.equal(crosses(m,zones.leftThumb),false,`${c.name}: minimapa ${fmt(m)} × leftThumb ${fmt(zones.leftThumb)}`);
      if(zones.rightThumb)assert.equal(crosses(m,zones.rightThumb),false,`${c.name}: minimapa ${fmt(m)} × rightThumb ${fmt(zones.rightThumb)}`);
    }
    for(const [control,rect] of thumbControls(c))assert.ok(gap(m,rect)>=THUMB_GAP,`${c.name}: minimapa is ${gap(m,rect)} px from ${control}`);
  }
});

test('thumb zones: selector and segments keep ≥ 24 px from joystick, skill, emote and chip and never cross the thumb zones',()=>{
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c);
    for(const {name,rect} of newRects(l)){
      for(const [control,box] of thumbControls(c))assert.ok(gap(rect,box)>=THUMB_GAP,`${c.name}: ${name} ${fmt(rect)} is ${gap(rect,box)} px from ${control}`);
      for(const zone of [z.leftThumb,z.rightThumb,l.zones.leftThumb,l.zones.rightThumb])if(zone)assert.equal(crosses(rect,zone),false,`${c.name}: ${name} ${fmt(rect)} × ${fmt(zone)}`);
    }
  }
});

test('thumb zones: the documented clearances hold (window-open landscape minimap 70 px above the joystick, narrow portrait 24 px)',()=>{
  for(const notch of [false,true]){
    const l=layoutOf({o:'landscape',scale:1,notch,windowOpen:true,name:''}),stick=notch?r(47,278,96,96):DOC.landscape.joystick;
    assert.equal(gap(l.minimap,stick),70,`notch=${notch}`);
  }
  // Narrow portrait: the collapsed minimap sits 24 px above the joystick, touching (never crossing) its thumb zone.
  for(const notch of [false,true]){
    const l=layoutOf({o:'portrait',scale:1,notch,windowOpen:false,name:''});
    assert.equal(gap(l.minimap,DOC.portrait.joystick),THUMB_GAP,`notch=${notch}`);assert.equal(crosses(l.minimap,l.zones.leftThumb!),false,`notch=${notch}`);
  }
});

// =====================================================================================================================
// Assertion 3: hero ± 40, auditBoxes heroCrossed / thumbGaps empty
// =====================================================================================================================
test('3. no new rect crosses the hero ± 40 (centred and shifted 24 px); auditBoxes reports no heroCrossed and no thumbGaps',()=>{
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c),k=controlsFor(c) as any;
    for(const [dx,dy] of SHIFTS){
      const hero=heroAt(z.useful,dx,dy),where=`${c.name}, herói ${dx},${dy}`;
      for(const {name,rect} of newRects(l))assert.equal(crosses(rect,hero,HERO_MARGIN),false,`${where}: ${name} ${fmt(rect)} over the hero ${fmt(hero)}`);
      const boxes:AuditBox[]=[{name:'joystick',rect:k.joystick,thumb:true,target:true},{name:'habilidade',rect:k.skill,thumb:true,target:true},
        {name:'minimapa',rect:l.minimap,target:true,topReadout:true,edgeColumn:true,allowedInPlay:true,overHeroFails:true},{name:'seletor',rect:l.selector,target:true},
        {name:'segmento-cidade',rect:l.segments[0],target:true},{name:'segmento-infinito',rect:l.segments[1],target:true}];
      if(k.emote)boxes.push({name:'emote',rect:k.emote,target:true});
      if(k.chip)boxes.push({name:'chip',rect:k.chip,target:true});
      const audit=auditBoxes(boxes,z,hero);
      assert.deepEqual(audit.heroCrossed,[],where);assert.deepEqual(audit.thumbGaps,[],where);
      assert.ok(audit.minThumbGap>=THUMB_GAP,`${where}: minThumbGap ${audit.minThumbGap}`);
    }
  }
});

test('3. the hero box sits at the useful area\'s centre (portrait {202,386}, landscape {402,195})',()=>{
  const l=layoutOf({o:'portrait',scale:1,notch:false,windowOpen:false,name:''}),hero=heroAt(l.zones.useful,0,0);
  assert.deepEqual(hero,r(202,386,56,56));assert.deepEqual(l.hero,hero);
  const ls=layoutOf({o:'landscape',scale:1,notch:false,windowOpen:false,name:''});assert.deepEqual(heroAt(ls.zones.useful,0,0),r(402,195,56,56));assert.deepEqual(ls.hero,r(402,195,56,56));
});

// =====================================================================================================================
// Assertion 4: the minimap floats over a corner of the field (Orquestrador, 13/10): the useful area does not change for
// it, and it never covers a button, the HUD or the hero zone; landscape: in an edge column (offColumn); useful.y 186 / 225
// portrait, 136 landscape
// =====================================================================================================================
test('4. the minimap floats: the useful area ignores it (portrait useful.y 186, 225 notch; landscape 136), and it never covers a button, the HUD or the hero ± 40',()=>{
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c),v=VIEWPORT[c.o],m=l.minimap,k=controlsFor(c) as any;
    const without=computeZones({viewport:{...v},safe:safeOf(c),...controlsFor(c)});
    assert.deepEqual(l.zones.useful,without.useful,`${c.name}: the useful area changes for the minimap`);
    assert.deepEqual(z.useful,without.useful,`${c.name}: computeZones with the minimap`);
    assert.equal(l.zones.useful.y,c.o==='landscape'?136:c.notch?225:186,c.name);
    if(c.o==='landscape')assert.deepEqual(auditBoxes([{name:'minimapa',rect:m,target:true,topReadout:true,edgeColumn:true}],z).offColumn,[],c.name);
    // Buttons (camera and the top band's rows, gear, joystick, skill / "Me salva" #coop-sos in its place, emote, chip) and HUD (team, announcement slot).
    const covered:[string,Rect|undefined][]=[...(k.status as (Rect|undefined)[]).map((s,i)=>[`status ${i}`,s] as [string,Rect|undefined]),['engrenagem',gearOf(c)],
      ['time',k.team],['anúncio',l.announce],['joystick',k.joystick],['habilidade / me-salva',k.skill],['emote',k.emote],['chip',k.chip]];
    for(const [name,box] of covered)if(box)assert.equal(crosses(m,box),false,`${c.name}: minimap ${fmt(m)} over ${name} ${fmt(box)}`);
    for(const [dx,dy] of SHIFTS){const hero=heroAt(z.useful,dx,dy);assert.equal(crosses(m,hero,HERO_MARGIN),false,`${c.name}, herói ${dx},${dy}: minimap ${fmt(m)} over the hero ${fmt(hero)}`);}
  }
});

// =====================================================================================================================
// Assertion 5: status, gear, team, announcement slot
// =====================================================================================================================
test('5. minimap: off the status rows and the gear (≥ 6 px), the team and the announcement slot',()=>{
  for(const c of ALL){
    const l=layoutOf(c),k=controlsFor(c) as any,m=l.minimap,g=gearOf(c);
    const status=(k.status as (Rect|undefined)[]).filter((s):s is Rect=>!!s&&!(s.x===g.x&&s.width===g.width&&s.height===g.height));
    for(const s of status)assert.ok(gap(m,s)>=6,`${c.name}: minimap ${fmt(m)} is ${gap(m,s)} px from status ${fmt(s)}`);
    // Landscape {706,60} sits right under the gear {782,12,48,48} (gap 0): the city keeps the island's .rh-minimap slot
    // unchanged on purpose (doc §1: "o mesmo slot do minimapa atual ... continuam valendo sem mexer em nada"; hud.css
    // landscape .rh-minimap top --rh-t + 52), so landscape inherits that slot and is held to "never crosses" the gear.
    // Portrait keeps the ≥ 6 px of §5 assertion 5.
    if(c.o==='portrait')assert.ok(gap(m,g)>=6,`${c.name}: minimap is ${gap(m,g)} px from the gear`);
    else assert.equal(crosses(m,g),false,`${c.name}: minimap over the gear`);
    if(k.team)assert.equal(crosses(m,k.team),false,`${c.name}: minimap over the team`);
    const slot=announceOf(c,l.zones);assert.deepEqual(l.announce,slot,`${c.name}: announcement slot`);
    assert.equal(crosses(m,slot),false,`${c.name}: minimap ${fmt(m)} over the announcement slot ${fmt(slot)}`);
  }
});

// =====================================================================================================================
// Assertion 6: touch sizes
// =====================================================================================================================
test('6. touch targets: minimap wcMinimapSide (124 ≥ 44), segments ≥ 48 on both sides',()=>{
  for(const c of ALL){
    const l=layoutOf(c),side=city.wcMinimapSide(VIEWPORT[c.o]);
    assert.equal(l.minimap.width,side,c.name);assert.equal(l.minimap.height,side,c.name);assert.ok(side>=44,c.name);
    for(const s of l.segments)assert.ok(s.width>=48&&s.height>=48,`${c.name}: segment ${fmt(s)}`);
    assert.equal(crosses(l.segments[0],l.segments[1]),false,`${c.name}: segments overlap`);
    for(const s of l.segments)assert.ok(within(s,l.selector,0),`${c.name}: segment ${fmt(s)} outside the selector`);
  }
});

// =====================================================================================================================
// Assertion 7: arrows in play
// =====================================================================================================================
/** Overlap of two rects, or undefined. */
const overlap=(a:Rect,b:Rect):Rect|undefined=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),w=Math.min(right(a),right(b))-x,h=Math.min(bottom(a),bottom(b))-y;return w>0&&h>0?r(x,y,w,h):undefined;};
/** What hides the map on screen (edges.ts COVERING): the HUD of a case, plus its minimap(s). */
const coveringOf=(c:Case,minimaps:(Rect|undefined)[])=>{const k=controlsFor(c) as any;return [...(k.status as (Rect|undefined)[]),gearOf(c),k.team,k.joystick,k.skill,k.emote,k.chip,...minimaps].filter((x):x is Rect=>!!x);};
test('7. arrows in play, 100% and 125%: inside the useful area and the rail, off the hero ± 40, ≥ 24 px from every thumb control; a caído under the floating minimap keeps an arrow',()=>{
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c),s=insetsOf(c),v=VIEWPORT[c.o];
    const safe=r(s.left,s.top,v.width-s.left-s.right,v.height-s.top-s.bottom);
    // The collapsed minimap floats over a corner of the field and is a window (edges.ts WINDOWS has .rh-minimap): the caído
    // stands under its part over the field (else under its centre) and keeps an arrow of its own on the rail, off the
    // minimap and the hero, with escaped/unpointed empty. The "≤ 40 px from the window" rule stays for the big windows
    // (offer, forge: janela-caido.test.ts); gluing the arrow to the minimap's edge is a future edges.ts improvement.
    const options={windows:[l.minimap],seen:{viewport:r(0,0,v.width,v.height),covered:coveringOf(c,[l.minimap])},textScale:c.scale};
    const under=overlap(l.minimap,z.useful)??l.minimap;
    for(const [dx,dy] of SHIFTS){
      const hero=heroAt(z.useful,dx,dy),where=`${c.name}, herói ${dx},${dy}`;
      const targets=cityTargets(hero,under),arrows=city.layoutCityEdges(targets,l.zones.useful,hero,options);
      assert.ok(arrows.some(a=>a.kind==='caido')&&arrows.some(a=>a.kind==='chefe'),`${where}: caído and chefe keep their arrows`);
      const boxes:AuditBox[]=arrows.flatMap(a=>arrowBoxes(a,c.scale).map(b=>({...b,allowedInPlay:true,overHeroFails:true,withinUseful:true})));
      for(const kind of MUST_POINT)if(!arrows.some(a=>a.kind===kind))boxes.push({name:`sem-seta-${kind}`,rect:r(0,0,0,0),unpointed:true});
      const audit=auditBoxes(boxes,z,hero);
      assert.deepEqual(audit.escaped,[],where);assert.deepEqual(audit.unpointed,[],where);assert.deepEqual(audit.heroCrossed,[],where);
      for(const a of arrows){
        // At the case's text scale (84 px fichas at 125%), every centre rides the §5 rail.
        assert.ok(a.x>=l.arrowRail.x-.5&&a.x<=right(l.arrowRail)+.5&&a.y>=l.arrowRail.y-.5&&a.y<=bottom(l.arrowRail)+.5,`${where}: ${a.key} centre (${a.x},${a.y}) off the rail ${fmt(l.arrowRail)}`);
        for(const {name,rect} of arrowBoxes(a,c.scale)){
          assert.ok(within(rect,z.useful,1),`${where}: ${name} ${fmt(rect)} leaves the useful area`);
          assert.ok(within(rect,safe,0),`${where}: ${name} leaves the safe area`);
          assert.equal(crosses(rect,hero,HERO_MARGIN),false,`${where}: ${name} ${fmt(rect)} over the hero`);
          for(const zone of [z.leftThumb,z.rightThumb])if(zone)assert.equal(crosses(rect,zone),false,`${where}: ${name} × thumb zone`);
          for(const [control,box] of thumbControls(c))assert.ok(gap(rect,box)>=THUMB_GAP,`${where}: ${name} is ${gap(rect,box)} px from ${control}`);
          assert.equal(crosses(rect,l.minimap),false,`${where}: ${name} on the collapsed minimap`);
        }
      }
    }
  }
});

test('7. layoutCityEdges caps grupo and boca at 2 each (the nearest), 6 in all, even in a roomy field',()=>{
  const area=r(0,0,2000,2000),hero=r(972,972,56,56),out:EdgeTarget[]=[];
  for(let i=0;i<6;i++){const a=i/6*Math.PI*2;out.push(target(`grupo:k${i}`,'grupo',1000+Math.cos(a)*3000,1000+Math.sin(a)*3000,10+i*5,{label:String(5+i)}));}
  const groups=city.layoutCityEdges(out,area,hero);
  assert.ok(groups.length<=2,`groups: ${groups.map(a=>a.key)}`);
  assert.deepEqual(groups.map(a=>a.key).sort(),['grupo:k0','grupo:k1'],'the two nearest groups');
  const mouths=(['N','S','L','O'] as const).map((id,i)=>{const a=(i/4+.125)*Math.PI*2;return target(`boca:${id}`,'spawn',1000+Math.cos(a)*3000,1000+Math.sin(a)*3000,50-i*5);});
  const m=city.layoutCityEdges(mouths,area,hero);
  assert.deepEqual(m.map(a=>a.key).sort(),['boca:L','boca:O'],'the two nearest mouths');
  const mixed=city.layoutCityEdges([...out,...mouths,target('c1','caido',-500,1000,30,{seconds:9}),target('c2','caido',2500,1000,31,{seconds:20}),target('boss','chefe',1000,-500,40),target('base','base',1000,2600,20)],area,hero);
  assert.ok(mixed.length<=MAX_ARROWS);
  assert.ok(mixed.filter(a=>a.key.startsWith('grupo:')).length<=2&&mixed.filter(a=>a.key.startsWith('boca:')).length<=2);
  for(const kind of MUST_POINT)assert.ok(mixed.some(a=>a.kind===kind),`${kind} keeps its arrow`);
});

test('§3 crowded groups: two groups and a mouth side by side → one group arrow with the critters summed (count 1, never "+1"), the mouth keeps its own arrow',()=>{
  const area=USEFUL.portrait.n100,hero=heroAt(area,0,0);
  for(const scale of [1,1.25]){
    const targets=[target('grupo:a','grupo',900,450,20,{groupCount:7,label:'7'} as any),target('grupo:b','grupo',905,470,25,{groupCount:6,label:'6',danger:true} as any),
      target('boca:N','spawn',910,460,30)];
    for(const order of [targets,[...targets].reverse()]){
      const arrows=city.layoutCityEdges(order,area,hero,{textScale:scale}) as (EdgeArrow&{groupCount?:number})[];
      const groups=arrows.filter(a=>a.key.startsWith('grupo:')),mouths=arrows.filter(a=>a.key.startsWith('boca:'));
      assert.equal(groups.length,1,`groups: ${arrows.map(a=>a.key)}`);
      assert.equal(groups[0].groupCount,13,'critters summed');assert.equal(groups[0].count,1,'a group arrow never shows "+N"');
      assert.equal(groups[0].key,'grupo:a','keyed as the nearest group');assert.equal(groups[0].danger,true,'danger survives the merge');
      assert.equal(city.groupCountText(groups[0].groupCount!),'13');
      assert.equal(mouths.length,1,'the mouth keeps its arrow');assert.equal(mouths[0].count,1,'nothing folded into the mouth');
      assert.equal(groups[0].kind,'grupo','the group rides its own kind (edges.ts, doc §7)');assert.equal(mouths[0].kind,'spawn','the mouth is a spawn');
    }
  }
  // Counts past 99 read "99+".
  const big=city.layoutCityEdges([target('grupo:x','grupo',900,450,20,{groupCount:80} as any),target('grupo:y','spawn',902,452,21,{groupCount:40} as any)],area,hero) as (EdgeArrow&{groupCount?:number})[];
  assert.equal(big.length,1);assert.equal(big[0].groupCount,120);assert.equal(city.groupCountText(big[0].groupCount!),'99+');
  // mergeGroupTargets is order-independent and leaves other targets alone.
  const t=[target('grupo:a','spawn',100,100,20,{groupCount:5} as any),target('boca:S','spawn',101,101,9),target('grupo:b','spawn',110,100,30,{groupCount:8} as any)];
  const norm2=(list:any[])=>list.map(x=>`${x.key}:${x.groupCount??'-'}`).sort();
  assert.deepEqual(norm2(city.mergeGroupTargets(t)),['boca:S:-','grupo:a:13']);assert.deepEqual(norm2(city.mergeGroupTargets([...t].reverse())),norm2(city.mergeGroupTargets(t)));
});

// =====================================================================================================================
// Assertion 8: lobby selector
// =====================================================================================================================
test('8. selector, landscape: ≥ 24 px from joystick, skill (100/125%), gear and the owner window, on the side opposite the notch',()=>{
  for(const c of ALL.filter(x=>x.o==='landscape')){
    const l=layoutOf(c),k=controlsFor(c) as any;
    for(const [name,box] of [['joystick',k.joystick],['habilidade',k.skill],['habilidade 125%',DOC.landscape.skill125],['engrenagem',gearOf(c)],['janela do dono',OWNER_WINDOW]] as [string,Rect][])
      for(const rect of [l.selector,...l.segments])assert.ok(gap(rect,box)>=THUMB_GAP,`${c.name}: ${fmt(rect)} is ${gap(rect,box)} px from ${name}`);
    assert.ok(l.selector.x>=VIEWPORT.landscape.width/2,`${c.name}: selector on the right (notch on the left, or tie)`);
  }
  const mirror=city.cityHudLayout({...inputOf({o:'landscape',scale:1,notch:false,windowOpen:false,name:''}),safe:{...ZERO,right:NOTCH}});
  assert.ok(right(mirror.selector)<=VIEWPORT.landscape.width/2,'notch on the right: selector on the left');
  assert.ok(gap(mirror.selector,DOC.landscape.joystick)>=THUMB_GAP);
});

test('8. selector, portrait: inside the inner box of the lobby window, under the code row',()=>{
  for(const c of ALL.filter(x=>x.o==='portrait')){
    const l=layoutOf(c),win=r(16,c.notch?161:122,358,844),inner=r(win.x+16,win.y,win.width-32,844);
    for(const rect of [l.selector,...l.segments])assert.ok(within(rect,inner,0)&&rect.y>win.y,`${c.name}: ${fmt(rect)} outside ${fmt(inner)}`);
    assert.equal(l.segments[0].x,l.selector.x);assert.equal(right(l.segments[1]),right(l.selector));
    assert.equal(l.segments[0].y,l.segments[1].y,'side by side');
  }
  const pl=layoutOf({o:'landscape',scale:1,notch:false,windowOpen:false,name:''});
  assert.equal(pl.segments[0].x,pl.segments[1].x,'landscape: stacked');assert.ok(pl.segments[1].y>=bottom(pl.segments[0]));
});

// =====================================================================================================================
// Assertion 9: pure parts
// =====================================================================================================================
/** Blob of n enemies within ±1 u of (cx,cy): cx, cy = 8k + 1.75 stay inside one 8 u cell for both grid alignments (x/8, (x+84.5)/8). */
function blob(prefix:string,cx:number,cy:number,n:number,rnd:()=>number):EnemyPoint[]{
  return Array.from({length:n},(_,i)=>({id:`${prefix}${i}`,x:cx+(rnd()*2-1),y:cy+(rnd()*2-1)}));
}
const shuffle=<T>(list:readonly T[],rnd:()=>number)=>{const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const norm=(groups:readonly EnemyGroup[])=>groups.map(g=>({key:g.key,count:g.count,x:Math.round(g.x*1e6)/1e6,y:Math.round(g.y*1e6)/1e6,ids:[...g.ids].sort()}))
  .sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
const ENEMIES=(()=>{const rnd=lcg(2026);return [...blob('a',25.75,33.75,12,rnd),...blob('b',121.75,41.75,6,rnd),...blob('c',73.75,145.75,3,rnd),...blob('d',153.75,153.75,1,rnd)];})();

test('9. clusterEnemies: deterministic, order-independent, conserves the count, one group per tight blob, mean position',()=>{
  const a=city.clusterEnemies(ENEMIES),b=city.clusterEnemies(ENEMIES);
  assert.deepEqual(a,b,'same input, same output');
  for(const seed of [1,7,42,0xdeadbeef]){const shuffled=city.clusterEnemies(shuffle(ENEMIES,lcg(seed)));assert.deepEqual(norm(shuffled),norm(a),`shuffle seed ${seed}`);}
  const ids=a.flatMap(g=>g.ids);
  assert.equal(a.reduce((n,g)=>n+g.count,0),ENEMIES.length);assert.equal(ids.length,ENEMIES.length);assert.equal(new Set(ids).size,ENEMIES.length);
  for(const g of a){
    assert.equal(g.count,g.ids.length,g.key);
    const members=ENEMIES.filter(e=>g.ids.includes(e.id));
    assert.ok(near(g.x,members.reduce((s,e)=>s+e.x,0)/members.length,1e-9)&&near(g.y,members.reduce((s,e)=>s+e.y,0)/members.length,1e-9),`${g.key}: mean position`);
  }
  assert.deepEqual(a.map(g=>g.count).sort((x,y)=>y-x),[12,6,3,1]);
  assert.equal(new Set(a.map(g=>g.key)).size,a.length,'keys are unique');
  // Key stable for the same cell: a nudge inside the cells keeps every key.
  assert.deepEqual(norm(city.clusterEnemies(ENEMIES.map(e=>({...e,x:e.x+.1,y:e.y-.1})))).map(g=>[g.key,g.count]),norm(a).map(g=>[g.key,g.count]));
  assert.deepEqual(city.clusterEnemies([]),[]);
});

test('9. clusterEnemies: a long line splits into groups of one ring at most (spread < 24 u), still conserving the count',()=>{
  const rnd=lcg(99),line:EnemyPoint[]=Array.from({length:40},(_,i)=>({id:`l${i}`,x:10+i*3.7+rnd()*.2,y:101.75+rnd()*.5}));
  const groups=city.clusterEnemies(line);
  assert.equal(groups.reduce((n,g)=>n+g.count,0),line.length);
  assert.ok(groups.length>=2);
  for(const g of groups){const xs=line.filter(e=>g.ids.includes(e.id)).map(e=>e.x);assert.ok(Math.max(...xs)-Math.min(...xs)<3*city.GROUP_CELL,`${g.key}: spread ${Math.max(...xs)-Math.min(...xs)}`);}
  assert.deepEqual(norm(city.clusterEnemies(shuffle(line,lcg(5)))),norm(groups));
});

const G=(key:string,x:number,y:number,count:number):EnemyGroup=>({key,x,y,count,ids:Array.from({length:count},(_,i)=>`${key}-${i}`)});
const HERO={x:84.5,y:84.5};
const offScreen=(p:{x:number;y:number})=>Math.hypot(p.x-HERO.x,p.y-HERO.y)<8;
test('9. pickGroupArrows: off-screen, ≥ 5, within GROUP_RANGE (60 u × K), nearest first, at most 2, ties by count then key, hysteresis',()=>{
  const groups=[G('far',HERO.x+city.GROUP_RANGE+10,HERO.y,8),G('small',HERO.x,HERO.y+15,4),G('a',HERO.x+20,HERO.y,6),G('b',HERO.x-30,HERO.y,12),G('c',HERO.x,HERO.y-40,9),G('seen',HERO.x+5,HERO.y,20)];
  assert.deepEqual(city.pickGroupArrows(groups,HERO,offScreen).map(g=>g.key),['a','b']);
  assert.deepEqual(city.pickGroupArrows(groups,HERO,offScreen,{max:5}).map(g=>g.key),['a','b','c'],'never on screen, never under 5, never past 60 u');
  assert.deepEqual(city.pickGroupArrows(groups,HERO,offScreen,{max:5,min:3}).map(g=>g.key),['small','a','b','c']);
  assert.deepEqual(city.pickGroupArrows(shuffle(groups,lcg(3)),HERO,offScreen).map(g=>g.key),['a','b'],'order-independent');
  // Ties: same distance, larger count first, then the key.
  const tie=[G('k2',HERO.x+20,HERO.y,6),G('k3',HERO.x,HERO.y+20,8),G('k1',HERO.x-20,HERO.y,6)];
  assert.deepEqual(city.pickGroupArrows(tie,HERO,offScreen).map(g=>g.key),['k3','k1']);
  // Hysteresis: a shown arrow stays while its group has ≥ 3 and is among the 3 nearest.
  const h=[G('gA',HERO.x+20,HERO.y,6),G('gB',HERO.x+25,HERO.y,6),G('gC',HERO.x+30,HERO.y,4),G('gD',HERO.x+50,HERO.y,7)];
  const kept=city.pickGroupArrows(h,HERO,offScreen,{previous:new Set(['gC'])}).map(g=>g.key);
  assert.ok(kept.includes('gC')&&kept.length<=2,`kept ${kept}`);
  assert.deepEqual(city.pickGroupArrows(h,HERO,offScreen,{previous:new Set(['gD'])}).map(g=>g.key),['gA','gB'],'4th nearest: dropped');
  const two=[G('gE',HERO.x+10,HERO.y,2),G('gA',HERO.x+20,HERO.y,6),G('gB',HERO.x+25,HERO.y,6)];
  assert.ok(!city.pickGroupArrows(two,HERO,offScreen,{previous:new Set(['gE'])}).some(g=>g.key==='gE'),'under 3: dropped');
});

test('9. DEFAULT_CITY: the whole city (CITY_SIZE), the plaza at its centre (radius 10 u × K), the 4 mouths and the start inside',()=>{
  const map=city.DEFAULT_CITY,c=map.size;
  assert.equal(c,city.CITY_SIZE);assert.deepEqual({x:map.plaza.x,y:map.plaza.y},{x:82.28,y:82.28});assert.equal(map.plaza.radius,10*K);
  assert.deepEqual(map.mouths.map(m=>m.id).sort(),['L','N','O','S']);
  assert.ok(map.start.x>=0&&map.start.x<=c&&map.start.y>=0&&map.start.y<=c);
});

test('9. cityEdgeTargets: caído always, groups ≥ 5 off screen as kind grupo with groupCount, ≤ 2 active mouths, base only in prepare or after a wall hit',()=>{
  const hero={x:84.5,y:150},rnd=lcg(5);
  const locate=(p:{x:number;y:number})=>({x:195+(p.x-hero.x)*41,y:422+(p.y-hero.y)*41});
  const isOnScreen=(p:{x:number;y:number})=>{const s=locate(p);return s.x>=0&&s.x<=390&&s.y>=0&&s.y<=844;};
  const base={hero,selfId:'me',players:[{id:'me',x:hero.x,y:hero.y},{id:'a',x:84.5,y:20},{id:'b',x:20,y:20,downed:true,name:'Zé',seconds:12}],
    enemies:[...blob('g',41.75,145.75,12,rnd),...blob('s',121.75,153.75,4,rnd)],activeMouths:['N','S','L'] as ('N'|'S'|'L'|'O')[],map:city.DEFAULT_CITY,
    phase:'wave' as const,wallHitRecently:false,locate,isOnScreen};
  const {targets,groupKeys}=city.cityEdgeTargets(base);
  const caido=targets.filter(t=>t.kind==='caido');
  assert.equal(caido.length,1);assert.ok(near(caido[0].distance,Math.hypot(84.5-20,150-20),1e-6));
  assert.ok(!targets.some(t=>t.kind==='aliado'),'a standing ally never gets an arrow in the city');
  assert.ok(!targets.some(t=>t.kind==='base'),'no base in a wave without a wall hit');
  const grupos=targets.filter(t=>t.key.startsWith('grupo:'));
  assert.equal(grupos.length,1,`grupos: ${grupos.map(t=>t.key)}`);assert.equal(grupos[0].kind,'grupo');assert.equal((grupos[0] as any).groupCount,12,'the group carries its critters');
  assert.deepEqual([...groupKeys].map(k=>`grupo:${k}`),grupos.map(t=>t.key));
  const bocas=targets.filter(t=>t.key.startsWith('boca:'));
  assert.ok(bocas.length<=2&&bocas.length>=1,`bocas: ${bocas.map(t=>t.key)}`);
  for(const t of targets)assert.ok(Number.isFinite(t.screen.x)&&Number.isFinite(t.screen.y)&&t.distance>=0,t.key);
  assert.equal(city.cityEdgeTargets({...base,phase:'prepare'}).targets.filter(t=>t.kind==='base').length,1,'base in the intermission');
  assert.equal(city.cityEdgeTargets({...base,wallHitRecently:true}).targets.filter(t=>t.kind==='base').length,1,'base after a wall hit');
  assert.deepEqual(city.cityEdgeTargets(base).targets,targets,'deterministic');
});

/** World → screen for the edge-target tests: the hero at the portrait useful area's centre, 41 px/u (doc §0). */
const edgeWorld=(hero:{x:number;y:number},onScreen:boolean)=>{
  const locate=(p:{x:number;y:number})=>({x:230+(p.x-hero.x)*41,y:441+(p.y-hero.y)*41});
  return {locate,isOnScreen:onScreen?(p:{x:number;y:number})=>{const s=locate(p);return s.x>=0&&s.x<=390&&s.y>=0&&s.y<=844;}:()=>false};
};
test('§3 group ficha turns Cone (danger) within 8 u of the hero or 12 u of the wall, never otherwise',()=>{
  assert.equal(city.GROUP_DANGER_HERO,8);assert.equal(city.GROUP_DANGER_WALL,12);
  const hero={x:84.5+MID,y:150+MID},rnd=lcg(8),map=city.DEFAULT_CITY;
  const base={hero,selfId:'me',players:[{id:'me',...hero}],activeMouths:[] as ('N'|'S'|'L'|'O')[],map,phase:'wave' as const,...edgeWorld(hero,false)};
  // Near the hero (≈ 6.8 u) and far from both (≈ 43 u from the hero, ≈ 57 u from the wall).
  const near=blob('n',89.75+MID,145.75+MID,6,rnd),far=blob('f',41.75+MID,145.75+MID,7,rnd);
  const {targets}=city.cityEdgeTargets({...base,enemies:[...near,...far]});
  const byIds=(ids:EnemyPoint[])=>targets.find(t=>t.key.startsWith('grupo:')&&Math.abs(t.distance-Math.hypot(ids.reduce((s,e)=>s+e.x,0)/ids.length-hero.x,ids.reduce((s,e)=>s+e.y,0)/ids.length-hero.y))<1e-6);
  assert.equal(byIds(near)?.danger,true,'≤ 8 u from the hero');
  assert.ok(byIds(far)&&!byIds(far)!.danger,'far from the hero and the wall');
  // Near the wall: just inside the plaza's rim (radius 17), ≈ 54 u from the hero.
  const wall=blob('w',97.75+MID,97.75+MID,6,rnd),w=city.cityEdgeTargets({...base,enemies:wall}).targets.filter(t=>t.key.startsWith('grupo:'));
  const g={x:wall.reduce((s,e)=>s+e.x,0)/6,y:wall.reduce((s,e)=>s+e.y,0)/6};
  assert.ok(Math.hypot(g.x-map.plaza.x,g.y-map.plaza.y)-map.plaza.radius<=12&&Math.hypot(g.x-hero.x,g.y-hero.y)>8,'fixture: near the wall only');
  assert.equal(w.length,1);assert.equal(w[0].danger,true,'≤ 12 u from the wall');
});

test('§3 base after the horn: Cone with the seconds in the intermission; plain before it; no horn in a wave',()=>{
  const hero={x:84.5+MID,y:150+MID},map=city.DEFAULT_CITY;
  const base={hero,selfId:'me',players:[{id:'me',...hero}],enemies:[],map,...edgeWorld(hero,true)};
  const plain=city.cityEdgeTargets({...base,phase:'prepare'}).targets.find(t=>t.kind==='base');
  assert.ok(plain);assert.ok(!plain!.danger);assert.equal(plain!.seconds,undefined);
  const horn=city.cityEdgeTargets({...base,phase:'prepare',hornSeconds:5}).targets.find(t=>t.kind==='base');
  assert.equal(horn?.danger,true);assert.equal(horn?.seconds,5);
  const wave=city.cityEdgeTargets({...base,phase:'wave',wallHitRecently:true,hornSeconds:5}).targets.find(t=>t.kind==='base');
  assert.ok(wave,'a wall hit shows the base in a wave');assert.equal(wave!.seconds,undefined,'the horn belongs to the intermission');
  // Plaza in plain view: no base arrow even in the intermission.
  const seen=city.cityEdgeTargets({...base,hero:{x:84.5+MID,y:90+MID},phase:'prepare',...edgeWorld({x:84.5+MID,y:90+MID},true)}).targets;
  assert.ok(!seen.some(t=>t.kind==='base'));
});

test('§3 count text caps at "99+"; §4 download and news texts',()=>{
  assert.equal(city.groupCountText(0),'0');assert.equal(city.groupCountText(12),'12');assert.equal(city.groupCountText(99),'99');
  assert.equal(city.groupCountText(100),'99+');assert.equal(city.groupCountText(4321),'99+');
  assert.equal(city.downloadText(.4),'Baixando a cidade: 40%');assert.equal(city.downloadText(0),'Baixando a cidade: 0%');
  assert.equal(city.downloadText(1),'Baixando a cidade: 100%');assert.equal(city.downloadText(1.7),'Baixando a cidade: 100%');
  assert.equal(city.downloadText(-.2),'Baixando a cidade: 0%');assert.equal(city.downloadText(.404),'Baixando a cidade: 40%');
  assert.equal(city.mapChangedNews('cidade-nevada'),'Mapa trocado: Cidade Nevada. Todo mundo confirma de novo.');
  assert.equal(city.SELECTOR_TEXT.failed,'Não chegou. Toca de novo.');assert.equal(city.NEWS_MS,4000);
});

test('9. map options: Cidade Nevada / Mapa infinito, subtitles ≤ 28 characters (doc §4)',()=>{
  assert.deepEqual(city.MAP_OPTIONS.map(o=>o.id),['cidade-nevada','infinito']);
  assert.deepEqual(city.MAP_OPTIONS.map(o=>o.name),['Cidade Nevada','Mapa infinito']);
  assert.deepEqual(city.MAP_OPTIONS.map(o=>o.subtitle),['Leve casaco, a firma não deu','Praia sem fim, boleto também']);
  for(const o of city.MAP_OPTIONS){assert.ok(o.subtitle.length>0&&[...o.subtitle.normalize('NFC')].length<=28,o.subtitle);assert.doesNotMatch(o.subtitle,/chefe|rodada/i);}
});

const step=(s:SelectorState,e:SelectorEvent)=>city.selectorReducer(s,e);
test('9. selector state machine: owner tap → pending → confirm; same map sends nothing; pending dropped after 3 s',()=>{
  let s=city.initialSelector(true,'cidade-nevada');
  assert.equal(s.confirmed,'cidade-nevada');assert.equal(s.canManage,true);assert.equal(s.locked,false);assert.equal(s.pending,undefined);
  let out=step(s,{type:'tap',map:'cidade-nevada',nowMs:100});
  assert.equal(out.send,undefined,'tapping the selected map sends nothing');assert.equal(out.state.pending,undefined);
  out=step(s,{type:'tap',map:'infinito',nowMs:100});
  assert.equal(out.send,'infinito');assert.deepEqual(out.state.pending,{map:'infinito',sinceMs:100});assert.equal(out.state.confirmed,'cidade-nevada','nothing changes before the server says so');
  const confirmed=step(out.state,{type:'confirm',map:'infinito'});
  assert.equal(confirmed.state.confirmed,'infinito');assert.equal(confirmed.state.pending,undefined);assert.equal(confirmed.send,undefined);
  // No answer in 3 s: back to the server's map.
  s=out.state;
  assert.ok(step(s,{type:'tick',nowMs:100+city.PENDING_MS-1}).state.pending,'still pending before 3 s');
  const dropped=step(s,{type:'tick',nowMs:100+city.PENDING_MS+1}).state;
  assert.equal(dropped.pending,undefined);assert.equal(dropped.confirmed,'cidade-nevada');
  // And a new tap works again.
  assert.equal(step(dropped,{type:'tap',map:'infinito',nowMs:5000}).send,'infinito');
  assert.equal(city.initialSelector(true,'infinito').confirmed,'infinito');
});

test('9. selector state machine: locked in the countdown, reconnect drops the pending change, owner change, guest tap does nothing',()=>{
  const owner=city.initialSelector(true,'cidade-nevada');
  const locked=step(owner,{type:'countdown',on:true}).state;
  assert.equal(locked.locked,true);
  const tapLocked=step(locked,{type:'tap',map:'infinito',nowMs:10});
  assert.equal(tapLocked.send,undefined);assert.equal(tapLocked.state.pending,undefined);
  const unlocked=step(locked,{type:'countdown',on:false}).state;
  assert.equal(unlocked.locked,false);assert.equal(step(unlocked,{type:'tap',map:'infinito',nowMs:20}).send,'infinito','unlocks when the countdown drops');
  // Reconnect: the pending change is dropped and the welcome's map rules.
  const pending=step(owner,{type:'tap',map:'infinito',nowMs:0}).state;
  const back=step(pending,{type:'reconnect'}).state;
  assert.equal(back.pending,undefined);assert.equal(back.confirmed,'cidade-nevada');
  assert.equal(step(back,{type:'confirm',map:'infinito'}).state.confirmed,'infinito');
  // Owner change in the middle: the pending change drops too; the new guest can no longer pick.
  const demoted=step(pending,{type:'owner',canManage:false}).state;
  assert.equal(demoted.canManage,false);assert.equal(demoted.pending,undefined);
  // Guest: a tap does nothing at all.
  const guest=city.initialSelector(false,'cidade-nevada');
  const tap=step(guest,{type:'tap',map:'infinito',nowMs:0});
  assert.equal(tap.send,undefined);assert.deepEqual(tap.state,guest);
  // Guests still follow the server's map, and become able to pick when they get the room.
  assert.equal(step(guest,{type:'confirm',map:'infinito'}).state.confirmed,'infinito');
  const promoted=step(guest,{type:'owner',canManage:true}).state;
  assert.equal(promoted.canManage,true);assert.equal(step(promoted,{type:'tap',map:'infinito',nowMs:0}).send,'infinito');
});

test('9. selector state machine never gets stuck and has no dead button (seeded random events, offline and download included)',()=>{
  const maps:MapId[]=['cidade-nevada','infinito'];
  for(const seed of [1,2,3,2026]){
    const rnd=lcg(seed);let now=0,s=city.initialSelector(rnd()<.5,'cidade-nevada');
    for(let i=0;i<1500;i++){
      now+=Math.floor(rnd()*900);
      const k=rnd(),map=maps[Math.floor(rnd()*2)];
      const e:SelectorEvent=k<.35?{type:'tap',map,nowMs:now}:k<.48?{type:'tick',nowMs:now}:k<.56?{type:'confirm',map}:k<.64?{type:'countdown',on:rnd()<.5}
        :k<.70?{type:'reconnect'}:k<.80?{type:'owner',canManage:rnd()<.7}:k<.92?{type:'offline',on:rnd()<.5}:{type:'download',text:rnd()<.5?city.downloadText(rnd()):undefined};
      const prev=s,out=step(prev,e);s=out.state;
      const where=`seed ${seed}, step ${i}, ${JSON.stringify(e)}`;
      assert.ok(maps.includes(s.confirmed),where);
      if(s.pending)assert.ok(s.canManage&&!s.offline&&maps.includes(s.pending.map)&&s.pending.sinceMs<=now,`${where}: pending ${JSON.stringify(s.pending)} (canManage=${s.canManage}, offline=${s.offline})`);
      if(out.send!==undefined)assert.ok(e.type==='tap'&&prev.canManage&&!prev.locked&&!prev.offline&&e.map!==prev.confirmed&&out.send===e.map,`${where}: sent ${out.send}`);
      if(e.type==='tick'&&prev.pending&&now>prev.pending.sinceMs+city.PENDING_MS)assert.equal(s.pending,undefined,`${where}: pending past 3 s`);
      if(e.type==='reconnect'||(e.type==='offline'&&e.on))assert.equal(s.pending,undefined,`${where}: a pending change survives the reconnection`);
      // No dead button: an enabled segment on the other map sends it; a disabled one sends nothing. Offline: all off.
      for(const orientation of ['portrait','landscape'] as const){
        const view=city.selectorView(s,orientation);
        if(s.offline)assert.ok(view.options.every(o=>o.disabled&&o.sticker==='sem-linha'),`${where}: offline but a segment is live`);
        for(const o of view.options){
          const tap=step(s,{type:'tap',map:o.id,nowMs:now});
          if(o.disabled||o.selected)assert.equal(tap.send,undefined,`${where}: ${o.id} ${o.disabled?'disabled':'selected'} but sends`);
          else assert.equal(tap.send,o.id,`${where}: ${orientation} ${o.id} looks live but sends nothing (dead button)`);
        }
      }
      // Recovery from any state: back online, countdown over, room owner, 3 s later → a tap on the other map is sent.
      if(i%25===0){
        let t=step(s,{type:'offline',on:false}).state;t=step(t,{type:'countdown',on:false}).state;t=step(t,{type:'owner',canManage:true}).state;t=step(t,{type:'tick',nowMs:now+city.PENDING_MS+1}).state;
        const other=t.confirmed==='cidade-nevada'?'infinito':'cidade-nevada';
        assert.equal(step(t,{type:'tap',map:other,nowMs:now+city.PENDING_MS+2}).send,other,`${where}: stuck`);
      }
    }
  }
});

test('§4 reconnection: offline turns every segment off with sem-linha, drops the pending change, sends nothing; back online the owner picks again',()=>{
  const owner=city.initialSelector(true,'cidade-nevada');
  assert.equal(owner.offline,false);
  const pending=step(owner,{type:'tap',map:'infinito',nowMs:0}).state;
  const off=step(pending,{type:'offline',on:true}).state;
  assert.equal(off.offline,true);assert.equal(off.pending,undefined,'the pending change is dropped');
  for(const map of ['cidade-nevada','infinito'] as const){const t=step(off,{type:'tap',map,nowMs:10});assert.equal(t.send,undefined);assert.equal(t.state.pending,undefined);}
  for(const orientation of ['portrait','landscape'] as const){
    const v=city.selectorView(off,orientation);assert.ok(v.options.every(o=>o.disabled&&o.sticker==='sem-linha'),orientation);
  }
  // The welcome's map rules, then back online.
  const back=step(step(off,{type:'confirm',map:'cidade-nevada'}).state,{type:'offline',on:false}).state;
  assert.equal(back.offline,false);assert.equal(step(back,{type:'tap',map:'infinito',nowMs:20}).send,'infinito');
  // Stickers: pronto on the selection, relogio on the pending one, cadeado in the countdown (doc §4).
  assert.deepEqual(city.selectorView(owner,'portrait').options.map(o=>o.sticker),['pronto',undefined]);
  assert.deepEqual(city.selectorView(pending,'portrait').options.map(o=>o.sticker),['pronto','relogio']);
  assert.equal(city.selectorView(step(owner,{type:'countdown',on:true}).state,'portrait').options[0].sticker,'cadeado');
});

test('§4 download: the selected subtitle becomes "Baixando a cidade: 40%" (landscape too), and goes back after',()=>{
  const s=step(city.initialSelector(false,'cidade-nevada'),{type:'download',text:city.downloadText(.4)}).state;
  for(const orientation of ['portrait','landscape'] as const){
    const v=city.selectorView(s,orientation);
    assert.equal(v.options[0].subtitle,'Baixando a cidade: 40%',orientation);
    if(orientation==='landscape')assert.ok(!v.options[1].subtitle,'landscape: no joke on the other option');
    else assert.equal(v.options[1].subtitle,city.MAP_OPTIONS[1].subtitle);
  }
  const done=step(s,{type:'download'}).state;
  assert.equal(done.download,undefined);assert.equal(city.selectorView(done,'portrait').options[0].subtitle,city.MAP_OPTIONS[0].subtitle);
  // Downloading never blocks the owner's choice.
  assert.equal(step(step(city.initialSelector(true,'cidade-nevada'),{type:'download',text:city.downloadText(.1)}).state,{type:'tap',map:'infinito',nowMs:0}).send,'infinito');
});

test('9. selectorView: one selected, pending marked, guests read-only with the owner hint, locked hint, no subtitles in landscape',()=>{
  const owner=city.initialSelector(true,'cidade-nevada'),names=city.MAP_OPTIONS.map(o=>o.name);
  for(const orientation of ['portrait','landscape'] as const){
    const v=city.selectorView(owner,orientation);
    assert.deepEqual(v.options.map(o=>o.id),['cidade-nevada','infinito']);assert.deepEqual(v.options.map(o=>o.name),names);
    assert.deepEqual(v.options.map(o=>o.selected),[true,false]);assert.ok(v.options.every(o=>!o.pending&&!o.disabled),orientation);
    if(orientation==='landscape')assert.ok(v.options.every(o=>!o.subtitle),'landscape drops the subtitles');
    else assert.deepEqual(v.options.map(o=>o.subtitle),city.MAP_OPTIONS.map(o=>o.subtitle));
    const pending=city.selectorView(step(owner,{type:'tap',map:'infinito',nowMs:0}).state,orientation);
    assert.deepEqual(pending.options.map(o=>o.pending),[false,true]);assert.deepEqual(pending.options.map(o=>o.selected),[true,false],'selection waits for the server');
    const locked=city.selectorView(step(owner,{type:'countdown',on:true}).state,orientation);
    assert.ok(locked.options.every(o=>o.disabled));assert.equal(locked.hint,'Na contagem o mapa não muda.');
    const guest=city.selectorView(city.initialSelector(false,'infinito'),orientation);
    assert.ok(guest.options.every(o=>o.disabled),'guests: read-only');assert.deepEqual(guest.options.map(o=>o.selected),[false,true]);
    for(const view of [v,pending,locked,guest])if(view.hint)assert.doesNotMatch(view.hint,/chefe/i,'"dono", never "chefe"');
  }
  assert.equal(city.selectorView(city.initialSelector(false,'cidade-nevada'),'portrait').hint,'Quem escolhe o mapa é o dono da sala.');
});

// =====================================================================================================================
// Linking card cidade-04 (doc §7): the city HUD wired into the run HUD
// =====================================================================================================================
const realCity=async()=>{
  const text=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  const {hash}=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')) as {hash:string};
  const decoded=await cityTerrainFrom(text,hash);
  assert.ok(decoded.ok,'the shipped city decodes against its manifest hash');
  return decoded.terrain;
};

test('§7 CityMapInfo from the real asset: plaza at praca with its farthest entrance as radius, the 4 avenue ends as mouths, the start',async()=>{
  const terrain=await realCity(),asset=city.cityAssetOf(terrain);
  assert.ok(asset,'the city terrain carries its asset');
  const map=city.cityMapInfo(asset!),p=terrain.asset.points;
  assert.equal(map.size,terrain.asset.size.w);assert.ok(Math.abs(map.size-city.CITY_SIZE)<.1,'CITY_SIZE fits the asset');
  assert.deepEqual({x:map.plaza.x,y:map.plaza.y},{x:p.praca.x,y:p.praca.y});
  const radius=Math.max(...(['N','S','L','O'] as const).map(id=>Math.hypot(p.bocas[id].x-p.praca.x,p.bocas[id].y-p.praca.y)));
  assert.ok(near(map.plaza.radius,radius),`radius ${map.plaza.radius}`);assert.ok(map.plaza.radius>8*K&&map.plaza.radius<20*K,'a plaza, not the city');
  assert.deepEqual(map.mouths,(['N','S','L','O'] as const).map(id=>({id,...p[`spawn${id}`],gate:{...p.bocas[id]}})),'each avenue end with its entrance on the plaza wall as its gate');
  assert.deepEqual(map.start,{x:p.inicio.x,y:p.inicio.y});
  assert.equal(city.cityAssetOf({world:'ilha'}),undefined);assert.equal(city.cityAssetOf({world:'infinito'}),undefined);
  assert.equal(city.cityAssetOf({world:'cidade'}),undefined,'a city without its asset is not guessed');
});

// The run HUD and its driver import CSS (Vite): node loads them with the CSS stubbed, so their real methods run here
// against small fakes (no DOM).
const registerHooks=(nodeModule as {registerHooks?:(hooks:object)=>unknown}).registerHooks;
const noCss=registerHooks?(registerHooks({load(url:string,context:unknown,next:(url:string,context:unknown)=>unknown){
  return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}}),undefined):'needs node:module registerHooks (node ≥ 22.15)';

/** A RescueBoard with only what its frames read, faked (no DOM, no socket); `calls` records what it drove. */
async function fakeBoard(terrain:object,phase:'lobby'|'combat'){
  const {RescueBoard}=await import('../../src/client/hud/rescue.ts');
  const calls:string[]=[],area=USEFUL.portrait.n100,hero={x:84.5,y:150};
  const board=Object.create(RescueBoard.prototype) as Record<string,unknown>;
  const hud={el:{hidden:false,classList:{contains:()=>false}},
    setCityRoute:(input:unknown)=>calls.push(`cityRoute ${input?'on':'off'}`),prewarmCity:()=>calls.push('prewarm'),zones:()=>({useful:area}),
    edges:{clear:()=>calls.push('edges.clear'),render:(a:readonly EdgeArrow[])=>calls.push(`edges.render ${a.length}`),need:()=>calls.push('edges.need'),scale:()=>1}};
  const scene={focusPoint:()=>hero,usefulArea:area,heroScreenRect:()=>heroAt(area,0,0),say:()=>{},cameraView:0,
    locate:(p:{x:number;y:number})=>({screen:{x:area.x+area.width/2+(p.x-hero.x)*60,y:area.y+area.height/2+(p.y-hero.y)*60}})};
  const net={id:'me',terrain,run:{phase},feed:{players:new Map(),enemies:new Map()},view:()=>({players:[]})};
  Object.assign(board,{net,hud,scene:()=>scene,gate:{remaining:()=>0},button:{hidden:true,setAttribute(){},style:{setProperty(){}}},
    states:new Map(),warnings:[],pings:{get:()=>undefined,clear(){}},said:new Set(),mouths:new Map(),groupKeys:new Set(),windows:[],
    last:{tick:1000,players:[],telegraphs:[],pickups:[],nodes:[],structures:[],round:{phase:'wave'}},
    seen:()=>({viewport:{x:0,y:0,width:390,height:844},covered:[]}),cityFrame:()=>calls.push('cityFrame'),minimapAt:0});
  return {board:board as unknown as {tick():void},calls};
}

test('§7 world swap: the driver follows the world every frame, before the out-of-combat return; the city frame replaces the island radar',{skip:noCss},async()=>{
  const cityTerrain=await realCity();
  // In the lobby (a map switched there): the city's route is prewarmed, nothing is drawn.
  for(const [terrain,on] of [[cityTerrain,true],[{world:'ilha'},false]] as const){
    const {board,calls}=await fakeBoard(terrain,'lobby');board.tick();
    // The city's walking route (cidade-08) is built ahead of time from the lobby on, not on round 1's first frame.
    assert.deepEqual(calls,[...(on?['prewarm']:[]),'cityRoute off','edges.clear'],`lobby on ${on?'the city':'the island'}`);
  }
  // In a wave in the city: the city frame draws, never the island's radar and arrows.
  const inCity=await fakeBoard(cityTerrain,'combat');inCity.board.tick();
  // Round 1's walk to the plaza (cidade-08) reads the route in the city's runs only.
  assert.deepEqual(inCity.calls,['prewarm','cityRoute on','cityFrame']);
  // On the island: the radar's arrows, never the city frame.
  const onIsland=await fakeBoard({world:'ilha'},'combat');onIsland.board.tick();
  // setas-e-construir (arrows.ts): the island base (off screen) no longer gets an arrow; only a downed ally would.
  assert.deepEqual(onIsland.calls,['cityRoute off','edges.render 0','edges.need'],'the radar still runs, its base arrow is off');
});

test('§7 city frame: the targets are rebuilt at ≤ 10 Hz (buffers reused) and only re-located in between; the horn base is audited',{skip:noCss},async()=>{
  const {RescueBoard,CITY_TARGETS_MS}=await import('../../src/client/hud/rescue.ts');
  assert.ok(CITY_TARGETS_MS>=100,'≤ 10 Hz');
  const terrain=await realCity(),asset=city.cityAssetOf(terrain)!,area=USEFUL.portrait.n100,me={x:84.5,y:150};
  let cam={...me},sweeps=0;const rendered:EdgeArrow[][]=[],needs:string[][]=[];
  const enemies=new Map(blob('g',41.75,145.75,13,lcg(3)).map(e=>[e.id,{...e,hp:10}]));
  const feed={players:new Map(),enemies:{values:()=>{sweeps++;return enemies.values();}}};
  const scene={usefulArea:area,heroScreenRect:()=>heroAt(area,0,0),cameraView:0,
    locate:(p:{x:number;y:number})=>({screen:{x:area.x+area.width/2+(p.x-cam.x)*60,y:area.y+area.height/2+(p.y-cam.y)*60}})};
  const hud={
    edges:{render:(a:EdgeArrow[])=>rendered.push(a),need:(t:EdgeTarget[],must?:(t:EdgeTarget)=>boolean)=>needs.push(edgesMod.needKinds(t,must)),scale:()=>1}};
  const board=Object.create(RescueBoard.prototype) as Record<string,unknown>&{cityFrame(...a:unknown[]):void;cityEnemies:object[];cityPeople:object[]};
  Object.assign(board,{net:{id:'me',feed},hud,states:new Map([['p3',{id:'p3',downed:{progress:0,bleedOutTick:1280}}]]),pings:{get:()=>undefined},
    mouths:new Map(),groupKeys:new Set(),windows:[],wallHitAt:-Infinity,minimapAt:0,cityAt:-Infinity,
    cityPeople:[],cityEnemies:[],cityTargets:[],
    last:{tick:1000,round:{phase:'prepare'},camp:{hornEndsTick:1100},telegraphs:[],structures:[],pickups:[]},
    seen:()=>({viewport:{x:0,y:0,width:390,height:844},covered:[]})});
  const players=[{id:'me',name:'Você',classId:'mestre-de-obras',x:me.x,y:me.y,online:true},{id:'p3',name:'Zé do Pix',classId:'mestre-de-obras',x:118,y:142,online:true}];
  const frame=(now:number)=>board.cityFrame(asset,scene,players,cam,{useful:area},now);
  frame(1000);
  assert.equal(sweeps,1,'the first frame builds the targets');
  const enemy0=board.cityEnemies[0],person0=board.cityPeople[0];
  // setas-e-construir (arrows.ts): of the group, the horn's base and the downed Zé, only Zé keeps an arrow.
  const first=rendered.at(-1)!,group0=first.find(a=>a.key==='p3')!;
  assert.deepEqual(first.map(a=>a.kind),['caido'],first.map(a=>a.key).join());
  // 5 more frames inside the window, the camera walking east: no sweep of the critters, the arrows follow the camera.
  for(let k=1;k<=5;k++){cam={x:me.x+k*.1,y:me.y};frame(1000+k*16);}
  assert.equal(sweeps,1,'no rebuild between two refreshes');
  const moved=rendered.at(-1)!.find(a=>a.key===group0.key)!;
  assert.ok(moved.distance<group0.distance,'re-located: the hero walked toward Zé');
  frame(1000+CITY_TARGETS_MS);
  assert.equal(sweeps,2,'rebuilt at the next refresh');
  assert.equal(board.cityEnemies[0],enemy0,'the critter buffer is reused');assert.equal(board.cityPeople[0],person0,'the people buffer too');
  // The horn is running (5 s), but the base's arrow is off (arrows.ts): the audit's data-need lists only the caído.
  assert.deepEqual(needs.at(-1),['caido']);
});

test('§7 grupo edge kind: priority 2 (after chefe, before spawn and base), an existing sticker, its tag room kept in the area',()=>{
  const {EDGE_PRIORITY:P,EDGE_ICON,layoutEdges,TAG_ROOM:ROOM}=edgesMod;
  assert.ok(P.caido<P.chefe&&P.chefe<P.grupo&&P.grupo<P.spawn&&P.spawn<P.base&&P.base<P.aliado&&P.aliado<P.bau);
  assert.ok((ICON_NAMES as readonly string[]).includes(EDGE_ICON.grupo!),'reuses a sticker of the sprite (the bichos art is for E8)');
  const area=r(70,240,320,402),hero=heroAt(area,0,0);
  for(const [x,y] of [[230,-400],[230,1400],[-400,440],[900,440]] as const){
    const [a]=layoutEdges([target('grupo:1','grupo',x,y,34,{label:'12'})],area,hero);
    assert.ok(a&&a.kind==='grupo');
    const box=r(a.x-halfW(1),a.y-HALF_H-ROOM,2*halfW(1),2*HALF_H+ROOM);
    assert.ok(within(box,area,1),`tag room of ${x},${y}: ${fmt(box)} in ${fmt(area)}`);
  }
  // Two groups side by side fold into one arrow of their kind, never into a mouth's (layoutCityEdges sums the critters).
  const both=layoutEdges([target('grupo:1','grupo',900,440,30),target('grupo:2','grupo',900,442,31),target('boca:L','spawn',900,446,32)],area,hero,{merge:200});
  assert.equal(both.filter(a=>a.kind==='grupo').reduce((n,a)=>n+a.count,0),2,'both groups counted in group arrows');
  assert.ok(both.filter(a=>a.kind==='spawn').every(a=>a.count===1),'nothing folded into the mouth');
});

test('§7 tags: the base shows the horn seconds, a group its count in the body and its distance on the tag; the island kinds are unchanged',()=>{
  assert.equal(edgeTag({kind:'base',distance:40,seconds:5}),'5 s');assert.equal(edgeTag({kind:'base',distance:40}),'','no horn, no tag');
  assert.equal(edgeTag({kind:'grupo',distance:33.6}),'34 m');assert.equal(edgeTag({kind:'grupo',distance:4000}),'999 m');
  assert.equal(edgeTag({kind:'caido',distance:9,seconds:12,ping:true}),edgesMod.caidoTag({seconds:12,ping:true}));
  for(const kind of ['chefe','spawn','aliado','bau'] as const)assert.equal(edgeTag({kind,distance:20,seconds:3}),'',kind);
  assert.equal(city.hornSeconds({hornEndsTick:1100},1000,'prepare'),5);assert.equal(city.hornSeconds({hornEndsTick:1001},1000,'prepare'),1);
  assert.equal(city.hornSeconds({hornEndsTick:900},1000,'prepare'),0);assert.equal(city.hornSeconds({hornEndsTick:1100},1000,'wave'),undefined);
  assert.equal(city.hornSeconds({},1000,'prepare'),undefined);assert.equal(city.hornSeconds(undefined,1000,'prepare'),undefined);
  // The city's base arrow carries the seconds into the layout, which keeps its tag's room; a group arrow carries its count.
  const hero={x:84.5,y:150},{locate}=edgeWorld(hero,false);
  const {targets}=city.cityEdgeTargets({hero,selfId:'me',players:[{id:'me',...hero}],enemies:blob('g',41.75,145.75,13,lcg(3)),map:city.DEFAULT_CITY,phase:'prepare',
    hornSeconds:5,locate,isOnScreen:()=>false});
  const arrows=city.layoutCityEdges(targets,USEFUL.portrait.n100,heroAt(USEFUL.portrait.n100,0,0));
  const baseArrow=arrows.find(a=>a.kind==='base')!,group=arrows.find(a=>a.kind==='grupo')!;
  assert.equal(edgeTag(baseArrow),'5 s');assert.equal(baseArrow.danger,true);
  assert.equal(group.label,'13');assert.equal(group.groupCount,13);assert.equal(edgeTag(group),edgesMod.distanceText(group.distance));
  for(const a of arrows)assert.ok(a.y-HALF_H-TAG_ROOM>=USEFUL.portrait.n100.y-1,`${a.key}: tag out of the area`);
});

test('§7 COVERING and WINDOWS: the open windows and the minimap hide the map; the minimap is a window (targets behind it get an arrow beside it)',()=>{
  for(const sel of ['.rh-offer:not([hidden])','.rh-forge:not([hidden])','.rh-minimap'])assert.ok(edgesMod.COVERING.split(',').includes(sel),sel);
  // The WC3 minimap floats over a corner of the field (minimapa-wc3): the collapsed one is a window too.
  assert.ok(edgesMod.WINDOWS.split(',').includes('.rh-minimap'));
});

test('§7 active mouths: a spawn warning lights the mouth of its avenue (real map) until 3 s after its critters come out',async()=>{
  const map=city.cityMapInfo(city.cityAssetOf(await realCity())!),plaza=map.plaza;
  assert.equal(city.MOUTH_TAIL_TICKS,3*deps.SIM_HZ);
  // Points along each avenue (from its end to the plaza's rim, a few u off its axis) belong to that mouth.
  for(const m of map.mouths)for(const t of [.05,.3,.6,.85])for(const off of [-4,0,4]){
    const x=m.x+(plaza.x-m.x)*t,y=m.y+(plaza.y-m.y)*t,len=Math.hypot(plaza.x-m.x,plaza.y-m.y),nx=-(plaza.y-m.y)/len,ny=(plaza.x-m.x)/len;
    const p={x:x+nx*off,y:y+ny*off};
    if(Math.hypot(p.x-plaza.x,p.y-plaza.y)<=plaza.radius)continue;
    assert.equal(city.mouthOfWarning(p,map),m.id,`${m.id} at t=${t} off=${off}: ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  assert.equal(city.mouthOfWarning(plaza,map),undefined,'the boss lands in the plaza: no mouth');
  for(const corner of [{x:20,y:20},{x:150,y:20},{x:150,y:150},{x:20,y:150}].map(c=>({x:c.x*K,y:c.y*K})))assert.equal(city.mouthOfWarning(corner,map),undefined,'a block between avenues');
  assert.equal(city.mouthOfWarning({x:NaN,y:3},map),undefined);
  const state=new Map<'N'|'S'|'L'|'O',number>(),end=(id:string)=>map.mouths.find(m=>m.id===id)!;
  const warn=(id:string,atTick:number)=>({type:'spawn-warning',x:end(id).x,y:end(id).y,atTick,count:6});
  assert.deepEqual(city.trackMouths(state,[warn('L',1030),warn('N',1030),{type:'kill',x:end('S').x,y:end('S').y}],1000,map),['N','L'],'N, S, L, O order; other events ignored');
  assert.deepEqual(city.trackMouths(state,[],1030+city.MOUTH_TAIL_TICKS,map),['N','L'],'still lit 3 s after the critters came out');
  assert.deepEqual(city.trackMouths(state,[warn('O',1200)],1030+city.MOUTH_TAIL_TICKS+1,map),['O'],'then off');
  assert.deepEqual(city.trackMouths(state,[warn('O',1100)],1150,map),['O'],'an older warning never shortens a mouth');
  assert.deepEqual(city.trackMouths(state,[{type:'spawn-warning',x:plaza.x,y:plaza.y,atTick:1300}],1250,map),['O'],'the boss warning lights nothing');
});

test('cidade-04: every point the real planner spawns a group at lights that group\'s mouth (the south gate well inside the plaza radius)',async()=>{
  const terrain=await realCity(),map=city.cityMapInfo(city.cityAssetOf(terrain)!),planner=cityPlanner(terrain),P=terrain.asset.points;
  // The plaza is no circle: its south gate was 2.4 u from praca, the east and west ones 12 u. A radius for all (12.66 u)
  // dropped the south groups planned right outside their gate (5.9 u from praca, cidade-04 review).
  // Asset v4 (mapa-175-com-viaduto): the N and S gates ~6 u from the plaza point, L and O ~12 u.
  const gateS=map.mouths.find(m=>m.id==='S')!.gate!;
  assert.ok(Math.hypot(gateS.x-map.plaza.x,gateS.y-map.plaza.y)<map.plaza.radius*.6&&map.plaza.radius>10*K);
  // Players at the plaza, east of it, at the start, on each avenue and at its end; with the team chase (cidade-05c) and without.
  const spots=[P.praca,{x:P.praca.x+20*K,y:P.praca.y},P.inicio,...[{x:84,y:40},{x:40,y:88},{x:130,y:88},{x:84,y:130}].map(q=>({x:q.x*K,y:q.y*K})),P.spawnN,P.spawnL,P.spawnO];
  let total=0,south=0,nearPlaza=0;const wrong:string[]=[];
  for(const mode of ['cerco','normal','alternado','excursao'] as const)for(let seed=1;seed<=3;seed++)for(const s of spots)for(const chase of [false,true]){
    const state=planner.openRound(2+seed,mode,new Rng(seed));
    const groups=planner.planGroups([{at:0,size:12},{at:40,size:12},{at:80,size:20}],[{id:'a',x:s.x,y:s.y}],state,new Rng(seed+9),
      chase?{chaseCost:p=>Math.hypot(p.x-s.x,p.y-s.y)}:{});
    for(const g of groups)for(const p of g.points){
      total++;if(g.mouth==='S')south++;
      if(Math.hypot(p.x-map.plaza.x,p.y-map.plaza.y)<=map.plaza.radius)nearPlaza++;
      const got=city.mouthOfWarning(p,map);
      if(got!==g.mouth&&wrong.length<5)wrong.push(`${mode} seed ${seed} at ${s.x},${s.y}${chase?' chase':''}: ${g.mouth} group at ${p.x.toFixed(2)},${p.y.toFixed(2)} → ${got}`);
    }
  }
  assert.deepEqual(wrong,[],`${total} points`);
  assert.ok(total>5000&&south>500&&nearPlaza>0,`the scenes reach the case: ${total} points, ${south} south, ${nearPlaza} within the old radius`);
  // Inside the plaza (the boss lands there, its minions 2.5 u around it, D-026) nothing lights, even beside a gate.
  for(const c of [map.plaza,{x:84.1*K,y:86.5*K}])for(let a=0;a<12;a++){
    const p={x:c.x+Math.cos(a*Math.PI/6)*2.5,y:c.y+Math.sin(a*Math.PI/6)*2.5};
    assert.equal(city.mouthOfWarning(p,map),undefined,`a minion at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  for(const m of map.mouths)assert.equal(city.mouthOfWarning(m.gate!,map),undefined,`at gate ${m.id}`);
});

test('cidade-04: the audit\'s must-point kinds follow the layout\'s rule: the city\'s base after the horn is checked too',()=>{
  const base=target('base','base',900,440,30,{seconds:4,danger:true}),plain=target('base','base',900,440,30);
  const caido=target('p3','caido',-200,440,12,{seconds:9}),chefe=target('chefe:b','chefe',200,-300,40),group=target('grupo:1','grupo',200,1200,20);
  assert.deepEqual(edgesMod.needKinds([group,base,chefe,caido]),['caido','chefe'],'the island\'s rule: caído and boss only');
  assert.deepEqual(edgesMod.needKinds([group,base,chefe,caido],city.cityMustPoint),['caido','chefe','base'],'the city\'s: and the base after the horn');
  assert.deepEqual(edgesMod.needKinds([plain,group],city.cityMustPoint),[],'a plain base may give way');
  // What the audit then does with it: a needed kind without an arrow fails (zones.ts auditBoxes, unpointed).
  const zones=computeZones({viewport:{width:390,height:844},...city.REFERENCE_CONTROLS.portrait});
  const audit=auditBoxes([{name:'sem-seta-base',rect:r(0,0,0,0),unpointed:true}],zones,heroAt(zones.useful,0,0));
  assert.equal(audit.ok,false);assert.deepEqual(audit.unpointed,['sem-seta-base']);
});

test('§7 screenCorners: the camera\'s view rectangle in world units (the WC3 minimap draws it), empty for a degenerate camera',()=>{
  // An iso-like affine camera: the corners come back to the viewport exactly.
  const viewport={width:390,height:844},focus={x:80,y:120};
  const locate=(p:{x:number;y:number})=>({x:195+(p.x-focus.x-(p.y-focus.y))*45,y:441+(p.x-focus.x+p.y-focus.y)*22.5-3});
  const corners=city.screenCorners(locate,focus,viewport);
  assert.equal(corners.length,4);
  for(const [i,c] of [[0,0],[390,0],[390,844],[0,844]].entries()){const s=locate(corners[i]);assert.ok(near(s.x,c[0],1e-6)&&near(s.y,c[1],1e-6),`corner ${i}: ${s.x},${s.y}`);}
  assert.deepEqual(city.screenCorners(()=>({x:1,y:1}),focus,viewport),[],'a degenerate camera gives no rectangle');
});

// =====================================================================================================================
// Visual review of card cidade-04 (sandbox ?sandbox=hud&mapa=cidade, 390×844 and 844×390)
// =====================================================================================================================
/** The sandbox's useful area and hero box (measured in the browser). */
const SANDBOX={
  portrait:{viewport:VIEWPORT.portrait,area:r(85.90625,244.59375,304.09375,449.40625),hero:r(209.953125,441.296875,56,56)},
  landscape:{viewport:VIEWPORT.landscape,area:r(134,154,586,155.0625),hero:r(399,203.53125,56,56)},
} as const;
/** Caído (Zé, pinging), the 7-critter group 56 u away, the east mouth, the base after the horn (4 s): screen points per view. */
const SANDBOX_SCREEN:Record<Orientation,[number,number][][]>={
  portrait:[[[1093,1678],[1,-1285],[5331,1384],[1876,-255]],[[-1,1678],[2700,500],[1500,3800],[700,1300]],[[-617,-707],[475,2280],[-4855,-389],[-1400,1210]],[[700,-900],[-2300,500],[-200,-4200],[-400,-200]]],
  landscape:[[[1282,1440],[190,-1523],[5520,1146],[2065,-492]],[[-200,450],[2900,260],[1700,3500],[900,1060]],[[-428,-945],[664,2042],[-4666,-627],[-1211,972]],[[900,-1200],[-2100,250],[-10,-4500],[-200,-400]]],
};
function sandboxTargets(o:Orientation,view:number):EdgeTarget[]{
  const [c,g,m,b]=SANDBOX_SCREEN[o][view];
  return [target('p3','caido',c[0],c[1],40,{seconds:14,ping:true,label:'Zé',name:'Zé'}),target('grupo:4,10','grupo',g[0],g[1],56,{label:'7',groupCount:7} as Partial<EdgeTarget>),
    target('boca:L','spawn',m[0],m[1],85),target('base','base',b[0],b[1],35,{danger:true,seconds:4})];
}
const sandboxSeen=(o:Orientation)=>({viewport:r(0,0,VIEWPORT[o].width,VIEWPORT[o].height),covered:[] as Rect[]});
/** Where an arrow's beak sits (its base on the ficha, its tip BEAK_REACH further), as EdgeArrows draws it. */
function beakOf(a:EdgeArrow,half={w:38,h:18}){
  const tag=edgeTag(a),spot=edgesMod.beakSpot(a.angle,half,tag?{end:a.tagEnd,width:edgesMod.tagWidth(tag),flush:a.kind!=='caido'}:undefined);
  const c=Math.cos(a.angle),s=Math.sin(a.angle);
  const base={x:a.x+spot.ox+spot.r*c,y:a.y+spot.oy+spot.r*s};
  return {base,tip:{x:base.x+edgesMod.BEAK_REACH*c,y:base.y+edgesMod.BEAK_REACH*s},tag};
}
const countOf=(a:EdgeTarget)=>(a as {groupCount?:number}).groupCount;

test('cidade-04: every beak tip stays BEAK_GAP inside the viewport (the portrait right rim cut it by ~5 px), its base whole on the ficha',()=>{
  const half={w:38,h:18},cases:{o:Orientation;area:Rect;hero:Rect;targets:EdgeTarget[]}[]=[];
  for(const o of ['portrait','landscape'] as const){
    const s=SANDBOX[o];
    for(let v=0;v<4;v++)cases.push({o,area:s.area,hero:s.hero,targets:sandboxTargets(o,v)});
    // A ring of targets all around, one at a time (each side and corner of the rim).
    for(let i=0;i<16;i++){const a=i/16*Math.PI*2,cx=s.area.x+s.area.width/2,cy=s.area.y+s.area.height/2;
      cases.push({o,area:s.area,hero:s.hero,targets:[target(`k${i}`,i%2?'spawn':'base',cx+Math.cos(a)*3000,cy+Math.sin(a)*3000,30,i%4===0?{seconds:5,danger:true}:{})]});}
  }
  let checked=0;
  for(const c of cases){
    const v=VIEWPORT[c.o];
    for(const a of city.layoutCityEdges(c.targets,c.area,c.hero,{seen:sandboxSeen(c.o)})){
      const {base,tip}=beakOf(a,half),where=`${c.o} ${a.key} at ${Math.round(a.x)},${Math.round(a.y)}`;
      assert.ok(tip.x>=edgesMod.BEAK_GAP-.5&&tip.x<=v.width-edgesMod.BEAK_GAP+.5&&tip.y>=edgesMod.BEAK_GAP-.5&&tip.y<=v.height-edgesMod.BEAK_GAP+.5,`${where}: tip ${tip.x.toFixed(1)},${tip.y.toFixed(1)} off screen`);
      const dx=Math.abs(base.x-a.x),dy=Math.abs(base.y-a.y);
      assert.ok(near(dx,half.w,.5)&&dy<=half.h-edgesMod.BEAK_HALF+.5||near(dy,half.h,.5)&&dx<=half.w-edgesMod.BEAK_HALF+.5,`${where}: beak base ${dx.toFixed(1)},${dy.toFixed(1)} not whole on an edge`);
      assert.ok(within(r(a.x-half.w,a.y-half.h,2*half.w,2*half.h),c.area,1),`${where}: ficha leaves the useful area`);
      checked++;
    }
  }
  assert.ok(checked>40,`checked ${checked} arrows`);
});

test('cidade-04: a beak never hides under the tag (a group pointing up read as a box mid-screen); a group and the base hang their tag on the right, clear of the sticker',()=>{
  const half={w:38,h:18};
  // Straight up, with the group's distance on top: the beak moves to the free part of the top edge.
  for(const angle of [-Math.PI/2,-Math.PI/2-.15,-Math.PI/2+.15]){
    const width=edgesMod.tagWidth('56 m'),spot=edgesMod.beakSpot(angle,half,{end:'right',width,flush:true});
    const [t0]=edgesMod.tagSpan({end:'right',width,flush:true},half),bx=spot.ox+spot.r*Math.cos(angle),by=spot.oy+spot.r*Math.sin(angle);
    assert.ok(near(by,-half.h,.5),'leaves by the top edge');
    assert.ok(bx+edgesMod.BEAK_HALF<=t0+.5,`base ${bx.toFixed(1)} under the tag starting at ${t0}`);
    assert.ok(bx-edgesMod.BEAK_HALF>=-half.w-.5,'its base stays on the ficha');
  }
  // A shallow beak under the tag (the base's "4 s", up-right) leaves by the top of its side instead.
  const side=edgesMod.beakSpot(-.45,half,{end:'right',width:edgesMod.tagWidth('4 s'),flush:true});
  assert.ok(near(side.ox+side.r*Math.cos(-.45),half.w,.5),'by the right edge');
  // The sticker sits on the left of the body (hud.css: 2 px border + 4 px padding, 26 px wide, the tent's flag on its
  // top-left): the horn's seconds (one digit, doc §3 "5 s") stay right of it, a group's distance right of its middle.
  const sticker=[-half.w+6,-half.w+32];
  for(const kind of ['grupo','base'] as const)for(const x of [100,300,700])assert.equal(edgesMod.tagEndOf(kind,x,SANDBOX.landscape.area),'right',`${kind} at ${x}`);
  for(const text of ['4 s','5 s','9 s'])assert.ok(edgesMod.tagSpan({end:'right',width:edgesMod.tagWidth(text),flush:true},half)[0]>=sticker[1],`"${text}" over the tent`);
  for(const text of ['56 m','999 m'])assert.ok(edgesMod.tagSpan({end:'right',width:edgesMod.tagWidth(text),flush:true},half)[0]>=(sticker[0]+sticker[1])/2,`"${text}" over the sticker`);
  assert.equal(edgesMod.tagEndOf('caido',150,SANDBOX.landscape.area),'left','a caído keeps its wide tag growing away from the near edge');
  // In the sandbox's 8 scenes, no group or base beak sits under its tag.
  for(const o of ['portrait','landscape'] as const)for(let v=0;v<4;v++){
    const s=SANDBOX[o];
    for(const a of city.layoutCityEdges(sandboxTargets(o,v),s.area,s.hero,{seen:sandboxSeen(o)})){
      if(a.kind!=='grupo'&&a.kind!=='base')continue;
      const {base,tag}=beakOf(a,half);if(!tag)continue;
      const [t0,t1]=edgesMod.tagSpan({end:a.tagEnd,width:edgesMod.tagWidth(tag),flush:true},half);
      const onTop=near(base.y-a.y,-half.h,.5);
      assert.ok(!onTop||base.x-a.x+edgesMod.BEAK_HALF<=t0+.5||base.x-a.x-edgesMod.BEAK_HALF>=t1-.5,`${o} vista ${v} ${a.key}: beak under its tag`);
    }
  }
});

test('cidade-04: the base after the horn is never dropped, in every view; in landscape every target keeps an arrow, the base on its own side of the hero',()=>{
  for(const o of ['portrait','landscape'] as const)for(let v=0;v<4;v++){
    const s=SANDBOX[o],targets=sandboxTargets(o,v),where=`${o} vista ${v}`;
    const arrows=city.layoutCityEdges(targets,s.area,s.hero,{seen:sandboxSeen(o)});
    assert.ok(arrows.some(a=>a.key==='base'),`${where}: the base lost its arrow (${arrows.map(a=>a.key)})`);
    assert.ok(arrows.some(a=>a.key==='p3'),`${where}: the caído lost its arrow`);
    if(o==='landscape'&&(v===0||v===2)){
      assert.deepEqual(arrows.map(a=>a.key).sort(),['base','boca:L','grupo:4,10','p3'],`${where}: all four`);
      const base=arrows.find(a=>a.key==='base')!,hx=s.hero.x+s.hero.width/2,t=targets.find(x=>x.key==='base')!;
      assert.equal(Math.sign(base.x-hx),Math.sign(t.screen.x-hx),`${where}: the base arrow sits across the hero from its target`);
    }
    for(const a of arrows)for(const b of arrows)if(a!==b)assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=36,`${where}: ${a.key} on ${b.key}`);
  }
  assert.equal(city.cityMustPoint(target('b','base',0,0,1,{seconds:3,danger:true})),true);
  assert.equal(city.cityMustPoint(target('b','base',0,0,1)),false,'a plain base (intermission, before the horn) may give way');
  assert.ok(city.cityPlaceRank(target('b','base',0,0,1,{seconds:3}))<city.cityPlaceRank(target('boca:L','spawn',0,0,1)),'the horn base is placed before the mouths');
  assert.equal(city.cityPlaceRank(target('b','base',0,0,1)),city.cityEdgeRank(target('b','base',0,0,1)),'otherwise the doc order');
});

test('cidade-04: groups fold with their counts summed; one past GROUP_RANGE (the sandbox 12 at 85 u) gets no arrow, so the 7 stays 7',()=>{
  // The sandbox scene × K (the 1.7× map): the 12 at 85 × K u, the 7 at 56 × K u.
  const hero={x:82*K,y:125*K},rnd=lcg(7),blob=(p:string,cx:number,cy:number,n:number)=>Array.from({length:n},(_,i)=>({id:`${p}${i}`,x:cx*K+(rnd()*2-1)*2,y:cy*K+(rnd()*2-1)*2}));
  const enemies=[...blob('n',84,40,12),...blob('o',40,88,7)],map={size:169*K,plaza:{x:84*K,y:84*K,radius:12*K},mouths:[],start:{x:84*K,y:84*K}};
  const {targets}=city.cityEdgeTargets({hero,selfId:'p1',players:[],enemies,map,phase:'wave',locate:p=>({x:(p.x-hero.x)*60,y:(p.y-hero.y)*60}),isOnScreen:()=>false});
  assert.deepEqual(targets.filter(t=>t.kind==='grupo').map(countOf),[7],'only the 7 within GROUP_RANGE');
  // Two groups that cannot both fit on a short rim fold into one arrow, the critters summed (never "+1").
  const folded=city.layoutCityEdges([target('grupo:a','grupo',900,-20,20,{label:'6',groupCount:6} as Partial<EdgeTarget>),target('grupo:b','grupo',900,140,25,{label:'9',groupCount:9} as Partial<EdgeTarget>)],r(0,0,300,110));
  const g=folded.filter(a=>a.kind==='grupo');
  assert.equal(g.length,1,'one arrow for both');
  assert.equal(countOf(g[0]),15,'no critter lost');assert.equal(g[0].key,'grupo:a','placed as the nearest');
  for(const a of g){assert.equal(a.count,1,'never "+1"');assert.equal(a.label,String(countOf(a)));}
});

/**
 * The rules of a style sheet (no nesting but @media, whose rules count as if they applied) that match an element, by a
 * small selector matcher: compound selectors of a tag, classes, `[attr]` and `:not(…)` of those, joined by `>` or ` `;
 * a pseudo-class other than :not and a pseudo-element never match the stand-in.
 */
function matchingRules(css:string,chain:readonly {tag:string;classes:readonly string[]}[]){
  const rules:{selector:string;body:string}[]=[];
  const flat=css.replace(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g,'$1');
  for(const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g))rules.push({selector:m[1].trim(),body:m[2]});
  const simple=(sel:string,el:{tag:string;classes:readonly string[]}):boolean=>{
    let rest=sel;
    for(const not of [...sel.matchAll(/:not\(([^()]*)\)/g)]){if(simple(not[1],el))return false;rest=rest.replace(not[0],'');}
    if(/\[[^\]]*\]|:/.test(rest))return false;// attributes, other pseudo-classes and pseudo-elements: not the stand-in
    const tag=rest.match(/^[a-z][a-z0-9-]*/)?.[0];
    if(tag&&tag!==el.tag)return false;
    return [...rest.matchAll(/\.([\w-]+)/g)].every(c=>el.classes.includes(c[1]));
  };
  // chain[0] is the element, then its ancestors up to <html>.
  const complex=(sel:string)=>{
    const parts=sel.replace(/\s*>\s*/g,' > ').trim().split(/\s+/);
    if(!simple(parts.at(-1)!,chain[0]))return false;
    let i=0;
    for(let k=parts.length-2;k>=0;k--){
      if(parts[k]==='>'){k--;i++;if(i>=chain.length||!simple(parts[k],chain[i]))return false;continue;}
      do i++;while(i<chain.length&&!simple(parts[k],chain[i]));
      if(i>=chain.length)return false;
    }
    return true;
  };
  return rules.filter(r=>r.selector.split(',').some(s=>complex(s.trim())));
}
/** The last value a list of rules gives a property (source order), or undefined. */
const declOf=(rules:readonly {body:string}[],prop:string)=>rules.map(r=>r.body.split(';').map(d=>d.split(':')).find(([k])=>k.trim()===prop)?.slice(1).join(':').trim()).filter(Boolean).at(-1);

test('cidade-04: the HUD sandbox shows its 56 px hero stand-in (the body>:not(…) rule hid it), so overlaps with the hero can be judged',{skip:noCss},async()=>{
  // The style sheet the sandbox injects when it runs (city mode), caught as it is appended; the run stops there.
  const STOP=Symbol('stop'),g=globalThis as Record<string,unknown>,saved={location:g.location,document:g.document};
  let css='';
  g.location={search:'?mapa=cidade'};
  g.document={createElement:(tag:string)=>({tagName:tag,textContent:''}),head:{append:(el:{textContent:string})=>{css=el.textContent;throw STOP;}}};
  try{await import('../../src/client/sandboxes/sandbox-hud.ts');}catch(e){if(e!==STOP)throw e;}
  finally{g.location=saved.location;g.document=saved.document;}
  assert.ok(css.length>0,'the sandbox injects its style sheet');
  const body={tag:'body',classes:['hs-cidade']},html={tag:'html',classes:[]};
  const hero=matchingRules(css,[{tag:'div',classes:['hs-hero']},body,html]);
  assert.equal(declOf(hero,'display'),undefined,`nothing hides the stand-in: ${hero.map(r=>r.selector).join(' | ')}`);
  assert.equal(declOf(hero,'width'),'56px');assert.equal(declOf(hero,'height'),'56px','56 px, one city cell (D-030)');
  // The matcher is not blind: any other child of the body the sandbox does not list is hidden by that rule.
  assert.match(declOf(matchingRules(css,[{tag:'div',classes:['stray']},body,html]),'display')??'',/^none/);
});
