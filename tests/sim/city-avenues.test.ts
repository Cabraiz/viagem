import test from 'node:test';
import assert from 'node:assert/strict';
import {FlowField,type FlowGrid,type FlowPoint} from '../../src/maps/index.ts';
import {visibleOffset} from '../../src/contract/index.ts';
import {SCALE_PROFILES} from '../../src/rules/index.ts';
import {AvenuePlanner,CITY_VIEW_SCALE,MOUTHS,OPPOSITE,cityVisible,modeForModifier,mouthCount,type AvenueMode,type AvenuePlannerOptions,type AvenueState,type CityLayout,type GroupRequest,type Mouth,type PlannedGroup,type PlayerLike,type RngLike} from '../../src/sim/city/avenues.ts';

// Black-box tests of the avenue planner contract (avenues-spec + addendum v2). Expectations come from the contract and
// from references rebuilt here (plaza flood, mouth lines, camera visibility), never from the planner's internals.

// ---------- shared constants and helpers ----------
const W=192, CS=0.88, C=96;                        // grid side (cells), cell size (u), old fixture's plaza center cell
const TPS=20, SPEED=1.79, MIN_DIST=4, PLAZA_R=6, WARN_TICKS=30, FIRST_TICKS=240;
const ROUND=1;                                     // one tick of slack wherever the contract allows integer rounding
const MOUTH_HALF=2.6, OUTSIDE=2;                   // addendum §1: mouth line half width; members ≥ 2 u past the base exit
/** Slack (u) between "the route's last base cell" (cell center) and the outermost route sample still in that cell. */
const EXIT_TOL=.65;
const STACK_TICKS=2*TPS, STACK_GAP=.8;             // addendum §6
const MS:Mouth[]=['N','S','L','O'];
/** Addendum §4: city camera scale k and the default lead (hero speed × warning seconds ≈ 3 u). */
const VIEW_K=SCALE_PROFILES['cidade-nevada'].hero.drawnSize/SCALE_PROFILES.infinito.hero.drawnSize;
const LEAD=SCALE_PROFILES['cidade-nevada'].hero.speed*1.5;
const cellC=(cx:number,cy:number):FlowPoint=>({x:(cx+.5)*CS,y:(cy+.5)*CS});
const cellOf=(p:FlowPoint)=>{const x=Math.floor(p.x/CS),y=Math.floor(p.y/CS);return x>=0&&y>=0&&x<W&&y<W?y*W+x:-1;};
const dist=(a:FlowPoint,b:FlowPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const perMouth=<T,>(f:(m:Mouth)=>T)=>({N:f('N'),S:f('S'),L:f('L'),O:f('O')});
const centroid=(ps:readonly FlowPoint[])=>({x:ps.reduce((s,p)=>s+p.x,0)/ps.length,y:ps.reduce((s,p)=>s+p.y,0)/ps.length});
const segDist=(p:FlowPoint,a:FlowPoint,b:FlowPoint)=>{
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
/** Deterministic LCG for fixture layouts and random scenarios (no Math.random). */
const lcg=(seed:number)=>{let s=seed>>>0;return ()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;};
/** Tiny RngLike (mulberry32), seeded per test. */
const rngOf=(seed:number):RngLike=>{let a=seed>>>0;return {next(){a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}};};

/** Default city visibility rebuilt from the ports (addendum §4): offset shrunk by the lead, divided by k, camera union. */
const refVisible=(v:FlowPoint,p:FlowPoint,lead=LEAD)=>{
  const dx=p.x-v.x,dy=p.y-v.y,d=Math.hypot(dx,dy),f=d>0?Math.max(0,d-lead)/d:0;
  return visibleOffset(dx*f/VIEW_K,dy*f/VIEW_K);
};
/** False for samples within 0.01 u of the visibility edge (float noise between two correct implementations). */
const clearCut=(v:FlowPoint,p:FlowPoint,lead=LEAD)=>refVisible(v,p,lead-.01)===refVisible(v,p,lead+.01);

type Rect={x0:number;y0:number;x1:number;y1:number};
interface City {
  name:string; open:Uint8Array; orig:Uint8Array; layout:CityLayout;
  center:FlowPoint;                                // plaza flood seed (centroid of the mouths unless overridden)
  cap:number;                                      // flood cap: max mouth distance (and plazaRadius when given)
  barricades:Record<Mouth,Rect>; heli:FlowPoint;
  walkableAt(p:FlowPoint):boolean;
  /** Point on avenue m about d u from the plaza center, shifted sideways by `lat` u. */
  out(m:Mouth,d:number,lat?:number):FlowPoint;
}
const finishCity=(name:string,open:Uint8Array,layout:Omit<CityLayout,'grid'>,barricades:Record<Mouth,Rect>,heli:FlowPoint,out:City['out']):City=>{
  const grid:FlowGrid={width:W,height:W,cellSize:CS,walkable:(x,y)=>open[y*W+x]===1};
  const full={...layout,grid} as CityLayout;
  const center=layout.plazaCenter??centroid(MS.map(m=>layout.mouths[m]));
  const cap=Math.min(Math.max(...MS.map(m=>dist(layout.mouths[m],center))),layout.plazaRadius??Infinity);
  const walkableAt=(p:FlowPoint)=>{const i=cellOf(p);return i>=0&&open[i]===1;};
  return {name,open,orig:open.slice(),layout:full,center,cap,barricades,heli,walkableAt,out};
};

// ---------- fixture 1: synthetic city, symmetric plaza (192×192 cells at 0.88 u) ----------
const PLAZA=cellC(C,C);
const MOUTH_CELL:Record<Mouth,[number,number]>={N:[C,85],S:[C,107],L:[107,C],O:[85,C]};
const SPAWN_CELL:Record<Mouth,[number,number]>={N:[C,3],S:[C,188],L:[188,C],O:[3,C]};
/** One cell thick across the 5-cell avenue at each mouth: closes that entrance of the plaza. */
const BARRICADE:Record<Mouth,Rect>={N:{x0:94,y0:85,x1:98,y1:85},S:{x0:94,y0:107,x1:98,y1:107},L:{x0:107,y0:94,x1:107,y1:98},O:{x0:85,y0:94,x1:85,y1:98}};
/** Unit vector from the plaza outward along each avenue (y grows south). */
const OUT:Record<Mouth,FlowPoint>={N:{x:0,y:-1},S:{x:0,y:1},L:{x:1,y:0},O:{x:-1,y:0}};
const COURTYARD=cellC(104,88);                     // a single walkable cell sealed inside a building
const MOUTH_PT=perMouth(m=>cellC(...MOUTH_CELL[m])), SPAWN_PT=perMouth(m=>cellC(...SPAWN_CELL[m]));
/** Point on avenue m at distance d (u) from the plaza center, shifted sideways by `lat` (u). */
const avenuePoint=(m:Mouth,d:number,lat=0):FlowPoint=>({x:PLAZA.x+OUT[m].x*d-OUT[m].y*lat,y:PLAZA.y+OUT[m].y*d+OUT[m].x*lat});
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
  return finishCity('synthetic',open,{plaza:PLAZA,plazaRadius:PLAZA_R,mouths:MOUTH_PT,spawns:SPAWN_PT},BARRICADE,cellC(120,186),avenuePoint);
};

// ---------- fixture 2: the real asset's proportions and asymmetry ----------
/**
 * Real city numbers (avenues-spec): plaza point 2.9 u south of mouth N; mouths ≈ ±6.7 u (N/S) and ±12 u (L/O) around
 * their centroid; spawns at the avenue ends; heli ~21 u from spawn S.
 */
const REAL={
  plaza:{x:84.6,y:82.4},
  mouths:{N:{x:84.2,y:79.5},S:{x:84.2,y:93.0},L:{x:96.0,y:86.8},O:{x:72.1,y:86.8}} as Record<Mouth,FlowPoint>,
  spawns:{N:{x:83.5,y:14.4},S:{x:78.7,y:160.5},L:{x:158.3,y:88.1},O:{x:10.0,y:87.0}} as Record<Mouth,FlowPoint>,
  heli:{x:100.0,y:160.1},
};
const REAL_CENTER=centroid(MS.map(m=>REAL.mouths[m]));
const REAL_BARRICADE:Record<Mouth,Rect>={N:{x0:88,y0:90,x1:100,y1:90},S:{x0:88,y0:105,x1:100,y1:105},L:{x0:109,y0:92,x1:109,y1:104},O:{x0:81,y0:92,x1:81,y1:104}};
/**
 * Walled elliptic plaza (semi-axes 11.2 × 6.3 u around the mouths' centroid) closed except the 4 mouths; avenues 4–4.4 u
 * wide from each mouth to its spawn; avenue N walled end to end (only mouth N); one street joins avenues S and L far from
 * the plaza (so a closed S detours through mouth L); helipad road to avenue S. Variants: `leak` opens a side street from the
 * plaza to avenue L that bypasses mouth L; `fountain` blocks the centroid's cell (the flood must seed from `plaza`).
 */
const buildRealCity=(variant:{leak?:boolean;fountain?:boolean;plazaCenter?:FlowPoint}={}):City=>{
  const open=new Uint8Array(W*W), c=REAL_CENTER;
  const carve=(pts:FlowPoint[],hw:number)=>{
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i];
      const x0=Math.max(2,Math.floor((Math.min(a.x,b.x)-hw)/CS)),x1=Math.min(W-3,Math.floor((Math.max(a.x,b.x)+hw)/CS));
      const y0=Math.max(2,Math.floor((Math.min(a.y,b.y)-hw)/CS)),y1=Math.min(W-3,Math.floor((Math.max(a.y,b.y)+hw)/CS));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(segDist(cellC(x,y),a,b)<=hw)open[y*W+x]=1;
    }
  };
  for(let y=2;y<W-2;y++)for(let x=2;x<W-2;x++){const p=cellC(x,y);if(((p.x-c.x)/11.2)**2+((p.y-c.y)/6.3)**2<=1)open[y*W+x]=1;}
  carve([{x:84.2,y:81},{x:83.5,y:3}],2);                                 // avenue N
  carve([{x:84.2,y:92},{x:78.7,y:166}],2);                               // avenue S
  carve([{x:95,y:86.8},{x:158.3,y:88.1},{x:166,y:88.1}],2.2);            // avenue L
  carve([{x:73,y:86.8},{x:3,y:87}],2.2);                                 // avenue O
  carve([{x:80,y:140},{x:140,y:140},{x:140,y:89}],1.6);                  // street S ↔ L
  carve([{x:79,y:160},{x:104,y:160}],2); carve([REAL.heli,{x:REAL.heli.x+.1,y:REAL.heli.y}],4); // helipad
  if(variant.leak)carve([{x:90,y:84},{x:90,y:70},{x:110,y:70},{x:110,y:87}],1.2);
  if(variant.fountain){const i=cellOf(c);for(const d of [-W-1,-W,-W+1,-1,0,1,W-1,W,W+1])open[i+d]=0;}
  const u=perMouth(m=>{const a=REAL.mouths[m],b=REAL.spawns[m],l=dist(a,b);return {x:(b.x-a.x)/l,y:(b.y-a.y)/l};});
  const out=(m:Mouth,d:number,lat=0)=>{const a=REAL.mouths[m],k=d-dist(a,c),v=u[m];return {x:a.x+v.x*k-v.y*lat,y:a.y+v.y*k+v.x*lat};};
  const layout:Omit<CityLayout,'grid'>={plaza:REAL.plaza,plazaRadius:20,mouths:REAL.mouths,spawns:REAL.spawns,...(variant.plazaCenter?{plazaCenter:variant.plazaCenter}:{})};
  return finishCity('real',open,layout,REAL_BARRICADE,REAL.heli,out);
};
const BUILDERS:(()=>City)[]=[buildCity,()=>buildRealCity()];

