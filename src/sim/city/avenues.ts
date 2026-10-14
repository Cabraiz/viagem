/**
 * City avenue planner: where and when horde groups enter the city so they reach the plaza on time without popping up
 * in sight. The city is a cross of avenues from the 4 map edges to a central plaza; each avenue enters the plaza
 * through a mouth (barricade spot). Three shared flow fields drive the enemies:
 *  - plazaField: goal = the plaza; routes and the normal attack;
 *  - barricadeField: goal = cells around each mouth; used once barricades cut an enemy off the plaza (`targetFor`);
 *  - exitField: goal = the 4 avenue ends (spawns); retreat.
 *
 * The base: each mouth has a "mouth line", the cells within mouthHalfWidth (default 2.6 u × layout.mapScale: 4.42 u on
 * the real city, NEW-20261013-ORQ-cidade-escala-1-7) of the mouth point. The
 * plaza goal is a flood fill (8-neighborhood, no corner cutting) over walkable cells from the plaza center (default:
 * centroid of the 4 mouths), never entering a mouth line and never farther from the center than the farthest mouth
 * (nor than layout.plazaRadius when given). So a closed barricade really cuts the plaza off its avenue, even when the
 * plaza point sits a few u from a mouth. The constructor throws a RangeError when the mouth lines do not close the
 * plaza (an unbounded flood reaches a spawn). "Inside the base" = a plaza goal cell or a mouth-line cell; groups
 * never appear there and stand at least OUTSIDE_MOUTH (u, along their route) past the route's outermost base cell.
 *
 * Visibility (default): the union of every legal phone camera of the endless map (contract visibleOffset: portrait
 * and landscape × 4 views, sprite/lag/offset margins), scaled to the city by CITY_VIEW_SCALE (drawn hero size of
 * 'cidade-nevada' over 'infinito'), after shrinking the offset by a lead margin (hero speed × warning seconds), so a
 * warned spot is still off screen when the group lands even if a player walks straight at it: `cityVisible`.
 * Option viewRadius switches to a plain circle (radius + lead); option isVisible overrides both.
 * Viewers: every player not spectating nor eliminated, offline ones included (they may reconnect, D-011); downed
 * players still see.
 *
 * Director usage: openRound once per round; planGroups(all requests of the round) gives the schedule. Then, at each
 * group's warnTick, plan that group again alone with {at0: the round's first nominal at, indexBase: its index,
 * nowTick: the current tick} and a fresh rng, and check hiddenFrom on the returned points (players moved meanwhile);
 * when unconstrained it reproduces the arrival tick of the full plan. Never advance state.alternate between batches:
 * the rotation follows the global index (indexBase + position). A group that cannot make its arrival is released at
 * nowTick and arrives late alone; the others keep their schedule. Rng draws are a fixed function of the request sizes.
 *
 * Units: world u (x east, y south), speeds u/s, times in ticks at 20 Hz (ticks = Math.round(seconds × 20)).
 * Deterministic: randomness only from the injected RngLike. State is JSON-safe. targetFor/directionFor/
 * retreatDirection allocate nothing (with `out`).
 */
import {FlowField,DIRS,HERO_SPEED_MULT,type FlowGrid,type FlowPoint,type CellRect} from '../../maps/index.ts';
import {HERO_DEFAULT_SCREEN_PX,HERO_WIDEST_SCREEN_PX,visibleOffset} from '../../contract/index.ts';
import {SCALE_PROFILES} from '../../rules/index.ts';

export type Mouth='N'|'S'|'L'|'O';
/** Fixed mouth order (ties, iteration, cerco parts). */
export const MOUTHS:readonly Mouth[]=Object.freeze(['N','S','L','O'] as Mouth[]);
/** Facing mouth: N↔S, L↔O. */
export const OPPOSITE:Readonly<Record<Mouth,Mouth>>=Object.freeze({N:'S',S:'N',L:'O',O:'L'});
/** Random source in [0,1); the room's Rng fits structurally. */
export interface RngLike {next():number}
/** Structural player view (only position and the spectator/eliminated flags are read; offline players still count). */
export interface PlayerLike {id:string;x:number;y:number;online?:boolean;spectator?:boolean;eliminated?:boolean;downed?:unknown}
export interface CityLayout {
  grid:FlowGrid;                       // walkable cells of the city at 0.88 u
  plazaCenter?:FlowPoint;              // flood seed of the plaza goal; default: centroid of the 4 mouths
  plaza?:FlowPoint;                    // fallback seed when the center's cell is not walkable
  plazaRadius?:number;                 // extra cap (u from the plaza center) of the plaza flood
  /**
   * The map's scale over the .w3x proportions (default 1; city/grid.ts cityLayoutFrom: rules CITY_MAP_SCALE,
   * NEW-20261013-ORQ-cidade-escala-1-7). Multiplies the planner's MAP lengths — the mouthHalfWidth default,
   * MOUTH_RADIUS — and none of its body or camera lengths (spacing, lanes, OUTSIDE_MOUTH, minPlayerDistance, views).
   */
  mapScale?:number;
  /**
   * Radius (u) of the barricade goals around each mouth (default MOUTH_RADIUS × mapScale). cityLayoutFrom derives it
   * from the real barricade discs, which did not grow exactly with the map (their slack is a hero's).
   */
  mouthRadius?:number;
  mouths:Readonly<Record<Mouth,FlowPoint>>;  // barricade spots at the plaza's 4 entrances
  spawns:Readonly<Record<Mouth,FlowPoint>>;  // avenue ends (far spawn points)
}
/** Round "mode" from the round modifier. */
export type AvenueMode='normal'|'cerco'|'alternado'|'excursao';

/** Simulation rate (ticks per second). */
export const TICK_HZ=20;
const ticks=(seconds:number)=>Math.round(seconds*TICK_HZ);

