import test from 'node:test';
import assert from 'node:assert/strict';
import {FlowField,type FlowGrid,type FlowPoint} from '../../src/maps/flowfield.ts';
import {AvenuePlanner,MOUTHS,OPPOSITE,modeForModifier,mouthCount,type AvenueMode,type AvenueState,type CityLayout,type GroupRequest,type Mouth,type PlannedGroup,type PlayerLike,type RngLike} from '../../src/sim/city/avenues.ts';

// Black-box tests of the avenue planner contract. Everything below is derived from the contract only.

// ---------- fixture: a synthetic city with the real proportions (192×192 cells at 0.88 u) ----------
const W=192, CS=0.88, C=96;                       // grid side (cells), cell size (u), plaza center cell
const TPS=20, SPEED=1.79, VIEW=18, MIN_DIST=4, PLAZA_R=6, WARN_TICKS=30, FIRST_TICKS=240;
const ROUND=1;                                     // one tick of slack wherever the contract allows integer rounding
const cellC=(cx:number,cy:number):FlowPoint=>({x:(cx+.5)*CS,y:(cy+.5)*CS});
const dist=(a:FlowPoint,b:FlowPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const PLAZA=cellC(C,C);
const MOUTH_CELL:Record<Mouth,[number,number]>={N:[C,85],S:[C,107],L:[107,C],O:[85,C]};
const SPAWN_CELL:Record<Mouth,[number,number]>={N:[C,3],S:[C,188],L:[188,C],O:[3,C]};
type Rect={x0:number;y0:number;x1:number;y1:number};
/** One cell thick across the 5-cell avenue at each mouth: closes that entrance of the plaza. */
const BARRICADE:Record<Mouth,Rect>={N:{x0:94,y0:85,x1:98,y1:85},S:{x0:94,y0:107,x1:98,y1:107},L:{x0:107,y0:94,x1:107,y1:98},O:{x0:85,y0:94,x1:85,y1:98}};
/** Unit vector from the plaza outward along each avenue (y grows south). */
const OUT:Record<Mouth,FlowPoint>={N:{x:0,y:-1},S:{x:0,y:1},L:{x:1,y:0},O:{x:-1,y:0}};
const HELI=cellC(120,186);                         // heli start, ~21 u east of spawn S
const COURTYARD=cellC(104,88);                     // a single walkable cell sealed inside a building
const MS:Mouth[]=['N','S','L','O'];
const perMouth=<T,>(f:(m:Mouth)=>T)=>({N:f('N'),S:f('S'),L:f('L'),O:f('O')});
const MOUTH_PT=perMouth(m=>cellC(...MOUTH_CELL[m])), SPAWN_PT=perMouth(m=>cellC(...SPAWN_CELL[m]));
/** Point on avenue m at distance d (u) from the plaza center, shifted sideways by `lat` (u). */
const avenuePoint=(m:Mouth,d:number,lat=0):FlowPoint=>({x:PLAZA.x+OUT[m].x*d-OUT[m].y*lat,y:PLAZA.y+OUT[m].y*d+OUT[m].x*lat});

/** Deterministic LCG for the fixture layout and random scenarios (no Math.random). */
const lcg=(seed:number)=>{let s=seed>>>0;return ()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;};
/** Tiny RngLike (mulberry32), seeded per test. */
const rngOf=(seed:number):RngLike=>{let a=seed>>>0;return {next(){a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}};};

interface City {open:Uint8Array;layout:CityLayout;walkableAt(p:FlowPoint):boolean}
/**
 * Outer wall ring; a 5-cell avenue cross from wall to wall through a plaza disc (radius 9 cells ≈ 7.9 u); building blocks
 * separated by streets 2–6 cells wide (and some 1-cell alleys) in each quadrant. The N avenue is walled on both sides, so it
 * reaches the plaza only through mouth N; S, L and O connect to each other through the street grid. A ring of buildings
 * (radius 13 cells) keeps every street off the plaza, so the 4 mouths are its only entrances.
 */
const buildCity=():City=>{
  const open=new Uint8Array(W*W), rnd=lcg(20261012), ri=(lo:number,hi:number)=>lo+Math.floor(rnd()*(hi-lo+1));
  const set=(x0:number,y0:number,x1:number,y1:number,v:number)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)open[y*W+x]=v;};
  const bands=(lo:number,hi:number)=>{const b:[number,number][]=[];for(let p=lo+ri(6,12);p<hi;){const w=rnd()<.15?1:ri(2,6);b.push([p,Math.min(hi,p+w-1)]);p+=w+ri(8,14);}return b;};
  const keep=(x:number,y:number)=>Math.hypot(x-C,y-C)>13;
  for(const [x0,x1,y0,y1] of [[2,91,2,93],[101,189,2,93],[2,93,99,189],[99,189,99,189]]){
    for(const [a,b] of bands(x0,x1))for(let x=a;x<=b;x++)for(let y=y0;y<=y1;y++)if(keep(x,y))open[y*W+x]=1;
    for(const [a,b] of bands(y0,y1))for(let y=a;y<=b;y++)for(let x=x0;x<=x1;x++)if(keep(x,y))open[y*W+x]=1;
  }
  set(94,2,98,189,1); set(2,94,189,98,1);                        // avenue cross
  for(let y=C-9;y<=C+9;y++)for(let x=C-9;x<=C+9;x++)if(Math.hypot(x-C,y-C)<=9)open[y*W+x]=1; // plaza
  set(114,182,126,189,1); set(99,185,113,188,1);                 // helipad and its road to avenue S
  set(103,87,105,89,0); open[88*W+104]=1;                        // sealed courtyard
  set(0,0,W-1,1,0); set(0,W-2,W-1,W-1,0); set(0,0,1,W-1,0); set(W-2,0,W-1,W-1,0); // outer wall
  const grid:FlowGrid={width:W,height:W,cellSize:CS,walkable:(x,y)=>open[y*W+x]===1};
  const walkableAt=(p:FlowPoint)=>{const x=Math.floor(p.x/CS),y=Math.floor(p.y/CS);return x>=0&&y>=0&&x<W&&y<W&&open[y*W+x]===1;};
  return {open,walkableAt,layout:{grid,plaza:PLAZA,plazaRadius:PLAZA_R,mouths:MOUTH_PT,spawns:SPAWN_PT}};
};
/** Raise (closed=true) or remove the barricade at mouth m, then tell the planner. */
const setMouth=(city:City,pl:AvenuePlanner,m:Mouth,closed:boolean)=>{
  const r=BARRICADE[m];
  for(let y=r.y0;y<=r.y1;y++)for(let x=r.x0;x<=r.x1;x++)city.open[y*W+x]=closed?0:1;
  pl.invalidate([r]);
};
/** Reference plaza field (independent of the planner) to decide what the contract expects. */
const refPlaza=(city:City)=>{
  const goals:FlowPoint[]=[];
  for(let y=0;y<W;y++)for(let x=0;x<W;x++){const p=cellC(x,y);if(city.open[y*W+x]&&dist(p,PLAZA)<=PLAZA_R)goals.push(p);}
  return new FlowField(city.layout.grid,goals);
};

