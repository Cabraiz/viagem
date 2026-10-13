// Card cidade-08: round 1 of the city is a walk to the plaza. The HUD's objective row ("Vai pra praça!") points along the
// WALKING route (the flow field over the real Cidade Nevada), never down the straight bearing into a block; it says the
// walking distance left, turns with the 4 camera views, hides in the plaza, in other rounds and on the island/endless
// map, keeps the coach's generic "andar" out of its way, and is a row of the audited announcement slot. Results only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {clearSegment,moveDirection,walkable,type Point} from '../../src/maps/world.ts';
import {DIRS} from '../../src/maps/flowfield.ts';
import {cityPlanner} from '../../src/sim/city/grid.ts';
import {CityObjectiveTracker,cityRouteOf,cityRouteReady,prewarmCityRoute,objectiveSlot,screenBearing,objectiveMeters,OBJECTIVE_TEXT,OBJECTIVE_WALK,OBJECTIVE_JOKE,
  cityHudLayout,referenceInput,type ObjectiveSlotInput} from '../../src/client/hud/city/index.ts';
import {projectView} from '../../src/client/projection.ts';
import {Coach,resetSessionMemory,WALK_DISTANCE,type CoachInput} from '../../src/client/hud/coach.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';
import {auditBoxes,type AuditBox,type Rect} from '../../src/client/hud/zones.ts';
import {COVERING} from '../../src/client/hud/edges.ts';
import type {RunView} from '../../src/contract/view.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const terrain=loaded.terrain,P=terrain.asset.points,route=cityRouteOf(terrain);
const SECOND=20,DT=1/SECOND;
const unit=(v:Point)=>{const l=Math.hypot(v.x,v.y);return {x:v.x/l,y:v.y/l};};
const angle=(a:Point,b:Point)=>Math.acos(Math.max(-1,Math.min(1,(a.x*b.x+a.y*b.y)/(Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y)))))*180/Math.PI;
const toPlaza=(p:Point)=>unit({x:P.praca.x-p.x,y:P.praca.y-p.y});
/** A hero holding the joystick along `dir(p)` for up to `seconds` (the game's own slide along walls), until `stop(p)`. */
function walk(from:Point,dir:(p:Point)=>Point,seconds:number,stop:(p:Point)=>boolean=p=>route.inside(p)){
  let p={...from};const trail:Point[]=[{...p}];
  for(let i=0;i<seconds*SECOND&&!stop(p);i++){p=moveDirection(p,dir(p),DT,terrain);if((i+1)%SECOND===0)trail.push({...p});}
  return {end:p,trail,reached:stop(p)};
}
const followArrow=(p:Point)=>route.direction(p);
/** Where a straight walk to the plaza parks: from the road south of the block ≈(103,148), it presses into its south face. */
const straight=walk({x:104,y:157},toPlaza,20);

test('the plaza test is the planner\'s insideBase, cell by cell (client copy, no sim import in the bundle)',()=>{
  const planner=cityPlanner(terrain),cs=terrain.asset.unitsPerCell;
  let inside=0;
  for(let cy=0;cy<terrain.asset.cells.h;cy++)for(let cx=0;cx<terrain.asset.cells.w;cx++){
    const p={x:(cx+.5)*cs,y:(cy+.5)*cs},mine=route.inside(p);
    if(mine)inside++;
    if(mine!==planner.insideBase(p))assert.fail(`cell ${cx},${cy}: client ${mine}, planner ${!mine}`);
  }
  assert.ok(inside>100,`the plaza has cells (${inside})`);
  assert.ok(route.inside(P.praca),'the praca point is in the plaza');
  assert.ok(!route.inside(P.inicio),'the wreck is not');
  assert.equal(cityRouteOf(terrain),route,'one route per terrain (cached)');
});

