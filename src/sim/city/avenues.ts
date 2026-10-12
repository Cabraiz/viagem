/**
 * City avenue planner: where and when horde groups enter the city so they reach the plaza on time without popping up
 * in sight. The city is a cross of avenues from the 4 map edges to a central plaza; each avenue enters the plaza
 * through a mouth (barricade spot). Three shared flow fields drive the enemies:
 *  - plazaField: goal = the plaza (cells within plazaRadius); routes and the normal attack;
 *  - barricadeField: goal = cells around each mouth; used once barricades cut an enemy off the plaza (`targetFor`);
 *  - exitField: goal = the 4 avenue ends (spawns); retreat.
 * Units: world u (x east, y south), speeds u/s, times in ticks at 20 Hz (ticks = Math.round(seconds × 20)).
 * Deterministic: randomness only from the injected RngLike. directionFor/retreatDirection allocate nothing with `out`.
 */
import {FlowField,DIRS,type FlowGrid,type FlowPoint,type CellRect} from '../../maps/flowfield.ts';

export type Mouth='N'|'S'|'L'|'O';
/** Fixed mouth order (ties, iteration, cerco parts). */
export const MOUTHS:readonly Mouth[]=Object.freeze(['N','S','L','O'] as Mouth[]);
/** Facing mouth: N↔S, L↔O. */
export const OPPOSITE:Readonly<Record<Mouth,Mouth>>=Object.freeze({N:'S',S:'N',L:'O',O:'L'});
/** Random source in [0,1); the room's Rng fits structurally. */
export interface RngLike {next():number}
/** Structural player view (only position and activity flags are read). */
export interface PlayerLike {id:string;x:number;y:number;online?:boolean;spectator?:boolean;eliminated?:boolean;downed?:unknown}
export interface CityLayout {
  grid:FlowGrid;                       // walkable cells of the city at 0.88 u
  plaza:FlowPoint; plazaRadius:number; // plaza center and radius (u) — goal area
  mouths:Readonly<Record<Mouth,FlowPoint>>;  // barricade spots at the plaza's 4 entrances
  spawns:Readonly<Record<Mouth,FlowPoint>>;  // avenue ends (far spawn points)
}
/** Round "mode" from the round modifier. */
export type AvenueMode='normal'|'cerco'|'alternado'|'excursao';

/** Simulation rate (ticks per second). */
export const TICK_HZ=20;
const ticks=(seconds:number)=>Math.round(seconds*TICK_HZ);

/**
 * Maps modifier ids (src/game/sim/waves.ts) and the director's siege flag to a mode: 'company-trip'→excursao;
 * 'conga-line','frescobol'→alternado; 'surprise-party','uncle-hug' or siege→cerco; anything else→normal.
 * A named modifier wins over the siege flag.
 */
export function modeForModifier(modifierId?:string,siege?:boolean):AvenueMode{
  switch(modifierId){
    case 'company-trip':return 'excursao';
    case 'conga-line':case 'frescobol':return 'alternado';
    case 'surprise-party':case 'uncle-hug':return 'cerco';
  }
  return siege?'cerco':'normal';
}
/** Mouths a round opens. normal: rounds 1–2 → 1, 3–5 → 2, 6–8 → 3, 9+ → 4 (clamped 1..4); cerco 4; excursao 1; alternado 2. */
export function mouthCount(round:number,mode:AvenueMode):number{
  if(mode==='cerco')return 4;
  if(mode==='excursao')return 1;
  if(mode==='alternado')return 2;
  const r=Number.isFinite(round)?Math.floor(round):1;
  return r<=2?1:r<=5?2:r<=8?3:4;
}

