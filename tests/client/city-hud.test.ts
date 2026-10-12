/**
 * Cidade Nevada HUD (card NEW-20261012-ORQ-cidade-ux-01): minimap, big minimap, edge arrows and the lobby map selector.
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
import type {Rect,ScreenZones,AuditBox,EdgeTarget,EdgeArrow} from '../../src/client/hud/city/deps.ts';
import type {CityLayout,CityLayoutInput,EnemyPoint,EnemyGroup,MapId,SelectorState,SelectorEvent,CityView,CityMark} from '../../src/client/hud/city/index.ts';

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
  portrait:{gear:r(324,18,48,48),status:[r(14,12,44,44),r(166,8,142,46),r(8,72,292,26)],team:r(8,120,54,380),
    joystick:r(24,708,112,112),skill:r(284,738,82,82),emote:r(301,666,48,48),skill125:r(252,706,114,114),emote125:r(285,634,48,48),
    chip:r(284-THUMB_GAP-52,753,52,52)},
  landscape:{gear:r(782,12,48,48),status:[r(14,12,44,44),r(330,8,180,40),r(212,52,420,20)],team:r(258,318,328,64),
    joystick:r(18,278,96,96),skill:r(746,292,82,82),emote:undefined as Rect|undefined,skill125:r(714,260,114,114),emote125:undefined as Rect|undefined,
    chip:r(746-THUMB_GAP-52,307,52,52)},
};
/** Useful area per case (§0; the 125% + notch ones follow from the same formula). */
const USEFUL={
  portrait:{n100:r(70,240,320,402),n125:r(70,240,320,370),notch100:r(70,279,320,363),notch125:r(70,279,320,331)},
  landscape:{n100:r(138,148,584,162),n125:r(138,148,552,162),notch100:r(167,148,555,162),notch125:r(167,148,523,162)},
};
/** Owner's lobby window in landscape ({150,…,544,…}): only its x span matters, so it takes the full height. */
const OWNER_WINDOW=r(150,0,544,390);
/** Arrow ficha half size at a text scale (76×36, 84×36 at 125%) and the room layoutEdges keeps on the rim. */
const halfW=(scale:number)=>(44+32*scale)/2,HALF_H=18,RIM_PAD=8,TAG_ROOM=16,NAME_ROOM=16;
/** Rail of arrow centres with tag and name (§5) for a useful area. */
const railOf=(u:Rect,scale:number)=>{const hw=halfW(scale)+RIM_PAD,hh=HALF_H+RIM_PAD;return r(u.x+hw,u.y+hh+TAG_ROOM,u.width-2*hw,u.height-2*hh-TAG_ROOM-NAME_ROOM);};
const within=(a:Rect,box:Rect,eps=.5)=>a.x>=box.x-eps&&a.y>=box.y-eps&&right(a)<=right(box)+eps&&bottom(a)<=bottom(box)+eps;
const near=(a:number,b:number,eps=1e-6)=>Math.abs(a-b)<=eps;
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
/** A status row of the doc (0 camera, 1 round chip, 2 XP) as it sits in a case (portrait notch: 39 px lower). */
const statusOf=(c:Case,i:0|1|2)=>{const s=DOC[c.o].status[i];return c.o==='portrait'&&c.notch?{...s,y:s.y+DROP}:c.o==='landscape'&&c.notch&&s.x<100?{...s,x:s.x+33}:s;};
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
const expectedMinimap=(c:Case)=>c.o==='portrait'?r(306,c.notch?111:72,76,76):c.windowOpen?r(c.notch?47:14,84,76,76):r(754,60,76,76);
/**
 * Doc §5 big minimap. Landscape with a window open: the doc's {14,84,164,164} would cross the announcement slot (x 158), so
 * the side shrinks to keep ANNOUNCE_GAP (4 px) from it, as the coordinator's review asked: 140 (notch 146). Reported.
 */
const expectedBig=(c:Case):Rect|undefined=>{
  if(c.o==='portrait')return c.windowOpen?undefined:r(150,c.notch?111:72,232,232);
  if(!c.windowOpen)return r(654,60,176,176);
  const x=c.notch?47:14,side=Math.min(164,Math.max(8,insetsOf(c).left)+150-4-x);return r(x,84,side,side);
};
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
 * from left + max(70, team column + 16) to right + 8; landscape at top + 82, from left + 150 to right + 290.
 */
const announceOf=(c:Case,z:ScreenZones)=>{
  const s=insetsOf(c),f=(v:number)=>Math.max(8,v),k=controlsFor(c) as any,v=VIEWPORT[c.o];
  if(c.o==='portrait'){const x=f(s.left)+Math.max(70,(k.team&&k.team.height>k.team.width?k.team.width:54)+16);return r(x,z.announce.y,v.width-f(s.right)-8-x,z.announce.height);}
  const x=f(s.left)+150;return r(x,f(s.top)+82,v.width-f(s.right)-290-x,z.announce.height);
};
/** The new rects of a layout, named. */
const newRects=(l:CityLayout)=>{
  const list:{name:string;rect:Rect}[]=[{name:'minimapa',rect:l.minimap},{name:'seletor',rect:l.selector},{name:'segmento-cidade',rect:l.segments[0]},{name:'segmento-infinito',rect:l.segments[1]}];
  if(l.minimapBig)list.push({name:'minimapa-grande',rect:l.minimapBig});
  return list;
};
/** Thumb controls of a case (joystick, skill, emote, chip), as the zones contract names them. */
const thumbControls=(c:Case)=>{const k=controlsFor(c) as any;return ([['joystick',k.joystick],['habilidade',k.skill],['emote',k.emote],['chip',k.chip]] as [string,Rect|undefined][]).filter((e):e is [string,Rect]=>!!e[1]);};

// ---------- Edge-arrow fixtures (§3, assertion 7) ----------
const target=(key:string,kind:EdgeTarget['kind'],x:number,y:number,distance:number,extra:Partial<EdgeTarget>={}):EdgeTarget=>({key,kind,screen:{x,y},distance,...extra});
/** Eleven targets around the hero: a named caído hidden behind the big minimap, the boss, 4 groups, 4 active mouths, the base. */
function cityTargets(hero:Rect,behind:Rect):EdgeTarget[]{
  const hx=hero.x+hero.width/2,hy=hero.y+hero.height/2,at=(deg:number,dist:number)=>({x:hx+Math.cos(deg*Math.PI/180)*dist,y:hy+Math.sin(deg*Math.PI/180)*dist});
  const list=[target('b','caido',behind.x+behind.width/2,behind.y+behind.height/2,18,{seconds:12,label:'Zé',name:'Zé'}),target('boss','chefe',hx-900,hy,40)];
  [[30,20,'12'],[100,25,'6'],[200,30,'7'],[300,35,'9']].forEach(([deg,d,n],i)=>{const p=at(deg as number,800);list.push(target(`grupo:g${i}`,'spawn',p.x,p.y,d as number,{label:n as string}));});
  (['N','S','L','O'] as const).forEach((id,i)=>{const p=at(60+90*i,900);list.push(target(`boca:${id}`,'spawn',p.x,p.y,40+5*i));});
  const up=at(270,900);list.push(target('base','base',up.x,up.y,60));
  return list;
}
/** The boxes an arrow takes: the ficha, and for a caído its tag row above and its name row below (subsets of what layoutEdges reserves). */
function arrowBoxes(a:EdgeArrow,scale=1):{name:string;rect:Rect}[]{
  const hw=halfW(scale),out=[{name:`seta-${a.key}`,rect:r(a.x-hw,a.y-HALF_H,2*hw,2*HALF_H)}];
  if(a.kind==='caido'){out.push({name:`seta-${a.key}-etiqueta`,rect:r(a.x-hw+4,a.y-HALF_H-TAG_ROOM,2*hw-8,TAG_ROOM)});
    if(a.label)out.push({name:`seta-${a.key}-nome`,rect:r(a.x-hw+4,a.y+HALF_H,2*hw-8,NAME_ROOM)});}
  return out;
}
const MUST_POINT=['caido','chefe'] as const;