/** Raise (closed=true) or remove the barricade at mouth m, then tell the planner. */
const setMouth=(city:City,pl:AvenuePlanner,m:Mouth,closed:boolean)=>{
  const r=city.barricades[m];
  for(let y=r.y0;y<=r.y1;y++)for(let x=r.x0;x<=r.x1;x++)city.open[y*W+x]=closed?0:city.orig[y*W+x];
  pl.invalidate([r]);
};
/**
 * Reference base (addendum §1), from the current walkability. `line`: walkable cells within MOUTH_HALF of a mouth.
 * `flood` from the plaza center's cell (or `plaza` when that cell is blocked) never entering a line cell.
 * strict: no corner cutting and capped like the contract (the expected plaza goal). loose: corner cutting allowed, no cap —
 * a superset of any reading of the contract, used where "outside the base" must hold.
 */
const baseMasks=(city:City,strict:boolean)=>{
  const {open}=city, line=new Uint8Array(W*W), flood=new Uint8Array(W*W), mouths=city.layout.mouths;
  for(let y=0;y<W;y++)for(let x=0;x<W;x++)if(open[y*W+x]&&MS.some(m=>dist(cellC(x,y),mouths[m])<=MOUTH_HALF))line[y*W+x]=1;
  let seed=cellOf(city.center);
  if(seed<0||!open[seed])seed=cellOf(city.layout.plaza!);
  const q=[seed]; flood[seed]=1;
  for(let h=0;h<q.length;h++){
    const i=q[h],x=i%W,y=(i-x)/W;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=x+dx,ny=y+dy,j=ny*W+nx;
      if((!dx&&!dy)||nx<0||ny<0||nx>=W||ny>=W||flood[j]||!open[j]||line[j])continue;
      if(strict&&dx&&dy&&!(open[y*W+nx]&&open[ny*W+x]))continue;
      if(strict&&dist(cellC(nx,ny),city.center)>city.cap+1e-9)continue;
      flood[j]=1; q.push(j);
    }
  }
  return {line,flood};
};
const inMask=(mask:Uint8Array,p:FlowPoint)=>{const i=cellOf(p);return i>=0&&mask[i]===1;};
const countMask=(mask:Uint8Array)=>mask.reduce((s,v)=>s+v,0);
/** "Inside the base" = plaza goal cell or mouth-line cell (loose superset). */
const baseTest=(city:City)=>{const {line,flood}=baseMasks(city,false);return (p:FlowPoint)=>inMask(line,p)||inMask(flood,p);};
/** Reference plaza field (independent of the planner): goals = strict flood. */
const refGoalField=(city:City)=>{
  const {flood}=baseMasks(city,true), goals:FlowPoint[]=[];
  for(let i=0;i<W*W;i++)if(flood[i])goals.push(cellC(i%W,Math.floor(i/W)));
  return new FlowField(city.layout.grid,goals);
};