export interface AvenuePlannerOptions {
  enemySpeed?:number;        // u/s used for arrival estimates, default 1.79
  warningSeconds?:number;    // spawn-warning lead, default 1.5
  viewRadius?:number;        // a point within this distance (u) of any active player counts as visible; default 18
  isVisible?:(viewer:FlowPoint,p:FlowPoint)=>boolean; // overrides viewRadius when given
  minPlayerDistance?:number; // default 4
  firstArrivalSeconds?:number; // target arrival of the first group at the plaza after round start, default 12
  memberSpacing?:number;     // u between group members along the avenue, default 0.6
  clearance?:number;         // flow-field clearance (cells) for the planner's fields, default 0
}
/**
 * JSON-safe planner memory for the director checkpoint. `open`: mouths of this round, preferred first.
 * `alternate`: rotation offset — group k of planGroups uses open[(alternate+k) % open.length]; openRound resets it
 * to 0, a director planning one round in several batches advances it by the groups already planned.
 * `uses`: how many rounds each mouth was opened (least used are preferred).
 */
export interface AvenueState {round:number;mode:AvenueMode;open:Mouth[];alternate:number;uses:Record<Mouth,number>}

export interface GroupRequest {at:number;size:number}   // `at` = nominal dispatch tick after round start (from the waves plan); size = members
export interface PlannedGroup {
  index:number;            // request index
  mouth:Mouth;
  points:FlowPoint[];      // one walkable, hidden point per member (length = size, or fewer only if the avenue truly has no room)
  releaseTick:number;      // ticks after round start when they appear (>= 0)
  warnTick:number;         // releaseTick - warning (may be negative = during the intermission)
  arrivalTick:number;      // estimated plaza arrival, ticks after round start
}
export type Target={kind:'plaza'}|{kind:'barricade';mouth:Mouth}|{kind:'none'};

const PLAZA:Target=Object.freeze({kind:'plaza'}), NO_TARGET:Target=Object.freeze({kind:'none'});
const BARRICADE=Object.freeze({
  N:Object.freeze({kind:'barricade',mouth:'N'}),S:Object.freeze({kind:'barricade',mouth:'S'}),
  L:Object.freeze({kind:'barricade',mouth:'L'}),O:Object.freeze({kind:'barricade',mouth:'O'}),
}) as Readonly<Record<Mouth,Target>>;
/** Scan step (u) when walking a group back from the plaza toward the spawn. */
const SCAN_STEP=.5;
/** Groups never appear inside the base: the first member stands at least this far (u) past the mouth line, measured from the plaza center. */
export const OUTSIDE_MOUTH=2;
/** Lateral lanes (u from the route) used when single file does not fit; jitter (u) of each member around its lane. */
const LANES=[0,.9,-.9,1.8,-1.8], JITTER=.35;
/** Barricade goal radius (u) around each mouth; grown in steps while a barricade covers every cell in it. */
const MOUTH_RADIUS=1.5, MOUTH_RADIUS_MAX=4.5;
const NO_LABEL=255;

/** Traced route; `cum[i]` = distance (u) from the spawn to points[i]. */
interface Route {points:FlowPoint[];cum:number[];length:number;blocked:boolean;field:FlowField}
interface Placed {index:number;mouth:Mouth;points:FlowPoint[];travel:number}

/** Lazily labels cells with the goal their flow leads to (memoized per field version, amortized O(1) per query). */
class GoalMemo {
  private readonly field:FlowField; private readonly goal:(cx:number,cy:number)=>number;
  private readonly labels:Uint8Array; private readonly path:Int32Array; private ver=-1;
  constructor(field:FlowField,goal:(cx:number,cy:number)=>number){
    this.field=field; this.goal=goal;
    const n=field.width*field.height; this.labels=new Uint8Array(n); this.path=new Int32Array(n);
  }
  /** Goal label (0..253) the flow from (x,y) leads to (blocked cells follow their escape), or -1. Outside clamps to the edge. */
  at(x:number,y:number):number{
    const f=this.field, w=f.width, h=f.height, {labels,path}=this;
    let gx=(x-f.originX)/f.cellSize, gy=(y-f.originY)/f.cellSize;
    if(gx!==gx||gy!==gy)return -1;
    let cx=gx<0?0:gx>=w?w-1:Math.floor(gx), cy=gy<0?0:gy>=h?h-1:Math.floor(gy);
    if(f.version!==this.ver){labels.fill(0);this.ver=f.version;}
    let len=0, lab=NO_LABEL;
    for(;;){
      const i=cx+cy*w;
      if(labels[i]){lab=labels[i];break;}
      path[len++]=i;
      if(f.cellCost(cx,cy)===0){lab=this.goal(cx,cy)+1;break;}
      const d=f.nextCell(cx,cy);
      if(d<0||len>=path.length)break;
      cx+=DIRS[d].dx; cy+=DIRS[d].dy;
    }
    for(let k=0;k<len;k++)labels[path[k]]=lab;
    return lab===NO_LABEL?-1:lab-1;
  }
}