// =====================================================================================================================
// Contract surface
// =====================================================================================================================
test('contract: constants and reference controls match the doc (§0, §1, §2, §3, §4)',()=>{
  assert.equal(THUMB_GAP,24);assert.equal(HERO_MARGIN,40);assert.equal(EDGE_COLUMN,120);assert.equal(MAX_ARROWS,6);
  assert.equal(city.MINIMAP_SIDE,76);assert.equal(city.BIG_MIN_SIDE,120);assert.equal(typeof city.bigMinimapSide,'function');
  assert.equal(city.GROUP_CELL,8);assert.equal(city.GROUP_MIN,5);assert.equal(city.GROUP_RANGE,60);assert.equal(city.GROUP_ARROWS,2);
  assert.equal(city.CITY_SIZE,169);assert.equal(city.DEFAULT_MAP,'cidade');assert.equal(city.PENDING_MS,3000);
  for(const o of ['portrait','landscape'] as const){
    const k=city.REFERENCE_CONTROLS[o] as any,d=DOC[o];
    assert.deepEqual(k.joystick,d.joystick,`${o} joystick`);assert.deepEqual(k.skill,d.skill,`${o} skill`);assert.deepEqual(k.team,d.team,`${o} team`);
    if(d.emote)assert.deepEqual(k.emote,d.emote,`${o} emote`);
    for(const s of d.status)assert.ok(k.status.some((x:Rect|undefined)=>x&&x.x===s.x&&x.y===s.y&&x.width===s.width&&x.height===s.height),`${o} status has ${fmt(s)}`);
    assert.equal(k.minimap,undefined,'the layout places the minimap itself');
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
test('§5 table: collapsed minimap, big minimap, selector and segments are the exact rects of the doc',()=>{
  for(const c of CASES){
    const l=layoutOf(c);
    assert.equal(l.orientation,c.o,c.name);
    assert.deepEqual(l.minimap,expectedMinimap(c),`${c.name}: minimapa recolhido`);
    const big=expectedBig(c);
    if(big)assert.deepEqual(l.minimapBig,big,`${c.name}: minimapa grande`);
    else assert.deepEqual(l.minimapBig,layoutOf({...c,windowOpen:false}).minimapBig,`${c.name}: portrait big minimap "pela fórmula" does not move with the window`);
    assert.deepEqual(l.selector,expectedSelector(c),`${c.name}: seletor`);
    assert.deepEqual(l.segments,expectedSegments(c),`${c.name}: segmentos`);
  }
});

test('§5 table: arrow rail of centres (with tag and name) and the useful area per case',()=>{
  // The literal values of the table.
  const lit:[Partial<Case>,Rect][]=[[{o:'portrait',scale:1,notch:false},r(116,282,228,318)],[{o:'portrait',scale:1.25,notch:false},r(120,282,220,286)],
    [{o:'portrait',scale:1,notch:true},r(116,321,228,279)],[{o:'landscape',scale:1,notch:false},r(184,190,492,78)],
    [{o:'landscape',scale:1.25,notch:false},r(188,190,452,78)],[{o:'landscape',scale:1,notch:true},r(213,190,463,78)]];
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
test('2. collapsed and big minimap never cross leftThumb/rightThumb and keep ≥ 24 px from joystick, skill, emote and chip',()=>{
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c);
    for(const zones of [z,l.zones])for(const [name,rect] of [['minimapa',l.minimap],['minimapa-grande',l.minimapBig]] as [string,Rect|undefined][]){
      if(!rect)continue;
      if(zones.leftThumb)assert.equal(crosses(rect,zones.leftThumb),false,`${c.name}: ${name} ${fmt(rect)} × leftThumb ${fmt(zones.leftThumb)}`);
      if(zones.rightThumb)assert.equal(crosses(rect,zones.rightThumb),false,`${c.name}: ${name} ${fmt(rect)} × rightThumb ${fmt(zones.rightThumb)}`);
    }
    for(const [control,rect] of thumbControls(c))for(const [name,box] of [['minimapa',l.minimap],['minimapa-grande',l.minimapBig]] as [string,Rect|undefined][])
      if(box)assert.ok(gap(box,rect)>=THUMB_GAP,`${c.name}: ${name} is ${gap(box,rect)} px from ${control}`);
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

test('thumb zones: the documented clearances hold (landscape 125% big touches the skill zone at 24 px, window-open big ≥ 30 px above the joystick)',()=>{
  const l125=layoutOf({o:'landscape',scale:1.25,notch:false,windowOpen:false,name:''});
  assert.equal(gap(l125.minimapBig!,DOC.landscape.skill125),24);assert.equal(crosses(l125.minimapBig!,l125.zones.rightThumb!),false);
  assert.equal(gap(layoutOf({o:'landscape',scale:1,notch:false,windowOpen:false,name:''}).minimapBig!,DOC.landscape.skill),56);
  for(const notch of [false,true]){
    const l=layoutOf({o:'landscape',scale:1,notch,windowOpen:true,name:''}),stick=notch?r(47,278,96,96):DOC.landscape.joystick;
    assert.ok(gap(l.minimapBig!,stick)>=30,`notch=${notch}: ${gap(l.minimapBig!,stick)} px above the joystick`);assert.equal(gap(l.minimap,stick),118,`notch=${notch}`);
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
        {name:'minimapa',rect:l.minimap,target:true,topReadout:true,edgeColumn:true},{name:'seletor',rect:l.selector,target:true},
        {name:'segmento-cidade',rect:l.segments[0],target:true},{name:'segmento-infinito',rect:l.segments[1],target:true}];
      if(l.minimapBig)boxes.push({name:'minimapa-grande',rect:l.minimapBig,target:true,allowedInPlay:true,overHeroFails:true});
      if(k.emote)boxes.push({name:'emote',rect:k.emote,target:true});
      if(k.chip)boxes.push({name:'chip',rect:k.chip,target:true});
      const audit=auditBoxes(boxes,z,hero);
      assert.deepEqual(audit.heroCrossed,[],where);assert.deepEqual(audit.thumbGaps,[],where);
      assert.ok(audit.minThumbGap>=THUMB_GAP,`${where}: minThumbGap ${audit.minThumbGap}`);
      assert.ok(!audit.inPlay.includes('minimapa'),`${where}: the collapsed minimap is over the field`);
    }
  }
});

test('3. the big minimap keeps its documented distance to the hero zone (portrait 69 px, 45 px with the 24 px lag)',()=>{
  const l=layoutOf({o:'portrait',scale:1,notch:false,windowOpen:false,name:''}),hero=heroAt(l.zones.useful,0,0);
  assert.deepEqual(hero,r(202,413,56,56));
  assert.equal(hero.y-HERO_MARGIN-bottom(l.minimapBig!),69);assert.equal(hero.y-24-HERO_MARGIN-bottom(l.minimapBig!),45);
  const ls=layoutOf({o:'landscape',scale:1,notch:false,windowOpen:false,name:''});assert.deepEqual(heroAt(ls.zones.useful,0,0),r(402,201,56,56));
});

// =====================================================================================================================
// Assertion 4: landscape edge column (offColumn) and out of the field; portrait useful.y 240 / 279
// =====================================================================================================================
test('4. landscape: minimap ends ≤ 120 px from the safe edge (offColumn empty) and stays off the useful area; portrait: useful.y 240 (279 notch)',()=>{
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c),s=insetsOf(c),v=VIEWPORT[c.o];
    if(c.o==='landscape'){
      const m=l.minimap,fromRight=v.width-s.right-m.x,fromLeft=right(m)-s.left;
      assert.ok(Math.min(fromRight,fromLeft)<=EDGE_COLUMN,`${c.name}: minimap ${fmt(m)} is ${Math.min(fromRight,fromLeft)} px from the safe edge`);
      assert.deepEqual(auditBoxes([{name:'minimapa',rect:m,target:true,topReadout:true,edgeColumn:true}],z).offColumn,[],c.name);
      assert.equal(crosses(m,z.useful),false,`${c.name}: minimap over the useful area`);assert.equal(crosses(m,l.zones.useful),false,c.name);
      assert.equal(l.zones.useful.y,148,c.name);
    }else{
      const expected=c.notch?279:240;
      assert.equal(l.zones.useful.y,expected,c.name);
      assert.equal(computeZones({viewport:{...v},safe:safeOf(c),...controlsFor(c),minimap:l.minimap}).useful.y,expected,`${c.name}: computeZones with the minimap`);
      assert.equal(crosses(l.minimap,l.zones.useful),false,c.name);
    }
  }
});

// =====================================================================================================================
// Assertion 5: status, gear, team, announcement slot; big: round chip, gear, team; outside topReadout
// =====================================================================================================================
test('5. collapsed minimap: off the status rows and the gear (≥ 6 px), the team and the announcement slot',()=>{
  for(const c of ALL){
    const l=layoutOf(c),k=controlsFor(c) as any,m=l.minimap,g=gearOf(c);
    const status=(k.status as (Rect|undefined)[]).filter((s):s is Rect=>!!s&&!(s.x===g.x&&s.width===g.width&&s.height===g.height));
    for(const s of status)assert.ok(gap(m,s)>=6,`${c.name}: minimap ${fmt(m)} is ${gap(m,s)} px from status ${fmt(s)}`);
    // Landscape {754,60} sits right under the gear {782,12,48,48} (gap 0): the city keeps the island's .rh-minimap slot
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

test('5. big minimap: never over the round chip, the gear or the team; it is not a top readout (may cover the XP for 4 s)',()=>{
  for(const c of ALL){
    const l=layoutOf(c),k=controlsFor(c) as any,big=l.minimapBig;
    if(!big)continue;
    const round=statusOf(c,1),xp=statusOf(c,2);
    assert.equal(crosses(big,round),false,`${c.name}: big ${fmt(big)} over the round chip ${fmt(round)}`);
    assert.equal(crosses(big,gearOf(c)),false,`${c.name}: big over the gear`);
    if(k.team)assert.equal(crosses(big,k.team),false,`${c.name}: big over the team`);
    const audit=auditBoxes([{name:'round',rect:round,topReadout:true},{name:'xp',rect:xp,topReadout:true},{name:'minimapa',rect:l.minimap,target:true,topReadout:true,edgeColumn:true},
      {name:'minimapa-grande',rect:big,target:true,allowedInPlay:true,overHeroFails:true}],refZones(c));
    assert.deepEqual(audit.topCrossed,[],c.name);
  }
  // Portrait: it covers the XP bar on purpose (and still not the round chip).
  const p=layoutOf({o:'portrait',scale:1,notch:false,windowOpen:false,name:''});
  assert.equal(crosses(p.minimapBig!,DOC.portrait.status[2]),true);
});

const DANGER=['caido','chefe','corneta'] as const;
test('5. big minimap vs the announcement slot: clear of it (≥ 4 px) wherever a 120 px square fits; else it covers it and any notice blocks the tap and closes it',()=>{
  assert.equal(city.ANNOUNCE_GAP,4);assert.deepEqual([...city.DANGER_NOTICES].sort(),[...DANGER].sort());
  for(const c of ALL){
    const l=layoutOf(c),big=l.minimapBig!,slot=announceOf(c,l.zones),covers=l.bigCoversAnnounce;
    assert.deepEqual(l.announce,slot,`${c.name}: announcement slot ${fmt(l.announce)}`);
    if(crosses(big,slot)){
      // Only the doc's portrait square (§2: no 120 px square fits between the collapsed minimap and the slot) may cover it.
      assert.equal(c.o,'portrait',`${c.name}: big ${fmt(big)} over the announcement slot ${fmt(slot)}`);
      assert.equal(covers,true,`${c.name}: covers the slot without bigCoversAnnounce`);
    }else{
      assert.equal(covers,false,c.name);assert.ok(gap(big,slot)>=city.ANNOUNCE_GAP,`${c.name}: big is ${gap(big,slot)} px from the slot`);
    }
    // Danger notices up: never opens, and an open one closes. Other notices only when it covers the slot.
    for(const n of DANGER){
      assert.equal(city.tapBlocked(undefined,n,covers),true,`${c.name}: tap with a "${n}" notice`);
      assert.equal(city.blockReason(undefined,n,covers),'aviso');
      assert.equal(city.bigShouldClose({openedAtMs:0,nowMs:100,phase:'wave',notice:n,coversAnnounce:covers}),true,`${c.name}: open with a "${n}" notice`);
    }
    assert.equal(city.tapBlocked(undefined,'outro',covers),covers,`${c.name}: other notice`);
    assert.equal(city.bigShouldClose({openedAtMs:0,nowMs:100,phase:'prepare',notice:'outro',coversAnnounce:covers}),covers,c.name);
    assert.equal(city.tapBlocked(undefined,undefined,covers),false,`${c.name}: no notice, no critter`);
    assert.equal(city.blockReason(1,'caido',covers),'bicho','a critter at hand wins');
  }
  assert.equal(city.NOTICE_BLOCKED_LABEL,'Aviso na tela. O mapa grande abre quando sair.');
});

// =====================================================================================================================
// Assertion 6: touch sizes; S < 120 does not open
// =====================================================================================================================
test('6. touch targets: collapsed 76, big ≥ 120 and square, segments ≥ 48 on both sides',()=>{
  for(const c of ALL){
    const l=layoutOf(c);
    assert.equal(l.minimap.width,city.MINIMAP_SIDE,c.name);assert.equal(l.minimap.height,city.MINIMAP_SIDE,c.name);
    assert.ok(l.minimapBig,`${c.name}: big minimap opens`);
    assert.equal(l.minimapBig!.width,l.minimapBig!.height,c.name);assert.ok(l.minimapBig!.width>=city.BIG_MIN_SIDE,c.name);
    for(const s of l.segments)assert.ok(s.width>=48&&s.height>=48,`${c.name}: segment ${fmt(s)}`);
    assert.equal(crosses(l.segments[0],l.segments[1]),false,`${c.name}: segments overlap`);
    for(const s of l.segments)assert.ok(within(s,l.selector,0),`${c.name}: segment ${fmt(s)} outside the selector`);
  }
});

test('6. S < 120: the big minimap does not open (skill too close under it, or the team column too wide)',()=>{
  const land:Case={o:'landscape',scale:1,notch:false,windowOpen:false,name:''};
  const lowSkill=city.cityHudLayout({...inputOf(land),controls:{...controlsFor(land),skill:r(746,150,82,82)}});
  assert.equal(lowSkill.minimapBig,undefined,`landscape, skill at y 150: big ${fmt(lowSkill.minimapBig)}`);
  const port:Case={o:'portrait',scale:1,notch:false,windowOpen:false,name:''};
  const wideTeam=city.cityHudLayout({...inputOf(port),controls:{...controlsFor(port),team:r(8,120,262,380)}});
  assert.equal(wideTeam.minimapBig,undefined,`portrait, team column to x 270: big ${fmt(wideTeam.minimapBig)}`);
  // The collapsed one never depends on it.
  assert.deepEqual(lowSkill.minimap,r(754,60,76,76));assert.deepEqual(wideTeam.minimap,r(306,72,76,76));
});

// =====================================================================================================================
// Assertion 7: arrows with the big minimap open as a window
// =====================================================================================================================
/** Overlap of two rects, or undefined. */
const overlap=(a:Rect,b:Rect):Rect|undefined=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),w=Math.min(right(a),right(b))-x,h=Math.min(bottom(a),bottom(b))-y;return w>0&&h>0?r(x,y,w,h):undefined;};
/** What hides the map on screen (edges.ts COVERING): the HUD of a case, plus the open big minimap. */
const coveringOf=(c:Case,l:CityLayout)=>{const k=controlsFor(c) as any;return [...(k.status as (Rect|undefined)[]),gearOf(c),k.team,k.joystick,k.skill,k.emote,k.chip,l.minimap,l.minimapBig].filter((x):x is Rect=>!!x);};
test('7. arrows with the big minimap open (a window over the field): none on it, a caído hidden under it keeps an arrow beside it, escaped/unpointed empty, ≤ 6, ≤ 2 grupo, ≤ 2 boca',()=>{
  let hiddenInField=0;
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c),v=VIEWPORT[c.o];
    assert.ok(l.minimapBig,`${c.name}: no big minimap`);const big=l.minimapBig;
    // Laid out in the in-play useful area, with the big minimap passed as an open window and as covering (§2: it enters
    // WINDOWS/COVERING): the layout itself must keep the arrows off it.
    const options={windows:[big],seen:{viewport:r(0,0,v.width,v.height),covered:coveringOf(c,l)},textScale:c.scale};
    // The caído stands under the part of the big minimap that covers the field (portrait: its bottom 64 px; landscape: its
    // left strip), i.e. inside the useful area, where only the big minimap hides it. Without such a part, under its centre.
    const under=overlap(big,z.useful);if(under)hiddenInField++;
    for(const [dx,dy] of SHIFTS){
      const hero=heroAt(z.useful,dx,dy),where=`${c.name}, herói ${dx},${dy}`;
      const targets=cityTargets(hero,under??big),arrows=city.layoutCityEdges(targets,l.zones.useful,hero,options);
      assert.ok(arrows.length<=MAX_ARROWS,`${where}: ${arrows.length} arrows`);
      assert.ok(arrows.filter(a=>a.key.startsWith('grupo:')).length<=2,`${where}: grupo arrows ${arrows.map(a=>a.key)}`);
      assert.ok(arrows.filter(a=>a.key.startsWith('boca:')).length<=2,`${where}: boca arrows ${arrows.map(a=>a.key)}`);
      const boxes:AuditBox[]=arrows.flatMap(a=>arrowBoxes(a,c.scale).map(b=>({...b,allowedInPlay:true,overHeroFails:true,withinUseful:true})));
      for(const kind of MUST_POINT)if(!arrows.some(a=>a.kind===kind))boxes.push({name:`sem-seta-${kind}`,rect:r(0,0,0,0),unpointed:true});
      const audit=auditBoxes(boxes,z,hero);
      assert.deepEqual(audit.escaped,[],where);assert.deepEqual(audit.unpointed,[],where);assert.deepEqual(audit.heroCrossed,[],where);
      for(const b of boxes)if(!b.unpointed)assert.equal(crosses(b.rect,big),false,`${where}: ${b.name} ${fmt(b.rect)} on the big minimap ${fmt(big)}`);
      // The hidden caído: an arrow of its own, glued to the big minimap's edge (≤ 40 px), beak towards it.
      const caido=arrows.find(a=>a.kind==='caido');
      assert.ok(caido,`${where}: the caído under the big minimap has no arrow`);
      const t=targets.find(x=>x.kind==='caido')!,ficha=arrowBoxes(caido!,c.scale)[0].rect;
      assert.ok(gap(ficha,big)<=40,`${where}: caído arrow ${fmt(ficha)} is ${gap(ficha,big)} px from the big minimap`);
      assert.ok(Math.abs(Math.atan2(t.screen.y-caido!.y,t.screen.x-caido!.x)-caido!.angle)<1e-9,`${where}: beak points at the caído`);
    }
  }
  assert.ok(hiddenInField>=CASES.length,`only ${hiddenInField} cases put the caído inside the useful area under the big minimap`);
});

test('7. arrows in play (big closed), 100% and 125%: inside the useful area and the rail, off the hero ± 40, ≥ 24 px from every thumb control',()=>{
  for(const c of ALL){
    const l=layoutOf(c),z=refZones(c),s=insetsOf(c),v=VIEWPORT[c.o];
    const safe=r(s.left,s.top,v.width-s.left-s.right,v.height-s.top-s.bottom);
    for(const [dx,dy] of SHIFTS){
      const hero=heroAt(z.useful,dx,dy),where=`${c.name}, herói ${dx},${dy}`;
      const arrows=city.layoutCityEdges(cityTargets(hero,l.minimapBig??l.minimap),l.zones.useful,hero,{textScale:c.scale});
      assert.ok(arrows.some(a=>a.kind==='caido')&&arrows.some(a=>a.kind==='chefe'),`${where}: caído and chefe keep their arrows`);
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
  for(let i=0;i<6;i++){const a=i/6*Math.PI*2;out.push(target(`grupo:k${i}`,'spawn',1000+Math.cos(a)*3000,1000+Math.sin(a)*3000,10+i*5,{label:String(5+i)}));}
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
    const targets=[target('grupo:a','spawn',900,450,20,{groupCount:7,label:'7'} as any),target('grupo:b','spawn',905,470,25,{groupCount:6,label:'6',danger:true} as any),
      target('boca:N','spawn',910,460,30)];
    for(const order of [targets,[...targets].reverse()]){
      const arrows=city.layoutCityEdges(order,area,hero,{textScale:scale}) as (EdgeArrow&{groupCount?:number})[];
      const groups=arrows.filter(a=>a.key.startsWith('grupo:')),mouths=arrows.filter(a=>a.key.startsWith('boca:'));
      assert.equal(groups.length,1,`groups: ${arrows.map(a=>a.key)}`);
      assert.equal(groups[0].groupCount,13,'critters summed');assert.equal(groups[0].count,1,'a group arrow never shows "+N"');
      assert.equal(groups[0].key,'grupo:a','keyed as the nearest group');assert.equal(groups[0].danger,true,'danger survives the merge');
      assert.equal(city.groupCountText(groups[0].groupCount!),'13');
      assert.equal(mouths.length,1,'the mouth keeps its arrow');assert.equal(mouths[0].count,1,'nothing folded into the mouth');
      assert.ok(arrows.every(a=>a.kind==='spawn'),'both ride the spawn kind for the DOM');
    }
  }
  // Counts past 99 read "99+".
  const big=city.layoutCityEdges([target('grupo:x','spawn',900,450,20,{groupCount:80} as any),target('grupo:y','spawn',902,452,21,{groupCount:40} as any)],area,hero) as (EdgeArrow&{groupCount?:number})[];
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
test('9. pickGroupArrows: off-screen, ≥ 5, within 60 u, nearest first, at most 2, ties by count then key, hysteresis',()=>{
  const groups=[G('far',HERO.x+70,HERO.y,8),G('small',HERO.x,HERO.y+15,4),G('a',HERO.x+20,HERO.y,6),G('b',HERO.x-30,HERO.y,12),G('c',HERO.x,HERO.y-40,9),G('seen',HERO.x+5,HERO.y,20)];
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

/** projection.ts convention (rotateVector): the minimap uses the same one. */
const rot=(p:{x:number;y:number},view:number)=>{switch(((view%4)+4)%4){case 1:return {x:-p.y,y:p.x};case 2:return {x:-p.x,y:-p.y};case 3:return {x:p.y,y:-p.x};default:return {...p};}};
const VIEWS:CityView[]=[0,1,2,3];
test('9. cityMinimapPoint: city corners on the diamond vertices at ±34 px; mouths at mid-sides turning 90° per view',()=>{
  const map=city.DEFAULT_CITY,c=map.size;
  assert.equal(c,city.CITY_SIZE);assert.deepEqual({x:map.plaza.x,y:map.plaza.y},{x:84.5,y:84.5});
  assert.deepEqual(map.mouths.map(m=>m.id).sort(),['L','N','O','S']);
  assert.ok(map.start.x>=0&&map.start.x<=c&&map.start.y>=0&&map.start.y<=c);
  for(const view of VIEWS){
    const o=city.cityMinimapPoint(map.plaza,view);
    const corners=[{x:0,y:0},{x:c,y:0},{x:0,y:c},{x:c,y:c}].map(p=>{const q=city.cityMinimapPoint(p,view);return {x:q.x-o.x,y:q.y-o.y};});
    for(const q of corners){
      const ax=Math.abs(q.x),ay=Math.abs(q.y);
      assert.ok((near(ax,0,.01)&&near(ay,34,.01))||(near(ax,34,.01)&&near(ay,0,.01)),`view ${view}: corner at (${q.x},${q.y})`);
    }
    assert.equal(new Set(corners.map(q=>`${Math.round(q.x)},${Math.round(q.y)}`)).size,4,`view ${view}: four distinct vertices`);
    for(const m of map.mouths){
      const q=city.cityMinimapPoint(m,view),dx=q.x-o.x,dy=q.y-o.y;
      assert.ok(Math.abs(dx)+Math.abs(dy)<=34+.01&&Math.abs(dx)+Math.abs(dy)>=30,`view ${view} mouth ${m.id}: on the diamond's side (${dx},${dy})`);
      assert.ok(Math.abs(Math.abs(dx)-Math.abs(dy))<=2,`view ${view} mouth ${m.id}: middle of the side`);
    }
  }
  // View 0: the world corner (0,0) is straight up on screen (projection.ts), so it is the top vertex.
  const o0=city.cityMinimapPoint(map.plaza,0),top=city.cityMinimapPoint({x:0,y:0},0);
  assert.ok(near(top.x-o0.x,0,.01)&&near(top.y-o0.y,-34,.01),`view 0: (0,0) at (${top.x-o0.x},${top.y-o0.y})`);
  // Mouths turn by 90° per view, all the same way.
  let turn=0;
  for(const m of map.mouths)for(const view of VIEWS){
    const next=((view+1)%4) as CityView,p=city.cityMinimapPoint(m,view),q=city.cityMinimapPoint(m,next),op=city.cityMinimapPoint(map.plaza,view),oq=city.cityMinimapPoint(map.plaza,next);
    const a={x:p.x-op.x,y:p.y-op.y},b={x:q.x-oq.x,y:q.y-oq.y};
    assert.ok(near(a.x*b.x+a.y*b.y,0,.01),`mouth ${m.id}, view ${view}→${next}: not 90°`);
    assert.ok(near(Math.hypot(a.x,a.y),Math.hypot(b.x,b.y),.01));
    const cross=Math.sign(a.x*b.y-a.y*b.x);if(!turn)turn=cross;assert.equal(cross,turn,'same turning direction');
  }
  // Same box side in px: default 76.
  assert.deepEqual(city.cityMinimapPoint({x:10,y:20},2),city.cityMinimapPoint({x:10,y:20},2,76));
});

test('9. cityMinimapPoint: up (and right) on screen is up (and right) on the minimap in all 4 views',()=>{
  const map=city.DEFAULT_CITY;
  for(const view of VIEWS){
    const o=city.cityMinimapPoint(map.plaza,view);
    // In view v the screen shows rotateVector(d, v): screen up is q = (-1,-1), screen right is q = (1,-1).
    const up=rot({x:-5,y:-5},-view),rt=rot({x:5,y:-5},-view);
    const u=city.cityMinimapPoint({x:map.plaza.x+up.x,y:map.plaza.y+up.y},view),w=city.cityMinimapPoint({x:map.plaza.x+rt.x,y:map.plaza.y+rt.y},view);
    assert.ok(near(u.x-o.x,0,1e-6)&&u.y-o.y<0,`view ${view}: screen up → (${u.x-o.x},${u.y-o.y})`);
    assert.ok(near(w.y-o.y,0,1e-6)&&w.x-o.x>0,`view ${view}: screen right → (${w.x-o.x},${w.y-o.y})`);
  }
});

test('9. cityMinimapMarks: draw order bottom → top, você on top, doc minimum sizes, groups ≥ 3 as trevos',()=>{
  const rnd=lcg(11);
  const enemies=[...blob('x',25.75,33.75,12,rnd),...blob('y',121.75,41.75,26,rnd),...blob('z',73.75,121.75,4,rnd),...blob('w',145.75,9.75,2,rnd),{id:'boss',x:140,y:140,boss:true}];
  const marks:CityMark[]=city.cityMinimapMarks({map:city.DEFAULT_CITY,view:0,selfId:'me',
    players:[{id:'me',x:84.5,y:120},{id:'a',x:60,y:60},{id:'b',x:100,y:30,downed:true}],enemies,activeMouths:['N'],baseHp:{hp:20,maxHp:100}});
  const RANK:Record<string,number>={boca:0,grupo:1,aliado:2,base:3,'boca-ativa':4,chefe:5,caido:6,voce:7};
  const ranked=marks.filter(m=>m.kind!=='inicio').map(m=>RANK[m.kind]);
  for(let i=1;i<ranked.length;i++)assert.ok(ranked[i]>=ranked[i-1],`draw order: ${marks.map(m=>m.kind).join(',')}`);
  assert.equal(marks.at(-1)!.kind,'voce');
  const of=(k:string)=>marks.filter(m=>m.kind===k);
  assert.equal(of('voce').length,1);assert.equal(of('aliado').length,1);assert.equal(of('caido').length,1);assert.equal(of('base').length,1);assert.equal(of('chefe').length,1);
  assert.equal(of('boca').length,3);assert.equal(of('boca-ativa').length,1);
  const groups=of('grupo');
  assert.deepEqual(groups.map(g=>g.count).sort((a,b)=>a!-b!),[4,12,26],'groups of 3 or more only (the pair is left out)');
  const MIN:Record<string,number>={voce:9,aliado:6,caido:11,base:11,boca:5,'boca-ativa':12,chefe:10};
  for(const m of marks){
    assert.ok(m.size>=5,`${m.key}: ${m.size} px`);
    if(MIN[m.kind])assert.ok(m.size>=MIN[m.kind],`${m.kind}: ${m.size} < ${MIN[m.kind]}`);
    if(m.kind==='grupo')assert.ok(m.size>=(m.count!>=25?11:m.count!>=10?8:6),`grupo ${m.count}: ${m.size}`);
  }
  const me=city.cityMinimapPoint({x:84.5,y:120},0);
  assert.ok(near(of('voce')[0].x,me.x,1e-6)&&near(of('voce')[0].y,me.y,1e-6),'você at its minimap point');
  assert.equal(new Set(marks.map(m=>m.key)).size,marks.length,'keys are unique');
});

test('9. cityEdgeTargets: caído always, groups ≥ 5 off screen as "grupo:" spawns with groupCount, ≤ 2 active mouths, base only in prepare or after a wall hit',()=>{
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
  assert.equal(grupos.length,1,`grupos: ${grupos.map(t=>t.key)}`);assert.equal(grupos[0].kind,'spawn');assert.equal((grupos[0] as any).groupCount,12,'the group carries its critters');
  assert.deepEqual([...groupKeys].map(k=>`grupo:${k}`),grupos.map(t=>t.key));
  const bocas=targets.filter(t=>t.key.startsWith('boca:'));
  assert.ok(bocas.length<=2&&bocas.length>=1,`bocas: ${bocas.map(t=>t.key)}`);
  for(const t of targets)assert.ok(Number.isFinite(t.screen.x)&&Number.isFinite(t.screen.y)&&t.distance>=0,t.key);
  assert.equal(city.cityEdgeTargets({...base,phase:'prepare'}).targets.filter(t=>t.kind==='base').length,1,'base in the intermission');
  assert.equal(city.cityEdgeTargets({...base,wallHitRecently:true}).targets.filter(t=>t.kind==='base').length,1,'base after a wall hit');
  assert.deepEqual(city.cityEdgeTargets(base).targets,targets,'deterministic');
});

test('§2 big minimap closes by itself: 4 s in a wave, 8 s in the intermission, on a new notice, damage, a telegraph or a critter at 2.5 u',()=>{
  assert.deepEqual(city.BIG_OPEN_MS,{wave:4000,prepare:8000});assert.equal(city.NEAR_BLOCK,2.5);
  const base={openedAtMs:1000,phase:'wave' as const};
  assert.equal(city.bigShouldClose({...base,nowMs:1000+3990}),false,'wave, under 4 s');
  assert.equal(city.bigShouldClose({...base,nowMs:1000+4010}),true,'wave, past 4 s');
  assert.equal(city.bigShouldClose({...base,phase:'prepare',nowMs:1000+4010}),false,'intermission keeps it 8 s');
  assert.equal(city.bigShouldClose({...base,phase:'prepare',nowMs:1000+7990}),false);
  assert.equal(city.bigShouldClose({...base,phase:'prepare',nowMs:1000+8010}),true,'intermission, past 8 s');
  for(const flag of ['announced','hurt','telegraphOnHero'] as const)assert.equal(city.bigShouldClose({...base,nowMs:1100,[flag]:true}),true,flag);
  assert.equal(city.bigShouldClose({...base,nowMs:1100,nearestEnemy:city.NEAR_BLOCK}),true,'a critter at 2.5 u');
  assert.equal(city.bigShouldClose({...base,nowMs:1100,nearestEnemy:2.4}),true);
  assert.equal(city.bigShouldClose({...base,nowMs:1100,nearestEnemy:2.6}),false);
  assert.equal(city.bigShouldClose({...base,nowMs:1100}),false,'nothing happened');
});

test('§2 tap blocked while a critter is within NEAR_BLOCK (2.5 u), with the doc label',()=>{
  assert.equal(city.tapBlocked(2.5),true);assert.equal(city.tapBlocked(0),true);assert.equal(city.tapBlocked(2.4),true);
  assert.equal(city.tapBlocked(2.6),false);assert.equal(city.tapBlocked(undefined),false);assert.equal(city.tapBlocked(40),false);
  assert.equal(city.BLOCKED_LABEL,'Bicho perto. O mapa grande abre quando sair.');
});

/** World → screen for the edge-target tests: the hero at the portrait useful area's centre, 41 px/u (doc §0). */
const edgeWorld=(hero:{x:number;y:number},onScreen:boolean)=>{
  const locate=(p:{x:number;y:number})=>({x:230+(p.x-hero.x)*41,y:441+(p.y-hero.y)*41});
  return {locate,isOnScreen:onScreen?(p:{x:number;y:number})=>{const s=locate(p);return s.x>=0&&s.x<=390&&s.y>=0&&s.y<=844;}:()=>false};
};
test('§3 group ficha turns Cone (danger) within 8 u of the hero or 12 u of the wall, never otherwise',()=>{
  assert.equal(city.GROUP_DANGER_HERO,8);assert.equal(city.GROUP_DANGER_WALL,12);
  const hero={x:84.5,y:150},rnd=lcg(8),map=city.DEFAULT_CITY;
  const base={hero,selfId:'me',players:[{id:'me',...hero}],activeMouths:[] as ('N'|'S'|'L'|'O')[],map,phase:'wave' as const,...edgeWorld(hero,false)};
  // Near the hero (≈ 6.8 u) and far from both (≈ 43 u from the hero, ≈ 65 u from the wall).
  const near=blob('n',89.75,145.75,6,rnd),far=blob('f',41.75,145.75,7,rnd);
  const {targets}=city.cityEdgeTargets({...base,enemies:[...near,...far]});
  const byIds=(ids:EnemyPoint[])=>targets.find(t=>t.key.startsWith('grupo:')&&Math.abs(t.distance-Math.hypot(ids.reduce((s,e)=>s+e.x,0)/ids.length-hero.x,ids.reduce((s,e)=>s+e.y,0)/ids.length-hero.y))<1e-6);
  assert.equal(byIds(near)?.danger,true,'≤ 8 u from the hero');
  assert.ok(byIds(far)&&!byIds(far)!.danger,'far from the hero and the wall');
  // Near the wall: ≈ 8.7 u from the plaza's rim (radius 10), ≈ 54 u from the hero.
  const wall=blob('w',97.75,97.75,6,rnd),w=city.cityEdgeTargets({...base,enemies:wall}).targets.filter(t=>t.key.startsWith('grupo:'));
  const g={x:wall.reduce((s,e)=>s+e.x,0)/6,y:wall.reduce((s,e)=>s+e.y,0)/6};
  assert.ok(Math.hypot(g.x-map.plaza.x,g.y-map.plaza.y)-map.plaza.radius<=12&&Math.hypot(g.x-hero.x,g.y-hero.y)>8,'fixture: near the wall only');
  assert.equal(w.length,1);assert.equal(w[0].danger,true,'≤ 12 u from the wall');
});

test('§3 base after the horn: Cone with the seconds in the intermission; plain before it; no horn in a wave',()=>{
  const hero={x:84.5,y:150},map=city.DEFAULT_CITY;
  const base={hero,selfId:'me',players:[{id:'me',...hero}],enemies:[],map,...edgeWorld(hero,true)};
  const plain=city.cityEdgeTargets({...base,phase:'prepare'}).targets.find(t=>t.kind==='base');
  assert.ok(plain);assert.ok(!plain!.danger);assert.equal(plain!.seconds,undefined);
  const horn=city.cityEdgeTargets({...base,phase:'prepare',hornSeconds:5}).targets.find(t=>t.kind==='base');
  assert.equal(horn?.danger,true);assert.equal(horn?.seconds,5);
  const wave=city.cityEdgeTargets({...base,phase:'wave',wallHitRecently:true,hornSeconds:5}).targets.find(t=>t.kind==='base');
  assert.ok(wave,'a wall hit shows the base in a wave');assert.equal(wave!.seconds,undefined,'the horn belongs to the intermission');
  // Plaza in plain view: no base arrow even in the intermission.
  const seen=city.cityEdgeTargets({...base,hero:{x:84.5,y:90},phase:'prepare',...edgeWorld({x:84.5,y:90},true)}).targets;
  assert.ok(!seen.some(t=>t.kind==='base'));
});

test('§3 count text caps at "99+"; §4 download and news texts',()=>{
  assert.equal(city.groupCountText(0),'0');assert.equal(city.groupCountText(12),'12');assert.equal(city.groupCountText(99),'99');
  assert.equal(city.groupCountText(100),'99+');assert.equal(city.groupCountText(4321),'99+');
  assert.equal(city.downloadText(.4),'Baixando a cidade: 40%');assert.equal(city.downloadText(0),'Baixando a cidade: 0%');
  assert.equal(city.downloadText(1),'Baixando a cidade: 100%');assert.equal(city.downloadText(1.7),'Baixando a cidade: 100%');
  assert.equal(city.downloadText(-.2),'Baixando a cidade: 0%');assert.equal(city.downloadText(.404),'Baixando a cidade: 40%');
  assert.equal(city.mapChangedNews('cidade'),'Mapa trocado: Cidade Nevada. Todo mundo confirma de novo.');
  assert.equal(city.SELECTOR_TEXT.failed,'Não chegou. Toca de novo.');assert.equal(city.NEWS_MS,4000);
});

test('9. map options: Cidade Nevada / Mapa infinito, subtitles ≤ 28 characters (doc §4)',()=>{
  assert.deepEqual(city.MAP_OPTIONS.map(o=>o.id),['cidade','infinito']);
  assert.deepEqual(city.MAP_OPTIONS.map(o=>o.name),['Cidade Nevada','Mapa infinito']);
  assert.deepEqual(city.MAP_OPTIONS.map(o=>o.subtitle),['Leve casaco, a firma não deu','Praia sem fim, boleto também']);
  for(const o of city.MAP_OPTIONS){assert.ok(o.subtitle.length>0&&[...o.subtitle.normalize('NFC')].length<=28,o.subtitle);assert.doesNotMatch(o.subtitle,/chefe|rodada/i);}
});

const step=(s:SelectorState,e:SelectorEvent)=>city.selectorReducer(s,e);
test('9. selector state machine: owner tap → pending → confirm; same map sends nothing; pending dropped after 3 s',()=>{
  let s=city.initialSelector(true);
  assert.equal(s.confirmed,'cidade');assert.equal(s.canManage,true);assert.equal(s.locked,false);assert.equal(s.pending,undefined);
  let out=step(s,{type:'tap',map:'cidade',nowMs:100});
  assert.equal(out.send,undefined,'tapping the selected map sends nothing');assert.equal(out.state.pending,undefined);
  out=step(s,{type:'tap',map:'infinito',nowMs:100});
  assert.equal(out.send,'infinito');assert.deepEqual(out.state.pending,{map:'infinito',sinceMs:100});assert.equal(out.state.confirmed,'cidade','nothing changes before the server says so');
  const confirmed=step(out.state,{type:'confirm',map:'infinito'});
  assert.equal(confirmed.state.confirmed,'infinito');assert.equal(confirmed.state.pending,undefined);assert.equal(confirmed.send,undefined);
  // No answer in 3 s: back to the server's map.
  s=out.state;
  assert.ok(step(s,{type:'tick',nowMs:100+city.PENDING_MS-1}).state.pending,'still pending before 3 s');
  const dropped=step(s,{type:'tick',nowMs:100+city.PENDING_MS+1}).state;
  assert.equal(dropped.pending,undefined);assert.equal(dropped.confirmed,'cidade');
  // And a new tap works again.
  assert.equal(step(dropped,{type:'tap',map:'infinito',nowMs:5000}).send,'infinito');
  assert.equal(city.initialSelector(true,'infinito').confirmed,'infinito');
});

test('9. selector state machine: locked in the countdown, reconnect drops the pending change, owner change, guest tap does nothing',()=>{
  const owner=city.initialSelector(true);
  const locked=step(owner,{type:'countdown',on:true}).state;
  assert.equal(locked.locked,true);
  const tapLocked=step(locked,{type:'tap',map:'infinito',nowMs:10});
  assert.equal(tapLocked.send,undefined);assert.equal(tapLocked.state.pending,undefined);
  const unlocked=step(locked,{type:'countdown',on:false}).state;
  assert.equal(unlocked.locked,false);assert.equal(step(unlocked,{type:'tap',map:'infinito',nowMs:20}).send,'infinito','unlocks when the countdown drops');
  // Reconnect: the pending change is dropped and the welcome's map rules.
  const pending=step(owner,{type:'tap',map:'infinito',nowMs:0}).state;
  const back=step(pending,{type:'reconnect'}).state;
  assert.equal(back.pending,undefined);assert.equal(back.confirmed,'cidade');
  assert.equal(step(back,{type:'confirm',map:'infinito'}).state.confirmed,'infinito');
  // Owner change in the middle: the pending change drops too; the new guest can no longer pick.
  const demoted=step(pending,{type:'owner',canManage:false}).state;
  assert.equal(demoted.canManage,false);assert.equal(demoted.pending,undefined);
  // Guest: a tap does nothing at all.
  const guest=city.initialSelector(false);
  const tap=step(guest,{type:'tap',map:'infinito',nowMs:0});
  assert.equal(tap.send,undefined);assert.deepEqual(tap.state,guest);
  // Guests still follow the server's map, and become able to pick when they get the room.
  assert.equal(step(guest,{type:'confirm',map:'infinito'}).state.confirmed,'infinito');
  const promoted=step(guest,{type:'owner',canManage:true}).state;
  assert.equal(promoted.canManage,true);assert.equal(step(promoted,{type:'tap',map:'infinito',nowMs:0}).send,'infinito');
});

test('9. selector state machine never gets stuck and has no dead button (seeded random events, offline and download included)',()=>{
  const maps:MapId[]=['cidade','infinito'];
  for(const seed of [1,2,3,2026]){
    const rnd=lcg(seed);let now=0,s=city.initialSelector(rnd()<.5);
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
        const other=t.confirmed==='cidade'?'infinito':'cidade';
        assert.equal(step(t,{type:'tap',map:other,nowMs:now+city.PENDING_MS+2}).send,other,`${where}: stuck`);
      }
    }
  }
});

test('§4 reconnection: offline turns every segment off with sem-linha, drops the pending change, sends nothing; back online the owner picks again',()=>{
  const owner=city.initialSelector(true);
  assert.equal(owner.offline,false);
  const pending=step(owner,{type:'tap',map:'infinito',nowMs:0}).state;
  const off=step(pending,{type:'offline',on:true}).state;
  assert.equal(off.offline,true);assert.equal(off.pending,undefined,'the pending change is dropped');
  for(const map of ['cidade','infinito'] as const){const t=step(off,{type:'tap',map,nowMs:10});assert.equal(t.send,undefined);assert.equal(t.state.pending,undefined);}
  for(const orientation of ['portrait','landscape'] as const){
    const v=city.selectorView(off,orientation);assert.ok(v.options.every(o=>o.disabled&&o.sticker==='sem-linha'),orientation);
  }
  // The welcome's map rules, then back online.
  const back=step(step(off,{type:'confirm',map:'cidade'}).state,{type:'offline',on:false}).state;
  assert.equal(back.offline,false);assert.equal(step(back,{type:'tap',map:'infinito',nowMs:20}).send,'infinito');
  // Stickers: pronto on the selection, relogio on the pending one, cadeado in the countdown (doc §4).
  assert.deepEqual(city.selectorView(owner,'portrait').options.map(o=>o.sticker),['pronto',undefined]);
  assert.deepEqual(city.selectorView(pending,'portrait').options.map(o=>o.sticker),['pronto','relogio']);
  assert.equal(city.selectorView(step(owner,{type:'countdown',on:true}).state,'portrait').options[0].sticker,'cadeado');
});

test('§4 download: the selected subtitle becomes "Baixando a cidade: 40%" (landscape too), and goes back after',()=>{
  const s=step(city.initialSelector(false),{type:'download',text:city.downloadText(.4)}).state;
  for(const orientation of ['portrait','landscape'] as const){
    const v=city.selectorView(s,orientation);
    assert.equal(v.options[0].subtitle,'Baixando a cidade: 40%',orientation);
    if(orientation==='landscape')assert.ok(!v.options[1].subtitle,'landscape: no joke on the other option');
    else assert.equal(v.options[1].subtitle,city.MAP_OPTIONS[1].subtitle);
  }
  const done=step(s,{type:'download'}).state;
  assert.equal(done.download,undefined);assert.equal(city.selectorView(done,'portrait').options[0].subtitle,city.MAP_OPTIONS[0].subtitle);
  // Downloading never blocks the owner's choice.
  assert.equal(step(step(city.initialSelector(true),{type:'download',text:city.downloadText(.1)}).state,{type:'tap',map:'infinito',nowMs:0}).send,'infinito');
});

test('§1 group counts on the big minimap: labels for groups of 10+, drawn clear of every mark and of each other, inside the drawing',()=>{
  const rnd=lcg(11),side=232;
  const enemies=[...blob('x',25.75,33.75,12,rnd),...blob('y',121.75,41.75,126,rnd),...blob('z',73.75,121.75,4,rnd),...blob('q',89.75,81.75,15,rnd)];
  const marks=city.cityMinimapMarks({map:city.DEFAULT_CITY,view:0,side,selfId:'me',players:[{id:'me',x:84.5,y:120},{id:'a',x:88,y:84}],enemies,activeMouths:['N'],baseHp:{hp:50,maxHp:100}});
  const labels=city.cityMinimapLabels(marks,side),box=(m:CityMark)=>r(m.x-m.size/2,m.y-m.size/2,m.size,m.size),rad=city.innerRadius(side);
  assert.deepEqual(labels.map(l=>l.text).sort(),['12','15','99+'],'only groups of LABEL_MIN (10) or more, "99+" at the ceiling');
  for(const l of labels){
    for(const m of marks)assert.equal(crosses(l.box,box(m)),false,`label ${l.text} ${fmt(l.box)} over mark ${m.key} ${fmt(box(m))}`);
    assert.ok(l.box.x>=-rad&&l.box.y>=-rad&&right(l.box)<=rad&&bottom(l.box)<=rad,`label ${l.text} ${fmt(l.box)} leaves the drawing`);
  }
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)assert.equal(crosses(labels[i].box,labels[j].box),false,`${labels[i].text} × ${labels[j].text}`);
  assert.deepEqual(city.cityMinimapLabels(marks,side),labels,'deterministic');
});

test('9. selectorView: one selected, pending marked, guests read-only with the owner hint, locked hint, no subtitles in landscape',()=>{
  const owner=city.initialSelector(true),names=city.MAP_OPTIONS.map(o=>o.name);
  for(const orientation of ['portrait','landscape'] as const){
    const v=city.selectorView(owner,orientation);
    assert.deepEqual(v.options.map(o=>o.id),['cidade','infinito']);assert.deepEqual(v.options.map(o=>o.name),names);
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
  assert.equal(city.selectorView(city.initialSelector(false),'portrait').hint,'Quem escolhe o mapa é o dono da sala.');
});
