/**
 * Build menu (torres-hud): the window's layout (fits without scroll in both orientations at 100 % and 125 %, clear of
 * the thumbs and the hero, inside the safe area), the ground markers, and the tree's logic (affordability, evolve arrow,
 * branch limits: 12 per team and 1 Gustavão, the rail requirement).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditBoxes,bottom,crosses,gap,right,HERO_MARGIN,THUMB_GAP,type AuditBox,type Rect,type ZoneInput} from '../../src/client/hud/zones.ts';
import {OBRA_BUTTON,OBRA_TARGET,cardHeight,layoutObra,markerRect} from '../../src/client/hud/towers/layout.ts';
import {blockText,canEvolve,defaultPick,railTree,selectable,treeFor,type ObraSite,type ObraView} from '../../src/client/hud/towers/model.ts';
import {DEFENSE_LIMIT,DEFENSES,GUSTAVAO_LIMIT,RAIL} from '../../src/rules/index.ts';
import * as simCatalog from '../../src/sim/towers/catalog.ts';

// The live layout (hud-topo-uma-linha): the camera buttons and the gear 48 px at 12 px, the one-row band (--rh-t + 40)
// between them, the minimap where hud.css puts it (portrait: under the gear, part of the band; landscape: the right edge
// column at --rh-t + 52). The announcement slot (zones `announce`) is right under the band, and `top` ends under it.
const LANDSCAPE:ZoneInput={viewport:{width:844,height:390},
  status:[{x:14,y:12,width:48,height:48},{x:68,y:12,width:48,height:48},{x:160,y:8,width:616,height:40},{x:782,y:12,width:48,height:48}],
  team:{x:258,y:318,width:328,height:64},joystick:{x:18,y:278,width:96,height:96},skill:{x:746,y:292,width:82,height:82},minimap:{x:754,y:60,width:76,height:76}};
const PORTRAIT:ZoneInput={viewport:{width:390,height:844},
  status:[{x:14,y:12,width:48,height:48},{x:68,y:12,width:48,height:48},{x:166,y:8,width:142,height:40},{x:8,y:56,width:292,height:26},{x:328,y:18,width:48,height:48}],
  team:{x:8,y:120,width:54,height:380},joystick:{x:24,y:708,width:112,height:112},skill:{x:284,y:738,width:82,height:82},minimap:{x:306,y:72,width:76,height:76}};
const NOTCH:ZoneInput={...LANDSCAPE,safe:{top:0,right:44,bottom:21,left:44},
  status:[{x:44,y:12,width:48,height:48},{x:98,y:12,width:48,height:48},{x:196,y:8,width:544,height:40},{x:752,y:12,width:48,height:48}],
  team:{x:258,y:305,width:328,height:64},joystick:{x:62,y:257,width:96,height:96},skill:{x:702,y:271,width:82,height:82},minimap:{x:724,y:60,width:76,height:76}};
const PORTRAIT_NOTCH:ZoneInput={...PORTRAIT,safe:{top:47,right:0,bottom:34,left:0},
  status:[{x:14,y:47,width:48,height:48},{x:68,y:47,width:48,height:48},{x:166,y:47,width:142,height:40},{x:8,y:91,width:292,height:26},{x:324,y:47,width:48,height:48}],
  team:{x:8,y:159,width:54,height:380},joystick:{x:24,y:698,width:112,height:112},skill:{x:284,y:728,width:82,height:82},minimap:{x:306,y:111,width:76,height:76}};
// The sandbox's band (two rows, no minimap): a taller top still leaves the window room.
const TWO_ROWS:ZoneInput={viewport:{width:844,height:390},status:[{x:14,y:12,width:44,height:44},{x:330,y:8,width:180,height:40},{x:212,y:52,width:420,height:20}],
  team:{x:258,y:318,width:328,height:64},joystick:{x:18,y:278,width:96,height:96},skill:{x:746,y:292,width:82,height:82}};
const inside=(r:Rect,o:Rect)=>r.x>=o.x-.5&&r.y>=o.y-.5&&right(r)<=right(o)+.5&&bottom(r)<=bottom(o)+.5;

for(const [name,input] of [['retrato',PORTRAIT],['retrato com notch',PORTRAIT_NOTCH],['paisagem',LANDSCAPE],['paisagem com notch',NOTCH],['paisagem, faixa de 2 linhas',TWO_ROWS]] as const)for(const scale of [1,1.25])for(const n of [0,1,2,3]){
  test(`obra window fits with no scroll: ${name}, ${scale*100}% text, ${n} branches`,()=>{
    const L=layoutObra(input,scale,n);
    assert.ok(L.fits,'the window fits under the top band and leaves the hero a field');
    // BUG-20261013-E4-obra-janela-sob-anuncio-paisagem: "Bichos chegando" (the announcement slot) and the minimap stay
    // off the window: it starts under zones.top (status rows + announcement slot) and keeps clear of the minimap.
    assert.ok(!crosses(L.panel,L.zones.top)&&!crosses(L.panel,L.zones.announce)&&L.panel.y>=bottom(L.zones.announce),'under the announcement slot');
    if(input.minimap)assert.ok(!crosses(L.panel,input.minimap,4),'clear of the minimap');
    assert.equal(L.contentHeight,L.panel.height,'content = window height: no scroll');
    const vw=input.viewport,s=input.safe??{top:0,right:0,bottom:0,left:0};
    assert.ok(inside(L.panel,{x:Math.max(8,s.left),y:0,width:vw.width-Math.max(8,s.left)-Math.max(8,s.right),height:vw.height-Math.max(8,s.bottom)}),'inside the safe area');
    for(const r of [L.head,...L.branches,L.confirm,L.close])assert.ok(inside(r,L.panel),'every box inside the window');
    assert.equal(L.branches.length,n);
    for(const r of [L.head,...L.branches])assert.ok(r.height>=OBRA_TARGET&&r.height>=cardHeight(scale),'cards ≥ 44 px and as tall as their text');
    assert.ok(L.confirm.height>=48&&L.close.height>=48&&L.close.width>=48,'confirm and close ≥ 48 px');
    const boxes=[L.head,...L.branches,L.confirm,L.close];
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(!crosses(boxes[i],boxes[j]),'no two boxes overlap');
    // Thumbs: every target ≥ 24 px from the joystick and the skill button; the hero (± 40) in the field beside the window.
    for(const thumb of [input.joystick!,input.skill!])for(const r of [L.panel,...boxes])assert.ok(gap(r,thumb)>=THUMB_GAP,`≥ ${THUMB_GAP} px from a thumb`);
    assert.ok(!crosses(L.panel,L.hero,HERO_MARGIN),'never over the hero ± 40');
    const audit:AuditBox[]=[
      {name:'janela',rect:L.panel,allowedInPlay:true,overHeroFails:true},
      ...boxes.map((rect,i)=>({name:`alvo-${i}`,rect,target:true,allowedInPlay:true,overHeroFails:true})),
      {name:'joystick',rect:input.joystick!,thumb:true,target:true},{name:'skill',rect:input.skill!,thumb:true,target:true},
    ];
    const a=auditBoxes(audit,L.zones,L.hero);
    assert.deepEqual([a.heroCrossed,a.thumbGaps,a.inPlay,a.escaped],[[],[],[],[]]);
    assert.ok(L.confirm.height===OBRA_BUTTON);
  });
}

test('the window sits where the thumb reaches: bottom of the column in portrait, right side in landscape',()=>{
  const p=layoutObra(PORTRAIT,1,3);
  assert.equal(p.form,'coluna');
  assert.equal(bottom(p.panel),PORTRAIT.joystick!.y-THUMB_GAP,'portrait: right above the joystick zone');
  assert.ok(bottom(p.confirm)>bottom(p.branches[2]),'the confirm row is the lowest');
  // Landscape at 100 %: two columns are too tall for the room over the right thumb (the announcement slot is above it):
  // left of the thumb, down to the team row, still on the right half.
  const l=layoutObra(LANDSCAPE,1,3),thumb=l.zones.rightThumb!;
  assert.equal(l.form,'duas');
  assert.ok(l.panel.x>LANDSCAPE.viewport.width/3&&right(l.panel)<=thumb.x&&bottom(l.panel)<=LANDSCAPE.team!.y-8);
  assert.ok(l.confirm.x<l.branches[0].x,'landscape: confirm under the head, branches in the right column');
  // At 125 % neither place holds two columns: the compact form, right-aligned above the thumb, branches side by side.
  const c=layoutObra(LANDSCAPE,1.25,3);
  assert.equal(c.form,'compacta');
  assert.ok(c.panel.x>LANDSCAPE.viewport.width/3&&bottom(c.panel)<=LANDSCAPE.skill!.y-THUMB_GAP);
  assert.ok(c.branches.every(b=>b.y===c.branches[0].y)&&c.branches[0].y>=bottom(c.head),'one row of branches under the head row');
  assert.ok(c.head.y===c.confirm.y&&c.close.x>right(c.head),'head, close and confirm in one row');
});

test('portrait with a notch: one column leaves the hero no field under the announcement slot, so the branches go two by two',()=>{
  // A top band as tall as the old one with the minimap in it (the WC3 minimap now floats, minimapa-wc3): the tight case.
  const TALL:ZoneInput={...PORTRAIT_NOTCH,status:[...PORTRAIT_NOTCH.status,{x:306,y:111,width:76,height:76}]};
  assert.equal(layoutObra(PORTRAIT_NOTCH,1,3).form,'coluna','the floating minimap leaves room for one column');
  for(const scale of [1,1.25]){
    const L=layoutObra(TALL,scale,3),[a,b,c]=L.branches;
    assert.equal(L.form,'compacta');
    assert.ok(a.y===b.y&&b.x>right(a)&&c.y>bottom(a)&&c.x===a.x,'two per row');
    assert.ok(L.zones.useful.height>=136&&L.zones.useful.y>=bottom(L.zones.announce),'the field between the slot and the window');
    assert.ok(bottom(L.confirm)>bottom(c),'the confirm row stays the lowest');
  }
  assert.equal(layoutObra(PORTRAIT,1.25,3).form,'coluna','no notch: one column');
});

test('landscape: the old placement ran into the announcement slot and the minimap (BUG-20261013-E4-obra-janela-sob-anuncio-paisagem)',()=>{
  // Where the window used to go at 100 %: right-aligned above the right thumb, three cards tall, under the status rows only.
  const L=layoutObra(LANDSCAPE,1,3),old={x:844-8-520,y:LANDSCAPE.skill!.y-THUMB_GAP-L.contentHeight,width:520,height:L.contentHeight};
  assert.ok(crosses(old,L.zones.announce)&&crosses(old,LANDSCAPE.minimap!),'the overlap Executor-3 saw');
  assert.ok(!crosses(L.panel,L.zones.announce)&&!crosses(L.panel,LANDSCAPE.minimap!,4));
});

test('ground markers: 48 px targets at their screen points, clamped into the useful field',()=>{
  const L=layoutObra(PORTRAIT,1,0),u=L.zones.useful;
  const mid=markerRect({x:u.x+100,y:u.y+100},u);
  assert.deepEqual([mid.x+24,mid.y+24,mid.width,mid.clamped],[u.x+100,u.y+100,48,false]);
  for(const p of [{x:-50,y:-50},{x:9999,y:9999},{x:u.x,y:bottom(u)+300}]){
    const r=markerRect(p,u);
    assert.ok(r.clamped&&inside(r,u),'clamped inside');
    for(const thumb of [PORTRAIT.joystick!,PORTRAIT.skill!])assert.ok(gap(r,thumb)>=THUMB_GAP,'never on a thumb');
  }
});

const site=(over:Partial<ObraSite>={}):ObraSite=>({id:'obra-01',x:100,y:100,maxSize:3,...over});
const view=(over:Partial<ObraView>={}):ObraView=>({prepare:true,sites:[],balance:{coco:10,pedra:10},standing:0,gustavoes:0,...over});

test('empty site: the Vigia is the head to build, its 3 branches wait for it (shape + text)',()=>{
  const t=treeFor(site(),view());
  assert.equal(t.head.key,'vigia-do-predio');assert.ok(selectable(t.head));
  assert.deepEqual(t.head.action,{type:'build',site:'obra-01'});
  assert.deepEqual(t.branches.map(b=>[b.branch,b.block]),[['A','root'],['B','root'],['C','root']]);
  assert.equal(blockText(t.branches[0]),'Vigia antes');
  assert.equal(defaultPick(t),'vigia-do-predio');
});

test('affordability: a branch the team cannot pay is blocked with how much is missing',()=>{
  const s=site({tower:{id:'d1',kind:'vigia-do-predio'}});
  const poor=treeFor(s,view({balance:{coco:4,pedra:3}}));
  assert.deepEqual(poor.branches.map(b=>[b.block,b.missing]),[['balance',3],['balance',3],['balance',3]]);
  assert.equal(blockText(poor.branches[0]),'Falta 3');
  assert.equal(defaultPick(poor),undefined,'nothing to confirm');
  const rich=treeFor(s,view());
  assert.ok(rich.branches.every(selectable));
  assert.deepEqual(rich.branches.map(b=>b.action),['A2','B2','C2'].map(branch=>({type:'upgrade',defense:'d1',branch})));
  assert.equal(treeFor(site(),view({balance:{coco:3,pedra:2}})).head.block,'balance','the Vigia too');
});

test('evolve arrow: only on a ready tower with an open, affordable child',()=>{
  const v=view();
  assert.equal(canEvolve(site({tower:{id:'d',kind:'vigia-do-predio'}}),v),true);
  assert.equal(canEvolve(site({tower:{id:'d',kind:'vigia-do-predio',building:true}}),v),false,'not while in obra');
  assert.equal(canEvolve(site({tower:{id:'d',kind:'vigia-do-predio',ruined:true}}),v),false,'not a ruin');
  assert.equal(canEvolve(site(),v),false,'not an empty site');
  assert.equal(canEvolve(site({tower:{id:'d',kind:'vigia-do-predio'}}),view({balance:{coco:5,pedra:4}})),false,'not without material');
  assert.equal(canEvolve(site({tower:{id:'d',kind:'posto-de-radar'}}),v),false,'not at the top of a line');
  assert.equal(canEvolve(site({tower:{id:'d',kind:'atiradores-do-telhado'}}),view({balance:{coco:12,pedra:12}})),true,'A3 → A4/A4b at 24');
  assert.equal(canEvolve(site({tower:{id:'d',kind:'atiradores-do-telhado'}}),view({balance:{coco:12,pedra:11}})),false);
  // Building: the tree shows the branches blocked "Em obra".
  const b=treeFor(site({tower:{id:'d',kind:'vigia-do-predio',building:true}}),v);
  assert.equal(b.head.status,'obra');assert.ok(b.branches.every(x=>x.block==='building'));
});

test('site size: a 1×1 site keeps the Vigia, refuses A2 (2×2) and offers B2 and C2',()=>{
  const t=treeFor(site({maxSize:1,tower:{id:'d',kind:'vigia-do-predio'}}),view());
  assert.deepEqual(t.branches.map(b=>[b.label,b.block??'ok']),[['A2','size'],['B2','ok'],['C2','ok']]);
  assert.equal(blockText(t.branches[0]),'Não cabe');
  assert.ok(selectable(treeFor(site({maxSize:1}),view()).head),'the root takes size 1');
});

test(`team limit: ${DEFENSE_LIMIT} standing defenses; evolving never counts against it`,()=>{
  const full=view({standing:DEFENSE_LIMIT,balance:{coco:99,pedra:99}});
  const t=treeFor(site(),full);
  assert.equal(t.head.block,'limit');assert.equal(blockText(t.head),'Limite 12');
  assert.ok(!selectable(t.head));
  assert.ok(treeFor(site({tower:{id:'d',kind:'vigia-do-predio'}}),full).branches.every(selectable),'upgrades still open');
  assert.ok(selectable(treeFor(site(),view({standing:DEFENSE_LIMIT-1})).head));
  assert.equal(treeFor(site({tower:{id:'r',kind:'morteiro',ruined:true}}),full).head.block,'limit','a ruin is a site to build again');
});

test(`the Gustavão: needs the finished rail, ${GUSTAVAO_LIMIT} per run`,()=>{
  const obus=site({tower:{id:'o',kind:'obuseiro'}}),rich={coco:40,pedra:40};
  const noRail=treeFor(obus,view({balance:rich}));
  assert.deepEqual(noRail.branches.map(b=>[b.key,b.block]),[['gustavao','rail']]);
  assert.equal(blockText(noRail.branches[0]),'Sem trilho');
  assert.equal(canEvolve(obus,view({balance:rich})),false);
  assert.equal(treeFor(obus,view({balance:rich,rail:{x:0,y:0,laid:true,ready:false}})).branches[0].block,'rail','a rail still in obra');
  const ready={x:0,y:0,laid:true,ready:true};
  const open=treeFor(obus,view({balance:rich,rail:ready}));
  assert.ok(selectable(open.branches[0]));assert.deepEqual(open.branches[0].action,{type:'upgrade',defense:'o',branch:'B6'});
  assert.equal(canEvolve(obus,view({balance:rich,rail:ready})),true);
  const second=treeFor(obus,view({balance:rich,rail:ready,gustavoes:1}));
  assert.equal(second.branches[0].block,'unique');assert.equal(blockText(second.branches[0]),'Já tem 1');
  assert.equal(treeFor(obus,view({balance:{coco:20,pedra:20},rail:ready})).branches[0].missing,20,'60 units');
});

test('the rail: laid once for 12, its tree shows the Gustavão it unlocks',()=>{
  const t=railTree(view({rail:{x:0,y:0,laid:false,ready:false}}));
  assert.equal(t.head.cost,RAIL.cost);assert.deepEqual(t.head.action,{type:'build',site:'trilho'});
  assert.equal(t.branches[0].key,'gustavao');assert.equal(blockText(t.branches[0]),'Do Obuseiro');
  assert.equal(railTree(view({balance:{coco:5,pedra:5},rail:{x:0,y:0,laid:false,ready:false}})).head.block,'balance');
  const laid=railTree(view({rail:{x:0,y:0,laid:true,ready:false}}));
  assert.equal(laid.head.status,'obra');assert.ok(!selectable(laid.head));
  assert.equal(railTree(view({gustavoes:1,rail:{x:0,y:0,laid:true,ready:true}})).branches[0].block,'unique');
});

test('A3 forks: both A4 and A4b offered, main line first; one-line effects stay short',()=>{
  const t=treeFor(site({tower:{id:'a',kind:'atiradores-do-telhado'}}),view({balance:{coco:20,pedra:20}}));
  assert.deepEqual(t.branches.map(b=>b.label),['A4','A4b']);
  for(const d of Object.values(DEFENSES))assert.ok(treeFor(site({tower:{id:'x',kind:d.id}}),view()).head.effect.length<=24,`${d.id}: 1 short line`);
});

test('the catalog moved to the rules port and the sim re-exports the same objects',()=>{
  assert.equal(simCatalog.DEFENSES,DEFENSES);
  assert.equal(simCatalog.DEFENSES['vigia-do-predio'].size,1);
});

test('obra window open (intermission): the follow camera frames the hero beside it, never under it; closed, back to the viewport centre',async()=>{
  // BUG-20261013-ORQ-camera-centro-heroi: in the round the hero is at the viewport centre, which the window would cover
  // (landscape: the panel spans the middle); while it is open the camera centres the hero in the useful area it leaves.
  const {FollowCamera,followZoom,framesBeside,toScreen}=await import('../../src/client/framing.ts');
  const {ZOOM_MIN}=await import('../../src/client/camera-zoom.ts');
  assert.equal(framesBeside('combat','prepare',true),true);
  assert.equal(framesBeside('combat','prepare',false),false,'closed: the centre');
  assert.equal(framesBeside('combat','wave',true),false,'a wave never frames beside');
  assert.equal(framesBeside('lobby',undefined,false),true);assert.equal(framesBeside('countdown',undefined,false),true);
  assert.equal(framesBeside('result','wave',false),false);assert.equal(framesBeside(undefined,undefined,false),false,'solo');
  for(const input of [LANDSCAPE,PORTRAIT,NOTCH,PORTRAIT_NOTCH])for(const scale of [1,1.25])for(const branches of [0,3])for(const k of [ZOOM_MIN,1]){
    const l=layoutObra(input,scale,branches),vp=input.viewport,z=followZoom(vp,k),px=96*z,size={width:px,height:px},heroAt={x:4321.5,y:-987.25};
    const cam=new FollowCamera();cam.free=true;cam.beside=framesBeside('combat','prepare',true);
    const box=()=>{const f=toScreen(heroAt,cam.center,vp,z);return {x:f.x-px/2,y:f.y-px,width:px,height:px};};
    cam.snap(heroAt,vp,z,l.zones.useful,size);
    const label=`${vp.width}×${vp.height} ${scale} ${branches} k ${k.toFixed(3)}: hero ${JSON.stringify(box())} panel ${JSON.stringify(l.panel)}`;
    assert.equal(crosses(box(),l.panel,0),false,label);
    if(l.fits)assert.equal(crosses(box(),l.panel,HERO_MARGIN),false,`± ${HERO_MARGIN}: ${label}`);
    // Closed: the camera eases back to the viewport centre.
    cam.beside=framesBeside('combat','prepare',false);
    for(let i=0;i<60;i++)cam.step(heroAt,1/60,vp,z,l.zones.useful,size);
    const b=box();assert.ok(Math.abs(b.x+px/2-vp.width/2)<.01&&Math.abs(b.y+px/2-vp.height/2)<.01,`closed: ${label}`);
  }
});