test('following the arrow from the wreck reaches the plaza in under 45 s; the straight bearing parks at the block',()=>{
  const run=walk(P.inicio,followArrow,45);
  assert.ok(run.reached,`the arrow reaches the plaza (ended at ${run.end.x.toFixed(1)},${run.end.y.toFixed(1)})`);
  assert.ok(run.trail.length-1<=40,`in ${run.trail.length-1} s`);
  const direct=walk(P.inicio,toPlaza,45);
  assert.ok(!direct.reached,'the straight bearing from the wreck never gets there');
  assert.ok(!straight.reached&&Math.hypot(straight.end.x-103,straight.end.y-154)<2,`straight from the road parks at the block (${straight.end.x.toFixed(1)},${straight.end.y.toFixed(1)})`);
});

test('along the real route the arrow points at the next street segment and never into a wall',()=>{
  // The route the field walks, cell by cell from the wreck's cell to the plaza.
  const cs=route.cellSize,w=route.width,cells:Point[]=[];
  let cx=Math.floor(P.inicio.x/cs),cy=Math.floor(P.inicio.y/cs);
  for(let n=0;n<1000&&!route.inside({x:(cx+.5)*cs,y:(cy+.5)*cs});n++){
    cells.push({x:(cx+.5)*cs,y:(cy+.5)*cs});
    const d=route.field.nextCell(cx,cy);assert.ok(d>=0,`the route goes on at ${cx},${cy}`);
    cx+=DIRS[d].dx;cy+=DIRS[d].dy;
  }
  assert.ok(cells.length>40,`a real walk (${cells.length} cells, grid ${w})`);
  let checked=0;
  for(let i=2;i+3<cells.length;i+=5){
    const p=cells[i],ahead=cells[i+3],d=route.direction(p),next={x:ahead.x-p.x,y:ahead.y-p.y};
    assert.ok(angle(d,next)<50,`at ${p.x.toFixed(1)},${p.y.toFixed(1)} the arrow is ${angle(d,next).toFixed(0)}° off the next segment`);
    assert.ok(clearSegment(p,{x:p.x+d.x*.5,y:p.y+d.y*.5},terrain),`at ${p.x.toFixed(1)},${p.y.toFixed(1)} half a unit along the arrow is walkable`);
    checked++;
  }
  assert.ok(checked>=8,`${checked} points checked`);
});

test('at the stuck spot ≈(103,148) the arrow leads out where the straight bearing hits the wall',()=>{
  const at=straight.end,d=route.direction(at),s=toPlaza(at);
  assert.ok(!clearSegment(at,{x:at.x+s.x*.5,y:at.y+s.y*.5},terrain),'the straight bearing walks into the block');
  assert.ok(clearSegment(at,{x:at.x+d.x*.5,y:at.y+d.y*.5},terrain),'the arrow does not');
  assert.ok(angle(d,s)>45,`the arrow turns away from the straight bearing (${angle(d,s).toFixed(0)}°)`);
  assert.ok(Math.abs(screenBearing(d,0)-screenBearing(s,0))>30,'and so does its sticker on screen');
  assert.ok(walk(at,followArrow,45).reached,'following it from there reaches the plaza');
  // The dead-end yard inside that block (open to the south): every spot points back out, south, along walkable ground.
  for(const p of [{x:104.5,y:149.5},{x:105,y:151},{x:105.5,y:152.5}]){
    assert.ok(walkable(p,terrain),`${p.x},${p.y} is in the yard`);
    const q=route.direction(p);
    assert.ok(q.y>0,`at ${p.x},${p.y} the arrow leads out of the yard (${q.x.toFixed(2)},${q.y.toFixed(2)})`);
    assert.ok(clearSegment(p,{x:p.x+q.x*.5,y:p.y+q.y*.5},terrain));
    assert.ok(walk(p,followArrow,45).reached,`from ${p.x},${p.y} the arrow reaches the plaza`);
  }
});

