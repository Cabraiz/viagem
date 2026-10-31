/**
 * The obra menu in the real match (torres-ligar): the ObraView built from a RunView and the build plan (intermission
 * gating, defenses matched to sites by position, counts, balance, the rail), the branch the room accepts, a pt-BR
 * reason for every refusal code, the pending request and its timeout, and the zone input that counts the obra window.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFENSES,DEFENSE_IDS,RAIL,childrenOf,pickChild,type DefenseId} from '../../src/rules/index.ts';
import {ticks,type RunView,type StructureView} from '../../src/contract/index.ts';
import {buildPlanFor,type BuildPlan} from '../../src/maps/index.ts';
import {POS_SCALE} from '../../src/protocol/protocol4.ts';
import type {TowerRefusal} from '../../src/sim/towers/system.ts';
import {treeFor,type ObraAction} from '../../src/client/hud/towers/model.ts';
import {MARKER_SLACK,OBRA_MARKER,planMarkers} from '../../src/client/hud/towers/layout.ts';
import {OBRA_DONE_MS,OBRA_NO_ANSWER,OBRA_OFFLINE,OBRA_PENDING_MS,OBRA_RAIL_TAKEN,OBRA_REFUSALS,OBRA_REFUSED,OBRA_WATCHING,ObraRequests,WIRE_BRANCH,
  branchForWire,obraViewFrom,refusalText,siteOf,towersInWorld,unreachableText} from '../../src/client/hud/towers/wiring.ts';
import {ZONE_WINDOWS,ZONE_WINDOWS_BESIDE_OBRA,computeZones,crosses,measureZoneInput,measureZones,type Rect} from '../../src/client/hud/zones.ts';
// kits-so-torres-boas: the whole upgrade tree, as before the card (rules/kits-off.ts shows only the guarita).
import {showEveryTower} from '../../src/rules/kits-off.ts';
showEveryTower();

const PLAN:BuildPlan={cell:.88,sites:[{id:'obra-01',x:10,y:10,maxSize:2},{id:'obra-02',x:20.5,y:10,maxSize:3},{id:'obra-03',x:30,y:12.25,maxSize:1}],
  rail:{id:'trilho',x:5,y:40,axis:'x',length:12,width:4}};
/** What the wire does to a position (protocol4: 1/512 u steps). */
const wire=(v:number)=>Math.round(v*POS_SCALE)/POS_SCALE;
const defense=(id:string,kind:DefenseId,x:number,y:number,phase='pronta'):StructureView=>({id,kind,x:wire(x),y:wire(y),hp:phase==='ruina'?0:100,maxHp:100,
  tier:DEFENSES[kind].tier,...(DEFENSES[kind].branch?{branch:DEFENSES[kind].branch!}:{}),phase});
function runView(structures:StructureView[],round:'prepare'|'wave'='prepare'):RunView{
  return {tick:500,team:{xp:0,level:1,nextXp:10},round:{index:2,total:10,phase:round,phaseEndsTick:900,remaining:0},enemies:[],pickups:[],projectiles:[],telegraphs:[],
    structures,camp:{units:52,grana:17},players:[],offers:[],events:[]};
}
const project=(p:{x:number;y:number})=>({x:p.x*10,y:p.y*10+1});

test('outside the intermission the view is closed and empty (no projection work)',()=>{
  let calls=0;
  const v=obraViewFrom({prepare:false,view:runView([]),plan:PLAN,project:p=>{calls++;return p;}});
  assert.equal(v.prepare,false);assert.deepEqual(v.sites,[]);assert.equal(v.rail,undefined);assert.equal(calls,0);
});

