/**
 * NEW-20261011-UX-janela-esconde-caido (+ the arrow/minimap part of DSG-polimento-onda6): with the forge, the offer or
 * the kill-cam open, the caído's and the boss's arrows stay on screen, beside the window, never on the hero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutEdges,arrowHalf,pointedTargets,caidoTag,tagWidth,MUST_POINT,HEAD_ROOM,TAG_ROOM,NAME_ROOM,RIM_PAD,type EdgeTarget,type EdgeArrow} from '../../src/client/hud/edges.ts';
import {fallLine} from '../../src/client/hud/model.ts';
import {computeZones,auditBoxes,crosses,gap,HERO_MARGIN,type Rect,type ZoneInput} from '../../src/client/hud/zones.ts';
import {radar} from '../../src/client/hud/radar.ts';

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

// ---------- review round (code, design, UX) ----------
test('a caído\'s "+N" counts only caídos: spawn, base, ally and chest never join it, the boss never does', async ()=>{
  const area:Rect={x:100,y:150,width:360,height:160},hero={x:140,y:202,width:56,height:56};
  const same=(key:string,kind:EdgeTarget['kind'],extra:Partial<EdgeTarget>={})=>t(key,kind,2000,210,extra);
  const arrows=layoutEdges([same('c','caido',{seconds:6,label:'Zé'}),same('s','spawn'),same('b','base'),same('a','aliado'),same('k','bau'),same('boss','chefe')],area,hero);
  const caido=arrows.find(a=>a.kind==='caido')!;
  assert.equal(caido.count,1,'nothing of another kind inside the caído');
  assert.ok(arrows.some(a=>a.kind==='chefe'),'the boss keeps its own arrow');
  for(const a of arrows)if(a.count>1)assert.ok(arrows.filter(b=>b.kind===a.kind).length>=1);
  // Two caídos and nothing else fits: the second one is the "+1" of the first.
  const two=layoutEdges([same('c1','caido',{seconds:6}),same('c2','caido',{seconds:9})],{x:100,y:150,width:110,height:90},undefined,{max:1});
  assert.equal(two.length,1);assert.equal(two[0].count,2);assert.equal(two[0].key,'c1');
});

test('the tag reserve follows the real "+N": a merged caído\'s tag ("Me salva: 16 s +1") and its name never enter the hero\'s margin',()=>{
  let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const half=arrowHalf();let merged=0;
  for(let i=0;i<400;i++){
    // A short landscape field beside a window, the hero somewhere in it, 2 to 4 caídos off to one side.
    const area:Rect={x:138,y:154,width:300+rnd()*120,height:150+rnd()*10};
    const hero:Rect={x:area.x+60+rnd()*(area.width-176),y:area.y+area.height/2-28+(rnd()-.5)*20,width:56,height:56};
    const n=2+Math.floor(rnd()*3),dir=rnd()*Math.PI*2,list:EdgeTarget[]=[];
    for(let k=0;k<n;k++)list.push(t(`c${k}`,'caido',hero.x+Math.cos(dir+(rnd()-.5)*.05)*900,hero.y+Math.sin(dir+(rnd()-.5)*.05)*900,{seconds:10+k,label:['Zé','Concursei','Wagner','Tia'][k],ping:k===0}));
    for(const a of layoutEdges(list,area,hero,{max:2})){
      if(a.count>1)merged++;
      const text=caidoTag(a)+(a.count>1?` +${a.count-1}`:''),w=Math.max(2*half.w,tagWidth(text));
      const left=a.tagEnd==='right'?a.x+half.w+4-w:a.x-half.w-4,box={x:left,y:a.y-half.h-TAG_ROOM,width:w+4,height:2*half.h+TAG_ROOM+(a.label?NAME_ROOM:0)};
      assert.equal(crosses(box,hero,HERO_MARGIN),false,`case ${i}: "${text}" at ${Math.round(a.x)},${Math.round(a.y)}`);
    }
  }
  assert.ok(merged>20,`merges exercised (${merged})`);
});

test('caído: the first name rides under the ficha (never wider than it), the tag keeps the clock and the ping',()=>{
  assert.equal(caidoTag({seconds:30}),'30 s');assert.equal(caidoTag({seconds:16,ping:true}),'Me salva: 16 s');
  const {targets}=radar({selfId:'me',focus:{x:0,y:0},tick:0,locate:p=>({x:p.x*50,y:p.y*50}),
    players:[{id:'cz',name:'Concurseira Eterna',classId:'cidadao-comum',x:30,y:0,online:true}],
    states:new Map([['cz',{id:'cz',name:'Concurseira Eterna',classId:'cidadao-comum',hp:0,maxHp:100,online:true,spectator:false,downed:{progress:0,bleedOutTick:600},weapons:[],passives:[]} as never]])});
  const c=targets.find(x=>x.kind==='caido')!;assert.equal(c.label,'Concursei');
  // Londrina 13 px: 9 letters stay inside the ficha (76 px at 100%), so the name never needs side room.
  assert.ok(9*13*.46+10<=2*arrowHalf().w);
  // The name's room stays inside the field: an arrow on the bottom rim keeps NAME_ROOM under its ficha.
  const area:Rect={x:0,y:0,width:400,height:300};
  const [a]=layoutEdges([{...c,screen:{x:200,y:5000}}],area);
  assert.ok(a.y+arrowHalf().h+NAME_ROOM<=area.height-RIM_PAD+.5,`${a.y}`);
  const [b]=layoutEdges([{...c,label:undefined,screen:{x:200,y:5000}}],area);
  assert.ok(b.y>a.y,'unnamed arrows keep the old rim');
});

test('behind a window: the arrow sits on the field\'s edge right beside it, level with the caído, beak into the window',()=>{
  const forge=FORGE.landscape,zones=computeZones({...LANDSCAPE,offer:forge}),u=zones.useful,hero=heroIn(u);
  const behind={x:forge.x+60,y:forge.y+forge.height-30};
  const [a]=layoutEdges([t('c','caido',behind.x,behind.y,{seconds:9,label:'Zé'})],u,hero,{seen:{viewport:{x:0,y:0,width:844,height:390},covered:[forge]},windows:[forge]});
  assert.ok(a);const half=arrowHalf();
  assert.ok(Math.abs(forge.x-(a.x+half.w)-8)<=1,`8 px from the window (${forge.x-(a.x+half.w)})`);
  assert.ok(Math.abs(a.y-behind.y)<1,'level with the caído');
  assert.ok(Math.abs(a.angle)<1e-9,'beak straight into the window');
});

test('COVERING (game and arrows sandbox) counts the open windows; the sandbox reads the same list',async ()=>{
  const {COVERING,WINDOWS}=await import('../../src/client/hud/edges.ts');
  for(const sel of ['.rh-offer:not([hidden])','.rh-forge:not([hidden])','.rh-camp','.rh-stack>:not([hidden])','.rh-minimap'])assert.ok(COVERING.split(',').includes(sel),sel);
  // minimapa-wc3: the WC3 minimap floats over a corner of the field, so the arrows keep clear of it as of a window.
  assert.deepEqual(WINDOWS.split(','),['.rh-offer:not([hidden])','.rh-forge:not([hidden])','.rh-cida:not([hidden])','.rh-minimap','.rh-fort-puxar:not([hidden])','.rh-fort-construir:not([hidden])','.rh-fort-bandeja:not([hidden])'],'offer, forge, the Dona Cida tray (D-047), the floating minimap and the D-052 build buttons and tray');
  const {readFileSync}=await import('node:fs');
  const sandbox=readFileSync(new URL('../../src/client/sandboxes/sandbox-hud.ts',import.meta.url),'utf8'),rescue=readFileSync(new URL('../../src/client/hud/rescue.ts',import.meta.url),'utf8');
  assert.match(sandbox,/\$\{COVERING\}/);assert.match(rescue,/boxes\(hud\.el\.ownerDocument,COVERING\)/);
});

test('zones audit: in landscape the minimap sits in an edge column, never over the field',()=>{
  const zones=computeZones(LANDSCAPE);
  const at=(x:number)=>auditBoxes([{name:'minimapa',rect:{x,y:84,width:76,height:76},edgeColumn:true}],zones).offColumn;
  assert.deepEqual(at(14),[]);assert.deepEqual(at(754),[]);assert.deepEqual(at(400),['minimapa']);
  assert.deepEqual(auditBoxes([{name:'minimapa',rect:{x:150,y:84,width:76,height:76},edgeColumn:true}],computeZones(PORTRAIT)).offColumn,[],'portrait: the top band rule');
});

test('window header: the most urgent caído (not you), first name and live seconds',()=>{
  const p=(id:string,name:string,extra:object={})=>({id,name,downed:undefined,eliminated:false,spectator:false,...extra}) as never;
  const view={tick:100,players:[p('me','Maria',{downed:{progress:0,bleedOutTick:120}}),p('z','Zé do Pix',{downed:{progress:0,bleedOutTick:100+20*27}}),
    p('c','Concurseira',{downed:{progress:0,bleedOutTick:100+20*30}}),p('w','Wagner',{downed:{progress:0,bleedOutTick:101},eliminated:true})]};
  assert.equal(fallLine(view,'me'),'Zé caiu, 27 s. Dá pra andar.');
  assert.equal(fallLine({tick:0,players:[]},'me'),'');
});

test('portrait, window open: the follow camera keeps the hero at the viewport centre, ≥ 40 px from the offer windows',async ()=>{
  // BUG-20261013-ORQ-camera-centro-heroi: the camera no longer moves the hero beside the window. The offer windows as
  // the HUD sandbox draws them on 390×844 (state=offer-round, offer-heal, offer-open; 100%) sit under the centred hero.
  const {FollowCamera,followZoom,toScreen}=await import('../../src/client/framing.ts');
  const {ZOOM_MIN}=await import('../../src/client/camera-zoom.ts');
  const viewport=PORTRAIT.viewport,heroAt={x:1234.5,y:-678.25};
  const box=(k:number,offer?:Rect)=>{
    const z=followZoom(viewport,k),px=96*z,cam=new FollowCamera(),useful=computeZones({...PORTRAIT,minimap:{x:306,y:72,width:76,height:76},offer}).useful;
    const feet=toScreen(heroAt,cam.snap(heroAt,viewport,z,useful,{width:px,height:px}),viewport,z);
    return {x:feet.x-px/2,y:feet.y-px,width:px,height:px};
  };
  for(const offer of [{x:70,y:574,width:312,height:110},{x:181,y:552,width:201,height:132},{x:130,y:607,width:252,height:77}])for(const k of [ZOOM_MIN,1]){
    const hero=box(k,offer);
    assert.ok(Math.abs(hero.x+hero.width/2-195)<1e-6&&Math.abs(hero.y+hero.height/2-422)<1e-6,'body at the viewport centre');
    assert.equal(crosses(hero,offer,HERO_MARGIN),false,`window at ${offer.y}: hero ${hero.y}..${hero.y+hero.height}`);
  }
  // Accepted and reported on the card: the forge (state=camp-forge, 247 px tall above the thumbs) cannot clear a centred
  // hero on 390×844; it covers the lowest ≤ 13 px of the hero's box (its feet), never its body.
  const forge={x:70,y:437,width:312,height:247},near=box(1,forge);
  assert.ok(near.y+near.height-forge.y<=13+1e-6&&forge.y>near.y+near.height/2,`forge over ${near.y+near.height-forge.y} px`);
});

test('zones audit: the "Gira no intervalo" balloon never sits on the minimap (the XP bar is its old neighbour)',()=>{
  const zones=computeZones(LANDSCAPE),mm={x:14,y:84,width:76,height:76};
  const over=auditBoxes([{name:'minimapa',rect:mm,topReadout:true,edgeColumn:true},{name:'dica-girar',rect:{x:14,y:68,width:126,height:28},balloon:true}],zones);
  assert.deepEqual(over.topCrossed,['dica-girar×minimapa']);
  const under=auditBoxes([{name:'minimapa',rect:mm,topReadout:true,edgeColumn:true},{name:'dica-girar',rect:{x:14,y:168,width:70,height:42},balloon:true}],zones);
  assert.deepEqual(under.topCrossed,[]);
});