const CITY=SCALE_PROFILES['cidade-nevada'];
/** City u per endless-map u on screen: drawn hero size of the city over the endless map's (≈0.544). */
export const CITY_VIEW_SCALE=CITY.hero.drawnSize/SCALE_PROFILES.infinito.hero.drawnSize;
/** City hero walk (u/s): the scale profile's (base) hero × the 2× walk (maps HERO_SPEED_MULT), ≈3.99. */
const CITY_WALK=CITY.hero.speed*HERO_SPEED_MULT;
/** Default lead margin (u): what the city hero walks during the default 1.5 s spawn warning (≈5.98). */
export const CITY_VIEW_LEAD=CITY_WALK*1.5;
/**
 * Visibility of an offset (dx,dy) shrunk by `lead`, against the city-scaled camera union (the widest legal camera; a
 * `heroPx` of HERO_DEFAULT_SCREEN_PX asks about the players' default zoom instead, for pacing only).
 */
function seen(dx:number,dy:number,lead:number,heroPx=HERO_WIDEST_SCREEN_PX){
  const d=Math.sqrt(dx*dx+dy*dy);
  if(d<=lead)return true;
  const f=(d-lead)/d/CITY_VIEW_SCALE;
  return visibleOffset(dx*f,dy*f,undefined,heroPx);
}
/**
 * True when p may show on the screen of a player at `viewer` within the next `lead` u of walking (default
 * CITY_VIEW_LEAD): the offset is shrunk by lead, scaled by 1/CITY_VIEW_SCALE and tested against every legal camera.
 */
export function cityVisible(viewer:FlowPoint,p:FlowPoint,lead=CITY_VIEW_LEAD):boolean{
  return seen(p.x-viewer.x,p.y-viewer.y,Number.isFinite(lead)&&lead>0?lead:0);
}

/**
 * Maps modifier ids (src/rules/waves.ts) and the director's siege flag to a mode: 'company-trip'→excursao;
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

/** Numeric options: non-finite → default; negative → 0 (speeds, spacing and mouthHalfWidth: ≤ 0 → default). */
export interface AvenuePlannerOptions {
  enemySpeed?:number;        // u/s used for arrival estimates, default 1.79
  warningSeconds?:number;    // spawn-warning lead, default 1.5
  leadMargin?:number;        // u a viewer may walk before the group lands; default city hero speed × warningSeconds
  viewRadius?:number;        // when given: visible = within viewRadius + leadMargin of a viewer (instead of cityVisible)
  isVisible?:(viewer:FlowPoint,p:FlowPoint)=>boolean; // overrides cityVisible/viewRadius (no lead applied)
  minPlayerDistance?:number; // default 4
  firstArrivalSeconds?:number; // arrival of the first group at the plaza after the round's first nominal at, default 12
  memberSpacing?:number;     // u between group members along the avenue, default 0.6
  mouthHalfWidth?:number;    // u, radius of each mouth line, default 2.6 × layout.mapScale
  clearance?:number;         // flow-field clearance (cells, floored) for the planner's fields, default 0
}
/**
 * JSON-safe planner memory for the director checkpoint. `open`: mouths of this round, preferred first.
 * `alternate`: rotation offset — the group with global index i (indexBase + position) tries open[(alternate+i) % n]
 * first; openRound resets it to 0 and planning in batches must NOT advance it (pass indexBase instead).
 * `uses`: how many rounds each mouth was opened (least used are preferred).
 */
export interface AvenueState {round:number;mode:AvenueMode;open:Mouth[];alternate:number;uses:Record<Mouth,number>}

/**
 * `at` = nominal dispatch tick after round start (from the waves plan); size = members; speed = u/s of this group
 * (default enemySpeed); aim (cidade-05c v2): 'plaza' keeps this group on the plaza scan even when planGroups gets a
 * chaseCost (siege groups besiege the base, they never chase the team); 'team' or absent follows opts.chaseCost.
 */
export interface GroupRequest {at:number;size:number;speed?:number;aim?:'team'|'plaza'}
/**
 * Path distance (u) from p to the nearest live player (Infinity when none is reachable): aims groups at a team away
 * from the plaza (cidade-05c). See planGroups and openRound.
 */
export type ChaseCost=(p:FlowPoint)=>number;
/**
 * at0: the round's first nominal at (default: min of the requests' at); indexBase: global index of requests[0];
 * nowTick: earliest release; chaseCost: aim at the team instead of the plaza (see planGroups).
 */
export interface PlanOptions {at0?:number;indexBase?:number;nowTick?:number;chaseCost?:ChaseCost}
/** chaseCost: prefer the mouths whose avenue comes closest to the team (see openRound). */
export interface OpenOptions {chaseCost?:ChaseCost}
export interface PlannedGroup {
  index:number;            // indexBase + request position
  mouth:Mouth;
  points:FlowPoint[];      // one walkable, hidden point per member (length = size, or fewer only if the avenue truly has no room)
  releaseTick:number;      // ticks after round start when they appear (>= nowTick)
  warnTick:number;         // releaseTick - warning (may be negative = during the intermission)
  arrivalTick:number;      // estimated plaza arrival (with chaseCost: at the team), ticks after round start
}
export type Target={kind:'plaza'}|{kind:'barricade';mouth:Mouth}|{kind:'none'};

