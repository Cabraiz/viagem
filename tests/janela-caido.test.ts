/**
 * NEW-20261011-UX-janela-esconde-caido (+ the arrow/minimap part of DSG-polimento-onda6): with the forge, the offer or
 * the kill-cam open, the caído's and the boss's arrows stay on screen, beside the window, never on the hero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutEdges,arrowHalf,pointedTargets,MUST_POINT,HEAD_ROOM,type EdgeTarget,type EdgeArrow} from '../src/game/hud/edges.ts';
import {computeZones,auditBoxes,crosses,gap,HERO_MARGIN,type Rect,type ZoneInput} from '../src/game/hud/zones.ts';
import {radar} from '../src/game/hud/radar.ts';
import {DRAW_ORDER} from '../src/game/hud/minimap.ts';

const t=(key:string,kind:EdgeTarget['kind'],x:number,y:number,extra:Partial<EdgeTarget>={}):EdgeTarget=>({key,kind,screen:{x,y},distance:20,...extra});
const fichaOf=(a:EdgeArrow,half=arrowHalf()):Rect=>({x:a.x-half.w,y:a.y-half.h,width:2*half.w,height:2*half.h});
const heroIn=(u:Rect):Rect=>({x:u.x+u.width/2-28,y:u.y+u.height/2-28,width:56,height:56});

const LANDSCAPE:ZoneInput={viewport:{width:844,height:390},status:[{x:14,y:12,width:44,height:44},{x:330,y:8,width:180,height:40},{x:212,y:52,width:420,height:20}],
  team:{x:258,y:318,width:328,height:64},joystick:{x:18,y:278,width:96,height:96},skill:{x:746,y:292,width:82,height:82}};
const PORTRAIT:ZoneInput={viewport:{width:390,height:844},status:[{x:14,y:12,width:44,height:44},{x:166,y:8,width:142,height:46},{x:8,y:72,width:292,height:26}],
  team:{x:8,y:120,width:54,height:380},joystick:{x:24,y:708,width:112,height:112},skill:{x:284,y:738,width:82,height:82}};
/** The forge as the real scene lays it out: the right column in landscape, above the thumbs in portrait. */
const FORGE={landscape:{x:480,y:56,width:350,height:200},portrait:{x:70,y:450,width:315,height:230}} as const;

for(const [name,input,forge,behind,far] of [
  ['landscape',LANDSCAPE,FORGE.landscape,{x:650,y:150},{x:1400,y:240}],
  ['portrait',PORTRAIT,FORGE.portrait,{x:230,y:560},{x:260,y:1500}],
] as const){
  test(`${name}: with the forge open the caído under it and the boss keep their arrows, beside the window`,()=>{
    const zones=computeZones({...input,offer:forge}),u=zones.useful,hero=heroIn(u);
    assert.equal(crosses(u,forge),false,'the field left to play is beside the window');
    const targets=[t('caido','caido',behind.x,behind.y,{seconds:6}),t('chefe','chefe',far.x,far.y),t('base','base',-300,200)];
    const covered=[...input.status,input.team,input.joystick,input.skill,forge];
    const arrows=layoutEdges(targets,u,hero,{seen:{viewport:{x:0,y:0,...input.viewport},covered}});
    const caido=arrows.find(a=>a.kind==='caido'),chefe=arrows.find(a=>a.kind==='chefe');
    assert.ok(caido,'the caído under the window gets an arrow');assert.ok(chefe,'the boss keeps its arrow');
    for(const a of arrows){
      const ficha=fichaOf(a);
      assert.equal(crosses(ficha,forge),false,`${a.kind} not behind the window`);
      assert.equal(crosses(ficha,hero,HERO_MARGIN),false,`${a.kind} not on the hero`);
      assert.ok(ficha.x>=u.x-1&&ficha.y>=u.y-1&&ficha.x+ficha.width<=u.x+u.width+1&&ficha.y+ficha.height<=u.y+u.height+1,`${a.kind} inside the field`);
    }
    // The beak points at the window, where the caído is: the arrow says "behind this".
    assert.ok(Math.hypot(behind.x-caido!.x,behind.y-caido!.y)>0&&Math.abs(Math.atan2(behind.y-caido!.y,behind.x-caido!.x)-caido!.angle)<1e-9);
    // Before this card the window was not in the "covered" list: the caído read as in plain view and lost its arrow.
    const before=layoutEdges(targets,u,hero,{seen:{viewport:{x:0,y:0,...input.viewport},covered:covered.slice(0,-1)}});
    assert.equal(before.some(a=>a.kind==='caido'),false);
  });
}

test('the offer window works the same way (landscape, the round offer in the right column)',()=>{
  const offer={x:484,y:52,width:340,height:212},zones=computeZones({...LANDSCAPE,offer}),hero=heroIn(zones.useful);
  const arrows=layoutEdges([t('c','caido',600,120,{seconds:15,ping:true}),t('b','chefe',900,500)],zones.useful,hero,
    {seen:{viewport:{x:0,y:0,width:844,height:390},covered:[offer]}});
  assert.deepEqual(arrows.map(a=>a.kind).sort(),['caido','chefe']);
  for(const a of arrows)assert.equal(crosses(fichaOf(a),offer),false);
});