test('the distance is the walk left, in whole meters, and goes down along the route',()=>{
  const start=route.distance(P.inicio),line=Math.hypot(P.inicio.x-P.praca.x,P.inicio.y-P.praca.y);
  assert.ok(start>=line-14&&start<=line*1.4,`from the wreck ${start.toFixed(1)} u (straight to the praca ${line.toFixed(1)} u)`);
  const run=walk(P.inicio,followArrow,45),left=run.trail.map(p=>route.distance(p));
  for(let i=1;i<left.length;i++)assert.ok(left[i]<left[i-1],`second ${i}: ${left[i].toFixed(1)} < ${left[i-1].toFixed(1)}`);
  assert.equal(route.distance(P.praca),0,'none left in the plaza');
  assert.equal(objectiveMeters(72.4),'72 m');assert.equal(objectiveMeters(1500),'999 m');assert.equal(objectiveMeters(-2),'0 m');
  const shown=new CityObjectiveTracker().step({terrain,round:{index:1,phase:'wave'},standing:true,hero:P.inicio,view:0});
  assert.equal(shown?.meters,Math.round(start),'the row shows the same number');
});

test('the arrow turns with the 4 camera views exactly as the world is drawn',()=>{
  const at=straight.end,d=route.direction(at),bearings:number[]=[];
  for(const view of [0,1,2,3]){
    const a=projectView(at,view),b=projectView({x:at.x+d.x,y:at.y+d.y},view);
    const drawn=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI,b0=screenBearing(d,view);
    const diff=((b0-drawn)%360+540)%360-180;
    assert.ok(Math.abs(diff)<.5,`view ${view}: ${b0.toFixed(1)}° vs the drawn ${drawn.toFixed(1)}°`);
    const shown=new CityObjectiveTracker().step({terrain,round:{index:1,phase:'wave'},standing:true,hero:at,view});
    assert.ok(shown?.bearing!==undefined&&Math.abs(shown.bearing-b0)<1e-9,`view ${view}: the row uses it`);
    bearings.push(b0);
  }
  const turn=(a:number,b:number)=>Math.abs(((a-b)%360+540)%360-180);
  assert.ok(Math.abs(turn(bearings[0],bearings[2])-180)<1e-6,'view 2 is view 0 turned half way');
  assert.ok(Math.abs(turn(bearings[1],bearings[3])-180)<1e-6,'and 3 is 1 turned half way');
  assert.ok(turn(bearings[0],bearings[1])>20,'each quarter turn moves the arrow');
});

test('shown in round 1 out of the plaza; hidden in it, in round 2, on the island and the endless map, and while down',()=>{
  const base={terrain,round:{index:1,phase:'wave'},standing:true,hero:P.inicio,view:0} as const;
  assert.ok(new CityObjectiveTracker().step(base),'round 1, at the wreck');
  assert.ok(new CityObjectiveTracker().step({...base,round:{index:1,phase:'prepare'}}),'the opening countdown (index 1) too');
  assert.equal(new CityObjectiveTracker().step({...base,hero:P.praca}),undefined,'in the plaza');
  assert.equal(new CityObjectiveTracker().step({...base,hero:P.bocas.S}),undefined,'on the south mouth line (insideBase)');
  assert.equal(new CityObjectiveTracker().step({...base,round:{index:2,phase:'wave'}}),undefined,'round 2');
  assert.equal(new CityObjectiveTracker().step({...base,round:{index:2,phase:'prepare'}}),undefined,'the intermission after round 1');
  assert.equal(new CityObjectiveTracker().step({...base,round:undefined}),undefined,'no round (lobby, result)');
  assert.equal(new CityObjectiveTracker().step({...base,terrain:{world:'ilha'}}),undefined,'the island');
  assert.equal(new CityObjectiveTracker().step({...base,terrain:{world:'infinito',chunks:{}}}),undefined,'the endless map');
  assert.equal(new CityObjectiveTracker().step({...base,terrain:undefined}),undefined,'no terrain');
  assert.equal(new CityObjectiveTracker().step({...base,standing:false}),undefined,'down, out or watching');
  // Once in the plaza it is done for round 1: a fight that spills out of the gate brings no nag back. A new run does.
  const tracker=new CityObjectiveTracker();
  assert.ok(tracker.step(base));
  assert.equal(tracker.step({...base,hero:P.praca}),undefined);
  assert.equal(tracker.step(base),undefined,'out again in round 1: still done');
  assert.equal(tracker.step({...base,round:{index:2,phase:'wave'}}),undefined);
  assert.ok(tracker.step(base),'the next run\'s round 1 shows it again');
  tracker.step({...base,hero:P.praca});tracker.reset();
  assert.ok(tracker.step(base),'a rematch (RunHud.reset) too');
});