const pl0=(id:string,p:FlowPoint,extra:Partial<PlayerLike>={}):PlayerLike=>({id,x:p.x,y:p.y,...extra});
/** Addendum §5: offline players still watch (they may reconnect); spectators and eliminated don't. */
const isViewer=(p:PlayerLike)=>!p.spectator&&!p.eliminated;
const polyLen=(pts:readonly FlowPoint[])=>{let s=0;for(let i=1;i<pts.length;i++)s+=dist(pts[i-1],pts[i]);return s;};
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
/** Point at route distance s (u) from the polyline's last point, walking back toward its first. */
const alongFromEnd=(pts:readonly FlowPoint[],s:number):FlowPoint=>{
  for(let i=pts.length-1;i>0;i--){
    const a=pts[i],b=pts[i-1],l=dist(a,b);
    if(s<=l){const t=l?s/l:0;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
    s-=l;
  }
  return {...pts[0]};
};
/** Route distance (u, from the plaza end) of the outermost route sample lying in a base cell. */
const routeExit=(pts:readonly FlowPoint[],inBase:(p:FlowPoint)=>boolean)=>{
  const len=polyLen(pts); let exit=0;
  for(let s=0;s<=len;s+=.05)if(inBase(alongFromEnd(pts,s)))exit=s;
  return exit;
};
/** True when some point of the polyline (sampled every 0.1 u) lies within r of q. */
const passesNear=(pts:readonly FlowPoint[],q:FlowPoint,r:number)=>{
  const len=polyLen(pts);
  for(let s=0;s<=len;s+=.1)if(dist(alongFromEnd(pts,s),q)<=r)return true;
  return false;
};
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
const st=(open:Mouth[],mode:AvenueMode='normal',round=3,alternate=0):AvenueState=>({round,mode,open:[...open],alternate,uses:{N:0,S:0,L:0,O:0}});
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const minAt=(reqs:readonly GroupRequest[])=>Math.min(...reqs.map(r=>r.at));
/** A small team standing in the plaza around its center. */
const plazaTeam=(city:City,n=2,seed=1,r=3)=>{
  const rnd=lcg(seed*7+3), out:PlayerLike[]=[];
  for(let i=0;i<n;i++){const a=rnd()*Math.PI*2,d=i?rnd()*r:0;out.push(pl0(`p${i}`,{x:city.center.x+Math.cos(a)*d,y:city.center.y+Math.sin(a)*d}));}
  return out;
};
/**
 * Per-group contract (addendum §2–3): index = indexBase + position; release ≥ nowTick; warnTick = release − warning;
 * an on-time group arrives at firstArrival + (at − at0); a late one is released at nowTick and arrives after that.
 */
const checkSchedule=(g:PlannedGroup,reqs:readonly GroupRequest[],msg:string,o:{at0?:number;indexBase?:number;nowTick?:number;state?:AvenueState}={})=>{
  const base=o.indexBase??0, now=o.nowTick??0, at0=o.at0??minAt(reqs), r=reqs[g.index-base];
  assert.ok(Number.isInteger(g.index)&&r!==undefined,`${msg}: index ${g.index} (base ${base}, ${reqs.length} requests)`);
  if(o.state)assert.ok(o.state.open.includes(g.mouth),`${msg}: mouth ${g.mouth} not open (${o.state.open})`);
  assert.ok(Number.isFinite(g.releaseTick)&&g.releaseTick>=0,`${msg}: releaseTick ${g.releaseTick}`);
  assert.ok(Math.abs(g.warnTick-(g.releaseTick-WARN_TICKS))<1e-9,`${msg}: warnTick ${g.warnTick} vs release ${g.releaseTick}`);
  if(!g.points.length)return;
  assert.ok(g.points.length<=r.size,`${msg}: ${g.points.length} > ${r.size} members`);
  assert.ok(g.releaseTick>=now,`${msg}: release ${g.releaseTick} before nowTick ${now}`);
  assert.ok(Number.isFinite(g.arrivalTick)&&g.arrivalTick>g.releaseTick,`${msg}: arrival ${g.arrivalTick} ≤ release ${g.releaseTick}`);
  const desired=FIRST_TICKS+r.at-at0, onTime=Math.abs(g.arrivalTick-desired)<=ROUND;
  assert.ok(onTime||(g.releaseTick===now&&g.arrivalTick>desired),`${msg}: arrival ${g.arrivalTick} (release ${g.releaseTick}) vs desired ${desired}, nowTick ${now}`);
};
/** Every member walkable, ≥ minPlayerDistance from and not visible (cityVisible, default lead) to every viewer. */
const checkHidden=(city:City,players:readonly PlayerLike[],g:PlannedGroup,msg:string)=>{
  for(const p of g.points){
    assert.ok(city.walkableAt(p),`${msg}: point (${p.x.toFixed(2)},${p.y.toFixed(2)}) walkable`);
    for(const v of players.filter(isViewer)){
      assert.ok(dist(v,p)>=MIN_DIST,`${msg}: point ${dist(v,p).toFixed(2)} u from viewer ${v.id}`);
      assert.equal(cityVisible(v,p),false,`${msg}: point (${p.x.toFixed(2)},${p.y.toFixed(2)}) visible to ${v.id} (${dist(v,p).toFixed(2)} u)`);
    }
  }
};
/** Addendum §6: members of different groups on one mouth released within 2 s are ≥ 0.8 u apart; nobody coincides. */
const checkNoStacking=(groups:readonly PlannedGroup[],msg:string)=>{
  for(const g of groups)for(let i=0;i<g.points.length;i++)for(let j=i+1;j<g.points.length;j++)
    assert.ok(dist(g.points[i],g.points[j])>.05,`${msg}: group ${g.index}/${g.mouth} members ${i} and ${j} coincide`);
  for(let a=0;a<groups.length;a++)for(let b=a+1;b<groups.length;b++){
    const A=groups[a],B=groups[b];
    if(A.mouth!==B.mouth||Math.abs(A.releaseTick-B.releaseTick)>STACK_TICKS)continue;
    for(const p of A.points)for(const q of B.points)
      assert.ok(dist(p,q)>=STACK_GAP-1e-9,`${msg}: groups ${A.index} and ${B.index} on ${A.mouth} (releases ${A.releaseTick}/${B.releaseTick}) have members ${dist(p,q).toFixed(3)} u apart`);
  }
};
/** Addendum §1: every member outside the base and ≥ 2 u (along its mouth's route) past the route's last base cell. */
const checkOutsideBase=(city:City,pl:AvenuePlanner,groups:readonly PlannedGroup[],msg:string)=>{
  const inBase=baseTest(city), exits=new Map<Mouth,{pts:FlowPoint[];exit:number}>();
  for(const g of groups){
    if(!g.points.length)continue;
    let e=exits.get(g.mouth);
    if(!e){
      const r=pl.route(g.mouth);
      assert.ok(r,`${msg}: route ${g.mouth} exists`);
      e={pts:r.points,exit:routeExit(r.points,inBase)};exits.set(g.mouth,e);
    }
    for(const p of g.points){
      assert.equal(inBase(p),false,`${msg}: group ${g.index}/${g.mouth} member (${p.x.toFixed(2)},${p.y.toFixed(2)}) inside the base`);
      const s=remainingAlong(e.pts,p);
      assert.ok(s>=e.exit+OUTSIDE-EXIT_TOL,`${msg}: group ${g.index}/${g.mouth} member ${s.toFixed(2)} u along the route, base exit at ${e.exit.toFixed(2)} u`);
    }
    assert.ok(g.arrivalTick>g.releaseTick,`${msg}: group ${g.index} still has to walk to the plaza`);
  }
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

test('route(): spawn → plaza goal per mouth on both fixtures, walkable, not shorter than the straight line, not blocked', ()=>{
  for(const make of BUILDERS){
    const city=make(), pl=new AvenuePlanner(city.layout), {flood}=baseMasks(city,false);
    for(const m of MS){
      const r=pl.route(m), at=`${city.name} ${m}`;
      assert.ok(r,`${at}: route exists`);
      assert.equal(r.blocked,false,`${at}: route open`);
      assert.ok(r.points.length>=2,`${at}: route has points`);
      assert.ok(dist(r.points[0],city.layout.spawns[m])<=CS,`${at}: starts at the spawn (${JSON.stringify(r.points[0])})`);
      const last=r.points[r.points.length-1];
      assert.ok(pl.plazaField.atGoal(last.x,last.y)&&inMask(flood,last),`${at}: ends on a plaza goal cell (${last.x.toFixed(2)},${last.y.toFixed(2)})`);
      for(const p of r.points)assert.ok(city.walkableAt(p),`${at}: point (${p.x},${p.y}) walkable`);
      assert.ok(r.length>=dist(r.points[0],last)-1e-9,`${at}: length ≥ straight line`);
      const pl2=polyLen(r.points);
      assert.ok(Math.abs(r.length-pl2)<=.02*pl2,`${at}: length ${r.length} matches its polyline ${pl2}`);
    }
  }
});

test('plaza goal = flood from the plaza center bounded by the mouth lines (real asset: plaza point 2.9 u from mouth N)', ()=>{
  for(const make of BUILDERS){
    const city=make(), pl=new AvenuePlanner(city.layout), strict=baseMasks(city,true), loose=baseMasks(city,false);
    let n=0, shared=0;
    for(let y=0;y<W;y++)for(let x=0;x<W;x++){
      if(pl.plazaField.cellCost(x,y)!==0)continue;
      const i=y*W+x, p=cellC(x,y), at=`${city.name}: goal cell (${x},${y})`;
      n++; if(strict.flood[i])shared++;
      assert.equal(city.open[i],1,`${at} walkable`);
      assert.equal(strict.line[i],0,`${at} is in a mouth line`);
      assert.equal(loose.flood[i],1,`${at} is not reachable from the plaza without crossing a mouth line`);
      assert.ok(dist(p,city.center)<=city.cap+1e-6,`${at} ${dist(p,city.center).toFixed(2)} u from the center > cap ${city.cap.toFixed(2)}`);
    }
    const want=countMask(strict.flood);
    assert.ok(n>0&&shared>=.9*want,`${city.name}: goal has ${n} cells, ${shared} of the ${want} expected`);
    assert.ok(pl.plazaField.atGoal(city.center.x,city.center.y),`${city.name}: the plaza center is a goal`);
  }
  // Real proportions: the old disc around `plaza` (2.9 u from mouth N) leaked onto avenue N; the flood must not.
  const city=buildRealCity(), pl=new AvenuePlanner(city.layout), N=REAL.mouths.N;
  assert.ok(Math.abs(dist(REAL.plaza,N)-2.93)<.05&&city.cap>12,'fixture: plaza point 2.9 u from mouth N, cap ≈ 12 u');
  let avenueN=0;
  for(let y=0;y<W;y++)for(let x=0;x<W;x++){const p=cellC(x,y);if(pl.plazaField.cellCost(x,y)===0&&p.y<N.y&&Math.abs(p.x-N.x)<3)avenueN++;}
  assert.equal(avenueN,0,'no plaza goal cell on avenue N beyond its mouth');
  for(const p of [REAL.plaza,{x:84.2,y:89.5},{x:92,y:86.8},{x:76.1,y:86.8}])
    assert.ok(pl.plazaField.atGoal(p.x,p.y),`plaza floor (${p.x},${p.y}) is a goal`);
  // A fountain on the centroid's cell: the flood seeds from `plaza` instead.
  const f=buildRealCity({fountain:true}), pf=new AvenuePlanner(f.layout), fl=baseMasks(f,false);
  assert.equal(f.walkableAt(REAL_CENTER),false,'fixture: the centroid cell is blocked');
  for(const p of [REAL.plaza,{x:84.2,y:89.5},{x:92,y:86.8},{x:76.1,y:86.8}])
    assert.ok(pf.plazaField.atGoal(p.x,p.y),`fountain: plaza floor (${p.x},${p.y}) is a goal`);
  for(let i=0;i<W*W;i++)if(pf.plazaField.cellCost(i%W,Math.floor(i/W))===0)assert.ok(fl.flood[i]&&!fl.line[i],`fountain: goal cell ${i%W},${Math.floor(i/W)} outside the base`);
});

test('constructor: RangeError for a plaza center inside a mouth line or a base that leaks to a spawn; malformed layouts throw', ()=>{
  const real=buildRealCity(), old=buildCity();
  assert.doesNotThrow(()=>new AvenuePlanner(real.layout));
  assert.doesNotThrow(()=>new AvenuePlanner({...real.layout,plazaCenter:REAL.plaza}),'explicit center 2.9 u from mouth N is outside its line');
  assert.throws(()=>new AvenuePlanner({...real.layout,plazaCenter:{x:84.2,y:80.3}}),RangeError,'real: center in mouth line N');
  assert.throws(()=>new AvenuePlanner({...old.layout,plazaCenter:avenuePoint('S',9.5)}),RangeError,'synthetic: center in mouth line S');
  const leak=buildRealCity({leak:true}), loose=baseMasks(leak,false);
  assert.equal(loose.flood[cellOf(REAL.spawns.L)],1,'fixture: the leak street joins the plaza to avenue L past mouth L');
  assert.equal(baseMasks(real,false).flood[cellOf(REAL.spawns.L)],0,'fixture: without the leak the base is closed');
  assert.throws(()=>new AvenuePlanner(leak.layout),RangeError,'base leaks to spawn L');
  const L=real.layout;
  const bad:[string,unknown][]=[
    ['missing mouth L',{...L,mouths:{N:L.mouths.N,S:L.mouths.S,O:L.mouths.O}}],
    ['missing spawns',{...L,spawns:undefined}],
    ['NaN spawn',{...L,spawns:{...L.spawns,S:{x:NaN,y:100}}}],
    ['infinite mouth',{...L,mouths:{...L.mouths,N:{x:Infinity,y:79.5}}}],
    ['NaN mouth',{...L,mouths:{...L.mouths,O:{x:72.1,y:NaN}}}],
  ];
  for(const [what,layout] of bad)assert.throws(()=>new AvenuePlanner(layout as CityLayout),what);
});

test('real asset proportions: with N closed an enemy on avenue N targets barricade N and walks up to it', ()=>{
  const city=buildRealCity(), pl=new AvenuePlanner(city.layout), {flood}=baseMasks(city,false);
  const inPlaza=(p:FlowPoint)=>inMask(flood,p);
  const follow=(p:FlowPoint,out:FlowPoint)=>pl.directionFor(p,pl.targetFor(p),out);
  for(const m of MS){
    const e=city.out(m,30);
    assert.ok(city.walkableAt(e),`fixture: ${m} 30 u is on the avenue`);
    assert.deepEqual(pl.targetFor(e),{kind:'plaza'},`${m} open → plaza`);
    assert.ok(walk(city,e,follow,inPlaza),`${m} open: reaches the plaza`);
  }
  setMouth(city,pl,'N',true);
  const ref=refGoalField(city), atN=(p:FlowPoint)=>dist(p,REAL.mouths.N)<=1.5+CS;
  for(const d of [10.5,12,30,55]){
    const e=city.out('N',d);
    assert.equal(ref.reachable(e.x,e.y),false,`fixture: avenue N ${d} u only connects through mouth N`);
    assert.deepEqual(pl.targetFor(e),{kind:'barricade',mouth:'N'},`N closed, enemy ${d} u out → barricade N`);
    const end=walk(city,e,follow,atN);
    assert.ok(end,`N closed, from ${d} u: following directionFor(targetFor) reaches the barricade`);
    assert.ok(walk(city,e,(p,out)=>pl.directionFor(p,{kind:'barricade',mouth:'N'},out),atN),`N closed, from ${d} u: barricade target reaches it`);
  }
  const rN=pl.route('N');
  assert.ok(rN&&rN.blocked,'route N blocked');
  assert.ok(dist(rN.points[0],REAL.spawns.N)<=CS&&atN(rN.points[rN.points.length-1]),'blocked route N: spawn → barricade');
  for(const m of ['S','L','O'] as Mouth[]){
    assert.deepEqual(pl.targetFor(city.out(m,30)),{kind:'plaza'},`${m} still open`);
    assert.equal(pl.route(m)?.blocked,false);
  }
  setMouth(city,pl,'N',false);
  assert.deepEqual(pl.targetFor(city.out('N',30)),{kind:'plaza'},'N reopened → plaza');
  assert.ok(walk(city,city.out('N',12),follow,inPlaza),'N reopened: reaches the plaza');
  // S closed: avenue S detours through the street and enters through mouth L.
  setMouth(city,pl,'S',true);
  const e=city.out('S',30);
  assert.equal(refGoalField(city).reachable(e.x,e.y),true,'fixture: avenue S reaches the plaza through the street');
  assert.deepEqual(pl.targetFor(e),{kind:'plaza'},'S closed → plaza through another mouth');
  const rS=pl.route('S');
  assert.ok(rS&&!rS.blocked&&passesNear(rS.points,REAL.mouths.L,MOUTH_HALF),'route S detours through mouth L');
  assert.ok(walk(city,e,follow,inPlaza,.25,6000),'S closed: reaches the plaza through mouth L');
});

test('ACCEPTANCE: 20 seeds × 2 fixtures — every point walkable, ≥ 4 u from and invisible (cityVisible) to every viewer incl. offline', ()=>{
  // hiddenFrom on its own = not cityVisible from any viewer (offline and downed included) and ≥ minPlayerDistance.
  {
    const city=buildCity(), pl=new AvenuePlanner(city.layout), q=avenuePoint('S',40), rnd=lcg(77);
    assert.equal(pl.hiddenFrom([],q),true);
    let checked=0;
    for(let i=0;i<400;i++){
      const a=rnd()*Math.PI*2, d=rnd()*30, v={x:q.x+Math.cos(a)*d,y:q.y+Math.sin(a)*d};
      if(!clearCut(v,q)||Math.abs(d-MIN_DIST)<.01)continue;
      const want=d>=MIN_DIST&&!refVisible(v,q);
      for(const extra of [{},{downed:true},{online:false}])assert.equal(pl.hiddenFrom([pl0('a',v,extra)],q),want,`viewer ${JSON.stringify(extra)} at ${d.toFixed(2)} u, angle ${a.toFixed(2)}`);
      for(const extra of [{spectator:true},{eliminated:true}])assert.equal(pl.hiddenFrom([pl0('a',v,extra)],q),true,JSON.stringify(extra));
      checked++;
    }
    assert.ok(checked>300);
    const blind=new AvenuePlanner(city.layout,{isVisible:()=>false});
    assert.equal(blind.hiddenFrom([pl0('a',{x:q.x+3,y:q.y})],q),false,'minPlayerDistance still applies with isVisible');
    assert.equal(blind.hiddenFrom([pl0('a',{x:q.x+5,y:q.y})],q),true);
    const seeAll=new AvenuePlanner(city.layout,{isVisible:()=>true});
    assert.equal(seeAll.hiddenFrom([pl0('a',{x:q.x+60,y:q.y})],q),false,'isVisible overrides the camera');
  }
  const modes:AvenueMode[]=['normal','cerco','alternado','excursao'];
  let total=0;
  for(const make of BUILDERS){
    const city=make(), pl=new AvenuePlanner(city.layout);
    for(let seed=1;seed<=20;seed++){
      const rnd=lcg(seed*977), ri=(lo:number,hi:number)=>lo+Math.floor(rnd()*(hi-lo+1));
      const anyWalkable=()=>{for(;;){const p=cellC(ri(2,189),ri(2,189));if(city.walkableAt(p))return p;}};
      const inPlaza=()=>{const a=rnd()*Math.PI*2,r=rnd()*3;return {x:city.center.x+Math.cos(a)*r,y:city.center.y+Math.sin(a)*r};};
      const onAvenue=()=>city.out(MS[ri(0,3)],20+rnd()*45,(rnd()-.5)*3);
      const players:PlayerLike[]=[];
      for(let i=ri(1,2);i>0;i--)players.push(pl0(`plaza${i}`,inPlaza()));
      for(let i=ri(1,2);i>0;i--)players.push(pl0(`city${i}`,anyWalkable()));
      for(let i=ri(0,1);i>0;i--)players.push(pl0(`avenue${i}`,onAvenue()));
      players.push(pl0('heli',city.heli),pl0('downed',anyWalkable(),{downed:true}));
      players.push(pl0('offline',onAvenue(),{online:false}),pl0('spec',onAvenue(),{spectator:true}),pl0('elim',onAvenue(),{eliminated:true}));
      const mode=modes[seed%4], round=ri(1,10);
      const state=pl.openRound(round,mode,rngOf(seed));
      const reqs:GroupRequest[]=[]; let at=ri(0,40);
      for(let i=ri(4,8);i>0;i--){reqs.push({at,size:ri(2,6)});at+=ri(20,200);}
      const groups=pl.planGroups(reqs,players,state,rngOf(seed+1));
      const msg0=`${city.name} seed ${seed} ${mode}`;
      for(let k=0;k<reqs.length;k++){
        assert.ok(groups.some(g=>g.index===k),`${msg0}: request ${k} answered`);
        assert.ok(groups.filter(g=>g.index===k).reduce((s,g)=>s+g.points.length,0)<=reqs[k].size,`${msg0}: group ${k} oversize`);
      }
      for(const g of groups){
        const msg=`${msg0} group ${g.index}/${g.mouth}`;
        checkSchedule(g,reqs,msg,{state});
        checkHidden(city,players,g,msg);
        assert.ok(g.points.every(p=>pl.hiddenFrom(players,p)),`${msg}: hiddenFrom`);
        total+=g.points.length;
      }
      checkNoStacking(groups,msg0);
    }
  }
  assert.ok(total>0,'the planner placed some members');
});

test('cityVisible: the camera union scaled to the city (with lead); viewRadius → circle; isVisible still wins', ()=>{
  assert.ok(Math.abs(CITY_VIEW_SCALE-VIEW_K)<1e-12,`CITY_VIEW_SCALE ${CITY_VIEW_SCALE} vs ${VIEW_K}`);
  assert.ok(Math.abs(LEAD-3)<.05,`fixture: default lead ≈ 3 u (${LEAD})`);
  const rnd=lcg(4242), o={x:80,y:80};
  let checked=0;
  for(let i=0;i<1500;i++){
    const a=rnd()*Math.PI*2, d=rnd()*32, p={x:o.x+Math.cos(a)*d,y:o.y+Math.sin(a)*d};
    if(clearCut(o,p))assert.equal(cityVisible(o,p),refVisible(o,p),`default lead, ${d.toFixed(2)} u at ${a.toFixed(3)}`);
    for(const lead of [0,5])if(clearCut(o,p,lead))assert.equal(cityVisible(o,p,lead),refVisible(o,p,lead),`lead ${lead}, ${d.toFixed(2)} u at ${a.toFixed(3)}`);
    checked++;
  }
  assert.ok(checked===1500);
  // Shape, not a circle: ~16.9 u along the avenues (axes), farther along the diagonals.
  const axis={x:o.x+19,y:o.y}, diag={x:o.x+23/Math.SQRT2,y:o.y-23/Math.SQRT2};
  assert.equal(cityVisible(o,{x:o.x,y:o.y-16}),true); assert.equal(cityVisible(o,axis),false); assert.equal(cityVisible(o,diag),true);
  const city=buildCity(), cam=new AvenuePlanner(city.layout), circle=new AvenuePlanner(city.layout,{viewRadius:18});
  const viewer=[pl0('v',o)];
  assert.equal(cam.hiddenFrom(viewer,axis),true,'default: 19 u along an axis is off camera');
  assert.equal(cam.hiddenFrom(viewer,diag),false,'default: 23 u along a diagonal is on camera');
  assert.equal(circle.hiddenFrom(viewer,axis),false,'viewRadius 18: circle of 18 + lead covers 19 u');
  assert.equal(circle.hiddenFrom(viewer,diag),true,'viewRadius 18: 23 u is outside 18 + lead');
  assert.equal(circle.hiddenFrom(viewer,{x:o.x,y:o.y+18+LEAD-.2}),false);
  assert.equal(circle.hiddenFrom(viewer,{x:o.x,y:o.y+18+LEAD+.2}),true);
  const override=new AvenuePlanner(city.layout,{viewRadius:100,isVisible:()=>false});
  assert.equal(override.hiddenFrom(viewer,{x:o.x+10,y:o.y}),true,'isVisible overrides viewRadius');
  assert.equal(override.hiddenFrom(viewer,{x:o.x+3,y:o.y}),false,'…but not minPlayerDistance');
  // Report: closest hidden spot along each avenue from a viewer at the plaza center.
  for(const make of BUILDERS){
    const c=make(), pl=new AvenuePlanner(c.layout), v=[pl0('c',c.center)], rep:string[]=[];
    for(const m of MS){
      const pts=pl.route(m)!.points, len=polyLen(pts);
      let s=0;while(s<len&&!pl.hiddenFrom(v,alongFromEnd(pts,s)))s+=.05;
      rep.push(`${m} ${dist(c.center,alongFromEnd(pts,s)).toFixed(2)} u`);
    }
    console.log(`[${c.name}] closest hidden point along each avenue from a plaza-center viewer: ${rep.join(', ')}`);
  }
});

test('ACCEPTANCE: first group arrives ≤ 12 s with the team in the plaza; others keep the schedule; travel = route / speed', ()=>{
  // Tolerance: a member may sit up to half an avenue width (2.2 u) off the route's lane, and the route's last point may be
  // anywhere in its goal cell (≤ 0.62 u); 3 u of path at 1.79 u/s ≈ 34 ticks, plus one tick of rounding.
  const TOL=3/SPEED*TPS+ROUND;
  for(const make of BUILDERS){
    const city=make(), pl=new AvenuePlanner(city.layout);
    const routes=perMouth(m=>pl.route(m)!);
    for(let seed=1;seed<=20;seed++){
      const rnd=lcg(seed*31+5), team=plazaTeam(city,1+Math.floor(rnd()*4),seed);
      const reqs:GroupRequest[]=[{at:10,size:3+Math.floor(rnd()*3)},{at:90,size:4},{at:170,size:5},{at:400,size:2}];
      for(const [mode,round] of [['normal',1+seed%10],['cerco',4],['alternado',5],['excursao',6]] as [AvenueMode,number][]){
        const state=pl.openRound(round,mode,rngOf(seed));
        const groups=pl.planGroups(reqs,team,state,rngOf(seed+50)), msg0=`${city.name} seed ${seed} ${mode}`;
        const first=groups.filter(g=>g.index===0&&g.points.length>0);
        assert.ok(first.length>0,`${msg0}: first group placed`);
        for(const g of first)assert.ok(g.arrivalTick<=FIRST_TICKS,`${msg0}: first group (${g.mouth}) arrives at tick ${g.arrivalTick}`);
        for(const g of groups){
          const msg=`${msg0} group ${g.index}/${g.mouth}`;
          checkSchedule(g,reqs,msg,{state});
          if(!g.points.length)continue;
          assert.ok(Math.abs(g.arrivalTick-(FIRST_TICKS+reqs[g.index].at-reqs[0].at))<=ROUND,`${msg}: on schedule (arrival ${g.arrivalTick})`);
          const want=remainingAlong(routes[g.mouth].points,g.points[0])/SPEED*TPS, got=g.arrivalTick-g.releaseTick;
          assert.ok(Math.abs(got-want)<=TOL,`${msg}: travel ${got} ticks vs route ${want.toFixed(1)}`);
        }
        for(let k=0;k<reqs.length;k++)assert.equal(groups.filter(g=>g.index===k).reduce((s,g)=>s+g.points.length,0),reqs[k].size,`${msg0}: group ${k} complete`);
      }
    }
  }
});

test('ACCEPTANCE: one player 25 u out on an avenue — another open mouth delivers the first group ≤ 12 s', ()=>{
  const reqs:GroupRequest[]=[{at:0,size:4},{at:100,size:3},{at:200,size:5},{at:300,size:3}];
  for(const make of BUILDERS){
    const city=make(), pl=new AvenuePlanner(city.layout);
    for(let i=0;i<4;i++){
      const m=MS[i], other=MS[(i+1)%4], watcher=pl0('w',city.out(m,25));
      assert.ok(city.walkableAt(watcher),`fixture: ${city.name} watcher on avenue ${m}`);
      const players=[...plazaTeam(city,2,i+1),watcher], state=st([m,other]);
      const groups=pl.planGroups(reqs,players,state,rngOf(i+1)), msg0=`${city.name} watcher on ${m}`;
      const g0=groups.find(g=>g.index===0&&g.points.length);
      assert.ok(g0,`${msg0}: first group placed`);
      assert.equal(g0.mouth,other,`${msg0}: the watched mouth would be late, ${other} delivers`);
      assert.ok(g0.arrivalTick<=FIRST_TICKS,`${msg0}: first group arrives at tick ${g0.arrivalTick}`);
      for(const g of groups){checkSchedule(g,reqs,`${msg0} group ${g.index}/${g.mouth}`,{state});checkHidden(city,players,g,`${msg0} group ${g.index}`);}
      checkNoStacking(groups,msg0);
    }
  }
});

test('cadence: arrival spacing = requested spacing; a far mouth is released earlier instead of arriving late', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  const plaza=[pl0('a',PLAZA),pl0('b',{x:PLAZA.x+2,y:PLAZA.y+1})];
  const reqs:GroupRequest[]=[{at:20,size:4},{at:80,size:2},{at:140,size:5},{at:400,size:3},{at:420,size:6}];
  for(const state of [st(['S','O']),st(['N','S','L','O'],'cerco',4),st(['L','O'],'alternado',5),st(['N'],'excursao',6),st(['N','S','L'],'normal',7)]){
    const groups=pl.planGroups(reqs,plaza,clone(state),rngOf(9));
    for(const g of groups){
      const msg=`${state.mode} group ${g.index}/${g.mouth}`;
      checkSchedule(g,reqs,msg,{state});
      if(!g.points.length)continue;
      // Players only at the plaza: every travel is < 12 s, so arrival_k = 12 s + (at_k − at_0) and release_k > 0.
      assert.ok(g.releaseTick>0,`${msg}: released after round start`);
      assert.ok(Math.abs(g.arrivalTick-(FIRST_TICKS+reqs[g.index].at-reqs[0].at))<=ROUND,`${msg}: arrival ${g.arrivalTick}`);
    }
    for(let k=0;k<reqs.length;k++)assert.ok(groups.some(g=>g.index===k&&g.points.length),`${state.mode}: group ${k} placed`);
    checkNoStacking(groups,state.mode);
  }
  // Different `at` on a near mouth (L) and a far one (N: a player 15 u out pushes its groups behind him).
  const players=[...plaza,pl0('n',avenuePoint('N',15))], state=st(['L','N']);
  const near0:GroupRequest={at:20,size:3}, far1:GroupRequest={at:220,size:3};
  const groups=pl.planGroups([near0,far1],players,clone(state),rngOf(3));
  for(const g of groups)checkSchedule(g,[near0,far1],`near/far ${g.index}/${g.mouth}`,{state});
  const g0=groups.find(g=>g.index===0&&g.points.length), g1=groups.find(g=>g.index===1&&g.points.length);
  assert.ok(g0&&g1,`both placed: ${groups.map(g=>g.index+g.mouth+':'+g.points.length)}`);
  assert.equal(g0.mouth,'L'); assert.equal(g1.mouth,'N','group 1 rotates to N and N can still make it');
  const tNear=g0.arrivalTick-g0.releaseTick, tFar=g1.arrivalTick-g1.releaseTick;
  assert.ok(tFar>tNear+100,`fixture: N group really is farther (${tFar} vs ${tNear} ticks)`);
  assert.ok(tFar<FIRST_TICKS+far1.at-near0.at,'fixture: N can make its slot');
  const gap=g1.arrivalTick-g0.arrivalTick;
  assert.ok(Math.abs(gap-(far1.at-near0.at))<=ROUND,`arrival gap ${gap} ticks = requested ${far1.at-near0.at} (no extra ${((tFar-tNear)/TPS).toFixed(1)} s)`);
  assert.ok(Math.abs((g1.releaseTick-g0.releaseTick)-(far1.at-near0.at-(tFar-tNear)))<=ROUND,`far released earlier by its extra travel (${g0.releaseTick} / ${g1.releaseTick})`);
});

test('re-planning: one group alone with {at0, indexBase} reproduces the full plan; nowTick clamps; unsorted requests use min(at)', ()=>{
  for(const make of BUILDERS){
    const city=make(), pl=new AvenuePlanner(city.layout), team=plazaTeam(city,3,5), state=st(['S','L']);
    const reqs:GroupRequest[]=[{at:20,size:4},{at:80,size:3},{at:200,size:5},{at:300,size:3}], at0=20, msg0=city.name;
    const full=pl.planGroups(reqs,team,clone(state),rngOf(2));
    assert.deepEqual(full.map(g=>g.index),[0,1,2,3]);
    for(const g of full)checkSchedule(g,reqs,`${msg0} full ${g.index}`,{state});
    for(let k=0;k<reqs.length;k++){
      const one=pl.planGroups([reqs[k]],team,clone(state),rngOf(100+k),{at0,indexBase:k});
      assert.equal(one.length,1,`${msg0} replan ${k}: one group`);
      assert.equal(one[0].index,k,`${msg0} replan ${k}: index = indexBase`);
      assert.equal(one[0].points.length,reqs[k].size,`${msg0} replan ${k}: placed`);
      assert.equal(one[0].arrivalTick,full[k].arrivalTick,`${msg0} replan ${k}: same arrival as the full plan`);
      checkSchedule(one[0],reqs.slice(k),`${msg0} replan ${k}`,{at0,indexBase:k,state});
    }
    const batch=pl.planGroups(reqs.slice(2),team,clone(state),rngOf(7),{at0,indexBase:2});
    assert.deepEqual(batch.map(g=>[g.index,g.arrivalTick]),full.slice(2).map(g=>[g.index,g.arrivalTick]),`${msg0}: batch 2..3 keeps index and arrival`);
    // Without at0 a lone later group would be scheduled as the round's first.
    assert.equal(pl.planGroups([reqs[2]],team,clone(state),rngOf(8))[0].arrivalTick,FIRST_TICKS,`${msg0}: default at0 = its own at`);
    // nowTick: nothing is released before it; groups that can't make it any more are released at nowTick.
    const now=400, late=pl.planGroups(reqs,team,clone(state),rngOf(2),{nowTick:now});
    for(const g of late)checkSchedule(g,reqs,`${msg0} now=${now} group ${g.index}`,{nowTick:now,state});
    for(const k of [0,1]){
      const g=late.find(x=>x.index===k)!;
      assert.equal(g.releaseTick,now,`${msg0}: group ${k} clamped to nowTick`);
      assert.ok(g.arrivalTick>FIRST_TICKS+reqs[k].at-at0&&g.arrivalTick>now,`${msg0}: group ${k} arrives late (${g.arrivalTick})`);
    }
    // Unsorted requests: at0 = min(at), index = request position.
    const un=pl.planGroups([{at:200,size:3},{at:0,size:3}],team,clone(state),rngOf(1));
    const u0=un.find(g=>g.index===0)!, u1=un.find(g=>g.index===1)!;
    assert.ok(Math.abs(u1.arrivalTick-FIRST_TICKS)<=ROUND&&Math.abs(u0.arrivalTick-(FIRST_TICKS+200))<=ROUND,`${msg0}: unsorted arrivals ${u0.arrivalTick}/${u1.arrivalTick}`);
  }
});

test('rng draws are a fixed function of the request sizes (players, mode, mouths, nowTick do not change them)', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  const reqs:GroupRequest[]=[{at:0,size:4},{at:100,size:3},{at:200,size:5},{at:300,size:3}];
  const counting=()=>{let n=0;const r=rngOf(5);return {rng:{next(){n++;return r.next();}} as RngLike,get n(){return n;}};};
  const teams=[[pl0('a',PLAZA)],[pl0('a',PLAZA),pl0('w',avenuePoint('S',40)),pl0('o',avenuePoint('L',30),{online:false})],[]];
  const draws=new Set<number>(), seen:string[]=[];
  for(const players of teams)for(const state of [st(['S','L']),st([...MS],'cerco',4),st(['N','S'],'alternado',5),st(['O'],'excursao',6)])for(const nowTick of [0,500]){
    const c=counting(); pl.planGroups(reqs,players,state,c.rng,{nowTick});
    draws.add(c.n); seen.push(`${state.mode}/${players.length}p/now${nowTick}:${c.n}`);
  }
  assert.equal(draws.size,1,`draw counts: ${seen.join(' ')}`);
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
  // (a) A player 30 u out on avenue S (and one at the plaza): S's groups go behind him, on the spawn side.
  const watcher=pl0('w',avenuePoint('S',30)), pa=[pl0('c',PLAZA),watcher];
  const a=pl.planGroups(reqs,pa,st(['S'],'normal',1),rngOf(1));
  for(let k=0;k<reqs.length;k++){
    const g=a.find(x=>x.index===k);
    assert.ok(g&&g.mouth==='S'&&g.points.length===reqs[k].size,`(a) group ${k}: placed on S (spawn end is not visible)`);
    checkHidden(city,pa,g,`(a) group ${k}`);
    for(const p of g.points)assert.ok(p.y-PLAZA.y>30,`(a) group ${k}: point behind the watcher (${(p.y-PLAZA.y).toFixed(2)} u out)`);
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
  // (d) Only spectators and eliminated players: they hide nothing, groups come right past the mouth lines.
  const ghosts=[pl0('e',PLAZA,{eliminated:true}),...MS.map(m=>pl0('s'+m,avenuePoint(m,30),{spectator:true})),...MS.map(m=>pl0('x'+m,SPAWN_PT[m],{eliminated:true}))];
  const d=pl.planGroups(reqs,ghosts,st([...MS],'cerco',4),rngOf(4));
  for(let k=0;k<reqs.length;k++)assert.equal(d.filter(g=>g.index===k).reduce((s,g)=>s+g.points.length,0),reqs[k].size,`(d) group ${k} complete`);
  const closest=Math.min(...d.flatMap(g=>g.points.map(p=>dist(p,PLAZA))));
  assert.ok(closest<16,`(d) inactive players don't push groups away from the plaza (closest ${closest.toFixed(2)} u)`);
  // (e) An offline player at the plaza still counts as a viewer.
  const off=[pl0('o',PLAZA,{online:false})];
  const e=pl.planGroups(reqs,off,st([...MS],'cerco',4),rngOf(4));
  for(const g of e)checkHidden(city,off,g,`(e) group ${g.index}/${g.mouth}`);
  assert.ok(e.some(g=>g.points.length),'(e) placed');
});

test('targetFor/directionFor (synthetic): plaza when open, own barricade when closed, plaza through the streets when S closes', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout), {flood}=baseMasks(city,false);
  const enemy=(m:Mouth)=>avenuePoint(m,40);
  const inPlaza=(p:FlowPoint)=>inMask(flood,p);
  const toPlaza=(p:FlowPoint,out:FlowPoint)=>pl.directionFor(p,{kind:'plaza'},out);
  for(const m of MS){
    assert.deepEqual(pl.targetFor(enemy(m)),{kind:'plaza'},`${m}: open → plaza`);
    assert.ok(walk(city,enemy(m),toPlaza,inPlaza),`${m}: following directionFor reaches the plaza`);
  }
  assert.deepEqual(pl.targetFor(COURTYARD),{kind:'none'},'sealed courtyard → none');
  setMouth(city,pl,'N',true);
  assert.equal(refGoalField(city).reachable(enemy('N').x,enemy('N').y),false,'fixture: avenue N only connects through mouth N');
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
  // Closing S too: the fixture's street grid joins avenue S to L/O, so S's enemies still go to the plaza.
  setMouth(city,pl,'S',true);
  assert.equal(refGoalField(city).reachable(enemy('S').x,enemy('S').y),true,'fixture: avenue S reaches the plaza through the streets');
  assert.deepEqual(pl.targetFor(enemy('S')),{kind:'plaza'},'S closed → plaza through another mouth');
  assert.equal(pl.route('S')?.blocked,false,'route S detours');
  assert.ok(walk(city,enemy('S'),toPlaza,inPlaza,.25,6000),'S closed: reaches the plaza through another mouth');
  setMouth(city,pl,'S',false);
  setMouth(city,pl,'N',false);
  assert.deepEqual(pl.targetFor(enemy('N')),{kind:'plaza'},'N reopened → plaza');
  assert.equal(pl.route('N')?.blocked,false);
  assert.ok(walk(city,enemy('N'),toPlaza,inPlaza),'N reopened: reaches the plaza');
});