test('sites projected to the screen, defenses matched by position (through the wire rounding), counts and balance',()=>{
  const view=runView([
    {id:'muralha',kind:'muralha',x:10,y:10,hp:900,maxHp:900},// the wall: no tier, never a tower
    defense('defesa-1','vigias-armados',10,10,'obra-2'),
    defense('defesa-2','morteiro',20.5,10,'ruina'),
    defense('defesa-3','obuseiro',99,99),// on no site: counts as standing, sits nowhere
  ]);
  const v=obraViewFrom({prepare:true,view,plan:PLAN,project});
  assert.equal(v.prepare,true);
  assert.deepEqual(v.sites.map(s=>[s.id,s.x,s.y,s.maxSize]),[['obra-01',100,101,2],['obra-02',205,101,3],['obra-03',300,123.5,1]]);
  assert.deepEqual(v.sites[0].tower,{id:'defesa-1',kind:'vigias-armados',building:true});
  assert.deepEqual(v.sites[1].tower,{id:'defesa-2',kind:'morteiro',ruined:true});
  assert.equal(v.sites[2].tower,undefined);
  assert.equal(v.standing,2,'ruins do not count against the limit');
  assert.equal(v.gustavoes,0);
  assert.deepEqual(v.balance,{units:52},'the one pile (D-048)');
  assert.equal(v.grana,17,'the Grana of the team, from view.camp.grana');
  assert.equal(obraViewFrom({prepare:false,view,plan:PLAN,project}).grana,17,'closed too');
  assert.equal(obraViewFrom({prepare:true,view:undefined,plan:PLAN,project}).grana,0,'no view yet: no Grana');
  assert.equal(v.drawnInWorld,undefined,'default: the marker is the tower');
  assert.equal(obraViewFrom({prepare:true,view,plan:PLAN,project,drawnInWorld:true}).drawnInWorld,true);
  // A site with a ruin and a new obra on it (both in one view): the standing one is the tower.
  const both=obraViewFrom({prepare:true,view:runView([defense('d-old','vigia-do-predio',30,12.25,'ruina'),defense('d-new','vigia-do-predio',30,12.25,'obra-1')]),plan:PLAN,project});
  assert.equal(both.sites[2].tower?.id,'d-new');
});

test('the rail: unknown to others until a Gustavão stands on it; known locally from our own answer',()=>{
  const none=obraViewFrom({prepare:true,view:runView([]),plan:PLAN,project});
  assert.deepEqual(none.rail,{x:50,y:401,laid:false,ready:false});
  const local=obraViewFrom({prepare:true,view:runView([]),plan:PLAN,project,rail:{laid:true,ready:false}});
  assert.deepEqual([local.rail?.laid,local.rail?.ready],[true,false]);
  const g=obraViewFrom({prepare:true,view:runView([defense('defesa-9','gustavao',5,40)]),plan:PLAN,project});
  assert.deepEqual([g.rail?.laid,g.rail?.ready,g.gustavoes],[true,true,1]);
  assert.ok(g.sites.every(s=>!s.tower),'the Gustavão sits on the rail, not on a site');
  assert.equal(obraViewFrom({prepare:true,view:runView([]),plan:{...PLAN,rail:null},project}).rail,undefined,'no rail off the city');
  assert.deepEqual(obraViewFrom({prepare:true,view:runView([]),plan:buildPlanFor(undefined),project}).sites,[],'the island has no sites');
});

test('pending and done flow into the view; siteOf finds an upgrade\'s site',()=>{
  const v=obraViewFrom({prepare:true,view:runView([defense('defesa-1','vigia-do-predio',10,10)]),plan:PLAN,project,pending:['obra-02'],done:['obra-01']});
  assert.deepEqual([v.pending,v.done],[['obra-02'],['obra-01']]);
  assert.equal(siteOf({type:'upgrade',defense:'defesa-1',branch:'A2'},v),'obra-01');
  assert.equal(siteOf({type:'build',site:'trilho'},v),'trilho');
  assert.equal(siteOf({type:'upgrade',defense:'nope',branch:'A2'},v),undefined);
});