test("the route is built ahead of time: a prewarmed city's first objective frame builds nothing and has its numbers",()=>{
  // A city terrain no one asked for yet (same city, its own route cache entry).
  const fresh=()=>Object.create(terrain) as typeof terrain;
  const base={round:{index:1,phase:'prepare'},standing:true,hero:P.inicio,view:0} as const;
  // Prewarmed on an idle moment (the lobby): ready before round 1, and the first frame has the distance and the arrow.
  const lobby=fresh(),jobs:(()=>void)[]=[];
  assert.equal(prewarmCityRoute(lobby,job=>jobs.push(job)),true,'scheduled');
  assert.equal(prewarmCityRoute(lobby,job=>jobs.push(job)),false,'once per terrain');
  assert.equal(cityRouteReady(lobby),false,'not built inside the call');
  jobs.splice(0).forEach(job=>job());
  assert.equal(cityRouteReady(lobby),true,'built on the idle moment');
  const later:(()=>void)[]=[];
  const first=new CityObjectiveTracker(job=>later.push(job)).step({...base,terrain:lobby});
  assert.equal(first?.meters,Math.round(route.distance(P.inicio)),'the first frame has the distance');
  assert.ok(first?.bearing!==undefined,'and the arrow');
  assert.equal(later.length,0,'and asked for no build');
  // Not prewarmed (a phone that joined at the countdown): the frame still builds nothing; it asks for the idle build and
  // shows the row without numbers until it lands.
  const late=fresh(),queued:(()=>void)[]=[],tracker=new CityObjectiveTracker(job=>queued.push(job));
  assert.deepEqual(tracker.step({...base,terrain:late}),{},'the row, no numbers yet');
  assert.equal(cityRouteReady(late),false,'no build inside the frame');
  assert.equal(queued.length,1,'one idle build asked');
  assert.deepEqual(tracker.step({...base,terrain:late}),{},'still waiting');
  assert.equal(queued.length,1,'asked once');
  queued.splice(0).forEach(job=>job());
  assert.equal(tracker.step({...base,terrain:late})?.meters,Math.round(route.distance(P.inicio)),'then the numbers');
  assert.equal(prewarmCityRoute({world:'ilha'},()=>assert.fail('no route for the island')),false);
});

test(`the walk takes the round banner's slot in round 1 while "andar" is to learn; otherwise it waits for it`,()=>{
  const slot=(over:Partial<ObjectiveSlotInput>)=>objectiveSlot({wanted:true,round:1,walkLearned:false,banner:false,held:false,...over});
  assert.deepEqual(slot({}),{show:true,foldBanner:false},'a free slot');
  assert.deepEqual(slot({banner:true}),{show:true,foldBanner:true},'a novice: the banner folds into the round chip, the row stays');
  assert.deepEqual(slot({banner:true,walkLearned:true}),{show:false,foldBanner:false},'a phone that walked before: the banner keeps its 1.8 s');
  assert.deepEqual(slot({banner:true,round:2}),{show:false,foldBanner:false},'never past round 1');
  assert.deepEqual(slot({banner:true,held:true}),{show:false,foldBanner:false},'a notice, the kill-cam, a shell row or the rescue hint go first');
  assert.deepEqual(slot({wanted:false,banner:true}),{show:false,foldBanner:false},'no walk, no fold');
});

