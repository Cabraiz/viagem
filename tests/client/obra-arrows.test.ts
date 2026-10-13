/**
 * Build sites seen from the base (card NEW-20261013-E4-obras-visiveis-da-base): standing at the camp in the intermission
 * the camera showed none of the 16 sites, only a "+17 obras" etiqueta that pointed nowhere, took no tap and sat under the
 * base's "17 m" ficha in landscape. Now the 1–3 nearest off-screen sites get edge arrows (kind 'obra', with the distance),
 * laid out by layoutEdges around the arrows already drawn (EdgeOptions.placed), and a tap opens the site's tree.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OBRA_ARROWS,OBRA_ARROW_TRIES,OBRA_HERO_MARGIN,nearestHidden,obraArrows,planMarkers,type ObraPoint} from '../../src/client/hud/towers/layout.ts';
import {RAIL_SITE_ID,treeToOpen,type ObraView} from '../../src/client/hud/towers/model.ts';
import {arrowHalf,layoutEdges,EDGE_PRIORITY,TAG_ROOM,type EdgeArrow,type EdgeTarget} from '../../src/client/hud/edges.ts';
import {layoutCityEdges,type CityEdgeTarget} from '../../src/client/hud/city/edges.ts';
import {computeZones,crosses,type Rect,type ZoneInput} from '../../src/client/hud/zones.ts';
import {obraViewFrom} from '../../src/client/hud/towers/wiring.ts';
import type {BuildPlan} from '../../src/maps/index.ts';
import type {RunView} from '../../src/contract/index.ts';

const PORTRAIT:ZoneInput={viewport:{width:390,height:844},status:[{x:14,y:12,width:44,height:44},{x:166,y:8,width:142,height:46},{x:8,y:72,width:292,height:26}],
  team:{x:8,y:120,width:54,height:380},joystick:{x:24,y:708,width:112,height:112},skill:{x:284,y:738,width:82,height:82}};
const LANDSCAPE:ZoneInput={viewport:{width:844,height:390},status:[{x:14,y:12,width:44,height:44},{x:330,y:8,width:180,height:40},{x:212,y:52,width:420,height:20}],
  team:{x:258,y:318,width:328,height:64},joystick:{x:18,y:278,width:96,height:96},skill:{x:746,y:292,width:82,height:82}};

/** A ficha's box as layoutEdges reserves it (its tag rides TAG_ROOM above for the base's horn seconds). */
const ficha=(a:Pick<EdgeArrow,'x'|'y'>,scale=1):Rect=>{const h=arrowHalf(scale);return {x:a.x-h.w,y:a.y-h.h,width:2*h.w,height:2*h.h};};
const inside=(r:Rect,o:Rect)=>r.x>=o.x-.5&&r.y>=o.y-.5&&r.x+r.width<=o.x+o.width+.5&&r.y+r.height<=o.y+o.height+.5;
const heroIn=(u:Rect):Rect=>({x:u.x+u.width/2-28,y:u.y+u.height/2-28,width:56,height:56});

/** The live frame: 16 sites 8–20 u from the plaza, all off screen; the base's ficha ("17 m") already on the rim. */
function liveSites(area:Rect):ObraPoint[]{
  const cx=area.x+area.width/2,cy=area.y+area.height/2;
  return Array.from({length:16},(_,i)=>{
    const a=i/16*Math.PI*2,d=8+(i*7)%13;// 8..20 u
    return {id:`obra-${String(i+1).padStart(2,'0')}`,x:cx+Math.cos(a)*(area.width/2+60+d*20),y:cy+Math.sin(a)*(area.height/2+60+d*20),distance:d};
  });
}
function baseFicha(area:Rect,hero:Rect,screen:{x:number;y:number},opts:{city?:boolean;seconds?:number}={}):EdgeArrow[]{
  const t:EdgeTarget={key:'base',kind:'base',screen,distance:17,...(opts.seconds!==undefined?{seconds:opts.seconds}:{})};
  return layoutEdges([t],area,hero,{city:opts.city??true});
}