test('the branch the room accepts: A4b/A5b as they are, every other child by its letter, and it picks that child',()=>{
  for(const parent of DEFENSE_IDS)for(const child of childrenOf(parent)){
    const b=branchForWire(child.label);
    assert.ok(b&&WIRE_BRANCH.test(b),`${child.label} → ${b}`);
    assert.equal(pickChild(parent,b)?.id,child.id,`${parent} + ${b} → ${child.id}`);
  }
  assert.equal(branchForWire('A4b'),'A4b');assert.equal(branchForWire('A5b'),'A5b');
  assert.equal(branchForWire('A2'),'A');assert.equal(branchForWire('B6'),'B');assert.equal(branchForWire('C5'),'C');
  assert.equal(branchForWire('Z9'),undefined);
  // The model's own actions (what the menu confirms) go out as the room expects.
  const view={prepare:true,sites:[],balance:{units:999},grana:999,standing:1,gustavoes:0};
  const tree=treeFor({id:'obra-01',x:0,y:0,maxSize:3,tower:{id:'d',kind:'atiradores-do-telhado'}},view);
  assert.deepEqual(tree.branches.map(c=>c.action?.type==='upgrade'?branchForWire(c.action.branch):undefined),['A','A4b']);
});

test('every refusal code has its own short pt-BR reason',()=>{
  const CODES:Record<TowerRefusal,true>={'wall-down':true,phase:true,player:true,site:true,occupied:true,size:true,balance:true,grana:true,limit:true,rail:true,
    unique:true,defense:true,building:true,ruined:true,max:true,branch:true,duplicate:true,away:true,full:true};
  assert.deepEqual(Object.keys(OBRA_REFUSALS).sort(),Object.keys(CODES).sort(),'one text per TowerRefusal, no more');
  for(const code of Object.keys(CODES)){
    const text=refusalText(code);
    assert.ok(text&&text!==OBRA_REFUSED&&text.length<=24,`${code}: "${text}"`);
  }
  assert.equal(new Set(Object.values(OBRA_REFUSALS)).size,Object.keys(OBRA_REFUSALS).length,'no two codes say the same');
  // D-048: 'balance' is fichas short (a Vigia, the Gustavão), 'grana' is R$ short (an evolution, a repair).
  assert.deepEqual(['balance','grana','limit','rail','unique','wall-down','phase'].map(refusalText),
    ['Falta ficha de torre','Falta grana','Limite de 12 torres','Precisa do trilho','Só 1 Gustavão','Barricada caída','Só fora da briga']);
  assert.equal(refusalText('away'),'Chegue mais perto','torres-ajustes: too far from the obra');
  assert.equal(refusalText('whatever'),OBRA_REFUSED);assert.equal(refusalText(undefined),OBRA_REFUSED);assert.equal(refusalText('toString'),OBRA_REFUSED);
  assert.equal(unreachableText({connected:false,spectator:false}),OBRA_OFFLINE);
  assert.equal(unreachableText({connected:true,spectator:true}),OBRA_WATCHING);
});

function fakeNet(reachable=true){
  let req=40;const calls:unknown[][]=[];
  return {calls,build(site:string){calls.push(['build',site]);return reachable?++req:undefined;},
    upgrade(d:string,b?:string){calls.push(['upgrade',d,b]);return reachable?++req:undefined;}};
}
const LIVE={connected:true,spectator:false};

test('a request spins until the room answers: ok stamps the marker, a refusal comes back as words',()=>{
  let now=1000;const r=new ObraRequests(()=>now),net=fakeNet();
  assert.equal(r.send({type:'build',site:'obra-01'},'obra-01',net,LIVE),undefined);
  assert.deepEqual(r.pendingSites(),['obra-01']);
  // A second tap on the same site while it waits does not send again.
  r.send({type:'build',site:'obra-01'},'obra-01',net,LIVE);
  assert.equal(net.calls.length,1);
  assert.equal(r.answer({req:41,ok:true,kind:'vigia-do-predio'},500),undefined);
  assert.deepEqual([r.pendingSites(),r.doneSites()],[[],['obra-01']]);
  now+=OBRA_DONE_MS;r.expire();
  assert.deepEqual(r.doneSites(),[],'the stamp is short');
  r.send({type:'upgrade',defense:'defesa-1',branch:'B2'},'obra-01',net,LIVE);
  assert.deepEqual(net.calls.at(-1),['upgrade','defesa-1','B'],'the model\'s label goes out as the room\'s branch');
  assert.equal(r.answer({req:42,ok:false,reason:'grana'},500),'Falta grana','an evolution without R$');
  assert.deepEqual(r.pendingSites(),[]);
  assert.equal(r.answer({req:999,ok:false,reason:'balance'},500),undefined,'someone else\'s (or a forgotten) req: ignored');
});