test('groups never appear inside the base, on any route (blocked, detouring through another mouth), ≥ 2 u past its exit', ()=>{
  const reqs:GroupRequest[]=[{at:0,size:6},{at:40,size:4},{at:80,size:5},{at:120,size:3}];
  for(const make of BUILDERS){
    const city=make(), pl=new AvenuePlanner(city.layout);
    // Only spectators/eliminated: nothing is visible, so the planner is free to come as close as it wants.
    const ghosts=[pl0('spec',city.center,{spectator:true}),pl0('elim',city.center,{eliminated:true})];
    for(const mode of ['normal','cerco','alternado','excursao'] as AvenueMode[]){
      for(let seed=1;seed<=4;seed++){
        const rng=rngOf(seed), state=pl.openRound(mode==='normal'?9:3,mode,rng), msg=`${city.name} ${mode}#${seed}`;
        const groups=pl.planGroups(reqs,ghosts,state,rng);
        for(const g of groups)assert.ok(g.points.length>0,`${msg} group ${g.index} placed`);
        checkOutsideBase(city,pl,groups,msg);
        checkNoStacking(groups,msg);
      }
    }
    const team=plazaTeam(city,3,9);
    checkOutsideBase(city,pl,pl.planGroups(reqs,team,st([...MS],'cerco',4),rngOf(5)),`${city.name} team in plaza`);
    // N closed: route N is blocked (ends at its barricade); S closed: route S detours and enters through another mouth.
    setMouth(city,pl,'N',true); setMouth(city,pl,'S',true);
    const rS=pl.route('S'), rN=pl.route('N');
    assert.ok(rN&&rN.blocked,`${city.name}: route N blocked`);
    assert.ok(rS&&!rS.blocked,`${city.name}: route S detours`);
    const sEnd=rS.points[rS.points.length-1];
    assert.ok(MS.some(m=>m!=='S'&&m!=='N'&&passesNear(rS.points,city.layout.mouths[m],MOUTH_HALF)),`${city.name}: route S enters through L or O (ends at ${sEnd.x.toFixed(1)},${sEnd.y.toFixed(1)})`);
    for(const open of [['S'],['N'],['S','N']] as Mouth[][]){
      const groups=pl.planGroups(reqs,ghosts,st(open),rngOf(11));
      // The detour must be usable; whether a blocked route gets members is not specified, but placed ones must be outside.
      for(const g of groups)assert.ok(open.includes(g.mouth)&&(g.points.length>0||!open.includes('S')),`${city.name} closed ${open}: group ${g.index} placed on ${g.mouth}`);
      checkOutsideBase(city,pl,groups,`${city.name} closed, open=${open}`);
      checkNoStacking(groups,`${city.name} closed, open=${open}`);
    }
  }
});