test('nearest pick: the 3 nearest by the hero\'s world distance, ties by id; without distances, by screen distance',()=>{
  const area:Rect={x:70,y:150,width:312,height:520};
  const pts:ObraPoint[]=[{id:'c',x:-100,y:0,distance:12},{id:'a',x:900,y:900,distance:9},{id:'b',x:-50,y:400,distance:9},{id:'d',x:200,y:-300,distance:20},{id:'e',x:200,y:400,distance:1}];
  assert.deepEqual(nearestHidden(pts,['a','b','c','d'],area).map(p=>p.id),['a','b','c'],'e is on screen (not hidden); a/b tie by id');
  assert.equal(OBRA_ARROWS,3);
  assert.deepEqual(nearestHidden(pts,['a','b','c','d'],area,1).map(p=>p.id),['a']);
  const flat=pts.map(({distance:_d,...p})=>p);
  assert.deepEqual(nearestHidden(flat,['a','b','c','d'],area).map(p=>p.id),['b','c','d'],'screen distance from the field\'s centre (the sandbox)');
  assert.deepEqual(nearestHidden(pts,[],area),[]);
});

for(const [name,input] of [['retrato 390×844',PORTRAIT],['paisagem 844×390',LANDSCAPE]] as const)for(const scale of [1,1.25]){
  test(`${name}, ${scale*100}% text: 3 obra arrows on the rim, clear of the base's ficha, of each other and of the hero`,()=>{
    const area=computeZones(input).useful,hero=heroIn(area);
    const sites=liveSites(area),plan=planMarkers(sites,area);
    assert.equal(plan.shown.length,0,'standing at the camp: no site on screen (the live bug)');
    // The base's ficha up and to the right (where it sat over the "+17 obras" in landscape), its horn seconds on top.
    for(const base of [baseFicha(area,hero,{x:area.x+area.width+200,y:area.y-150},{seconds:5}),baseFicha(area,hero,{x:area.x+area.width+300,y:area.y+area.height/2})]){
      assert.equal(base.length,1);
      const arrows=obraArrows(sites,plan.hidden,area,{hero,placed:base,viewport:input.viewport,scale});
      assert.equal(arrows.length,3,'1–3 arrows, never the 16');
      assert.ok(arrows.every(a=>a.kind==='obra'&&plan.hidden.includes(a.key)),'each arrow is a hidden site, keyed by its id (what the tap opens)');
      const near=nearestHidden(sites,plan.hidden,area,OBRA_ARROW_TRIES).map(p=>p.id);
      assert.equal(arrows[0].key,near[0],'the nearest first');
      assert.ok(arrows.every(a=>near.includes(a.key)&&a.count===1),'among the nearest, one site per arrow (never a "+1")');
      // The horn's seconds ride TAG_ROOM above the base's ficha; without them the ficha alone.
      const tag=base[0].seconds!==undefined?TAG_ROOM:0,f=ficha(base[0],scale),baseBox={...f,y:f.y-tag,height:f.height+tag};
      for(const a of arrows){
        const box=ficha(a,scale);
        assert.ok(inside(box,area),`${a.key}: inside the useful area`);
        assert.ok(!crosses(box,baseBox),`${a.key}: never over the base's ficha or its tag`);
        assert.ok(!crosses(box,hero,OBRA_HERO_MARGIN),`${a.key}: clear of the hero`);
        assert.ok(Number.isFinite(a.angle),'the beak points at the site');
        const site=sites.find(s=>s.id===a.key)!;
        assert.ok(Math.cos(a.angle)*(site.x-a.x)+Math.sin(a.angle)*(site.y-a.y)>0,'towards the site');
      }
      for(let i=0;i<arrows.length;i++)for(let j=i+1;j<arrows.length;j++)assert.ok(!crosses(ficha(arrows[i],scale),ficha(arrows[j],scale)),`${arrows[i].key}×${arrows[j].key}`);
    }
  });
}

test('the live camp frame: the forge leaves a 310×169 field around a 103×59 hero; 3 arrows still fit beside the hero',()=>{
  // Measured in the local match (portrait, at the wall, forge open): with the HUD's 40 px keep-out and head room no rim
  // was left and the camp showed nothing at all.
  const area:Rect={x:80.1875,y:244.59375,width:309.8125,height:169.328125},hero:Rect={x:183.94,y:299.48,width:103.13,height:59.33};
  const sites:ObraPoint[]=[{id:'obra-01',x:40.7,y:-320.5,distance:21.9},{id:'obra-02',x:278.3,y:-206.6,distance:18},{id:'obra-03',x:515.9,y:-87.7,distance:14.9},
    {id:'obra-04',x:1149.4,y:224.2,distance:15},{id:'obra-05',x:-300,y:600,distance:12.2},{id:'obra-06',x:900,y:700,distance:19.5}];
  const arrows=obraArrows(sites,sites.map(s=>s.id),area,{hero,viewport:{width:390,height:844}});
  assert.equal(arrows.length,3);
  for(const a of arrows){
    assert.ok(inside(ficha(a),area),`${a.key} in the field`);
    assert.ok(!crosses(ficha(a),hero,OBRA_HERO_MARGIN),`${a.key} beside the hero, never on it`);
  }
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(!crosses(ficha(arrows[i]),ficha(arrows[j])));
});