/** Plans which avenues a round uses and where/when groups appear on them; steers enemies to the plaza, barricades or out. */
export class AvenuePlanner {
  /** Goals: cells within plazaRadius of the plaza. */
  readonly plazaField:FlowField;
  /** Goals: walkable cells within 1.5 u of each mouth (radius grows while a barricade covers them all). */
  readonly barricadeField:FlowField;
  /** Goals: the 4 spawns (avenue ends). */
  readonly exitField:FlowField;
  private readonly layout:CityLayout;
  private readonly speed:number; private readonly warn:number; private readonly view2:number; private readonly near2:number;
  private readonly firstArrival:number; private readonly spacing:number;
  private readonly visible:((viewer:FlowPoint,p:FlowPoint)=>boolean)|undefined;
  private readonly plazaMemo:GoalMemo; private readonly mouthMemo:GoalMemo; private readonly exitMemo:GoalMemo;
  private routes:Partial<Record<Mouth,Route|null>>={};
  private mouthKey:string;
  private readonly probe:FlowPoint={x:0,y:0}; private readonly along={x:0,y:0,tx:0,ty:0};

  constructor(layout:CityLayout,options:AvenuePlannerOptions={}){
    this.layout=layout;
    const pos=(v:number|undefined,def:number)=>v!==undefined&&Number.isFinite(v)&&v>0?v:def;
    this.speed=pos(options.enemySpeed,1.79); this.spacing=pos(options.memberSpacing,.6);
    this.warn=ticks(Math.max(0,options.warningSeconds??1.5)||0);
    const view=Math.max(0,options.viewRadius??18), near=Math.max(0,options.minPlayerDistance??4);
    this.view2=view*view; this.near2=near*near; this.visible=options.isVisible;
    this.firstArrival=ticks(Math.max(0,options.firstArrivalSeconds??12)||0);
    const opts={clearance:options.clearance??0}, g=layout.grid;
    this.plazaField=new FlowField(g,this.disc(layout.plaza,Math.max(0,layout.plazaRadius),false),opts);
    const mouths=this.mouthTargets(); this.mouthKey=key(mouths);
    this.barricadeField=new FlowField(g,mouths,opts);
    this.exitField=new FlowField(g,MOUTHS.map(m=>this.walkableNear(layout.spawns[m])),opts);
    this.plazaMemo=new GoalMemo(this.plazaField,()=>0);
    this.mouthMemo=new GoalMemo(this.barricadeField,(cx,cy)=>this.nearest(layout.mouths,cx,cy));
    this.exitMemo=new GoalMemo(this.exitField,(cx,cy)=>this.nearest(layout.spawns,cx,cy));
  }

  /** Re-read walkability (barricade raised/fallen) in cell rects for all three fields (invalidateMany). */
  invalidate(rects:readonly CellRect[]):void{
    this.plazaField.invalidateMany(rects); this.exitField.invalidateMany(rects); this.barricadeField.invalidateMany(rects);
    const mouths=this.mouthTargets(), k=key(mouths);
    if(k!==this.mouthKey){this.mouthKey=k;this.barricadeField.setTargets(mouths);}
    this.routes={};
  }