// ---------- helpers ----------
const isActive=(p:PlayerLike)=>p.online!==false&&!p.spectator&&!p.eliminated;
const pl0=(id:string,p:FlowPoint,extra:Partial<PlayerLike>={}):PlayerLike=>({id,x:p.x,y:p.y,...extra});
/** Remaining polyline length from the projection of p onto the polyline to its last point. */
const remainingAlong=(pts:readonly FlowPoint[],p:FlowPoint)=>{
  const suf=new Array<number>(pts.length).fill(0);
  for(let i=pts.length-2;i>=0;i--)suf[i]=suf[i+1]+dist(pts[i],pts[i+1]);
  let best=Infinity, rem=0;
  for(let i=0;i+1<pts.length;i++){
    const a=pts[i],b=pts[i+1],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
    const t=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0, q={x:a.x+t*dx,y:a.y+t*dy}, d=dist(p,q);
    if(d<best){best=d;rem=dist(q,b)+suf[i+1];}
  }
  return rem;
};
const polyLen=(pts:readonly FlowPoint[])=>{let s=0;for(let i=1;i<pts.length;i++)s+=dist(pts[i-1],pts[i]);return s;};
/** Point walker with collision against blocked cells (slides along walls); undefined when stuck or out of steps. */
const walk=(city:City,start:FlowPoint,dir:(p:FlowPoint,out:FlowPoint)=>FlowPoint,done:(p:FlowPoint)=>boolean,step=.25,max=3000)=>{
  let p={...start}; const out={x:0,y:0};
  for(let i=0;i<max;i++){
    if(done(p))return p;
    const d=dir(p,out);
    assert.ok(Number.isFinite(d.x)&&Number.isFinite(d.y),'finite direction');
    if(d.x===0&&d.y===0)return undefined;
    assert.ok(Math.abs(Math.hypot(d.x,d.y)-1)<1e-6,`unit direction at (${p.x.toFixed(2)},${p.y.toFixed(2)})`);
    const q=[{x:p.x+d.x*step,y:p.y+d.y*step},{x:p.x+d.x*step,y:p.y},{x:p.x,y:p.y+d.y*step}].find(c=>(c.x!==p.x||c.y!==p.y)&&city.walkableAt(c));
    if(!q)return undefined;
    p=q;
  }
  return undefined;
};
const st=(open:Mouth[],mode:AvenueMode='normal',round=3):AvenueState=>({round,mode,open,alternate:0,uses:{N:0,S:0,L:0,O:0}});
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
/** Common per-group invariants: index, mouth, ticks. */
const checkTicks=(g:PlannedGroup,n:number,state:AvenueState,msg:string)=>{
  assert.ok(Number.isInteger(g.index)&&g.index>=0&&g.index<n,`${msg}: index ${g.index}`);
  assert.ok(state.open.includes(g.mouth),`${msg}: mouth ${g.mouth} not open (${state.open})`);
  assert.ok(Number.isFinite(g.releaseTick)&&g.releaseTick>=0,`${msg}: releaseTick ${g.releaseTick}`);
  assert.ok(Math.abs(g.warnTick-(g.releaseTick-WARN_TICKS))<1e-9,`${msg}: warnTick ${g.warnTick} vs release ${g.releaseTick}`);
  if(g.points.length)assert.ok(Number.isFinite(g.arrivalTick)&&g.arrivalTick>=g.releaseTick,`${msg}: arrival ${g.arrivalTick} < release ${g.releaseTick}`);
};