test('no stacking: same-mouth groups released within 2 s keep ≥ 0.8 u; cerco parts falling back to another mouth too', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout), team=plazaTeam(city,2,3);
  const same:GroupRequest[]=[{at:0,size:4},{at:0,size:4},{at:10,size:5},{at:30,size:3},{at:30,size:6}];
  const g1=pl.planGroups(same,team,st(['S']),rngOf(7));
  assert.ok(g1.every(g=>g.mouth==='S'&&g.points.length===same[g.index].size),'fixture: everything on S');
  assert.ok(g1.some((a,i)=>g1.some((b,j)=>j>i&&Math.abs(a.releaseTick-b.releaseTick)<=STACK_TICKS)),`fixture: some groups released within 2 s (${g1.map(g=>g.releaseTick)})`);
  checkNoStacking(g1,'one mouth');
  for(const g of g1)checkSchedule(g,same,`one mouth group ${g.index}`);
  // Cerco with avenue N watched end to end: N's parts fall back to other mouths, next to that mouth's own part.
  const watchN=[pl0('c',PLAZA),pl0('n30',avenuePoint('N',30)),pl0('n60',avenuePoint('N',60)),pl0('nEnd',SPAWN_PT.N)];
  const reqs:GroupRequest[]=[{at:0,size:8},{at:10,size:6},{at:25,size:7}];
  const g2=pl.planGroups(reqs,watchN,st([...MS],'cerco',4),rngOf(7));
  for(let k=0;k<reqs.length;k++)assert.equal(g2.filter(g=>g.index===k).reduce((s,g)=>s+g.points.length,0),reqs[k].size,`cerco group ${k} complete`);
  assert.ok(g2.every(g=>g.mouth!=='N'||g.points.length===0),'fixture: nothing fits on N');
  checkNoStacking(g2,'cerco fallback');
  // All members of the plan released within 2 s on one mouth, across every group and part.
  const byMouth=new Map<Mouth,FlowPoint[]>();
  for(const g of g2)if(g.points.length)byMouth.set(g.mouth,[...(byMouth.get(g.mouth)??[]),...g.points]);
  for(const [m,pts] of byMouth){
    let close=0;
    for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++)if(dist(pts[i],pts[j])<.05)close++;
    assert.equal(close,0,`cerco fallback: ${close} coincident members on ${m}`);
  }
});