  /**
   * Route spawn→plaza traced cell by cell through plazaField (first point = spawn, last = a plaza goal cell center,
   * collinear steps merged) and its length in u. When the spawn can't reach the plaza (barricade closed) the route is
   * traced through barricadeField instead and marked blocked; undefined when neither field is reachable. Cached.
   */
  route(mouth:Mouth):{points:FlowPoint[];length:number;blocked:boolean}|undefined{
    const r=this.routeData(mouth);
    return r&&{points:r.points.map(p=>({x:p.x,y:p.y})),length:r.length,blocked:r.blocked};
  }

  /**
   * Choose which mouths open this round; updates `state` in place (a fresh one when absent) and returns it.
   * Least-used mouths first (rng breaks ties; mouths with no route last); 'alternado' opens the least-used opposite
   * pair; 'cerco' all 4 in MOUTHS order. Always draws 4 rng values.
   */
  openRound(round:number,mode:AvenueMode,rng:RngLike,state?:AvenueState):AvenueState{
    const s:AvenueState=state??{round:0,mode:'normal',open:[],alternate:0,uses:{N:0,S:0,L:0,O:0}};
    const uses=s.uses=s.uses??{N:0,S:0,L:0,O:0};
    for(const m of MOUTHS)if(!Number.isFinite(uses[m]))uses[m]=0;
    const tie:Record<Mouth,number>={N:rng.next(),S:rng.next(),L:rng.next(),O:rng.next()};
    const dead=(m:Mouth)=>this.routeData(m)?0:1;
    const rank=(a:Mouth,b:Mouth)=>dead(a)-dead(b)||uses[a]-uses[b]||tie[a]-tie[b];
    let open:Mouth[];
    if(mode==='cerco')open=[...MOUTHS];
    else if(mode==='alternado'){
      const a:Mouth[]=['N','S'], b:Mouth[]=['L','O'];
      const score=(p:Mouth[])=>[dead(p[0])+dead(p[1]),uses[p[0]]+uses[p[1]],Math.min(tie[p[0]],tie[p[1]])];
      const sa=score(a), sb=score(b);
      open=(sa[0]-sb[0]||sa[1]-sb[1]||sa[2]-sb[2])<=0?a:b;
      open.sort(rank);
    }else open=[...MOUTHS].sort(rank).slice(0,mouthCount(round,mode));
    for(const m of open)uses[m]++;
    s.round=round; s.mode=mode; s.open=open; s.alternate=0;
    return s;
  }

  /**
   * Plan where/when each requested group appears so arrivals keep the requested spacing.
   *  - group k uses open[(alternate+k) % open.length] (alternado: the pair alternates by k), falling back to the next
   *    open mouths; 'cerco' splits each group across all 4 mouths (one PlannedGroup per non-empty part);
   *  - members go along the mouth's route as close to the plaza as possible (scan every 0.5 u from the plaza toward
   *    the spawn): the first at distance s, the rest stepping back by memberSpacing (extra lateral lanes only when
   *    single file runs out of avenue), each with a small rng lateral jitter, all reachable and hiddenFrom every
   *    active player; a mouth with no such spot is skipped; when none works the group has points=[];
   *  - travel_k = s / enemySpeed (ticks); firstArrival = max(firstArrivalSeconds, travel of group 0's parts);
   *    arrival_k = firstArrival + (at_k − at_0); release_k = max(0, arrival_k − travel_k); arrival_k = release_k + travel_k.
   * Does not mutate `state`.
   */
  planGroups(requests:readonly GroupRequest[],players:readonly PlayerLike[],state:AvenueState,rng:RngLike):PlannedGroup[]{
    const active=players.filter(isActive);
    const open=(state.open??[]).filter(m=>MOUTHS.includes(m)), mouths=open.length?open:[...MOUTHS];
    const off=Math.floor(Number(state.alternate))||0, placed:Placed[]=[];
    for(let k=0;k<requests.length;k++){
      const size=Math.max(0,Math.floor(Number(requests[k].size))||0);
      if(state.mode==='cerco'){
        const base=Math.floor(size/4), rem=size%4;
        for(let p=0;p<4;p++){
          const n=base+(mod(p-off-k,4)<rem?1:0);
          if(n>0)placed.push(this.placeOn(k,rotate(MOUTHS,p),n,active,rng));
        }
      }else placed.push(this.placeOn(k,rotate(mouths,mod(off+k,mouths.length)),size,active,rng));
    }
    let travel0=0;
    for(const p of placed)if(p.index===0&&p.points.length)travel0=Math.max(travel0,p.travel);
    const first=Math.max(this.firstArrival,travel0), at0=requests.length?Number(requests[0].at)||0:0;
    return placed.map(p=>{
      const desired=first+Math.round((Number(requests[p.index].at)||0)-at0);
      const releaseTick=Math.max(0,desired-p.travel);
      return {index:p.index,mouth:p.mouth,points:p.points,releaseTick,warnTick:releaseTick-this.warn,arrivalTick:releaseTick+p.travel};
    });
  }