const PLAZA:Target=Object.freeze({kind:'plaza'}), NO_TARGET:Target=Object.freeze({kind:'none'});
const BARRICADE=Object.freeze({
  N:Object.freeze({kind:'barricade',mouth:'N'}),S:Object.freeze({kind:'barricade',mouth:'S'}),
  L:Object.freeze({kind:'barricade',mouth:'L'}),O:Object.freeze({kind:'barricade',mouth:'O'}),
}) as Readonly<Record<Mouth,Target>>;
/** Scan step (u) when walking a group back from the plaza toward the spawn. */
const SCAN_STEP=.5;
/**
 * Members stand at least this far (u, along the route) past the route's outermost base cell. Not × layout.mapScale
 * (NEW-20261013-ORQ-cidade-escala-1-7): the base edge it is measured from already moved out with the mouth lines, and
 * 2 u past a 4.42 u line keeps members 6.4 u from the mouth, clear of its 2.2 u barricade disc and the bodies at it;
 * × 1.7 (3.4 u) only made the first group of city-director seed 5 land at 16.8 s (bound 16 s).
 */
export const OUTSIDE_MOUTH=2;
/** Members of groups released within STACK_TICKS of each other stay at least STACK_GAP u apart (bodies: not scaled). */
const STACK_TICKS=2*TICK_HZ, STACK_GAP=.8;
/**
 * Lateral lanes (u from the route) used when single file does not fit; jitter (u) of each member around its lane. Body
 * spacing (about two common enemies side by side), not a fraction of the avenue: not scaled with the map.
 */
const LANES=[0,.9,-.9,1.8,-1.8], JITTER=.35;
/**
 * Barricade goals: every cell within this radius (u) of each mouth (active while walkable), fixed for the planner's
 * life; × layout.mapScale unless layout.mouthRadius says otherwise (it must reach past the barricade disc).
 */
const MOUTH_RADIUS=1.5;
/** Default mouth line half width (u) on the .w3x-sized city; × layout.mapScale. */
const MOUTH_HALF_WIDTH=2.6;
const NO_LABEL=255, MOUTH_LINE=1, PLAZA_CELL=2;

/** Traced route; `cum[i]` = distance (u) from the spawn to points[i]; `minS` = first allowed distance from the plaza end. */
interface Route {points:FlowPoint[];cum:number[];length:number;blocked:boolean;field:FlowField;minS:number}
interface Placed {index:number;mouth:Mouth;points:FlowPoint[];release:number;travel:number}

/** Lazily labels cells with the goal their flow leads to (memoized per field version, amortized O(1) per query). */
class GoalMemo {
  private readonly field:FlowField; private readonly goal:(cx:number,cy:number)=>number;
  private readonly labels:Uint8Array; private readonly path:Int32Array; private ver=-1;
  /** `path` is a shared scratch of at least width × height. */
  constructor(field:FlowField,goal:(cx:number,cy:number)=>number,path:Int32Array){
    this.field=field; this.goal=goal; this.labels=new Uint8Array(field.width*field.height); this.path=path;
  }
  /** Goal label (0..253) the flow from (x,y) leads to (blocked cells follow their escape), or -1. Outside clamps to the edge. */
  at(x:number,y:number):number{
    const f=this.field, w=f.width, h=f.height, {labels,path}=this, n=w*h;
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
      if(d<0||len>=n)break;
      cx+=DIRS[d].dx; cy+=DIRS[d].dy;
    }
    for(let k=0;k<len;k++)labels[path[k]]=lab;
    return lab===NO_LABEL?-1:lab-1;
  }
}

/** Plans which avenues a round uses and where/when groups appear on them; steers enemies to the plaza, barricades or out. */
export class AvenuePlanner {
  /** Goals: the plaza flood (see the module doc). */
  readonly plazaField:FlowField;
  /** Goals: every cell within 1.5 u of each mouth (active while walkable). */
  readonly barricadeField:FlowField;
  /** Goals: the 4 spawns (avenue ends). */
  readonly exitField:FlowField;
  /** Plaza center the flood started from (u). */
  readonly plazaCenter:FlowPoint;
  private readonly layout:CityLayout;
  private readonly speed:number; private readonly warn:number; private readonly lead:number; private readonly near2:number;
  private readonly radius:number|undefined; private readonly firstArrival:number; private readonly spacing:number;
  private readonly visible:((viewer:FlowPoint,p:FlowPoint)=>boolean)|undefined;
  /** Per cell: MOUTH_LINE, PLAZA_CELL or 0. */
  private readonly base:Uint8Array;
  private readonly plazaMemo:GoalMemo; private readonly mouthMemo:GoalMemo; private readonly exitMemo:GoalMemo;
  private routes:Partial<Record<Mouth,Route|null>>={};
  private readonly probe:FlowPoint={x:0,y:0}; private readonly along={x:0,y:0,tx:0,ty:0};