test('per-group speed: a faster group travels the same route in proportionally fewer ticks', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout), team=plazaTeam(city,2,4), route=pl.route('S')!;
  const tol=(v:number)=>3/v*TPS+ROUND;               // 3 u of lane/goal-cell slack at speed v, plus rounding
  const slow=pl.planGroups([{at:0,size:3}],team,st(['S']),rngOf(5))[0];
  const fast=pl.planGroups([{at:0,size:3,speed:2*SPEED}],team,st(['S']),rngOf(5))[0];
  for(const [g,v] of [[slow,SPEED],[fast,2*SPEED]] as [PlannedGroup,number][]){
    assert.equal(g.points.length,3);
    const want=remainingAlong(route.points,g.points[0])/v*TPS, got=g.arrivalTick-g.releaseTick;
    assert.ok(Math.abs(got-want)<=tol(v),`speed ${v}: travel ${got} vs route ${want.toFixed(1)}`);
    assert.ok(Math.abs(g.arrivalTick-FIRST_TICKS)<=ROUND,`speed ${v}: on time (${g.arrivalTick})`);
  }
  const ts=slow.arrivalTick-slow.releaseTick, tf=fast.arrivalTick-fast.releaseTick;
  if(JSON.stringify(slow.points)===JSON.stringify(fast.points))assert.ok(Math.abs(tf-ts/2)<=ROUND,`same spot: ${tf} ≈ ${ts}/2`);
  assert.ok(tf<ts*.6,`faster group travels less (${tf} vs ${ts})`);
  // Mixed in one batch: each group uses its own speed.
  const mixed:GroupRequest[]=[{at:0,size:3},{at:200,size:3,speed:SPEED/2},{at:400,size:3,speed:3*SPEED}];
  const groups=pl.planGroups(mixed,team,st(['S']),rngOf(6));
  for(const g of groups){
    const v=mixed[g.index].speed??SPEED, want=remainingAlong(route.points,g.points[0])/v*TPS, got=g.arrivalTick-g.releaseTick;
    assert.ok(Math.abs(got-want)<=tol(v),`mixed group ${g.index} (speed ${v.toFixed(2)}): travel ${got} vs ${want.toFixed(1)}`);
    checkSchedule(g,mixed,`mixed group ${g.index}`);
  }
});