// ---------- tests ----------
test('modeForModifier and mouthCount follow the contract tables', ()=>{
  assert.deepEqual([...MOUTHS],['N','S','L','O']);
  assert.deepEqual({...OPPOSITE},{N:'S',S:'N',L:'O',O:'L'});
  assert.equal(modeForModifier('company-trip'),'excursao');
  assert.equal(modeForModifier('conga-line'),'alternado');
  assert.equal(modeForModifier('frescobol'),'alternado');
  assert.equal(modeForModifier('surprise-party'),'cerco');
  assert.equal(modeForModifier('uncle-hug'),'cerco');
  assert.equal(modeForModifier(undefined,true),'cerco');
  assert.equal(modeForModifier('nonexistent-modifier'),'normal');
  assert.equal(modeForModifier(undefined),'normal');
  assert.equal(modeForModifier(),'normal');
  assert.equal(modeForModifier(undefined,false),'normal');
  const normal:[number,number][]=[[1,1],[2,1],[3,2],[4,2],[5,2],[6,3],[7,3],[8,3],[9,4],[10,4]];
  for(const [r,n] of normal)assert.equal(mouthCount(r,'normal'),n,`normal round ${r}`);
  for(const r of [0,-3])assert.equal(mouthCount(r,'normal'),1,`normal round ${r} clamps to 1`);
  for(const r of [11,25])assert.equal(mouthCount(r,'normal'),4,`normal round ${r} clamps to 4`);
  for(let r=1;r<=10;r++){
    assert.equal(mouthCount(r,'cerco'),4); assert.equal(mouthCount(r,'excursao'),1); assert.equal(mouthCount(r,'alternado'),2);
  }
});

test('route(): spawn → plaza per mouth, walkable, not shorter than the straight line, not blocked', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  for(const m of MS){
    const r=pl.route(m);
    assert.ok(r,`route ${m} exists`);
    assert.equal(r.blocked,false,`route ${m} open`);
    assert.ok(r.points.length>=2,`route ${m} has points`);
    assert.ok(dist(r.points[0],SPAWN_PT[m])<=CS,`route ${m} starts at the spawn (${JSON.stringify(r.points[0])})`);
    const last=r.points[r.points.length-1];
    // The goal is the set of cells whose centers lie within the radius; one cell of slack covers any point of such a cell.
    assert.ok(dist(last,PLAZA)<=PLAZA_R+CS,`route ${m} ends in the plaza (${dist(last,PLAZA).toFixed(2)} u)`);
    for(const p of r.points)assert.ok(city.walkableAt(p),`route ${m} point (${p.x},${p.y}) walkable`);
    assert.ok(r.length>=dist(r.points[0],last)-1e-9,`route ${m} length ≥ straight line`);
    assert.ok(r.length>=dist(SPAWN_PT[m],PLAZA)-PLAZA_R-CS,`route ${m} length ≥ spawn→plaza edge`);
    const pl2=polyLen(r.points);
    assert.ok(Math.abs(r.length-pl2)<=.02*pl2,`route ${m} length ${r.length} matches its polyline ${pl2}`);
  }
});