  /** Throws a RangeError on a malformed layout, a plaza center on a mouth line or a plaza not closed by its mouths. */
  constructor(layout:CityLayout,options:AvenuePlannerOptions={}){
    checkLayout(layout);
    this.layout=layout;
    const o=options??{}, g=layout.grid, w=g.width, h=g.height, cs=g.cellSize, ox=g.originX??0, oy=g.originY??0;
    this.speed=pos(o.enemySpeed,1.79); this.spacing=pos(o.memberSpacing,.6);
    const warnS=nonNeg(o.warningSeconds,1.5);
    this.warn=ticks(warnS); this.lead=nonNeg(o.leadMargin,CITY_WALK*warnS);
    const near=nonNeg(o.minPlayerDistance,4); this.near2=near*near;
    this.radius=o.viewRadius===undefined||!Number.isFinite(o.viewRadius)?undefined:nonNeg(o.viewRadius,18); // non-finite → camera default
    this.visible=typeof o.isVisible==='function'?o.isVisible:undefined;
    this.firstArrival=ticks(nonNeg(o.firstArrivalSeconds,12));
    const k=layout.mapScale??1;
    const halfWidth=pos(o.mouthHalfWidth,MOUTH_HALF_WIDTH*k), opts={clearance:Math.floor(nonNeg(o.clearance,0))};
    const scratch=new Int32Array(w*h), base=this.base=new Uint8Array(w*h);
    const cellOf=(p:FlowPoint)=>{const cx=Math.floor((p.x-ox)/cs), cy=Math.floor((p.y-oy)/cs);return cx>=0&&cy>=0&&cx<w&&cy<h?cx+cy*w:-1;};
    for(const m of MOUTHS)for(const i of this.disc(layout.mouths[m],halfWidth))base[i]=MOUTH_LINE;
    const center=layout.plazaCenter??centroid(layout.mouths);
    let seed=cellOf(center);
    if((seed<0||!g.walkable(seed%w,(seed/w)|0))&&layout.plaza)seed=cellOf(layout.plaza);
    if(seed<0||!g.walkable(seed%w,(seed/w)|0))throw new RangeError('plaza center (and plaza) cell is not walkable');
    if(base[seed])throw new RangeError('plaza center lies on a mouth line');
    this.plazaCenter={x:ox+(seed%w+.5)*cs,y:oy+(((seed/w)|0)+.5)*cs};
    let cap=0;
    for(const m of MOUTHS)cap=Math.max(cap,Math.hypot(layout.mouths[m].x-center.x,layout.mouths[m].y-center.y));
    if(layout.plazaRadius!==undefined)cap=Math.min(cap,layout.plazaRadius);
    const leak=this.flood(seed,Infinity,center,scratch);
    for(const m of MOUTHS){const i=cellOf(layout.spawns[m]);if(i>=0&&leak[i])throw new RangeError(`mouth lines do not close the plaza: it reaches spawn ${m}`);}
    const inside=this.flood(seed,cap,center,scratch), goals:FlowPoint[]=[];
    for(let i=0;i<w*h;i++)if(inside[i]){base[i]=PLAZA_CELL;goals.push({x:ox+(i%w+.5)*cs,y:oy+(((i/w)|0)+.5)*cs});}
    const cellPt=(i:number)=>({x:ox+(i%w+.5)*cs,y:oy+(((i/w)|0)+.5)*cs});
    this.plazaField=new FlowField(g,goals,opts);
    this.barricadeField=new FlowField(g,MOUTHS.flatMap(m=>this.disc(layout.mouths[m],layout.mouthRadius??MOUTH_RADIUS*k).map(cellPt)),opts);
    this.exitField=new FlowField(g,MOUTHS.map(m=>this.walkableNear(layout.spawns[m])),opts);
    this.plazaMemo=new GoalMemo(this.plazaField,()=>0,scratch);
    this.mouthMemo=new GoalMemo(this.barricadeField,(cx,cy)=>this.nearest(layout.mouths,cx,cy),scratch);
    this.exitMemo=new GoalMemo(this.exitField,(cx,cy)=>this.nearest(layout.spawns,cx,cy),scratch);
  }