  /** Where an enemy at p should go: plaza if plazaField reaches it; else the mouth whose barricade barricadeField leads p to; else none. A point inside a wall counts from the cell its escape leads to. */
  targetFor(p:FlowPoint):Target{
    if(this.plazaMemo.at(p.x,p.y)>=0)return PLAZA;
    const m=this.mouthMemo.at(p.x,p.y);
    return m>=0?BARRICADE[MOUTHS[m]]:NO_TARGET;
  }
  /** Direction (unit vector, allocation-free with out) for an enemy heading to `target`; (0,0) for none or at the goal. */
  directionFor(p:FlowPoint,target:Target,out:FlowPoint={x:0,y:0}):FlowPoint{
    if(target.kind==='plaza')return this.plazaField.directionAt(p.x,p.y,out);
    if(target.kind==='barricade')return this.barricadeField.directionAt(p.x,p.y,out);
    out.x=0; out.y=0; return out;
  }
  /** Retreat: unit vector toward the nearest avenue end through exitField (respects buildings). */
  retreatDirection(p:FlowPoint,out:FlowPoint={x:0,y:0}):FlowPoint{return this.exitField.directionAt(p.x,p.y,out);}
  /** Mouth whose avenue end the retreat from p leads to; undefined when no end is reachable. */
  retreatMouth(p:FlowPoint):Mouth|undefined{const m=this.exitMemo.at(p.x,p.y);return m>=0?MOUTHS[m]:undefined;}
  /** True when p is not visible to any active player and ≥ minPlayerDistance from all (same rule as planGroups). */
  hiddenFrom(players:readonly PlayerLike[],p:FlowPoint):boolean{
    for(const pl of players)if(isActive(pl)&&!this.hiddenFor(pl,p.x,p.y))return false;
    return true;
  }