test('openRound(): deterministic, JSON-safe, mode rules, rotation toward less-used mouths', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  for(let seed=1;seed<=20;seed++){
    const a=pl.openRound(1,'normal',rngOf(seed)), b=pl.openRound(1,'normal',rngOf(seed));
    assert.deepEqual(a,b,`seed ${seed}: same seed, same state`);
    assert.deepEqual(JSON.parse(JSON.stringify(a)),a,`seed ${seed}: JSON round-trip`);
    assert.equal(a.round,1); assert.equal(a.mode,'normal'); assert.equal(a.open.length,1);
    for(const m of MS)assert.ok(Number.isFinite(a.uses[m]),`uses.${m}`);
    // Same state in (cloned, as a checkpoint would restore it) → same state out.
    const c=pl.openRound(2,'normal',rngOf(seed+100),clone(a)), d=pl.openRound(2,'normal',rngOf(seed+100),JSON.parse(JSON.stringify(a)) as AvenueState);
    assert.deepEqual(c,d,`seed ${seed}: restored checkpoint gives the same round`);
    // A mouth just used is never preferred while three unused ones remain.
    assert.notEqual(c.open[0],a.open[0],`seed ${seed}: round 2 rotates away from round 1's mouth`);
    const cer=pl.openRound(4,'cerco',rngOf(seed),clone(a));
    assert.deepEqual(cer.open,[...MOUTHS],`seed ${seed}: cerco opens all 4 in MOUTHS order`);
    assert.equal(cer.mode,'cerco');
    const alt=pl.openRound(5,'alternado',rngOf(seed),clone(a));
    assert.equal(alt.open.length,2); assert.equal(alt.open[1],OPPOSITE[alt.open[0]],`seed ${seed}: alternado opens an opposite pair`);
    const exc=pl.openRound(6,'excursao',rngOf(seed),clone(a));
    assert.equal(exc.open.length,1,`seed ${seed}: excursao opens 1`);
    // 8 consecutive normal rounds: counts follow mouthCount and every mouth gets used.
    let s:AvenueState|undefined, used=new Set<Mouth>();
    const rng=rngOf(seed*7);
    for(let r=1;r<=8;r++){
      s=pl.openRound(r,'normal',rng,s===undefined?undefined:clone(s));
      assert.equal(s.round,r);
      assert.equal(s.open.length,mouthCount(r,'normal'),`seed ${seed} round ${r}: open count`);
      assert.equal(new Set(s.open).size,s.open.length,`seed ${seed} round ${r}: distinct mouths`);
      for(const m of s.open){assert.ok(MS.includes(m));used.add(m);}
      assert.deepEqual(JSON.parse(JSON.stringify(s)),s);
    }
    assert.equal(used.size,4,`seed ${seed}: every mouth used over 8 normal rounds (${[...used]})`);
  }
});

test('ACCEPTANCE: 20 seeds — every planned point is walkable, hidden and away from active players', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  // hiddenFrom rules on their own: active players see within viewRadius; downed still see; offline/spectator/eliminated don't.
  const q=avenuePoint('S',40);
  const near=(d:number)=>({x:q.x+d,y:q.y});
  assert.equal(pl.hiddenFrom([],q),true);
  assert.equal(pl.hiddenFrom([pl0('a',near(10))],q),false);
  assert.equal(pl.hiddenFrom([pl0('a',near(19))],q),true);
  assert.equal(pl.hiddenFrom([pl0('a',near(10),{downed:true})],q),false);
  for(const extra of [{online:false},{spectator:true},{eliminated:true}])assert.equal(pl.hiddenFrom([pl0('a',near(2),extra)],q),true,JSON.stringify(extra));
  const blind=new AvenuePlanner(city.layout,{isVisible:()=>false});
  assert.equal(blind.hiddenFrom([pl0('a',near(3))],q),false,'minPlayerDistance still applies with isVisible');
  assert.equal(blind.hiddenFrom([pl0('a',near(5))],q),true);
  const seeAll=new AvenuePlanner(city.layout,{isVisible:()=>true});
  assert.equal(seeAll.hiddenFrom([pl0('a',near(60))],q),false,'isVisible overrides viewRadius');

  const modes:AvenueMode[]=['normal','cerco','alternado'];
  let total=0;
  for(let seed=1;seed<=20;seed++){
    const rnd=lcg(seed*977), ri=(lo:number,hi:number)=>lo+Math.floor(rnd()*(hi-lo+1));
    const anyWalkable=()=>{for(;;){const p=cellC(ri(2,189),ri(2,189));if(city.walkableAt(p))return p;}};
    const inPlaza=()=>{const a=rnd()*Math.PI*2,r=rnd()*4;return {x:PLAZA.x+Math.cos(a)*r,y:PLAZA.y+Math.sin(a)*r};};
    const onAvenue=()=>avenuePoint(MS[ri(0,3)],20+rnd()*55,(rnd()-.5)*3.5);
    const players:PlayerLike[]=[];
    for(let i=ri(1,2);i>0;i--)players.push(pl0(`plaza${i}`,inPlaza()));
    for(let i=ri(1,2);i>0;i--)players.push(pl0(`city${i}`,anyWalkable()));
    for(let i=ri(1,2);i>0;i--)players.push(pl0(`avenue${i}`,onAvenue()));
    players.push(pl0('heli',HELI),pl0('downed',anyWalkable(),{downed:true}));
    players.push(pl0('offline',onAvenue(),{online:false}),pl0('spec',onAvenue(),{spectator:true}),pl0('elim',onAvenue(),{eliminated:true}));
    const active=players.filter(isActive);
    assert.equal(active.length,players.length-3);
    const mode=modes[seed%3], round=ri(1,10);
    const state=pl.openRound(round,mode,rngOf(seed));
    const reqs:GroupRequest[]=[]; let at=ri(0,40);
    for(let i=ri(4,8);i>0;i--){reqs.push({at,size:ri(2,6)});at+=ri(20,200);}
    const groups=pl.planGroups(reqs,players,state,rngOf(seed+1));
    for(let k=0;k<reqs.length;k++)assert.ok(groups.some(g=>g.index===k),`seed ${seed}: request ${k} answered`);
    const perIndex=new Map<number,number>();
    for(const g of groups){
      const msg=`seed ${seed} ${mode} group ${g.index}/${g.mouth}`;
      checkTicks(g,reqs.length,state,msg);
      perIndex.set(g.index,(perIndex.get(g.index)??0)+g.points.length);
      for(const p of g.points){
        total++;
        assert.ok(city.walkableAt(p),`${msg}: point (${p.x.toFixed(2)},${p.y.toFixed(2)}) walkable`);
        assert.equal(pl.hiddenFrom(players,p),true,`${msg}: hiddenFrom`);
        for(const a of active){
          const d=dist(a,p);
          assert.ok(d>=MIN_DIST&&d>=VIEW,`${msg}: point ${d.toFixed(2)} u from active player ${a.id}`);
        }
      }
    }
    for(const [k,n] of perIndex)assert.ok(n<=reqs[k].size,`seed ${seed}: group ${k} has ${n} > ${reqs[k].size} members`);
  }
  assert.ok(total>0,'the planner placed some members');
});