test(`a novice's first city run: from the countdown through the round banner the walk row never leaves, "andar" never doubles it`,()=>{
  // The HUD's turn, frame by frame (RunHud.update: the coach, then the walk's slot): the opening countdown (round 1
  // prepare, 3 s), then the wave's banner ("Pouso Forçado") for 1.8 s unless the walk folds it; the novice starts walking at 4 s.
  resetSessionMemory();
  const coach=new Coach(memory()),tracker=new CityObjectiveTracker(()=>assert.fail('built ahead of time'));
  let banner=false,bannerUntil=-1,hero={...P.inicio};
  const missing:number[]=[];
  for(let now=0;now<=8000;now+=50){
    const phase=now<3000?'prepare':'wave';
    if(now===3000){banner=true;bannerUntil=now+1800;}
    if(banner&&now>=bannerUntil)banner=false;
    if(now>=4000)hero=moveDirection(hero,route.direction(hero),.05,terrain);
    const view=round1({round:{...round1().round!,phase}});
    const want=tracker.step({terrain,round:{index:1,phase},standing:true,hero,view:0});
    const show=coach.step(coachInput(view,{hero,banner,objective:!!want}),now);
    assert.notEqual(show?.lesson,'walk',`${now} ms: the generic "andar" stays folded into the walk`);
    const turn=objectiveSlot({wanted:!!want,round:1,walkLearned:coach.done.has('walk'),banner,held:!!show});
    if(turn.foldBanner)banner=false;
    if(want&&!turn.show)missing.push(now);
  }
  assert.deepEqual(missing,[],'the walk row is on screen on every frame it is wanted');
  assert.ok(coach.done.has('walk'),'walking along it taught "andar"');
});

test('copy: dry imperative, one short joke, no caps, no real brand',()=>{
  assert.equal(OBJECTIVE_TEXT,'Vai pra praça!');
  for(const line of [OBJECTIVE_TEXT,OBJECTIVE_WALK,OBJECTIVE_JOKE]){
    assert.ok(line.length<=28,`"${line}" is short`);
    assert.doesNotMatch(line,/[A-ZÁÉÍÓÚÂÊÔÃÕ]{2}|·|→|—|\p{Extended_Pictographic}/u,line);
    assert.doesNotMatch(line,/uber|99|ifood|google/i,'no real brand (D-033)');
  }
  // The joke is the line that wraps (portrait at 125%): its only break point is between its two sentences, so a wrap
  // reads "O heli caiu." over "Você, não.", never a word alone on a line.
  assert.deepEqual(OBJECTIVE_JOKE.split(' ').map(part=>part.replaceAll(String.fromCharCode(160),' ')),['O heli caiu.','Você, não.']);
});

// ---------- Coach ----------
const memory=()=>{const store=new Map<string,string>();return {getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};};
function round1(over:Partial<RunView>={}):RunView{
  const view=fakeView('wave',2);
  return {...view,round:{...view.round!,index:1},offers:[],pickups:[],events:[],...over};
}
const coachInput=(view:RunView,extra:Partial<CoachInput>={}):CoachInput=>({view,localId:'p1',hero:{x:0,y:0},chip:false,blocked:false,...extra});

test('coach: while the walk to the plaza is wanted, the generic "andar" never shows; walking there still teaches it',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());let now=0;
  const view=round1();
  assert.deepEqual(new Coach(memory()).step(coachInput(view),0),{lesson:'walk',done:false},'control: without the objective, round 1 starts with "andar"');
  for(;now<=6000;now+=100)assert.equal(coach.step(coachInput(view,{objective:true}),now),undefined,'one or the other: the objective holds the slot');
  // The chip and XP wait too (one row at a time).
  assert.equal(coach.step(coachInput(round1({pickups:[{id:'x',kind:'xp',x:.5,y:0,value:1}]}),{objective:true,chip:true}),now+=100),undefined);
  // The novice walks toward the plaza: "andar" is learned (never shown on its own after that).
  assert.equal(coach.step(coachInput(view,{objective:true,hero:{x:WALK_DISTANCE+.2,y:0}}),now+=100),undefined);
  assert.ok(coach.done.has('walk'),'learned by walking');
  now+=3000;
  assert.notEqual(coach.step(coachInput(view,{hero:{x:2,y:0}}),now)?.lesson,'walk','in the plaza (objective gone) no late "Arrasta pra andar"');
});