  private hiddenFor(pl:PlayerLike,x:number,y:number){
    const dx=x-pl.x, dy=y-pl.y, d2=dx*dx+dy*dy;
    if(d2<this.near2)return false;
    if(this.visible){const q=this.probe;q.x=x;q.y=y;return !this.visible(pl,q);}
    return d2>this.view2;
  }
  private routeData(mouth:Mouth):Route|undefined{
    let r=this.routes[mouth];
    if(r===undefined){
      const from=this.layout.spawns[mouth];
      r=this.routes[mouth]=this.trace(this.plazaField,from,false)??this.trace(this.barricadeField,from,true)??null;
    }
    return r??undefined;
  }
  /** Follow nextCell from `from` to a goal cell (escaping walls), merging collinear steps. */
  private trace(field:FlowField,from:FlowPoint,blocked:boolean):Route|undefined{
    const {cellSize:cs,originX:ox,originY:oy,width:w,height:h}=field;
    let cx=Math.floor((from.x-ox)/cs), cy=Math.floor((from.y-oy)/cs);
    if(!(cx>=0&&cy>=0&&cx<w&&cy<h))return undefined;
    const points:FlowPoint[]=[{x:from.x,y:from.y}];
    for(let n=0,last=-1;field.cellCost(cx,cy)!==0;n++){
      const d=field.nextCell(cx,cy);
      if(d<0||n>w*h)return undefined;
      cx+=DIRS[d].dx; cy+=DIRS[d].dy;
      const p={x:ox+(cx+.5)*cs,y:oy+(cy+.5)*cs};
      if(d===last)points[points.length-1]=p;else points.push(p);
      last=d;
    }
    const cum=[0];
    for(let i=1;i<points.length;i++)cum.push(cum[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
    return {points,cum,length:cum[cum.length-1],blocked,field};
  }
  /** Point at distance s (u) from the route's plaza end, with the unit tangent there (into `this.along`). */
  private pointAt(r:Route,s:number){
    const t=Math.min(r.length,Math.max(0,r.length-s)), {points,cum}=r, a=this.along;
    let i=0;
    while(i<points.length-2&&cum[i+1]<t)i++;
    const p=points[i], q=points[Math.min(i+1,points.length-1)], seg=cum[Math.min(i+1,points.length-1)]-cum[i];
    const f=seg>0?(t-cum[i])/seg:0;
    a.x=p.x+(q.x-p.x)*f; a.y=p.y+(q.y-p.y)*f;
    if(seg>0){a.tx=(q.x-p.x)/seg;a.ty=(q.y-p.y)/seg;}else{a.tx=1;a.ty=0;}
    return a;
  }
  /** Place `size` members on the first mouth of `order` that has a hidden spot. */
  private placeOn(index:number,order:readonly Mouth[],size:number,active:readonly PlayerLike[],rng:RngLike):Placed{
    const jitter:number[]=[];
    for(let j=0;j<size;j++)jitter.push((rng.next()*2-1)*JITTER);
    for(const mouth of order){
      const r=this.routeData(mouth);
      if(!r||!size)continue;
      let best:FlowPoint[]|undefined, bestS=0;
      for(let s=this.outsideStart(r,mouth);;s=Math.min(r.length,s+SCAN_STEP)){
        const rows=Math.floor((r.length-s)/this.spacing+1e-9)+1;
        for(let lanes=Math.min(LANES.length,Math.ceil(size/rows));lanes<=LANES.length;lanes++){
          const pts=this.fill(r,s,rows,lanes,size,jitter,active);
          if(!pts)break;
          if(pts.length===size)return {index,mouth,points:pts,travel:ticks(s/this.speed)};
          if(!best||pts.length>best.length){best=pts;bestS=s;}
        }
        if(s>=r.length)break;
      }
      if(best)return {index,mouth,points:best,travel:ticks(bestS/this.speed)};
    }
    return {index,mouth:order[0],points:[],travel:0};
  }
  /** First route distance (u from the plaza end) whose point is OUTSIDE_MOUTH past the mouth line; the spawn end if none. */
  private outsideStart(r:Route,mouth:Mouth){
    const {plaza,mouths}=this.layout, m=mouths[mouth], min=Math.max(this.layout.plazaRadius,Math.hypot(m.x-plaza.x,m.y-plaza.y))+OUTSIDE_MOUTH;
    for(let s=0;s<r.length;s+=SCAN_STEP){const a=this.pointAt(r,s);if(Math.hypot(a.x-plaza.x,a.y-plaza.y)>=min)return s;}
    return r.length;
  }
  /** Member points from distance s back toward the spawn; undefined as soon as a point is seen, [] when none fits. */
  private fill(r:Route,s:number,rows:number,lanes:number,size:number,jitter:readonly number[],active:readonly PlayerLike[]){
    const pts:FlowPoint[]=[], f=r.field;
    for(let i=0;i<rows&&pts.length<size;i++){
      const a=this.pointAt(r,s+i*this.spacing), nx=-a.ty, ny=a.tx;
      for(let l=0;l<lanes&&pts.length<size;l++){
        let o=LANES[l]+jitter[pts.length], x=a.x+nx*o, y=a.y+ny*o;
        if(!f.reachable(x,y)){o=LANES[l];x=a.x+nx*o;y=a.y+ny*o;if(!f.reachable(x,y))continue;}
        for(const pl of active)if(!this.hiddenFor(pl,x,y))return undefined;
        pts.push({x,y});
      }
    }
    return pts;
  }
  /** Cell centers within `radius` (u) of c; only walkable ones when `walkableOnly`. Always includes c's own cell. */
  private disc(c:FlowPoint,radius:number,walkableOnly:boolean):FlowPoint[]{
    const g=this.layout.grid, cs=g.cellSize, ox=g.originX??0, oy=g.originY??0, out:FlowPoint[]=[];
    const x0=Math.max(0,Math.floor((c.x-radius-ox)/cs)), x1=Math.min(g.width-1,Math.floor((c.x+radius-ox)/cs));
    const y0=Math.max(0,Math.floor((c.y-radius-oy)/cs)), y1=Math.min(g.height-1,Math.floor((c.y+radius-oy)/cs));
    const ccx=Math.floor((c.x-ox)/cs), ccy=Math.floor((c.y-oy)/cs);
    for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){
      const x=ox+(cx+.5)*cs, y=oy+(cy+.5)*cs;
      if((Math.hypot(x-c.x,y-c.y)<=radius||cx===ccx&&cy===ccy)&&(!walkableOnly||g.walkable(cx,cy)))out.push({x,y});
    }
    return out;
  }
  /** Barricade goals: walkable cells within 1.5 u of each mouth, the radius growing while none is walkable. */
  private mouthTargets():FlowPoint[]{
    const out:FlowPoint[]=[];
    for(const m of MOUTHS){
      for(let r=MOUTH_RADIUS;r<=MOUTH_RADIUS_MAX;r+=.5){
        const d=this.disc(this.layout.mouths[m],r,true);
        if(d.length){out.push(...d);break;}
      }
    }
    return out;
  }
  /** p itself when its cell is walkable (or nothing nearer is), else the nearest walkable cell center within 4 u. */
  private walkableNear(p:FlowPoint):FlowPoint{
    let best=p, bd=Infinity;
    for(const q of this.disc(p,4,true)){const d=Math.hypot(q.x-p.x,q.y-p.y);if(d<bd){bd=d;best=q;}}
    const g=this.layout.grid, cs=g.cellSize, cx=Math.floor((p.x-(g.originX??0))/cs), cy=Math.floor((p.y-(g.originY??0))/cs);
    return cx>=0&&cy>=0&&cx<g.width&&cy<g.height&&g.walkable(cx,cy)?p:best;
  }
  /** Index in MOUTHS of the point of `set` nearest to cell (cx,cy)'s center. */
  private nearest(set:Readonly<Record<Mouth,FlowPoint>>,cx:number,cy:number){
    const g=this.layout.grid, cs=g.cellSize, x=(g.originX??0)+(cx+.5)*cs, y=(g.originY??0)+(cy+.5)*cs;
    let best=0, bd=Infinity;
    for(let i=0;i<MOUTHS.length;i++){const q=set[MOUTHS[i]], d=(q.x-x)**2+(q.y-y)**2;if(d<bd){bd=d;best=i;}}
    return best;
  }
}

function isActive(p:PlayerLike){return p.online!==false&&!p.spectator&&!p.eliminated&&Number.isFinite(p.x)&&Number.isFinite(p.y);}
function mod(a:number,n:number){return ((a%n)+n)%n;}
function rotate<T>(list:readonly T[],from:number):T[]{return list.map((_,i)=>list[(from+i)%list.length]);}
function key(points:readonly FlowPoint[]){return points.map(p=>p.x+','+p.y).join(';');}