test('ACCEPTANCE: first group reaches the plaza ≤ 12 s; travel matches route distance / enemySpeed', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  const routes=perMouth(m=>pl.route(m)!);
  // Tolerance: the member may sit up to half an avenue width (2.2 u) off the route's lane, and the route's last point may be
  // anywhere in its goal cell (≤ 0.62 u); 3 u of path at 1.79 u/s ≈ 34 ticks, plus one tick of rounding.
  const TOL=3/SPEED*TPS+ROUND;
  for(let seed=1;seed<=20;seed++){
    const rnd=lcg(seed*31+5);
    const players:PlayerLike[]=[];
    for(let i=1+Math.floor(rnd()*4);i>0;i--){const a=rnd()*Math.PI*2,r=rnd()*4;players.push(pl0(`p${i}`,{x:PLAZA.x+Math.cos(a)*r,y:PLAZA.y+Math.sin(a)*r}));}
    const reqs:GroupRequest[]=[{at:0,size:3+Math.floor(rnd()*3)},{at:80,size:4},{at:160,size:5}];
    for(const [mode,round] of [['normal',1+seed%10],['cerco',4],['alternado',5],['excursao',6]] as [AvenueMode,number][]){
      const state=pl.openRound(round,mode,rngOf(seed));
      const groups=pl.planGroups(reqs,players,state,rngOf(seed+50));
      const first=groups.filter(g=>g.index===0&&g.points.length>0);
      assert.ok(first.length>0,`seed ${seed} ${mode}: first group placed`);
      for(const g of first)assert.ok(g.arrivalTick<=FIRST_TICKS,`seed ${seed} ${mode}: first group (${g.mouth}) arrives at tick ${g.arrivalTick}`);
      for(const g of groups){
        if(!g.points.length)continue;
        const want=remainingAlong(routes[g.mouth].points,g.points[0])/SPEED*TPS, got=g.arrivalTick-g.releaseTick;
        assert.ok(Math.abs(got-want)<=TOL,`seed ${seed} ${mode} group ${g.index}/${g.mouth}: travel ${got} ticks vs route ${want.toFixed(1)}`);
      }
    }
  }
});