  /** Re-read walkability (barricade raised/fallen) in cell rects; each field recomputes once. Goals never change. */
  invalidate(rects:readonly CellRect[]):void{
    this.plazaField.invalidateMany(rects); this.exitField.invalidateMany(rects); this.barricadeField.invalidateMany(rects);
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

  /** True when the cell containing p is a plaza goal cell or a mouth-line cell. */
  insideBase(p:FlowPoint):boolean{return this.inBase(p.x,p.y);}
  /** Ticks after the round's first nominal `at` when the first group is aimed at the plaza (firstArrivalSeconds). */
  get firstArrivalTicks():number{return this.firstArrival;}

  /**
   * Choose which mouths open this round; updates `state` in place (a fresh one when absent) and returns it.
   * Least-used mouths first (rng breaks ties; mouths with no route last); 'alternado' opens the least-used opposite
   * pair; 'cerco' all 4 in MOUTHS order. Always draws 4 rng values.
   * With opts.chaseCost (the team away from the base, cidade-05c) the mouths whose avenue (past the base, from
   * OUTSIDE_MOUTH on) comes closest to the team by path rank first, before the use count: a team at an avenue's far
   * end meets that avenue's horde instead of one that walks the whole city. 'alternado' prefers the pair holding the
   * closest mouth; 'cerco' is unchanged. A mouth the team cannot be reached from ranks as farthest.
   */
  openRound(round:number,mode:AvenueMode,rng:RngLike,state?:AvenueState,opts:OpenOptions={}):AvenueState{
    const s:AvenueState=state??{round:0,mode:'normal',open:[],alternate:0,uses:{N:0,S:0,L:0,O:0}};
    const uses=s.uses=s.uses??{N:0,S:0,L:0,O:0};
    for(const m of MOUTHS)if(!Number.isFinite(uses[m]))uses[m]=0;
    const tie:Record<Mouth,number>={N:rng.next(),S:rng.next(),L:rng.next(),O:rng.next()};
    const dead=(m:Mouth)=>this.routeData(m)?0:1;
    const chase=typeof opts?.chaseCost==='function'?opts.chaseCost:undefined;
    // Path distance from each avenue to the team (0 for every mouth without chaseCost: the use count decides).
    const near:Record<Mouth,number>={N:0,S:0,L:0,O:0};
    if(chase&&mode!=='cerco')for(const m of MOUTHS){const r=this.routeData(m);near[m]=r?this.nearestOn(r,chase):Infinity;}
    const cmp=(x:number,y:number)=>x===y?0:x<y?-1:1;
    const rank=(a:Mouth,b:Mouth)=>dead(a)-dead(b)||cmp(near[a],near[b])||uses[a]-uses[b]||tie[a]-tie[b];
    let open:Mouth[];
    if(mode==='cerco')open=[...MOUTHS];
    else if(mode==='alternado'){
      const a:Mouth[]=['N','S'], b:Mouth[]=['L','O'];
      const score=(p:Mouth[])=>[dead(p[0])+dead(p[1]),Math.min(near[p[0]],near[p[1]]),uses[p[0]]+uses[p[1]],Math.min(tie[p[0]],tie[p[1]])];
      const sa=score(a), sb=score(b);
      open=(cmp(sa[0],sb[0])||cmp(sa[1],sb[1])||cmp(sa[2],sb[2])||cmp(sa[3],sb[3]))<=0?a:b;
      open.sort(rank);
    }else open=[...MOUTHS].sort(rank).slice(0,mouthCount(round,mode));
    for(const m of open)uses[m]++;
    s.round=round; s.mode=mode; s.open=open; s.alternate=0;
    return s;
  }

  /**
   * Plan where/when each requested group appears so arrivals keep the requested spacing. Group at position k has the
   * global index i = indexBase + k.
   *  - desired arrival = firstArrivalSeconds (ticks) + (at_k − at0); release = max(nowTick, desired − travel),
   *    arrival = release + travel, travel = route distance of the first member / speed (ticks). A late group arrives
   *    late alone;
   *  - normal/excursao: tries the open mouths in rotation order from open[(alternate+i) % n] and keeps the placement
   *    with the most members, then the EARLIEST arrival (ties → rotation order); alternado: the pair alternates by i,
   *    the other mouth only when the first has no spot; cerco: splits each group over the 4 mouths (one PlannedGroup
   *    per non-empty part), a part moving to the next mouth only when its own has no spot;
   *  - members go along the mouth's route as close to the plaza as possible (scan every 0.5 u from OUTSIDE_MOUTH past
   *    the route's outermost base cell toward the spawn): the first at distance s, the rest stepping back by
   *    memberSpacing (extra lateral lanes only when single file runs out of avenue), each with a small rng lateral
   *    jitter, all reachable, outside the base, hiddenFrom every viewer and ≥ 0.8 u from members of groups of this
   *    call released within 2 s; a mouth with no such spot is skipped; when none works the group has points=[];
   *  - opts.chaseCost (cidade-05c: the team away from the base): on each route the spots are tried by the path
   *    distance of their route point to the team (ascending; ties → closer to the plaza) instead of by the distance
   *    to the plaza, so the group appears as close to the team as it stays hidden; travel = that distance / speed, so
   *    arrivalTick is the arrival at the team. A route with no finite chaseCost past the base (or no spot that fits
   *    by it) falls back to the plaza scan. A request with aim 'plaza' (a siege group) ignores chaseCost.
   * Draws exactly Σ size rng values. Does not mutate `state`.
   */
  planGroups(requests:readonly GroupRequest[],players:readonly PlayerLike[],state:AvenueState,rng:RngLike,opts:PlanOptions={}):PlannedGroup[]{
    const viewers=players.filter(isViewer);
    const now=Math.max(0,Math.floor(fin(opts?.nowTick,0))), indexBase=Math.max(0,Math.floor(fin(opts?.indexBase,0)));
    let at0=fin(opts?.at0,Infinity);
    if(at0===Infinity){for(const r of requests){const a=Number(r?.at);if(Number.isFinite(a)&&a<at0)at0=a;}if(at0===Infinity)at0=0;}
    const open=(state?.open??[]).filter(m=>MOUTHS.includes(m)), mouths=open.length?open:[...MOUTHS];
    const off=Math.floor(fin(state?.alternate,0)), mode=state?.mode, placed:Placed[]=[];
    const chase=typeof opts?.chaseCost==='function'?opts.chaseCost:undefined;
    const sizes=requests.map(r=>Math.max(0,Math.floor(fin(r?.size,0))));
    const jitter=sizes.map(n=>{const j:number[]=[];for(let q=0;q<n;q++)j.push((rng.next()*2-1)*JITTER);return j;});
    for(let k=0;k<requests.length;k++){
      const i=indexBase+k, size=sizes[k], speed=pos(requests[k]?.speed,this.speed), aim=requests[k]?.aim==='plaza'?undefined:chase;
      const desired=this.firstArrival+Math.round(fin(requests[k]?.at,at0)-at0);
      if(mode==='cerco'){
        const part=Math.floor(size/4), rem=size%4;
        for(let p=0,used=0;p<4;p++){
          const n=part+(mod(p-off-i,4)<rem?1:0);
          if(n>0)placed.push(this.placeOn(i,rotate(MOUTHS,p),false,jitter[k].slice(used,used+n),viewers,desired,now,speed,placed,aim));
          used+=n;
        }
      }else placed.push(this.placeOn(i,rotate(mouths,mod(off+i,mouths.length)),mode!=='alternado',jitter[k],viewers,desired,now,speed,placed,aim));
    }
    return placed.map(p=>({index:p.index,mouth:p.mouth,points:p.points,releaseTick:p.release,warnTick:p.release-this.warn,arrivalTick:p.release+p.travel}));
  }

  /** Where an enemy at p should go: plaza if plazaField reaches it; else the mouth whose barricade barricadeField leads p to; else none. A point inside a wall counts from the cell its escape leads to. */
  targetFor(p:FlowPoint):Target{
    if(this.plazaMemo.at(p.x,p.y)>=0)return PLAZA;
    const m=this.mouthMemo.at(p.x,p.y);
    return m>=0?BARRICADE[MOUTHS[m]]:NO_TARGET;
  }
  /**
   * Direction (unit vector, allocation-free with out) for an enemy heading to `target`; (0,0) for none or at the goal.
   * A barricade target follows barricadeField (nearest reachable barricade); its `mouth` is informational.
   */
  directionFor(p:FlowPoint,target:Target,out:FlowPoint={x:0,y:0}):FlowPoint{
    if(target.kind==='plaza')return this.plazaField.directionAt(p.x,p.y,out);
    if(target.kind==='barricade')return this.barricadeField.directionAt(p.x,p.y,out);
    out.x=0; out.y=0; return out;
  }
  /** Retreat: unit vector toward the nearest avenue end through exitField (respects buildings). */
  retreatDirection(p:FlowPoint,out:FlowPoint={x:0,y:0}):FlowPoint{return this.exitField.directionAt(p.x,p.y,out);}
  /** Mouth whose avenue end the retreat from p leads to; undefined when no end is reachable. */
  retreatMouth(p:FlowPoint):Mouth|undefined{const m=this.exitMemo.at(p.x,p.y);return m>=0?MOUTHS[m]:undefined;}
  /** True when p is not visible to any viewer (offline included) and ≥ minPlayerDistance from all (same rule as planGroups). */
  hiddenFrom(players:readonly PlayerLike[],p:FlowPoint):boolean{
    for(const pl of players)if(isViewer(pl)&&!this.hiddenFor(pl,p.x,p.y))return false;
    return true;
  }

  /**
   * Pacing only (the director's city run-in, NEW-20261013-ORQ-camera-zoom-out-e-roda): true when p is off every viewer's
   * screen at the players' DEFAULT zoom (contract HERO_DEFAULT_SCREEN_PX, city-scaled, no lead) and ≥ minPlayerDistance
   * from all. With viewRadius or isVisible the planner's own visibility rule decides, without the lead. Spawns keep
   * hiddenFrom (the widest legal camera, with the lead).
   */
  hiddenAtDefault(players:readonly PlayerLike[],p:FlowPoint):boolean{
    for(const pl of players){
      if(!isViewer(pl))continue;
      const dx=p.x-pl.x, dy=p.y-pl.y, d2=dx*dx+dy*dy;
      if(!(d2>=this.near2))return false;
      if(this.visible){const q=this.probe;q.x=p.x;q.y=p.y;if(this.visible(pl,q))return false;continue;}
      if(this.radius!==undefined){if(d2<=this.radius*this.radius)return false;continue;}
      if(seen(dx,dy,0,HERO_DEFAULT_SCREEN_PX))return false;
    }
    return true;
  }

  private inBase(x:number,y:number){
    const g=this.layout.grid, cx=Math.floor((x-(g.originX??0))/g.cellSize), cy=Math.floor((y-(g.originY??0))/g.cellSize);
    return cx>=0&&cy>=0&&cx<g.width&&cy<g.height&&this.base[cx+cy*g.width]!==0;
  }
  private hiddenFor(pl:PlayerLike,x:number,y:number){
    const dx=x-pl.x, dy=y-pl.y, d2=dx*dx+dy*dy;
    if(!(d2>=this.near2))return false;
    if(this.visible){const q=this.probe;q.x=x;q.y=y;return !this.visible(pl,q);}
    if(this.radius!==undefined){const r=this.radius+this.lead;return d2>r*r;}
    return !seen(dx,dy,this.lead);
  }
  /** Flood (8-neighborhood, no corner cutting) over walkable non-mouth-line cells within `cap` u of `c`. */
  private flood(seed:number,cap:number,c:FlowPoint,queue:Int32Array):Uint8Array{
    const g=this.layout.grid, w=g.width, h=g.height, cs=g.cellSize, ox=g.originX??0, oy=g.originY??0, base=this.base;
    const mark=new Uint8Array(w*h), ok=(x:number,y:number)=>x>=0&&y>=0&&x<w&&y<h&&base[x+y*w]!==MOUTH_LINE&&g.walkable(x,y);
    let qa=0, qe=0; mark[seed]=1; queue[qe++]=seed;
    while(qa<qe){
      const u=queue[qa++], ux=u%w, uy=(u-ux)/w;
      for(let d=0;d<8;d++){
        const vx=ux+DIRS[d].dx, vy=uy+DIRS[d].dy, v=vx+vy*w;
        if(vx<0||vy<0||vx>=w||vy>=h||mark[v]||!ok(vx,vy)||d>=4&&(!ok(vx,uy)||!ok(ux,vy)))continue;
        if(Math.hypot(ox+(vx+.5)*cs-c.x,oy+(vy+.5)*cs-c.y)>cap)continue;
        mark[v]=1; queue[qe++]=v;
      }
    }
    return mark;
  }
  private routeData(mouth:Mouth):Route|undefined{
    let r=this.routes[mouth];
    if(r===undefined){
      const from=this.layout.spawns[mouth];
      r=this.routes[mouth]=this.trace(this.plazaField,from,false)??this.trace(this.barricadeField,from,true)??null;
    }
    return r??undefined;
  }
  /** Follow nextCell from `from` to a goal cell (escaping walls), merging collinear cell steps; notes the first base cell. */
  private trace(field:FlowField,from:FlowPoint,blocked:boolean):Route|undefined{
    const {cellSize:cs,originX:ox,originY:oy,width:w,height:h}=field;
    let cx=Math.floor((from.x-ox)/cs), cy=Math.floor((from.y-oy)/cs);
    if(!(cx>=0&&cy>=0&&cx<w&&cy<h))return undefined;
    const points:FlowPoint[]=[{x:from.x,y:from.y}];
    let dist=0, baseAt=this.base[cx+cy*w]?0:-1;
    for(let n=0,last=-1;field.cellCost(cx,cy)!==0;n++){
      const d=field.nextCell(cx,cy);
      if(d<0||n>w*h)return undefined;
      cx+=DIRS[d].dx; cy+=DIRS[d].dy;
      const p={x:ox+(cx+.5)*cs,y:oy+(cy+.5)*cs}, q=points[points.length-1];
      dist+=n===0?Math.hypot(p.x-q.x,p.y-q.y):DIRS[d].dx&&DIRS[d].dy?cs*Math.SQRT2:cs;
      if(d===last&&points.length>2)points[points.length-1]=p;else points.push(p);
      last=d;
      if(baseAt<0&&this.base[cx+cy*w])baseAt=dist;
    }
    const cum=[0];
    for(let i=1;i<points.length;i++)cum.push(cum[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
    const length=cum[cum.length-1];
    return {points,cum,length,blocked,field,minS:(baseAt<0?0:length-baseAt)+OUTSIDE_MOUTH};
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
  /**
   * Place `size` members on the mouths of `order`: with `earliest` the placement with most members then earliest
   * arrival wins (ties → order); otherwise the first mouth with any spot.
   */
  private placeOn(index:number,order:readonly Mouth[],earliest:boolean,jitter:readonly number[],viewers:readonly PlayerLike[],desired:number,now:number,speed:number,placed:readonly Placed[],chase?:ChaseCost):Placed{
    let best:Placed|undefined;
    for(const mouth of order){
      const r=this.routeData(mouth);
      const got=r&&jitter.length?(chase&&this.chaseScan(r,jitter,viewers,desired,now,speed,placed,chase))||this.scan(r,jitter,viewers,desired,now,speed,placed):undefined;
      if(!got)continue;
      const c:Placed={index,mouth,...got};
      if(!earliest)return c;
      if(!best||c.points.length>best.points.length||c.points.length===best.points.length&&c.release+c.travel<best.release+best.travel)best=c;
    }
    const release=Math.max(now,desired);
    return best??{index,mouth:order[0]??'N',points:[],release,travel:0};
  }
  /** Closest spot of route r (from r.minS toward the spawn) where the group fits; partial when it never fully fits. */
  private scan(r:Route,jitter:readonly number[],viewers:readonly PlayerLike[],desired:number,now:number,speed:number,placed:readonly Placed[]){
    const size=jitter.length;
    let best:{points:FlowPoint[];release:number;travel:number}|undefined;
    if(r.minS>r.length)return undefined;
    for(let s=r.minS;;s=Math.min(r.length,s+SCAN_STEP)){
      const travel=ticks(s/speed), release=Math.max(now,desired-travel);
      const rows=Math.floor((r.length-s)/this.spacing+1e-9)+1;
      for(let lanes=Math.min(LANES.length,Math.ceil(size/rows));lanes<=LANES.length;lanes++){
        const pts=this.fill(r,s,rows,lanes,jitter,viewers,release,placed);
        if(!pts)break;
        if(pts.length===size)return {points:pts,release,travel};
        if(pts.length&&(!best||pts.length>best.points.length))best={points:pts,release,travel};
      }
      if(s>=r.length)break;
    }
    return best;
  }
  /** Spots of route r past the base: s = minS, then every SCAN_STEP up to the spawn end (r.length). */
  private spots(r:Route):number[]{
    const out:number[]=[];
    if(r.minS>r.length)return out;
    for(let s=r.minS;;s=Math.min(r.length,s+SCAN_STEP)){out.push(s);if(s>=r.length)break;}
    return out;
  }
  /**
   * `scan` aimed at the team: the spots whose route point has a finite chaseCost, tried by that cost (ties → smaller
   * s); travel = cost / speed. The first full fit wins, else the largest partial one (ties → cheaper); undefined when
   * no spot has a finite cost or none fits.
   */
  private chaseScan(r:Route,jitter:readonly number[],viewers:readonly PlayerLike[],desired:number,now:number,speed:number,placed:readonly Placed[],chase:ChaseCost){
    const spots:{s:number;cost:number}[]=[];
    for(const s of this.spots(r)){
      const a=this.pointAt(r,s), cost=chase({x:a.x,y:a.y});
      if(Number.isFinite(cost)&&cost>=0)spots.push({s,cost});
    }
    spots.sort((p,q)=>p.cost-q.cost||p.s-q.s);
    const size=jitter.length;
    let best:{points:FlowPoint[];release:number;travel:number}|undefined;
    for(const {s,cost} of spots){
      const travel=ticks(cost/speed), release=Math.max(now,desired-travel);
      const rows=Math.floor((r.length-s)/this.spacing+1e-9)+1;
      for(let lanes=Math.min(LANES.length,Math.ceil(size/rows));lanes<=LANES.length;lanes++){
        const pts=this.fill(r,s,rows,lanes,jitter,viewers,release,placed);
        if(!pts)break;
        if(pts.length===size)return {points:pts,release,travel};
        if(pts.length&&(!best||pts.length>best.points.length))best={points:pts,release,travel};
      }
    }
    return best;
  }
  /** Smallest finite chaseCost of route r's spots (see `spots`); Infinity when none. */
  private nearestOn(r:Route,chase:ChaseCost):number{
    let low=Infinity;
    for(const s of this.spots(r)){
      const a=this.pointAt(r,s), cost=chase({x:a.x,y:a.y});
      if(Number.isFinite(cost)&&cost>=0&&cost<low)low=cost;
    }
    return low;
  }
  /** Member points from distance s back toward the spawn; undefined as soon as a point is seen or stacks on a recent group. */
  private fill(r:Route,s:number,rows:number,lanes:number,jitter:readonly number[],viewers:readonly PlayerLike[],release:number,placed:readonly Placed[]){
    const pts:FlowPoint[]=[], f=r.field, size=jitter.length, gap2=STACK_GAP*STACK_GAP;
    const ok=(x:number,y:number)=>f.reachable(x,y)&&!this.inBase(x,y);
    for(let i=0;i<rows&&pts.length<size;i++){
      const a=this.pointAt(r,s+i*this.spacing), nx=-a.ty, ny=a.tx;
      for(let l=0;l<lanes&&pts.length<size;l++){
        let o=LANES[l]+jitter[pts.length], x=a.x+nx*o, y=a.y+ny*o;
        if(!ok(x,y)){o=LANES[l];x=a.x+nx*o;y=a.y+ny*o;if(!ok(x,y))continue;}
        for(const pl of viewers)if(!this.hiddenFor(pl,x,y))return undefined;
        for(const q of placed){
          if(Math.abs(q.release-release)>STACK_TICKS)continue;
          for(const p of q.points)if((p.x-x)**2+(p.y-y)**2<gap2)return undefined;
        }
        pts.push({x,y});
      }
    }
    return pts;
  }
  /** Cell indices whose centers lie within `radius` (u) of c; always includes c's own cell when inside the grid. */
  private disc(c:FlowPoint,radius:number):number[]{
    const g=this.layout.grid, cs=g.cellSize, ox=g.originX??0, oy=g.originY??0, out:number[]=[];
    const x0=Math.max(0,Math.floor((c.x-radius-ox)/cs)), x1=Math.min(g.width-1,Math.floor((c.x+radius-ox)/cs));
    const y0=Math.max(0,Math.floor((c.y-radius-oy)/cs)), y1=Math.min(g.height-1,Math.floor((c.y+radius-oy)/cs));
    const ccx=Math.floor((c.x-ox)/cs), ccy=Math.floor((c.y-oy)/cs);
    for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){
      if(Math.hypot(ox+(cx+.5)*cs-c.x,oy+(cy+.5)*cs-c.y)<=radius||cx===ccx&&cy===ccy)out.push(cx+cy*g.width);
    }
    return out;
  }
  /** p itself when its cell is walkable (or nothing nearer is), else the nearest walkable cell center within 4 u. */
  private walkableNear(p:FlowPoint):FlowPoint{
    const g=this.layout.grid, cs=g.cellSize, ox=g.originX??0, oy=g.originY??0, w=g.width;
    const cx=Math.floor((p.x-ox)/cs), cy=Math.floor((p.y-oy)/cs);
    if(cx>=0&&cy>=0&&cx<w&&cy<g.height&&g.walkable(cx,cy))return p;
    let best=p, bd=Infinity;
    for(const i of this.disc(p,4)){
      const x=i%w, y=(i-x)/w, q={x:ox+(x+.5)*cs,y:oy+(y+.5)*cs}, d=Math.hypot(q.x-p.x,q.y-p.y);
      if(g.walkable(x,y)&&d<bd){bd=d;best=q;}
    }
    return best;
  }
  /** Index in MOUTHS of the point of `set` nearest to cell (cx,cy)'s center. */
  private nearest(set:Readonly<Record<Mouth,FlowPoint>>,cx:number,cy:number){
    const g=this.layout.grid, cs=g.cellSize, x=(g.originX??0)+(cx+.5)*cs, y=(g.originY??0)+(cy+.5)*cs;
    let best=0, bd=Infinity;
    for(let i=0;i<MOUTHS.length;i++){const q=set[MOUTHS[i]], d=(q.x-x)**2+(q.y-y)**2;if(d<bd){bd=d;best=i;}}
    return best;
  }
}

/** Viewers: everyone but spectators and eliminated players (offline ones may reconnect, D-011; downed ones still see). */
function isViewer(p:PlayerLike){return !!p&&!p.spectator&&!p.eliminated&&Number.isFinite(p.x)&&Number.isFinite(p.y);}
function fin(v:unknown,def:number){const n=Number(v);return v===undefined||v===null||!Number.isFinite(n)?def:n;}
function nonNeg(v:unknown,def:number){return Math.max(0,fin(v,def));}
function pos(v:unknown,def:number){const n=fin(v,def);return n>0?n:def;}
function mod(a:number,n:number){return ((a%n)+n)%n;}
function rotate<T>(list:readonly T[],from:number):T[]{return list.map((_,i)=>list[(from+i)%list.length]);}
function centroid(ps:Readonly<Record<Mouth,FlowPoint>>):FlowPoint{
  let x=0, y=0;
  for(const m of MOUTHS){x+=ps[m].x;y+=ps[m].y;}
  return {x:x/MOUTHS.length,y:y/MOUTHS.length};
}
function checkLayout(l:CityLayout){
  const g=l?.grid, finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
  if(!g||!(Number.isInteger(g.width)&&g.width>0&&Number.isInteger(g.height)&&g.height>0)||!(finite(g.cellSize)&&g.cellSize>0)
    ||typeof g.walkable!=='function'||g.originX!==undefined&&!finite(g.originX)||g.originY!==undefined&&!finite(g.originY))
    throw new RangeError('layout.grid needs integer width/height > 0, a finite cellSize > 0, finite origins and walkable()');
  const point=(name:string,p:FlowPoint|undefined,optional=false)=>{
    if(p===undefined&&optional)return;
    if(!p||!finite(p.x)||!finite(p.y))throw new RangeError(`layout.${name} must be a point with finite x and y`);
  };
  for(const m of MOUTHS){point(`mouths.${m}`,l.mouths?.[m]);point(`spawns.${m}`,l.spawns?.[m]);}
  point('plaza',l.plaza,true); point('plazaCenter',l.plazaCenter,true);
  if(l.plazaRadius!==undefined&&!(finite(l.plazaRadius)&&l.plazaRadius>=0))throw new RangeError('layout.plazaRadius must be a finite number >= 0');
  if(l.mapScale!==undefined&&!(finite(l.mapScale)&&l.mapScale>0))throw new RangeError('layout.mapScale must be a finite number > 0');
  if(l.mouthRadius!==undefined&&!(finite(l.mouthRadius)&&l.mouthRadius>=0))throw new RangeError('layout.mouthRadius must be a finite number >= 0');
}