test('coach: a teammate down still goes ahead of the objective (rescue), the joystick lesson does not',()=>{
  resetSessionMemory();
  const coach=new Coach(memory());
  const down=round1();down.players=down.players.map(p=>p.id==='p2'?{...p,hp:0,online:true,downed:{progress:0,bleedOutTick:2000}}:p);
  assert.equal(coach.step(coachInput(down,{objective:true}),0)?.lesson,'rescue');
});

// ---------- Zones ----------
test('zones: the objective is an audited row of the announcement slot, clear of the thumbs, the hero and the field',()=>{
  const zonesSrc=readFileSync(fromRoot('src/client/hud/zones.ts'),'utf8'),hudSrc=readFileSync(fromRoot('src/client/hud/hud.ts'),'utf8');
  assert.match(zonesSrc,/add\('\.rh-stack \.rh-objetivo','objetivo',\{fallback:low\}\)/,'the zones audit measures it like the coach\'s hint');
  assert.match(hudSrc,/\.rh-objetivo:not\(\[hidden\]\),\.rh-coach:not\(\[hidden\]\),\.rh-row:not\(\[hidden\]\)'\)\]/,'avoidHero moves it with the slot (low slot off the hero)');
  assert.ok(COVERING.includes('.rh-stack>:not([hidden])'),'the arrows treat it as HUD over the map');
  // The row's worst case (hud.css .rh-objetivo): 320 px wide (400 in landscape), the second line wrapped in portrait
  // at 125% (16 px + 2 × 13 px lines at 1.2, padding and edge), one line in landscape.
  const rowHeight=(orientation:'portrait'|'landscape',scale:1|1.25)=>orientation==='portrait'?4+11+(16+2*13)*1.2*scale:4+7+(16+13)*1.2*scale;
  for(const orientation of ['portrait','landscape'] as const)for(const scale of [1,1.25] as const)for(const notch of [false,true]){
    const layout=cityHudLayout(referenceInput(orientation,{textScale:scale,notch})),slot=layout.announce;
    const width=Math.min(slot.width,orientation==='portrait'?320:400),height=rowHeight(orientation,scale);
    const row:Rect={x:slot.x+(slot.width-width)/2,y:slot.y,width,height};
    const name=`${orientation} ${scale*100}%${notch?' notch':''}`;
    assert.ok(height<=slot.height,`${name}: ${height.toFixed(0)} px fits the ${slot.height} px slot`);
    const c=referenceInput(orientation,{textScale:scale,notch}).controls;
    const boxes:AuditBox[]=[{name:'objetivo',rect:row},
      ...(c.joystick?[{name:'joystick',rect:c.joystick,thumb:true,target:true}]:[]),...(c.skill?[{name:'habilidade',rect:c.skill,thumb:true,target:true}]:[])];
    const audit=auditBoxes(boxes,layout.zones,layout.hero);
    assert.deepEqual({hero:audit.heroCrossed,field:audit.inPlay,thumbs:audit.thumbGaps},{hero:[],field:[],thumbs:[]},name);
    for(const s of c.status)if(s)assert.ok(row.y>=s.y+s.height,`${name}: under the top band's ${JSON.stringify(s)}`);
    assert.ok(row.x>=0&&row.x+row.width<=layout.zones.viewport.width,`${name}: on screen`);
  }
});