test('cadence: arrivals keep the requested spacing; far mouths are released earlier (no 36 s gap)', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  const plaza=[pl0('a',PLAZA),pl0('b',{x:PLAZA.x+2,y:PLAZA.y+1})];
  const reqs:GroupRequest[]=[{at:20,size:4},{at:80,size:2},{at:140,size:5},{at:400,size:3},{at:420,size:6}];
  for(const state of [st(['S','O']),st(['N','S','L','O'],'cerco',4),st(['L','O'],'alternado',5),st(['N'],'excursao',6),st(['N','S','L'],'normal',7)]){
    const groups=pl.planGroups(reqs,plaza,clone(state),rngOf(9));
    for(const g of groups){
      const msg=`${state.mode} group ${g.index}/${g.mouth}`;
      checkTicks(g,reqs.length,state,msg);
      if(!g.points.length)continue;
      // Players only at the plaza: every travel is < 12 s, so arrival_k = 12 s + (at_k − at_0) and release_k > 0.
      assert.ok(g.releaseTick>0,`${msg}: released after round start`);
      assert.ok(Math.abs(g.arrivalTick-(FIRST_TICKS+reqs[g.index].at-reqs[0].at))<=ROUND,`${msg}: arrival ${g.arrivalTick}`);
    }
    for(let k=0;k<reqs.length;k++)assert.ok(groups.some(g=>g.index===k&&g.points.length),`${state.mode}: group ${k} placed`);
  }
  // Same `at`, one far mouth (a player 25 u out on avenue N pushes N's group behind him) and one near mouth (L).
  const players=[...plaza,pl0('n',avenuePoint('N',25))];
  const state=st(['N','L']);
  const groups=pl.planGroups([{at:20,size:3},{at:20,size:3}],players,clone(state),rngOf(3));
  const far=groups.find(g=>g.mouth==='N'&&g.points.length), nearG=groups.find(g=>g.mouth==='L'&&g.points.length);
  assert.ok(far&&nearG,`both mouths used: ${groups.map(g=>g.mouth+':'+g.points.length)}`);
  for(const g of groups)checkTicks(g,2,state,`far/near ${g.mouth}`);
  const tFar=far.arrivalTick-far.releaseTick, tNear=nearG.arrivalTick-nearG.releaseTick;
  assert.ok(tFar>tNear+100,`fixture: N group really is farther (${tFar} vs ${tNear} ticks)`);
  assert.ok(far.releaseTick<=nearG.releaseTick,`far released first (${far.releaseTick} vs ${nearG.releaseTick})`);
  // The only gap allowed is what the far group physically can't make up after a release at tick 0.
  const gap=Math.abs(far.arrivalTick-nearG.arrivalTick);
  assert.ok(gap<=Math.max(0,tFar-FIRST_TICKS)+ROUND,`arrival gap ${gap} ticks`);
  assert.ok(gap<36*TPS,'no 36 s gap');
  // The first group's arrival is max(12 s, its own travel).
  const g0=groups.find(g=>g.index===0)!;
  assert.ok(Math.abs(g0.arrivalTick-Math.max(FIRST_TICKS,g0.arrivalTick-g0.releaseTick))<=ROUND,`group 0 arrival ${g0.arrivalTick}`);
});

test('modes in planGroups: cerco splits each group over the 4 mouths; alternado alternates the pair; excursao uses one', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  const players=[pl0('a',PLAZA)];
  const reqs:GroupRequest[]=[{at:0,size:4},{at:100,size:6},{at:200,size:9},{at:300,size:2}];
  for(let seed=1;seed<=5;seed++){
    const cer=pl.openRound(4,'cerco',rngOf(seed));
    const groups=pl.planGroups(reqs,players,cer,rngOf(seed));
    reqs.forEach((r,k)=>{
      const parts=groups.filter(g=>g.index===k);
      assert.equal(new Set(parts.map(g=>g.mouth)).size,parts.length,`seed ${seed} group ${k}: one part per mouth`);
      assert.equal(parts.reduce((s,g)=>s+g.points.length,0),r.size,`seed ${seed} group ${k}: members sum to the size`);
      if(r.size>=4){
        assert.equal(parts.length,4,`seed ${seed} group ${k}: 4 parts`);
        assert.deepEqual(parts.map(g=>g.mouth).sort(),[...MS].sort());
        for(const g of parts)assert.ok(g.points.length>=1,`seed ${seed} group ${k}/${g.mouth}: part not empty`);
      }else assert.ok(parts.length<=4);
    });
    const many:GroupRequest[]=[0,60,120,180,240].map(at=>({at,size:3}));
    const alt=pl.openRound(5,'alternado',rngOf(seed));
    const ag=pl.planGroups(many,players,alt,rngOf(seed)).sort((a,b)=>a.index-b.index);
    assert.equal(ag.length,many.length);
    for(const g of ag)assert.ok(alt.open.includes(g.mouth)&&g.points.length===3);
    for(let k=1;k<ag.length;k++)assert.notEqual(ag[k].mouth,ag[k-1].mouth,`seed ${seed}: alternado alternates by k`);
    const exc=pl.openRound(6,'excursao',rngOf(seed));
    const eg=pl.planGroups(many,players,exc,rngOf(seed));
    assert.equal(eg.length,many.length);
    for(const g of eg)assert.ok(g.mouth===exc.open[0]&&g.points.length===3,`seed ${seed}: excursao uses its single mouth`);
  }
});