test('options/layout validation: NaN, ±Infinity and negative values never disable a rule', ()=>{
  const city=buildCity(), def=new AvenuePlanner(city.layout), team=plazaTeam(city,2,6);
  const reqs:GroupRequest[]=[{at:0,size:4},{at:60,size:3},{at:200,size:5}], state=st(['S','L']);
  const plan=(p:AvenuePlanner)=>p.planGroups(reqs,team,clone(state),rngOf(3));
  const want=plan(def);
  const keys:(keyof AvenuePlannerOptions)[]=['enemySpeed','warningSeconds','viewRadius','minPlayerDistance','firstArrivalSeconds','memberSpacing','clearance'];
  const extra=['mouthHalfWidth','leadMargin'];
  // Each option alone, then all together: a non-finite value behaves exactly like the option left out.
  const wrong:string[]=[], v={x:PLAZA.x,y:PLAZA.y};
  const sameAsDefault=(opts:AvenuePlannerOptions,what:string)=>{
    const p=new AvenuePlanner(city.layout,opts);
    if(JSON.stringify(plan(p))!==JSON.stringify(want))wrong.push(`${what}: plan differs`);
    const rnd=lcg(5);
    for(let i=0;i<100;i++){
      const a=rnd()*Math.PI*2,d=rnd()*30,q={x:v.x+Math.cos(a)*d,y:v.y+Math.sin(a)*d};
      if(p.hiddenFrom([pl0('v',v)],q)!==def.hiddenFrom([pl0('v',v)],q)){wrong.push(`${what}: hiddenFrom differs at ${d.toFixed(2)} u, angle ${a.toFixed(2)}`);break;}
    }
  };
  for(const k of [...keys,...extra])sameAsDefault({[k]:NaN} as AvenuePlannerOptions,`${k}=NaN`);
  for(const bad of [NaN,Infinity,-Infinity])sameAsDefault(Object.fromEntries([...keys,...extra].map(k=>[k,bad])) as AvenuePlannerOptions,`all=${bad}`);
  assert.deepEqual(wrong,[],'non-finite options must fall back to their defaults');
  const blindNaN=new AvenuePlanner(city.layout,{minPlayerDistance:NaN,isVisible:()=>false}), q=avenuePoint('L',40);
  assert.equal(blindNaN.hiddenFrom([pl0('a',{x:q.x+3,y:q.y})],q),false,'minPlayerDistance NaN → 4');
  assert.equal(blindNaN.hiddenFrom([pl0('a',{x:q.x+5,y:q.y})],q),true);
  const camNaN=new AvenuePlanner(city.layout,{viewRadius:NaN}), o=avenuePoint('L',40);
  assert.equal(camNaN.hiddenFrom([pl0('a',o)],{x:o.x+19,y:o.y}),true,'viewRadius NaN → camera (19 u along an axis is hidden)');
  assert.equal(camNaN.hiddenFrom([pl0('a',o)],{x:o.x+23/Math.SQRT2,y:o.y+23/Math.SQRT2}),false,'viewRadius NaN → camera (23 u diagonal is seen)');
  assert.deepEqual(plan(new AvenuePlanner(city.layout,{enemySpeed:-1})),want,'negative enemySpeed → default');
  assert.deepEqual(plan(new AvenuePlanner(city.layout,{enemySpeed:0})),want,'zero enemySpeed → default');
  for(const g of plan(new AvenuePlanner(city.layout,{warningSeconds:-2})))assert.equal(g.warnTick,g.releaseTick,'negative warning → 0');
  assert.doesNotThrow(()=>plan(new AvenuePlanner(city.layout,{minPlayerDistance:-1,memberSpacing:-1,firstArrivalSeconds:-5,clearance:-3})));
  // Floored options: clearance 0.7 behaves as 0.
  assert.deepEqual(plan(new AvenuePlanner(city.layout,{clearance:.7})),want,'clearance floored');
});