test('no answer in 3 s: the spinner stops once with "A sala não respondeu"; a late ok still stamps',()=>{
  let now=0;const r=new ObraRequests(()=>now),net=fakeNet();
  r.send({type:'build',site:'obra-02'},'obra-02',net,LIVE);
  now=OBRA_PENDING_MS-1;assert.equal(r.expire(),false);assert.deepEqual(r.pendingSites(),['obra-02']);
  now=OBRA_PENDING_MS;assert.equal(r.expire(),true);assert.deepEqual(r.pendingSites(),[]);
  assert.equal(r.expire(),false,'said once');
  assert.ok(OBRA_NO_ANSWER.length>0);
  assert.equal(r.answer({req:41,ok:true,kind:'vigia-do-predio'},10),undefined);
  assert.deepEqual(r.doneSites(),['obra-02']);
});

test('offline or watching: nothing leaves, the same toast path answers at once',()=>{
  const r=new ObraRequests(()=>0);
  assert.equal(r.send({type:'build',site:'obra-01'},'obra-01',fakeNet(false),{connected:false,spectator:false}),OBRA_OFFLINE);
  assert.equal(r.send({type:'build',site:'obra-01'},'obra-01',fakeNet(false),{connected:true,spectator:true}),OBRA_WATCHING);
  assert.deepEqual(r.pendingSites(),[]);
});

test('the rail this client laid: laid at the answer, ready after its build time; "occupied" means someone laid it',()=>{
  const r=new ObraRequests(()=>0),net=fakeNet();
  const lay:ObraAction={type:'build',site:RAIL.siteId};
  r.send(lay,RAIL.siteId,net,LIVE);
  r.answer({req:41,ok:true,kind:RAIL.id},100);
  assert.deepEqual(r.rail(100),{laid:true,ready:false});
  assert.deepEqual(r.rail(100+ticks(RAIL.buildSeconds)-1),{laid:true,ready:false});
  assert.deepEqual(r.rail(100+ticks(RAIL.buildSeconds)),{laid:true,ready:true});
  r.resetRun();assert.deepEqual(r.rail(1e6),{laid:false,ready:false},'a new run has no rail');
  r.send(lay,RAIL.siteId,net,LIVE);
  assert.equal(r.answer({req:42,ok:false,reason:'occupied'},50),OBRA_RAIL_TAKEN);
  assert.equal(r.rail(50).laid,true);
});

// ---------- zones: the obra window trims the useful area like the offer and the forge ----------
function fakeDoc(boxes:Record<string,Rect>){
  const node=(r:Rect)=>({closest:()=>null,getBoundingClientRect:()=>({left:r.x,top:r.y,width:r.width,height:r.height,right:r.x+r.width,bottom:r.y+r.height})});
  return {querySelector:(s:string)=>boxes[s]?node(boxes[s]):null,querySelectorAll:(s:string)=>boxes[s]?[node(boxes[s])]:[]} as unknown as Document;
}
function withWindow<T>(run:()=>T):T{
  const g=globalThis as unknown as Record<string,unknown>,saved={innerWidth:g.innerWidth,innerHeight:g.innerHeight,getComputedStyle:g.getComputedStyle};
  Object.assign(g,{innerWidth:390,innerHeight:844,getComputedStyle:()=>({visibility:'visible',getPropertyValue:()=>''})});
  try{return run();}finally{Object.assign(g,saved);}
}