test('visible avenue: groups go behind the viewer, a covered mouth is skipped, full coverage gives points=[]', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  const reqs:GroupRequest[]=[{at:0,size:4},{at:60,size:3},{at:120,size:5}];
  // (a) A player 35 u out on avenue S (and one at the plaza): S's groups go behind him, on the spawn side.
  const watcher=pl0('w',avenuePoint('S',35));
  const a=pl.planGroups(reqs,[pl0('c',PLAZA),watcher],st(['S'],'normal',1),rngOf(1));
  for(let k=0;k<reqs.length;k++){
    const g=a.find(x=>x.index===k);
    assert.ok(g&&g.mouth==='S'&&g.points.length===reqs[k].size,`(a) group ${k}: placed on S (spawn end is not visible)`);
    for(const p of g.points){
      assert.ok(dist(p,watcher)>=VIEW,`(a) group ${k}: ${dist(p,watcher).toFixed(2)} u from the watcher`);
      assert.ok(p.y-PLAZA.y>35,`(a) group ${k}: point behind the watcher (${(p.y-PLAZA.y).toFixed(2)} u out)`);
    }
  }
  // (b) Avenue S fully watched up to its spawn end: S is skipped and L takes every group.
  const coverS=[pl0('c',PLAZA),pl0('s30',avenuePoint('S',30)),pl0('s60',avenuePoint('S',60)),pl0('sEnd',SPAWN_PT.S)];
  const b=pl.planGroups(reqs,coverS,st(['S','L'],'normal',3),rngOf(2));
  for(let k=0;k<reqs.length;k++){
    const gs=b.filter(x=>x.index===k&&x.points.length);
    assert.equal(gs.length,1,`(b) group ${k} placed once`);
    assert.equal(gs[0].mouth,'L',`(b) group ${k} skips S`);
    assert.equal(gs[0].points.length,reqs[k].size);
  }
  assert.ok(b.every(g=>g.mouth!=='S'||g.points.length===0),'(b) nothing placed on S');
  // (c) Every avenue watched end to end: every group comes back with points=[].
  const coverAll=[pl0('c',PLAZA),...MS.flatMap(m=>[pl0(m+'30',avenuePoint(m,30)),pl0(m+'60',avenuePoint(m,60)),pl0(m+'End',SPAWN_PT[m])])];
  const c=pl.planGroups(reqs,coverAll,st([...MS],'normal',9),rngOf(3));
  for(let k=0;k<reqs.length;k++)assert.ok(c.some(g=>g.index===k),`(c) group ${k} returned`);
  for(const g of c)assert.deepEqual(g.points,[],`(c) group ${g.index}/${g.mouth} has no points`);
  // (d) Only inactive players (eliminated at the plaza, offline/spectator on the avenues): they hide nothing.
  const ghosts=[pl0('e',PLAZA,{eliminated:true}),...MS.map(m=>pl0('o'+m,avenuePoint(m,30),{online:false})),...MS.map(m=>pl0('s'+m,SPAWN_PT[m],{spectator:true}))];
  const d=pl.planGroups(reqs,ghosts,st([...MS],'cerco',4),rngOf(4));
  for(let k=0;k<reqs.length;k++)assert.equal(d.filter(g=>g.index===k).reduce((s,g)=>s+g.points.length,0),reqs[k].size,`(d) group ${k} complete`);
  const closest=Math.min(...d.flatMap(g=>g.points.map(p=>dist(p,PLAZA))));
  assert.ok(closest<VIEW,`(d) inactive players don't push groups away from the plaza (closest ${closest.toFixed(2)} u)`);
});

test('targetFor/directionFor: plaza when open, own barricade when the mouth is closed, plaza again when reopened', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  const enemy=(m:Mouth)=>avenuePoint(m,40);
  const inPlaza=(p:FlowPoint)=>dist(p,PLAZA)<=PLAZA_R+CS;
  const toPlaza=(p:FlowPoint,out:FlowPoint)=>pl.directionFor(p,{kind:'plaza'},out);
  for(const m of MS){
    assert.deepEqual(pl.targetFor(enemy(m)),{kind:'plaza'},`${m}: open → plaza`);
    assert.ok(walk(city,enemy(m),toPlaza,inPlaza),`${m}: following directionFor reaches the plaza`);
  }
  assert.deepEqual(pl.targetFor(COURTYARD),{kind:'none'},'sealed courtyard → none');
  setMouth(city,pl,'N',true);
  assert.equal(refPlaza(city).reachable(enemy('N').x,enemy('N').y),false,'fixture: avenue N only connects through mouth N');
  assert.deepEqual(pl.targetFor(enemy('N')),{kind:'barricade',mouth:'N'},'N closed → its barricade');
  const atN=(p:FlowPoint)=>dist(p,MOUTH_PT.N)<=1.5+CS;
  assert.ok(walk(city,enemy('N'),(p,out)=>pl.directionFor(p,{kind:'barricade',mouth:'N'},out),atN),'N closed: reaches the barricade');
  const rN=pl.route('N');
  assert.ok(rN&&rN.blocked,'route N blocked');
  assert.ok(dist(rN.points[0],SPAWN_PT.N)<=CS&&atN(rN.points[rN.points.length-1]),'blocked route N: spawn → barricade');
  for(const m of ['S','L','O'] as Mouth[]){
    assert.deepEqual(pl.targetFor(enemy(m)),{kind:'plaza'},`${m} still open`);
    assert.equal(pl.route(m)?.blocked,false);
  }
  // Closing S too: S's avenue reaches the plaza through the streets and another mouth iff the reference field says so.
  setMouth(city,pl,'S',true);
  const viaStreets=refPlaza(city).reachable(enemy('S').x,enemy('S').y);
  assert.deepEqual(pl.targetFor(enemy('S')),viaStreets?{kind:'plaza'}:{kind:'barricade',mouth:'S'},'S closed');
  if(viaStreets)assert.ok(walk(city,enemy('S'),toPlaza,inPlaza,.25,6000),'S closed: reaches the plaza through another mouth');
  setMouth(city,pl,'S',false);
  setMouth(city,pl,'N',false);
  assert.deepEqual(pl.targetFor(enemy('N')),{kind:'plaza'},'N reopened → plaza');
  assert.equal(pl.route('N')?.blocked,false);
  assert.ok(walk(city,enemy('N'),toPlaza,inPlaza),'N reopened: reaches the plaza');
});