test('landscape: an arrow on the top rim keeps HEAD_ROOM sideways from the hero, not beside its head',()=>{
  const area:Rect={x:138,y:154,width:570,height:155},hero:Rect={x:395,y:203,width:56,height:56};
  const [up]=layoutEdges([t('up','chefe',423,-300)],area,hero);
  assert.ok(up);assert.equal(up.side,'top');
  assert.ok(gap(fichaOf(up),hero)>=HEAD_ROOM,`gap ${gap(fichaOf(up),hero)}`);
  // Portrait: the top rim is far above the hero, the head room changes nothing (the arrow stays straight above it).
  const tall:Rect={x:70,y:244,width:320,height:440},h2:Rect={x:202,y:436,width:56,height:56};
  const [p]=layoutEdges([t('up','chefe',230,-300)],tall,h2);
  assert.ok(Math.abs(p.x-230)<1,'not moved in a tall field');
});

test('landscape beside a window: no room for the head room on top, the caído still gets an arrow (never dropped)',()=>{
  const zones=computeZones({...LANDSCAPE,offer:FORGE.landscape}),u=zones.useful,hero=heroIn(u);
  const arrows=layoutEdges([t('up','caido',u.x+u.width/2,-400,{seconds:9,ping:true})],u,hero);
  assert.equal(arrows.length,1);
  const a=arrows[0];assert.equal(crosses(fichaOf(a),hero,HERO_MARGIN),false);
  assert.ok(a.angle<0,'still points up');
});

test('zones: the landscape minimap in the left column (a window open) stays out of the field',()=>{
  const minimap={x:14,y:68,width:76,height:76};
  const z=computeZones({...LANDSCAPE,minimap,offer:FORGE.landscape});
  assert.equal(crosses(z.useful,minimap),false);
  assert.ok(gap(minimap,LANDSCAPE.joystick!)>=24,'clear of the joystick');
});

test('minimap: one mark per resource (the nearest pile with something), base above the allies',()=>{
  const node=(id:string,kind:string,x:number,remaining=3)=>({id,kind,x,y:0,remaining,capacity:3,value:1,progress:0});
  const {items}=radar({selfId:'me',focus:{x:0,y:0},self:{x:0,y:0},tick:0,players:[],states:new Map(),locate:p=>p,
    nodes:[node('c1','coco',8),node('c2','coco',3),node('c3','coco',3.4),node('c4','coco',1,0),node('p1','pedra',-6),node('p2','pedra',-5.5),node('p3','pedra',-9)]});
  assert.deepEqual(items.filter(i=>i.kind==='coco'||i.kind==='pedra').map(i=>i.key).sort(),['node:c2','node:p2']);
  assert.ok(DRAW_ORDER.base>DRAW_ORDER.aliado,'the tent is drawn over an ally dot');
  assert.ok(DRAW_ORDER.voce>DRAW_ORDER.base&&DRAW_ORDER.caido>DRAW_ORDER.base);
  assert.ok(DRAW_ORDER.coco<DRAW_ORDER.aliado&&DRAW_ORDER.pedra<DRAW_ORDER.aliado);
});

test('pointedTargets: a caído under the open window needs an arrow; one in plain view does not',()=>{
  const zones=computeZones({...LANDSCAPE,offer:FORGE.landscape}),u=zones.useful;
  const seen={viewport:{x:0,y:0,width:844,height:390},covered:[FORGE.landscape]};
  const under=t('a','caido',650,150,{seconds:6}),plain=t('b','caido',u.x+u.width/2,u.y+u.height/2,{seconds:9});
  assert.deepEqual(pointedTargets([under,plain],u,seen).map(x=>x.key),['a']);
  assert.ok(MUST_POINT.includes('caido')&&MUST_POINT.includes('chefe'));
});

test('zones audit: a caído that needs an arrow and has none fails (unpointed), and only that',()=>{
  const zones=computeZones(LANDSCAPE);
  const ok=auditBoxes([{name:'joystick',rect:LANDSCAPE.joystick!,thumb:true,target:true}],zones);
  assert.equal(ok.ok,true);assert.deepEqual(ok.unpointed,[]);
  const bad=auditBoxes([{name:'joystick',rect:LANDSCAPE.joystick!,thumb:true,target:true},{name:'sem-seta-caido',rect:{x:0,y:0,width:0,height:0},unpointed:true}],zones,{x:400,y:200,width:56,height:56});
  assert.equal(bad.ok,false);assert.deepEqual(bad.unpointed,['sem-seta-caido']);
  assert.deepEqual([bad.heroCrossed,bad.inPlay,bad.escaped],[[],[],[]],'the marker is not a box on screen');
});

test('a boss arrow never hides in the caído\'s "+1" while a corner of the field is free',()=>{
  const area:Rect={x:100,y:150,width:500,height:160},hero={x:322,y:202,width:56,height:56};
  // Both point at the same spot on the right rim: the boss steps aside or takes a corner, never "+1" on the caído.
  const arrows=layoutEdges([t('c','caido',2000,230,{seconds:6}),t('b','chefe',2000,231)],area,hero);
  assert.deepEqual(arrows.map(a=>a.kind).sort(),['caido','chefe']);
  assert.ok(arrows.every(a=>a.count===1));
});