test('the city\'s real base arrow (layoutCityEdges) as the placed one: the obra arrow aimed at the same spot steps aside',()=>{
  const area=computeZones(LANDSCAPE).useful,hero=heroIn(area);
  const base:CityEdgeTarget={key:'base',kind:'base',screen:{x:area.x+area.width+120,y:area.y-40},distance:17};
  const placed=layoutCityEdges([base],area,hero,{textScale:1});
  assert.equal(placed.length,1);
  // One site right behind the base (the same direction): its arrow would have landed on the base's ficha.
  const sites:ObraPoint[]=[{id:'obra-09',x:base.screen.x+10,y:base.screen.y+4,distance:12}];
  const alone=obraArrows(sites,['obra-09'],area,{hero,viewport:LANDSCAPE.viewport});
  assert.ok(crosses(ficha(alone[0]),ficha(placed[0])),'without the placed arrows it would cover the base');
  const arrows=obraArrows(sites,['obra-09'],area,{hero,placed,viewport:LANDSCAPE.viewport});
  assert.equal(arrows.length,1,'it still shows');
  assert.ok(!crosses(ficha(arrows[0]),{...ficha(placed[0]),y:ficha(placed[0]).y-TAG_ROOM,height:36+TAG_ROOM}),'beside the base, not on it');
});

test('layoutEdges placed: kept as they are, never in the result, never merged into, not counted in max; absent = unchanged',()=>{
  const area:Rect={x:70,y:150,width:312,height:520};
  const targets:EdgeTarget[]=[{key:'s1',kind:'obra',screen:{x:-200,y:300},distance:8},{key:'s2',kind:'obra',screen:{x:-200,y:500},distance:9}];
  const without=layoutEdges(targets,area);
  assert.deepEqual(layoutEdges(targets,area,undefined,{placed:[]}),without,'an empty list changes nothing');
  const other:EdgeArrow={key:'base',kind:'base',screen:{x:-200,y:300},distance:17,x:without[0].x,y:without[0].y,angle:Math.PI,side:'left',count:1,tagEnd:'left'};
  const got=layoutEdges(targets,area,undefined,{placed:[other],max:2});
  assert.equal(got.length,2,'max counts only this layer\'s arrows');
  assert.ok(got.every(a=>a.key!=='base'),'the placed arrow is not returned');
  assert.equal(other.count,1,'and not touched');
  for(const a of got)assert.ok(!crosses(ficha(a),ficha(other)),`${a.key} steps aside`);
  // Another obra arrow already there (a placed one of the same kind) is still never merged into.
  const twin={...other,kind:'obra' as const,key:'x'};
  layoutEdges(targets,area,undefined,{placed:[twin]});
  assert.equal(twin.count,1);
  assert.ok(EDGE_PRIORITY.obra>EDGE_PRIORITY.bau,'the lowest rank: it never pushes a caído, the boss or the base');
});

test('two sites at the same spot get two arrows side by side, each opening its own site (never folded into "+1")',()=>{
  const area:Rect={x:70,y:150,width:312,height:520};
  const sites:ObraPoint[]=[{id:'obra-02',x:-300,y:400,distance:10},{id:'obra-01',x:-301,y:401,distance:11}];
  const arrows=obraArrows(sites,['obra-01','obra-02'],area,{viewport:{width:390,height:844}});
  assert.deepEqual(arrows.map(a=>[a.key,a.count]),[['obra-02',1],['obra-01',1]]);
  assert.ok(!crosses(ficha(arrows[0]),ficha(arrows[1])));
  // No room for a second ficha at all (a sliver of a field): the farther one is skipped, never merged.
  const sliver=obraArrows(sites,['obra-01','obra-02'],{...area,height:60,width:90},{viewport:{width:390,height:844}});
  assert.ok(sliver.length<=1&&sliver.every(a=>a.count===1));
});