test('retreat: retreatMouth names the avenue and retreatDirection walks to its spawn end', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  for(const m of MS){
    for(const p of [avenuePoint(m,30,1.2),avenuePoint(m,45,-1.5),avenuePoint(m,65,.5),SPAWN_PT[m]]){
      const at=`${m} from (${p.x.toFixed(1)},${p.y.toFixed(1)})`;
      assert.equal(pl.retreatMouth(p),m,`${at}: retreatMouth`);
      const end=walk(city,p,(q,out)=>pl.retreatDirection(q,out),q=>dist(q,SPAWN_PT[m])<=2);
      assert.ok(end,`${at}: reaches within 2 u of spawn ${m}`);
    }
  }
});

test('determinism: identical inputs give identical outputs; seeds change mouth choices', ()=>{
  const plA=new AvenuePlanner(buildCity().layout), plB=new AvenuePlanner(buildCity().layout);
  const players=[pl0('a',PLAZA),pl0('b',avenuePoint('L',30)),pl0('h',HELI),pl0('d',avenuePoint('O',50),{downed:true})];
  const reqs:GroupRequest[]=[{at:0,size:4},{at:90,size:5},{at:200,size:3},{at:260,size:6}];
  for(const mode of ['normal','cerco','alternado','excursao'] as AvenueMode[]){
    const sA=plA.openRound(6,mode,rngOf(42)), sB=plB.openRound(6,mode,rngOf(42));
    assert.deepEqual(sA,sB,`${mode}: same state`);
    const gA=plA.planGroups(reqs,players,clone(sA),rngOf(43)), gB=plB.planGroups(reqs,players,clone(sB),rngOf(43));
    assert.deepEqual(gA,gB,`${mode}: same plan on twin planners`);
    assert.deepEqual(plA.planGroups(reqs,players,clone(sA),rngOf(43)),gA,`${mode}: same plan when repeated`);
  }
  const seqs=new Set<string>();
  for(let seed=1;seed<=12;seed++){
    let s:AvenueState|undefined; const rng=rngOf(seed*1009), seq:string[]=[];
    for(let r=1;r<=5;r++){s=plA.openRound(r,'normal',rng,s===undefined?undefined:clone(s));seq.push(s.open.join(''));}
    seqs.add(seq.join('|'));
  }
  assert.ok(seqs.size>=2,`different seeds pick different mouths (${[...seqs]})`);
});

test('groups never appear inside the base: even with nobody watching, every member stands past the mouth line', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  const reqs:GroupRequest[]=[{at:0,size:6},{at:40,size:4},{at:80,size:5},{at:120,size:3}];
  for(const mode of ['normal','cerco','alternado','excursao'] as AvenueMode[]){
    for(let seed=1;seed<=10;seed++){
      const rng=rngOf(seed),state=pl.openRound(mode==='normal'?9:3,mode,rng);
      // Only inactive players: nothing is visible, so the planner is free to go as close as it wants.
      const ghosts=[pl0('off',PLAZA,{online:false}),pl0('spec',PLAZA,{spectator:true})];
      for(const g of pl.planGroups(reqs,ghosts,state,rng)){
        assert.ok(g.points.length>0,`${mode}#${seed} group ${g.index} placed`);
        const edge=dist(MOUTH_PT[g.mouth],PLAZA)+2;
        for(const p of g.points)assert.ok(dist(p,PLAZA)>=edge-1e-9,`${mode}#${seed} ${g.mouth} member at ${dist(p,PLAZA).toFixed(2)} u < ${edge.toFixed(2)} u from the plaza`);
        assert.ok(g.arrivalTick>g.releaseTick,`${mode}#${seed} group ${g.index} still has to walk to the plaza`);
      }
    }
  }
});