test('measureZoneInput: the obra window is a window of the useful area; the obra HUD measures without it',()=>{
  const janela={x:70,y:520,width:312,height:200},offer={x:70,y:300,width:312,height:240};
  const base={'.explore-stick':{x:24,y:708,width:112,height:112},'#coop-attack':{x:284,y:738,width:82,height:82}};
  withWindow(()=>{
    const input=measureZoneInput(fakeDoc({...base,'.rh-obra-janela':janela}));
    assert.deepEqual(input.offer,janela);
    assert.deepEqual(input.viewport,{width:390,height:844});
    assert.equal(measureZoneInput(fakeDoc({...base,'.rh-obra-janela':janela}),ZONE_WINDOWS_BESIDE_OBRA).offer,undefined,'never laid out from itself');
    assert.deepEqual(measureZoneInput(fakeDoc({...base,'.rh-obra-janela':janela,'.rh-offer':offer})).offer,offer,'the offer comes first');
    const zones=measureZones(fakeDoc({...base,'.rh-obra-janela':janela}));
    assert.deepEqual(zones,computeZones(input),'measureZones = computeZones(measureZoneInput)');
    assert.ok(!crosses(zones.useful,janela),'the camera\'s field leaves the obra window out');
    // Unchanged for the windows it had: the forge alone is still the window.
    const forge={x:70,y:500,width:312,height:180};
    assert.deepEqual(measureZoneInput(fakeDoc({...base,'.rh-forge':forge})).offer,forge);
  });
  // D-047: Dona Cida's tray (hud/cida.ts) is one more window, in the forge's place.
  assert.deepEqual([...ZONE_WINDOWS],['.rh-offer','.rh-forge','.rh-obra-janela','.rh-cida']);
});

// ---------- markers on screen: off-screen sites hide (their edge arrows: obra-arrows.test.ts), crowded ones are nudged apart ----------
const AREA:Rect={x:70,y:150,width:312,height:520};
const crossing=(a:Rect,b:Rect)=>crosses(a,b);

test('off-screen sites hide instead of piling on the field\'s edge (no "+N" etiqueta: the nearest get edge arrows)',()=>{
  // The live frame: six sites and the rail far off to the left all clamped onto (80.6, 244.6).
  const off=['obra-01','obra-02','obra-07','obra-09','obra-11','obra-12','trilho'].map((id,i)=>({id,x:-300-i*40,y:200+i*10}));
  const on=[{id:'obra-03',x:200,y:300},{id:'obra-04',x:300,y:500}];
  const plan=planMarkers([...off,...on],AREA);
  assert.deepEqual(plan.shown.map(m=>m.id).sort(),['obra-03','obra-04']);
  assert.deepEqual(plan.hidden,off.map(p=>p.id));
  assert.equal('hint' in plan,false,'the old non-tappable "+17 obras" etiqueta is gone');
  assert.deepEqual(planMarkers(on,AREA).hidden,[],'nothing off screen');
});

test('the slack: a marker sticking out by ≤ 8 px shows (clamped in), farther out it hides; the open site always shows',()=>{
  const half=OBRA_MARKER/2;
  const edge=planMarkers([{id:'a',x:AREA.x+half-MARKER_SLACK,y:400},{id:'b',x:AREA.x+half-MARKER_SLACK-1,y:300}],AREA);
  assert.deepEqual(edge.shown.map(m=>m.id),['a']);assert.deepEqual(edge.hidden,['b']);
  assert.equal(edge.shown[0].rect.x,AREA.x,'clamped back into the field');
  const open=planMarkers([{id:'b',x:-500,y:300}],AREA,{keep:'b'});
  assert.deepEqual(open.shown.map(m=>[m.id,m.rect.x]),[['b',AREA.x]]);
});