test('retreat: retreatMouth names the avenue and retreatDirection walks to its spawn end (both fixtures)', ()=>{
  for(const make of BUILDERS){
    const city=make(), pl=new AvenuePlanner(city.layout);
    for(const m of MS){
      for(const p of [city.out(m,30,1.2),city.out(m,45,-1.2),city.out(m,62,.5),city.layout.spawns[m]]){
        const at=`${city.name} ${m} from (${p.x.toFixed(1)},${p.y.toFixed(1)})`;
        assert.ok(city.walkableAt(p),`fixture: ${at} walkable`);
        assert.equal(pl.retreatMouth(p),m,`${at}: retreatMouth`);
        const end=walk(city,p,(q,out)=>pl.retreatDirection(q,out),q=>dist(q,city.layout.spawns[m])<=2);
        assert.ok(end,`${at}: reaches within 2 u of spawn ${m}`);
      }
    }
  }
});

test('determinism: identical inputs give identical outputs; seeds change mouth choices', ()=>{
  const plA=new AvenuePlanner(buildCity().layout), plB=new AvenuePlanner(buildCity().layout);
  const players=[pl0('a',PLAZA),pl0('b',avenuePoint('L',30)),pl0('h',cellC(120,186)),pl0('d',avenuePoint('O',50),{downed:true}),pl0('o',avenuePoint('S',45),{online:false})];
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

test('openRound(): deterministic, JSON-safe, mode rules, rotation toward less-used mouths', ()=>{
  const city=buildCity(), pl=new AvenuePlanner(city.layout);
  for(let seed=1;seed<=20;seed++){
    const a=pl.openRound(1,'normal',rngOf(seed)), b=pl.openRound(1,'normal',rngOf(seed));
    assert.deepEqual(a,b,`seed ${seed}: same seed, same state`);
    assert.deepEqual(JSON.parse(JSON.stringify(a)),a,`seed ${seed}: JSON round-trip`);
    assert.equal(a.round,1); assert.equal(a.mode,'normal'); assert.equal(a.open.length,1);
    for(const m of MS)assert.ok(Number.isFinite(a.uses[m]),`uses.${m}`);
    const c=pl.openRound(2,'normal',rngOf(seed+100),clone(a)), d=pl.openRound(2,'normal',rngOf(seed+100),JSON.parse(JSON.stringify(a)) as AvenueState);
    assert.deepEqual(c,d,`seed ${seed}: restored checkpoint gives the same round`);
    assert.notEqual(c.open[0],a.open[0],`seed ${seed}: round 2 rotates away from round 1's mouth`);
    const cer=pl.openRound(4,'cerco',rngOf(seed),clone(a));
    assert.deepEqual(cer.open,[...MOUTHS],`seed ${seed}: cerco opens all 4 in MOUTHS order`);
    assert.equal(cer.mode,'cerco');
    const alt=pl.openRound(5,'alternado',rngOf(seed),clone(a));
    assert.equal(alt.open.length,2); assert.equal(alt.open[1],OPPOSITE[alt.open[0]],`seed ${seed}: alternado opens an opposite pair`);
    const exc=pl.openRound(6,'excursao',rngOf(seed),clone(a));
    assert.equal(exc.open.length,1,`seed ${seed}: excursao opens 1`);
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
