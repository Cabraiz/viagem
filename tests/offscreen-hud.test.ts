/**
 * Edge arrows, minimap and rescue in the world (UX-bordas-fora-da-tela, ORQ-minimapa, UX-resgate-e-ping): pure parts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutEdges,inView,arrowHalf,beakRadius,caidoTag,distanceText,tagWidth,MAX_ARROWS,EDGE_PRIORITY,type EdgeTarget} from '../src/game/hud/edges.ts';
import {minimapPoint,islandOutline,MINIMAP_RADIUS,MINIMAP_RANGE} from '../src/game/hud/minimap.ts';
import {radar,keepWarnings,holdLine,sosButton,SPAWN_TAIL_TICKS} from '../src/game/hud/radar.ts';
import {computeZones,crosses,HERO_MARGIN,type Rect} from '../src/game/hud/zones.ts';
import {projectView,viewPoint} from '../src/game/projection.ts';
import {toScreen} from '../src/game/framing.ts';
import {reviveBanner,OUT_TEXT} from '../src/game/hud/model.ts';
import {ringPoints,progressPoints} from '../src/game/render/downed-rules.ts';
import {REVIVE_RADIUS} from '../src/game/sim/revive.ts';
import {fakeView} from '../src/game/hud/fixtures.ts';
import type {PlayerRunView} from '../src/game/sim/view.ts';

const AREA:Rect={x:70,y:244,width:320,height:440};
const inside=(p:{x:number;y:number},r:Rect)=>p.x>=r.x-1e-6&&p.x<=r.x+r.width+1e-6&&p.y>=r.y-1e-6&&p.y<=r.y+r.height+1e-6;
const t=(key:string,kind:EdgeTarget['kind'],x:number,y:number,distance=10,extra:Partial<EdgeTarget>={}):EdgeTarget=>({key,kind,screen:{x,y},distance,...extra});

test('arrows sit on the inner rim of the useful area, only for what is outside it, and point at the target',()=>{
  const half=arrowHalf();
  const arrows=layoutEdges([t('in','aliado',200,400),t('right','aliado',900,464),t('up','base',230,-300)],AREA);
  assert.deepEqual(arrows.map(a=>a.key).sort(),['right','up']);
  for(const a of arrows){
    // The whole ficha stays inside the useful area (never on the HUD, the thumbs or the team strip).
    assert.ok(inside({x:a.x-half.w,y:a.y-half.h},AREA)&&inside({x:a.x+half.w,y:a.y+half.h},AREA),a.key);
    assert.ok(Math.abs(Math.atan2(a.screen.y-a.y,a.screen.x-a.x)-a.angle)<1e-9);
  }
  const right=arrows.find(a=>a.key==='right')!;assert.equal(right.side,'right');assert.ok(Math.abs(right.angle)<.1);
  const up=arrows.find(a=>a.key==='up')!;assert.equal(up.side,'top');
});

test('priority caído > chefe > spawn > base > aliado > baú; at most 6; neighbours merge into the urgent one',()=>{
  assert.ok(EDGE_PRIORITY.caido<EDGE_PRIORITY.chefe&&EDGE_PRIORITY.chefe<EDGE_PRIORITY.spawn&&EDGE_PRIORITY.spawn<EDGE_PRIORITY.aliado);
  // Nine targets spread around: only six arrows, the caído and the chefe always among them.
  const ring=Array.from({length:9},(_,i)=>{const a=i/9*Math.PI*2;return {x:230+Math.cos(a)*900,y:464+Math.sin(a)*900};});
  const kinds:EdgeTarget['kind'][]=['bau','aliado','aliado','aliado','aliado','base','spawn','chefe','caido'];
  const arrows=layoutEdges(ring.map((p,i)=>t(`k${i}`,kinds[i],p.x,p.y)),AREA);
  assert.equal(arrows.length,MAX_ARROWS);
  assert.ok(arrows.some(a=>a.kind==='caido')&&arrows.some(a=>a.kind==='chefe')&&arrows.some(a=>a.kind==='spawn'));
  assert.ok(!arrows.some(a=>a.kind==='bau'),'the least urgent is left out');
  // Two targets in the same direction: the less urgent steps aside along the side (both readable)...
  const apart=layoutEdges([t('ally','aliado',900,470,4),t('down','caido',905,480,30,{seconds:12})],AREA);
  assert.equal(apart.length,2);const half=arrowHalf();
  assert.ok(Math.abs(apart[0].y-apart[1].y)>=2*half.h,'stacked, not overlapping');
  // ...and only when the side has no room left they become one, the caído's, with "+1".
  const tight:Rect={x:0,y:0,width:100,height:40};
  const merged=layoutEdges([t('ally','aliado',900,20,4),t('down','caido',905,22,30,{seconds:12})],tight);
  assert.equal(merged.length,1);assert.equal(merged[0].kind,'caido');assert.equal(merged[0].count,2);
});

test('an arrow never covers the hero (± 40 px): it slides along its side',()=>{
  // Landscape: the useful area is ~155 px tall and the hero stands in its middle.
  const area:Rect={x:138,y:154,width:570,height:155},hero:Rect={x:395,y:203,width:56,height:56};
  const arrows=layoutEdges([t('up','caido',423,-200,20,{seconds:9}),t('down','aliado',423,900)],area,hero);
  assert.equal(arrows.length,2);
  const half=arrowHalf();
  for(const a of arrows)assert.equal(crosses({x:a.x-half.w,y:a.y-half.h,width:2*half.w,height:2*half.h},hero,HERO_MARGIN),false,a.key);
});

test('a target in plain view gets no arrow; one under the HUD or off the viewport does',()=>{
  const seen={viewport:{x:0,y:0,width:390,height:844},covered:[{x:166,y:8,width:142,height:46}]};
  assert.equal(inView({x:200,y:150},seen),true);
  assert.equal(inView({x:200,y:30},seen),false,'under the round chip');
  assert.equal(inView({x:-20,y:400},seen),false);
  const arrows=layoutEdges([t('top-visible','aliado',200,150),t('under-chip','caido',200,30,8,{seconds:5}),t('off','aliado',600,400)],AREA,undefined,{seen});
  assert.deepEqual(arrows.map(a=>a.key).sort(),['off','under-chip']);
});

test('arrows follow the 4 views: the arrow points where the target is on screen in each view',()=>{
  const hero={x:12,y:17},target={x:3,y:17},viewport={width:390,height:844},zoom=.583;
  const area:Rect={x:70,y:244,width:320,height:440};
  const seenAngles:number[]=[];
  for(let view=0;view<4;view++){
    const center=projectView(hero,view);
    const s=toScreen(projectView(target,view),center,viewport,zoom);
    const [a]=layoutEdges([t('x','aliado',s.x,s.y,9)],area);
    assert.ok(a,`view ${view}`);
    // The beak points at the target, and the minimap dot is in the same screen direction.
    const dir=Math.atan2(s.y-a.y,s.x-a.x);assert.ok(Math.abs(dir-a.angle)<1e-9);
    const m=minimapPoint({x:target.x-hero.x,y:target.y-hero.y},view,20);
    const screenDir=Math.atan2(s.y-viewport.height/2-(center.y*0),s.x-viewport.width/2);
    const fromHero={x:s.x-toScreen(center,center,viewport,zoom).x,y:s.y-toScreen(center,center,viewport,zoom).y};
    // Same quadrant/sign on both axes (the minimap undoes the 2:1 isometric squash only).
    assert.equal(Math.sign(Math.round(m.x*100)),Math.sign(Math.round(fromHero.x)),`x view ${view}`);
    assert.equal(Math.sign(Math.round(m.y*100)),Math.sign(Math.round(fromHero.y)),`y view ${view}`);
    seenAngles.push(Math.round(Math.atan2(fromHero.y,fromHero.x)*100)/100);void screenDir;
  }
  assert.equal(new Set(seenAngles).size,4,'each view puts the target somewhere else on screen');
});

test('the offer window shrinks the useful area and the arrows move inside what is left',()=>{
  const base={viewport:{width:390,height:844},status:[{x:14,y:12,width:44,height:44},{x:166,y:8,width:142,height:46},{x:8,y:72,width:292,height:26}],
    team:{x:8,y:120,width:54,height:380},joystick:{x:24,y:708,width:112,height:112},skill:{x:284,y:738,width:82,height:82}};
  const open=computeZones({...base,offer:{x:70,y:420,width:312,height:250}}),closed=computeZones(base);
  assert.ok(open.useful.height<closed.useful.height);
  const half=arrowHalf();
  for(const a of layoutEdges([t('s','spawn',230,2000),t('w','caido',-500,300,5,{seconds:3})],open.useful)){
    assert.ok(inside({x:a.x-half.w,y:a.y-half.h},open.useful)&&inside({x:a.x+half.w,y:a.y+half.h},open.useful),a.key);
    assert.equal(crosses({x:a.x-half.w+1,y:a.y-half.h+1,width:2*half.w-2,height:2*half.h-2},{x:70,y:420,width:312,height:250}),false,'not on the offer');
  }
});

test('ficha texts and the beak radius',()=>{
  assert.equal(distanceText(12.4),'12 m');assert.equal(distanceText(4321),'999 m');assert.equal(distanceText(-3),'0 m');
  assert.equal(caidoTag({seconds:18}),'18 s');
  // The ping never hides the clock of the most urgent caído (UX onda 6, aresta 2).
  assert.equal(caidoTag({seconds:7,ping:true}),'Me salva: 7 s');assert.equal(caidoTag({ping:true}),'Me salva');
  const half={w:38,h:18};
  assert.equal(beakRadius(0,half),38);assert.equal(beakRadius(Math.PI/2,half),18);assert.ok(beakRadius(Math.PI/4,half)<=Math.hypot(38,18));
  assert.deepEqual(arrowHalf(1.25),{w:42,h:18});
});

test('minimap: centred on the followed hero, turned with the view, far things on the rim',()=>{
  assert.deepEqual(minimapPoint({x:0,y:0},0,20),{x:0,y:0,rim:false});
  // World (-1,-1) is straight up on screen in view 0 (projection.ts).
  const up=minimapPoint({x:-5,y:-5},0,20);assert.ok(Math.abs(up.x)<1e-9&&up.y<0);
  const far=minimapPoint({x:200,y:0},0,20);assert.equal(far.rim,true);assert.ok(Math.hypot(far.x,far.y)<=MINIMAP_RADIUS-4+1e-9);
  // Each view turns the minimap by 90°, as it turns the screen.
  const p0=minimapPoint({x:4,y:-2},0,20),p1=minimapPoint({x:4,y:-2},1,20);
  assert.ok(Math.abs(p0.x*p1.x+p0.y*p1.y)<1e-9);
  assert.equal(islandOutline(12).length,12);assert.ok(MINIMAP_RANGE.ilha[1]>MINIMAP_RANGE.ilha[0]);
});

const player=(id:string,extra:Partial<PlayerRunView>={}):PlayerRunView=>({id,name:`N${id}`,classId:'cidadao-comum',hp:50,maxHp:100,online:true,spectator:false,weapons:[],passives:[],...extra});
test('radar: caído with seconds and ping, base, boss with an imminent telegraph, spawns until they land, chests',()=>{
  const states=new Map<string,PlayerRunView>([['me',player('me')],['b',player('b',{hp:0,downed:{progress:.2,bleedOutTick:400}})],['c',player('c',{eliminated:true})],['d',player('d',{online:false})]]);
  const players=['me','b','c','d','e'].map((id,i)=>({id,name:`N${id}`,classId:'cidadao-comum',x:10+i,y:10,online:id!=='d'}));
  const {targets,items}=radar({selfId:'me',focus:{x:10,y:10},self:{x:10,y:10},tick:200,players,states,base:{x:12,y:12},
    enemies:[{id:'boss',kind:'chefe',x:30,y:30,hp:10,maxHp:10,boss:true},{id:'g',kind:'gosma',x:1,y:1,hp:1,maxHp:1}],
    telegraphs:[{id:'t',shape:'circle',x:31,y:30,radius:2,fireTick:220}],pickups:[{id:'ch',kind:'chest',x:5,y:5,value:1},{id:'xp',kind:'xp',x:5,y:5,value:1}],
    warnings:[{x:40,y:0,atTick:210},{x:0,y:40,atTick:100}],pinged:id=>id==='b',locate:p=>({x:p.x*10,y:p.y*10})});
  const by=(k:string)=>targets.find(x=>x.key===k);
  assert.equal(by('b')?.kind,'caido');assert.equal(by('b')?.seconds,10);assert.equal(by('b')?.ping,true);
  assert.equal(by('c'),undefined,'eliminated: no arrow');assert.equal(by('d'),undefined,'offline and standing: no arrow');
  assert.equal(by('e'),undefined,'an ally on its feet is on the minimap only (design onda 6 D4)');assert.equal(by('me'),undefined);
  assert.equal(items.find(i=>i.key==='e')?.kind,'aliado');
  assert.equal(by('base')?.kind,'base');assert.equal(by('boss')?.danger,true);assert.equal(by('g'),undefined);
  assert.equal(targets.filter(x=>x.kind==='spawn').length,1,'the old warning is gone');
  assert.equal(by('ch'),undefined,'chests: minimap only');assert.equal(items.find(i=>i.key==='ch')?.kind,'bau');assert.equal(by('xp'),undefined);
  assert.ok(Math.abs(by('base')!.distance-Math.hypot(2,2))<1e-9);
  assert.deepEqual(items.find(i=>i.kind==='voce'),{key:'self',kind:'voce',x:10,y:10});
  assert.equal(items.find(i=>i.key==='b')?.ping,true);
  const list=keepWarnings([],[{type:'spawn-warning',x:1,y:2,atTick:50},{type:'damage'}],10);
  assert.equal(list.length,1);keepWarnings(list,[],50+SPAWN_TAIL_TICKS+1);assert.equal(list.length,0);
});

test('rescue helpers: "Segura aí" once per fall while holding in range; the Me salva button only for a caído in a wave',()=>{
  const states=new Map<string,PlayerRunView>([['me',player('me')],['z',player('z',{name:'Zé do Pix',hp:0,downed:{progress:.3,bleedOutTick:400}})]]);
  const said=new Set<string>(),players=[{id:'z',name:'Zé do Pix',x:11,y:10}];
  assert.equal(holdLine({x:10,y:10},states.get('me'),players,states,said)?.line,'Segura aí, Zé!');
  assert.equal(holdLine({x:10,y:10},states.get('me'),players,states,said),undefined,'once per fall');
  assert.equal(holdLine({x:10+REVIVE_RADIUS+1,y:10},states.get('me'),[{id:'z',name:'Zé',x:10,y:10}],states,new Set()),undefined,'out of range');
  assert.deepEqual(sosButton(player('me',{downed:{progress:0,bleedOutTick:9}}),true,1500),{show:true,cooling:true,left:.5});
  assert.equal(sosButton(player('me'),true,0).show,false);
  assert.equal(sosButton(player('me',{downed:{progress:0,bleedOutTick:9}}),false,0).show,false);
});

test('with the world rescue the fall/rescue banners leave the top band; connection, out and watching stay',()=>{
  const view=fakeView('downed',6,1000);
  const self=view.players[0];
  assert.ok(view.players.some(p=>p.downed),'fixture has a caído');
  assert.ok(reviveBanner(view,self.id),'the sandbox keeps its banner');
  assert.equal(reviveBanner(view,self.id,undefined,undefined,undefined,true),undefined);
  assert.equal(reviveBanner(view,self.id,'Reconectando',undefined,undefined,true)?.text,'Reconectando');
  const out={...view,players:view.players.map((p,i)=>i===0?{...p,downed:undefined,eliminated:true}:p)};
  assert.equal(reviveBanner(out,self.id,undefined,undefined,undefined,true)?.text,OUT_TEXT);
});

test('zones: the minimap is part of the top band in portrait and stays out of the field in landscape',()=>{
  const p={viewport:{width:390,height:844},status:[{x:14,y:12,width:44,height:44},{x:166,y:8,width:142,height:46},{x:8,y:72,width:292,height:26}],
    team:{x:8,y:120,width:54,height:380},joystick:{x:24,y:708,width:112,height:112},skill:{x:284,y:738,width:82,height:82}};
  const without=computeZones(p),withMap=computeZones({...p,minimap:{x:306,y:72,width:76,height:76}});
  assert.equal(withMap.announce.y,148+4);assert.ok(withMap.useful.y>without.useful.y);
  assert.equal(crosses(withMap.useful,{x:306,y:72,width:76,height:76}),false);
  const l={viewport:{width:844,height:390},status:[{x:14,y:12,width:44,height:44},{x:330,y:8,width:180,height:40},{x:212,y:52,width:420,height:20}],
    team:{x:258,y:318,width:328,height:64},joystick:{x:18,y:278,width:96,height:96},skill:{x:746,y:292,width:82,height:82}};
  const lw=computeZones({...l,minimap:{x:754,y:64,width:76,height:76}});
  assert.equal(lw.top.height,computeZones(l).top.height,'the landscape band does not grow');
  assert.equal(crosses(lw.useful,{x:754,y:64,width:76,height:76}),false);
});

test('the rescue ring is the real revive range and starts at the top of the screen in every view',()=>{
  for(let view=0;view<4;view++){
    const ring=ringPoints({x:10,y:10},view);
    for(const p of ring)assert.ok(Math.abs(Math.hypot(p.x-10,p.y-10)-REVIVE_RADIUS)<1e-9);
    // Flat ground (the relief only lifts the whole ring): screen y ∝ q.x + q.y, screen x ∝ q.x − q.y.
    const flat=(p:{x:number;y:number})=>{const q=viewPoint(p,view);return {x:q.x-q.y,y:q.x+q.y};};
    const ys=ring.map(p=>flat(p).y),top=Math.min(...ys);
    assert.ok(Math.abs(ys[0]-top)<1e-6,`view ${view}: first point is the highest on screen`);
    // Clockwise on screen: the second point is to the right of the first.
    assert.ok(flat(ring[1]).x>flat(ring[0]).x);
  }
  const ring=ringPoints({x:0,y:0},0);
  assert.deepEqual(progressPoints(ring,0),[]);assert.equal(progressPoints(ring,1).length,ring.length);
  assert.equal(progressPoints(ring,.001).length,2);assert.equal(progressPoints(ring,NaN).length,0);
});

test('code review onda 6: the tag row is kept inside the area, and targets past the limit join a "+N"',()=>{
  const half=arrowHalf();
  // A caído straight up: the ficha sits TAG_ROOM lower, so its tag (15 px above it) stays inside the useful area.
  const [up]=layoutEdges([t('up','caido',230,-500,20,{seconds:9})],AREA);
  assert.ok(up.y-half.h-15>=AREA.y,'tag inside the area');
  // Nine caídos all around: six arrows, and the three left over are counted on them, none lost.
  const ring=Array.from({length:9},(_,i)=>{const a=i/9*Math.PI*2;return t(`c${i}`,'caido',230+Math.cos(a)*900,464+Math.sin(a)*900,10+i,{seconds:20});});
  const arrows=layoutEdges(ring,AREA);
  assert.equal(arrows.length,MAX_ARROWS);assert.equal(arrows.reduce((n,a)=>n+a.count,0),9);
});
test('the hero keep-out counts the caído tag ("Me salva: 24 s" is wider than the ficha)',()=>{
  const area:Rect={x:138,y:154,width:570,height:155},hero:Rect={x:395,y:215,width:56,height:56},half=arrowHalf();
  const [a]=layoutEdges([t('up','caido',423,-300,10,{seconds:24,ping:true})],area,hero);
  assert.ok(a);const w=Math.max(2*half.w,tagWidth('Me salva: 24 s'));
  const tag={x:a.x-half.w-4,y:a.y-half.h-16,width:w,height:16};
  assert.equal(crosses(tag,hero,HERO_MARGIN),false);
});
test('a caído arrow with a wide tag finds a clear corner when its side is blocked by the hero',()=>{
  // Portrait with the intermission window: the field above it is ~190 px tall, the hero in its middle.
  const area:Rect={x:70,y:244,width:320,height:190},hero:Rect={x:202,y:300,width:56,height:56};
  const arrows=layoutEdges([t('down','caido',230,900,9,{seconds:27,ping:true})],area,hero);
  assert.equal(arrows.length,1,'never dropped');
  const half=arrowHalf(),a=arrows[0];
  assert.equal(crosses({x:a.x-half.w,y:a.y-half.h,width:2*half.w,height:2*half.h},hero,HERO_MARGIN),false);
  assert.ok(a.angle>0,'the beak still points down, at the caído');
  // Squeezed: the clock stays, the word goes (the ficha keeps the ping ring).
  assert.equal(caidoTag(a),a.compact?'27 s':'Me salva: 27 s');
});