test('two markers closer than 48 px are nudged apart, deterministically; the nearest the centre is on top',()=>{
  const pts=[{id:'obra-05',x:220,y:400},{id:'obra-06',x:230,y:404},{id:'obra-08',x:226,y:430}];
  const a=planMarkers(pts,AREA),b=planMarkers([...pts].reverse(),AREA);
  assert.deepEqual(a,b,'the input order does not matter');
  for(let i=0;i<a.shown.length;i++)for(let j=i+1;j<a.shown.length;j++)assert.ok(!crossing(a.shown[i].rect,a.shown[j].rect),`${a.shown[i].id}×${a.shown[j].id}`);
  for(const m of a.shown)assert.ok(m.rect.x>=AREA.x&&m.rect.y>=AREA.y&&m.rect.x+48<=AREA.x+AREA.width&&m.rect.y+48<=AREA.y+AREA.height,'still in the field');
  // Same point: the lower id goes left.
  const same=planMarkers([{id:'z',x:200,y:400},{id:'a',x:200,y:400}],AREA);
  const ax=same.shown.find(m=>m.id==='a')!.rect.x,zx=same.shown.find(m=>m.id==='z')!.rect.x;
  assert.ok(ax<zx&&zx-ax>=48);
  // A crowd jammed into a corner may still cross: the one nearest the field's centre is drawn last (on top).
  const jam=planMarkers(['p','q','r','s','t','u'].map((id,i)=>({id,x:AREA.x+30+i,y:AREA.y+30+i})),{x:AREA.x,y:AREA.y,width:100,height:100});
  const mid={x:AREA.x+50,y:AREA.y+50},dist=(r:Rect)=>Math.hypot(r.x+24-mid.x,r.y+24-mid.y);
  const top=jam.shown.at(-1)!;
  assert.ok(jam.shown.every(m=>dist(m.rect)>=dist(top.rect)-1e-9),'last = nearest the centre');
});

test('drawnInWorld comes from the scene\'s optional towersInWorld(): false without it',()=>{
  assert.equal(towersInWorld({}),false);
  assert.equal(towersInWorld(undefined),false);
  assert.equal(towersInWorld({towersInWorld:'yes'}),false);
  assert.equal(towersInWorld({towersInWorld:()=>true}),true);
  assert.equal(towersInWorld({on:true,towersInWorld(this:{on:boolean}){return this.on;}}),true,'called on the scene');
});

test('revision: the same while only the camera moves; changes with the snapshot, requests, watching or the scene',()=>{
  const view=runView([defense('defesa-1','vigia-do-predio',10,10,'obra-1')]);
  const base={prepare:true,view,plan:PLAN,project};
  const a=obraViewFrom(base),b=obraViewFrom({...base,project:p=>({x:p.x*10+37,y:p.y*10-12})});
  assert.ok(a.revision);
  assert.equal(b.revision,a.revision,'points moved: same revision');
  assert.notDeepEqual(b.sites[0].x,a.sites[0].x);
  assert.equal(b.sites[0].tower,a.sites[0].tower,'what the snapshot says is read once per RunView');
  const next=(over:Partial<Parameters<typeof obraViewFrom>[0]>)=>obraViewFrom({...base,...over}).revision;
  // Same content in a new snapshot object (the next frame from the room): same revision, so no rebuild.
  assert.equal(next({view:runView([defense('defesa-1','vigia-do-predio',10,10,'obra-1')])}),a.revision);
  for(const [why,rev] of [
    ['the obra finished',next({view:runView([defense('defesa-1','vigia-do-predio',10,10,'pronta')])})],
    ['the balance',next({view:{...view,camp:{units:53,grana:17}}})],
    ['the Grana',next({view:{...view,camp:{units:52,grana:18}}})],
    ['a request sent',next({pending:['obra-02']})],
    ['an obra accepted',next({done:['obra-01']})],
    ['watching',next({readOnly:true})],
    ['the scene draws the towers',next({drawnInWorld:true})],
    ['the rail',next({rail:{laid:true,ready:false}})],
    ['out of the intermission',next({prepare:false})],
    ['another map',next({plan:{...PLAN}})],
  ] as const)assert.notEqual(rev,a.revision,why);
  assert.equal(obraViewFrom({...base,readOnly:true}).readOnly,true);
  assert.equal(a.readOnly,undefined);
});

test('no endless animation in the obra CSS (CHECKLIST A12)',async()=>{
  const css=(await import('node:fs')).readFileSync(new URL('../../src/client/hud/towers/obra.css',import.meta.url),'utf8');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g,''),/infinite/);
});