// ---------- tap → open ----------
const VIEW:ObraView={prepare:true,balance:{coco:9,pedra:9},standing:0,gustavoes:0,
  sites:[{id:'obra-01',x:-400,y:300,maxSize:2,distance:12},{id:'obra-02',x:200,y:300,maxSize:1,distance:3}],
  rail:{x:900,y:-200,laid:false,ready:false,distance:18}};

test('tapping an off-screen site\'s arrow opens its tree (wherever its point is); not while it waits for the room',()=>{
  const tree=treeToOpen('obra-01',VIEW);
  assert.equal(tree?.site,'obra-01','an off-screen site opens like an on-screen one');
  assert.equal(tree?.head.action?.type,'build','its tree builds there');
  assert.equal(treeToOpen(RAIL_SITE_ID,VIEW)?.head.rail,true,'the rail too');
  assert.equal(treeToOpen('obra-01',{...VIEW,pending:['obra-01']}),undefined,'a request on its way: no second tap');
  assert.equal(treeToOpen('obra-99',VIEW),undefined);
  assert.equal(treeToOpen('obra-01',{...VIEW,prepare:false}),undefined,'only in the intermission');
  assert.equal(treeToOpen(undefined,VIEW),undefined);
  // Opened, the site's marker shows clamped onto the field's edge towards it (the open site is always kept).
  const area:Rect={x:70,y:150,width:312,height:520};
  const open=planMarkers([{id:'obra-01',x:-400,y:300}],area,{keep:'obra-01'});
  assert.deepEqual(open.shown.map(m=>[m.id,m.rect.x]),[['obra-01',area.x]]);
});

test('the obra HUD wires the arrows: a pooled button per arrow that opens its site, and the host feeds hero, HUD arrows and distances',()=>{
  const obra=readFileSync(new URL('../../src/client/hud/towers/obra.ts',import.meta.url),'utf8');
  assert.match(obra,/addEventListener\('click',\(\)=>\{if\(slot\.id\)this\.open\(slot\.id\);\}\)/,'tap → open(site)');
  assert.match(obra,/obraArrows\(pts,this\.hidden,this\.area!,\{hero,placed,viewport,scale\}\)/,'laid out around the HUD\'s arrows');
  assert.doesNotMatch(obra,/rh-obra-fora/,'no more "+N obras"');
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.match(explore,/edgeArrows:\(\)=>host\.edges\?\.shown/);
  assert.match(explore,/heroRect:\(\)=>controller\?\.scene\.heroScreenRect\(\)/);
  assert.match(explore,/obraViewFrom\(\{[^}]*hero:net\.predicted/);
  const css=readFileSync(new URL('../../src/client/hud/towers/obra.css',import.meta.url),'utf8');
  assert.match(css,/\.rh-obra \.rh-obra-borda\{pointer-events:auto/,'the arrows take taps (the HUD\'s arrows do not)');
});

test('the match view carries each site\'s (and the rail\'s) distance from the hero; without a hero, none',()=>{
  const plan:BuildPlan={cell:.88,sites:[{id:'obra-01',x:10,y:10,maxSize:2},{id:'obra-02',x:13,y:14,maxSize:1}],rail:{id:'trilho',x:10,y:30,axis:'x',length:12,width:4}};
  const view={tick:500,team:{xp:0,level:1,nextXp:10},round:{index:2,total:10,phase:'prepare',phaseEndsTick:900,remaining:0},enemies:[],pickups:[],projectiles:[],telegraphs:[],
    structures:[],camp:{coco:7,pedra:5},players:[],offers:[],events:[]} as unknown as RunView;
  const v=obraViewFrom({prepare:true,view,plan,project:p=>p,hero:{x:10,y:10}});
  assert.deepEqual(v.sites.map(s=>s.distance),[0,5]);
  assert.equal(v.rail?.distance,20);
  const moved=obraViewFrom({prepare:true,view,plan,project:p=>p,hero:{x:13,y:10}});
  assert.equal(moved.revision,v.revision,'the hero walking changes no revision (only the arrows move)');
  assert.equal(obraViewFrom({prepare:true,view,plan,project:p=>p}).sites[0].distance,undefined);
});
