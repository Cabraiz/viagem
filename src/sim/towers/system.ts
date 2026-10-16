/**
 * Tower defense in the simulation (torres-sim, D-041): build, evolve and fire the defenses of towers/catalog.ts.
 * Wired into the Stonewards 'structures' system (stonewards/system.ts): its `build`/`upgrade` commands call these, its
 * step calls `defensesStep`, and its single structure damage path (`hit`, D-017) reaches `damageDefense`.
 *
 * - Where: only on the build sites of the room's terrain (sites.ts: the city and the endless map; none on the island).
 *   D-052, the city's runs (StonewardsOptions.freeBuild): anywhere on the build grid (`buildFree`, free-build.ts: the
 *   root, the muro and the barricada, at any phase of the run); a site id there builds the root on the site's cell
 *   (the bots' brain, the HUD of today), the rail and the Gustavão are out, and a larger tier needs its square free.
 * - When: building, upgrading and repairing only in the intermission (round phase 'prepare'), by a standing player,
 *   while the wall stands (the free build: at any phase).
 * - Reach (torres-ajustes): only a player within BUILD_REACH of what the order names may give it: the site's largest
 *   footprint (build), the rail's rectangle (laying it, a Gustavão on it), the footprint of the defense's site
 *   (upgrade, repair); 'away' otherwise. A sim rule, so the offline run and the rooms obey it alike; the build menu
 *   (torres-hud) may still offer any site, the sim refuses from afar.
 * - Repair (torres-ajustes): `repair` mirrors the forge's barricade repair ('reparo' with a target): REPAIR_FRACTION of
 *   the defense's maxHp per order (rounded up, capped at maxHp), at once, for TOWER_REPAIR_COST R$ from the wallet
 *   of who orders it (sim/wallet.ts; NEW-20261014-ORQ-carteira-e-pix). Any standing defense under its maxHp (under construction too); a ruin never (it already frees
 *   its site: build a new Vigia there).
 * - Limits: DEFENSE_LIMIT standing defenses (ruins do not count) and GUSTAVAO_LIMIT Gustavão per run.
 * - Fire: only in combat (phase 'wave'), instant hits through ctx.damageEnemy (the central path), no source player (no
 *   hero's might scales them, no kill counts as anyone's; the weapon id is the defense id). A kill's Grana goes to the
 *   defense's owner (damageEnemy `credit`, sim/wallet.ts payKill). The radar's bonus,
 *   targets and order are deterministic (enemies sorted by distance then id); the holofote's dazzle roll draws from
 *   ctx.rng.fork('towers'), re-derived every tick (no stream kept across ticks).
 * - Enemies: a defense (also under construction) is a NON-blocking siege target, like the wall: the siege groups go
 *   for whichever is closer, a hero or a structure's edge (stonewards structureTargets → enemy-ai), and their contact
 *   hits come back through the system's `hit`. Everyone else walks past (defenses never block movement).
 * - State: JSON-safe, under StonewardsState.defenses, created on the first build only, so a run where nobody builds
 *   keeps every state hash it had before this card (island, endless and city alike). A rematch reset drops it.
 * - Events: none new (no wire change; torres-fio puts the defenses on the protocol). Damage and kills go out as usual.
 */
import type {Point} from '../../maps/index.ts';
import type {EnemyState} from '../../contract/index.ts';
import {ticks} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';
import {isFlying} from '../enemies/catalog.ts';
import type {StonewardsState} from '../stonewards/state.ts';
import {DEFENSES,DEFENSE_LIMIT,GUSTAVAO_LIMIT,RAIL,ROOT_DEFENSE,childrenOf,payUnits,phaseOf,pickChild,type DefenseDef,type DefenseId,type DefensePhase} from './catalog.ts';
import {footprint,railRect,rectDistance,type BuildPlan,type Rect} from './sites.ts';
import {REPAIR_FRACTION} from '../stonewards/forge.ts';
import {EVOLVE_PRICE,TOWER_REPAIR_PRICE} from '../../rules/index.ts';
import {payFrom,walletOf} from '../wallet.ts';
import type {CellRect} from '../../maps/index.ts';
import {CAR_NEST_KEEP_OUT,type FreeBuildRefusal,type FreePiece} from '../../contract/index.ts';
import {CAR_BUILD_GAP,FREE_PIECE_DEFS,isFreePiece,pieceCells} from '../../rules/index.ts';
import {RADIUS} from '../../maps/index.ts';
import {defenseRectOf,discHits,FREE_CELL,freeCity,locks,onGround,pieceRect,pieceRectOf,piecesOf,rectsOverlap,setMuro,standingPieces,
  type FreeBuildHooks,type FreeOrder,type PieceState} from './free-build.ts';

export interface DefenseState extends Point {
  id:string;kind:DefenseId;
  /**
   * Build site id ('obra-NN'), or the rail ('trilho') for the Gustavão. D-052 free build: the site a bot's or an old
   * client's order named (it was turned into its cell), else ''.
   */
  site:string;
  /** D-052 free build (the city): its size square's top-left cell on the build grid (free-build.ts); rot as ordered. */
  cell?:{c:number;r:number};rot?:1;
  /** Who paid the last stage: its kills' Grana goes to them (sim/wallet.ts payKill). */
  owner:string;
  hp:number;maxHp:number;
  /** Radius of its footprint (u), what the enemy-ai measures a siege hit against. */
  r:number;
  /** The current obra started at startTick and is pronta at readyTick (upgrades start a new obra). */
  startTick:number;readyTick:number;
  /** Next tick it may fire. */
  fireTick:number;
  /** Where it last fired (radians, atan2 of the first target), for the client's turret (torres-fio). */
  aim?:number;
  /**
   * Volleys fired, mod 256 (torre-contador-de-tiros): the client draws a shot whenever it changes, also at a target
   * that does not move (the aim alone then never changes).
   */
  shots?:number;
  ruined?:true;
}
export interface RailState {owner:string;startTick:number;readyTick:number}
export interface TowersState {
  list:DefenseState[];
  /** The Gustavão's rail, once laid. */
  rail?:RailState;
  /** Gustavões built this run (ruined ones included). */
  gustavoes:number;
  /** D-052: the standing wall pieces (muro, barricada; free-build.ts), created by the first one. */
  pieces?:PieceState[];
}

/** 'balance': not enough fichas de torre (a root, the Gustavão); 'grana': not enough R$ (an evolution, a repair). */
export type TowerRefusal='wall-down'|'phase'|'player'|'site'|'occupied'|'size'|'balance'|'grana'|'limit'|'rail'|'unique'|'defense'|'building'|'ruined'|'max'|'branch'|'duplicate'|'away'|'full'|FreeBuildRefusal;
/**
 * `cost`: what was charged, in what paid it: material units (a root, the Gustavão, the rail) or R$ (an evolution, a
 * repair, a wall piece).
 */
export type TowerResult={ok:true;defense:string;kind:DefenseId|FreePiece|typeof RAIL.id;cost:number}|{ok:false;reason:TowerRefusal};

/**
 * Reach (u): a player builds, evolves or repairs only within this distance of the footprint's edge (the site's largest
 * footprint, the rail's rectangle). About an arm and a step: the hero stands next to the obra, not across the plaza.
 */
export const BUILD_REACH=3;
/** A tower repair's price in Grana, R$ (D-048). */
export const TOWER_REPAIR_COST=TOWER_REPAIR_PRICE;

const ID_PREFIX='defesa';
/** Remembered request ids share the forge's list (stonewards handled), under this prefix. */
const HANDLED_PREFIX='obra:';
const HANDLED_LIMIT=256;

const towersOf=(state:StonewardsState):TowersState=>state.defenses??=({list:[],gustavoes:0});
/** The defenses that count against DEFENSE_LIMIT. */
export const standingDefenses=(state:StonewardsState)=>(state.defenses?.list??[]).filter(d=>!d.ruined);
export function defensePhase(d:DefenseState,tick:number):DefensePhase{return phaseOf(d,tick);}
export const railReady=(state:StonewardsState,tick:number)=>!!state.defenses?.rail&&tick>=state.defenses.rail.readyTick;

/** Where an order is given from: the site's largest footprint, the rail's rectangle, a defense's site (or its own disc). */
export function siteRect(plan:BuildPlan,siteId:string):Rect|undefined{
  if(plan.rail&&siteId===plan.rail.id)return railRect(plan.rail,plan.cell);
  const site=plan.sites.find(s=>s.id===siteId);
  return site?footprint(site,site.maxSize,plan.cell):undefined;
}
const defenseRect=(plan:BuildPlan,d:DefenseState):Rect=>d.cell?defenseRectOf(d):siteRect(plan,d.site)??{x:d.x-d.r,y:d.y-d.r,w:2*d.r,h:2*d.r};
/** True when the player stands within BUILD_REACH of `rect` (the reach rule). */
export function withinReach(rect:Rect,p:Point):boolean{return rectDistance(rect,p)<=BUILD_REACH;}
const near=(ctx:SimContext,playerId:string,rect:Rect)=>{const p=ctx.players.get(playerId);return !!p&&withinReach(rect,p);};

function common(ctx:SimContext,state:StonewardsState,playerId:string):TowerRefusal|undefined{
  if(state.wallDown)return 'wall-down';
  if(ctx.round.phase!=='prepare')return 'phase';
  const p=ctx.players.get(playerId);
  if(!p||!isStanding(p))return 'player';
  return undefined;
}
/** Applies `run` once per `playerId:requestId` (a resent command is refused without charging again). */
function once(state:StonewardsState,playerId:string,requestId:string|undefined,run:()=>TowerResult):TowerResult{
  const key=requestId===undefined?undefined:`${HANDLED_PREFIX}${playerId}:${requestId}`;
  if(key!==undefined&&state.handled.includes(key))return {ok:false,reason:'duplicate'};
  const result=run();
  if(result.ok&&key!==undefined){
    state.handled.push(key);
    if(state.handled.length>HANDLED_LIMIT)state.handled.splice(0,state.handled.length-HANDLED_LIMIT);
  }
  return result;
}
const radiusOn=(plan:BuildPlan,size:number)=>size*plan.cell/2;

/**
 * Builds the root defense (Vigia do Prédio) on a free site, or lays the Gustavão's rail when `siteId` is the plan's
 * rail ('trilho'). A ruin on the site is cleared by the new obra.
 * D-052, the city: the sites are only hints now. A site id (the bots, an old client) becomes a free build of the root
 * on the cell under the site's centre (`buildFree`, the defense keeps the site id); the rail is gone ('rail').
 */
export function build(ctx:SimContext,state:StonewardsState,plan:BuildPlan,playerId:string,siteId:string,requestId?:string,free?:FreeBuildContext):TowerResult{
  if(free&&freeCity(ctx.terrain)){
    if(plan.rail&&siteId===plan.rail.id)return once(state,playerId,requestId,()=>({ok:false,reason:'rail'}));
    const site=plan.sites.find(s=>s.id===siteId);
    if(!site)return once(state,playerId,requestId,()=>({ok:false,reason:'site'}));
    return buildFree(ctx,state,plan,playerId,{piece:ROOT_DEFENSE,c:Math.floor(site.x/FREE_CELL),r:Math.floor(site.y/FREE_CELL)},requestId,free,site.id);
  }
  return once(state,playerId,requestId,()=>{
    const no=common(ctx,state,playerId);
    if(no)return {ok:false,reason:no};
    if(plan.rail&&siteId===plan.rail.id){
      if(state.defenses?.rail)return {ok:false,reason:'occupied'};
      if(!near(ctx,playerId,railRect(plan.rail,plan.cell)))return {ok:false,reason:'away'};
      if(!payUnits(state.balance,RAIL.cost))return {ok:false,reason:'balance'};
      towersOf(state).rail={owner:playerId,startTick:ctx.tick,readyTick:ctx.tick+ticks(RAIL.buildSeconds)};
      return {ok:true,defense:plan.rail.id,kind:RAIL.id,cost:RAIL.cost};
    }
    const site=plan.sites.find(s=>s.id===siteId);
    if(!site)return {ok:false,reason:'site'};
    const list=state.defenses?.list??[];
    if(list.some(d=>d.site===site.id&&!d.ruined))return {ok:false,reason:'occupied'};
    const root=DEFENSES[ROOT_DEFENSE];
    if(root.size!>site.maxSize)return {ok:false,reason:'size'};
    if(standingDefenses(state).length>=DEFENSE_LIMIT)return {ok:false,reason:'limit'};
    if(!near(ctx,playerId,footprint(site,site.maxSize,plan.cell)))return {ok:false,reason:'away'};
    if(!payUnits(state.balance,root.cost))return {ok:false,reason:'balance'};
    const towers=towersOf(state);
    towers.list=towers.list.filter(d=>d.site!==site.id);
    const d:DefenseState={id:ctx.nextId(ID_PREFIX),kind:root.id,site:site.id,owner:playerId,x:site.x,y:site.y,
      hp:root.hp,maxHp:root.hp,r:radiusOn(plan,root.size!),startTick:ctx.tick,readyTick:ctx.tick+ticks(root.buildSeconds),fireTick:0};
    d.fireTick=d.readyTick;
    towers.list.push(d);
    return {ok:true,defense:d.id,kind:d.kind,cost:root.cost};
  });
}

/** What the free build needs beyond the state (stonewards/system.ts): the objective's hooks and the flow grid's refresh. */
export interface FreeBuildContext extends FreeBuildHooks {onTerrainChanged?(rect:CellRect):void}

/** A forge tower's body (u) and the moto's (chaveiro MOTO_RADIUS), for 'ocupado'. */
const FORGE_TOWER_R=.6,MOTO_BODY_R=.5;
/**
 * Whether something standing already holds part of `rect`: a standing defense's square, a piece, a forge tower, a body
 * (another standing hero, a live enemy, the moto) or, without a car, the wall. The builder never counts: the heroes walk
 * through every piece (a muro is solid to the enemies only), so they cannot wall themselves in. `skip`: a defense
 * evolving in place (then only the defenses and the pieces count).
 */
function taken(ctx:SimContext,state:StonewardsState,rect:Rect,free:FreeBuildHooks,skip?:DefenseState,builder?:string):boolean{
  for(const d of state.defenses?.list??[])if(d!==skip&&!d.ruined&&rectsOverlap(defenseRectOf(d),rect))return true;
  for(const p of piecesOf(state))if(rectsOverlap(pieceRectOf(p),rect))return true;
  if(skip)return false;
  for(const t of state.towers)if(discHits(rect,t.x,t.y,FORGE_TOWER_R))return true;
  for(const p of ctx.players.values())if(p.id!==builder&&isStanding(p)&&discHits(rect,p.x,p.y,RADIUS))return true;
  for(const e of ctx.enemies.values())if(e.hp>0&&discHits(rect,e.x,e.y,Math.max(e.radius,RADIUS)))return true;
  const moto=free.moto?.(ctx.tick);
  if(moto&&discHits(rect,moto.x,moto.y,MOTO_BODY_R))return true;
  if(!free.car&&!state.wallDown&&discHits(rect,state.wall.x,state.wall.y,state.wall.radius))return true;
  return false;
}
/** The tick `owner`'s queued free obras end (D-052: a hero's free builds run one after the other); `tick` when none. */
function queueEnd(state:StonewardsState,owner:string,tick:number):number{
  let end=tick;
  for(const d of state.defenses?.list??[])if(d.cell&&d.owner===owner&&!d.ruined)end=Math.max(end,d.readyTick);
  for(const p of piecesOf(state))if(p.owner===owner)end=Math.max(end,p.readyTick);
  return end;
}
const PIECE_PREFIX='peca';

/**
 * D-052 free build (the city): `order.piece` (the root tower, a muro or a barricada) with its footprint's top-left cell
 * at (c,r) of the build grid (free-build.ts), at any phase of the run. Refusals, in order: 'duplicate', 'wall-down',
 * 'player' (not standing), 'defense' (a tower that is not the root: towers evolve), 'fora' (off the grid or a cell off
 * walkable ground), 'ninho' (within CAR_NEST_KEEP_OUT of a living nest), 'carro' (within CAR_BUILD_GAP of the car's
 * body), 'ocupado' (a standing thing or a body on it), 'limite' (DEFENSE_LIMIT / the piece's limit), 'away'
 * (BUILD_REACH), 'balance' (the root's ficha) or 'grana' (a piece's R$, from the builder's wallet), 'tranca' (a muro that
 * would cut the car off from the borda or the moto). A ruin under the footprint is cleared. The builder's obras queue:
 * this one starts when their last one is done.
 */
export function buildFree(ctx:SimContext,state:StonewardsState,plan:BuildPlan,playerId:string,order:FreeOrder,requestId:string|undefined,free:FreeBuildContext,siteId=''):TowerResult{
  return once(state,playerId,requestId,()=>{
    if(state.wallDown)return {ok:false,reason:'wall-down'};
    const p=ctx.players.get(playerId);
    if(!p||!isStanding(p))return {ok:false,reason:'player'};
    const city=freeCity(ctx.terrain);
    if(!city)return {ok:false,reason:'fora'};
    const piece=order.piece,rot=order.rot===1?1:0,wall=isFreePiece(piece);
    if(!wall&&piece!==ROOT_DEFENSE)return {ok:false,reason:'defense'};
    const [w,h]=pieceCells(piece,rot),cell={c:order.c,r:order.r};
    if(!onGround(city,cell,w,h))return {ok:false,reason:'fora'};
    const rect=pieceRect(cell,w,h);
    for(const n of free.nests?.(ctx.tick)??[])if(rectDistance(rect,n)<CAR_NEST_KEEP_OUT)return {ok:false,reason:'ninho'};
    const car=free.car?.(ctx.tick);
    if(car&&rectDistance(rect,car)<car.radius+CAR_BUILD_GAP)return {ok:false,reason:'carro'};
    if(taken(ctx,state,rect,free,undefined,playerId))return {ok:false,reason:'ocupado'};
    if(wall?standingPieces(state,piece)>=FREE_PIECE_DEFS[piece].limit:standingDefenses(state).length>=DEFENSE_LIMIT)return {ok:false,reason:'limite'};
    if(!withinReach(rect,p))return {ok:false,reason:'away'};
    const root=DEFENSES[ROOT_DEFENSE],price=wall?FREE_PIECE_DEFS[piece].price:root.cost,short=wall?'grana' as const:'balance' as const;
    if(wall?walletOf(p)<price:state.balance.units<price)return {ok:false,reason:short};
    if(piece==='muro'&&locks(city,state,cell,car??state.wall,free.moto?.(ctx.tick)))return {ok:false,reason:'tranca'};
    if(wall?!payFrom(p,price):!payUnits(state.balance,price))return {ok:false,reason:short};
    const towers=towersOf(state),start=queueEnd(state,playerId,ctx.tick);
    // A ruin under the new footprint is rubble the obra clears.
    towers.list=towers.list.filter(d=>!d.ruined||!rectsOverlap(defenseRectOf(d),rect));
    const x=rect.x+rect.w/2,y=rect.y+rect.h/2;
    if(wall){
      const def=FREE_PIECE_DEFS[piece];
      const q:PieceState={id:ctx.nextId(PIECE_PREFIX),kind:piece,cell,...(rot?{rot:1 as const}:{}),owner:playerId,x,y,hp:def.hp,maxHp:def.hp,
        startTick:start,readyTick:start+ticks(def.buildSeconds)};
      (towers.pieces??=[]).push(q);
      setMuro(ctx.terrain,q,false,free.onTerrainChanged);
      return {ok:true,defense:q.id,kind:piece,cost:price};
    }
    const d:DefenseState={id:ctx.nextId(ID_PREFIX),kind:root.id,site:siteId,cell,...(rot?{rot:1 as const}:{}),owner:playerId,x,y,
      hp:root.hp,maxHp:root.hp,r:radiusOn(plan,root.size!),startTick:start,readyTick:start+ticks(root.buildSeconds),fireTick:0};
    d.fireTick=d.readyTick;
    towers.list.push(d);
    return {ok:true,defense:d.id,kind:d.kind,cost:price};
  });
}

/**
 * D-052: the cell of the square a free-built defense takes at `size`, kept centred on the one it has (a 1×1 root
 * growing to 2×2 also takes the cells up and left of it, to 3×3 the ring around it).
 */
function grownCell(d:DefenseState,size:number):{c:number;r:number}{
  const s=DEFENSES[d.kind].size??1,shift=Math.floor((s-size)/2);
  return {c:d.cell!.c+shift,r:d.cell!.r+shift};
}

/**
 * Evolves a ready defense in place into one of its children (catalog pickChild: `branch` = 'A'|'B'|'C' at the root,
 * a child's id or label such as 'A4b' at A3; omitted when there is only one). The new tier starts a new obra at its
 * full hp. The Gustavão (from the Obuseiro) needs the laid, finished rail and moves onto it, freeing its site.
 */
export function upgrade(ctx:SimContext,state:StonewardsState,plan:BuildPlan,playerId:string,defenseId:string,branch?:string,requestId?:string):TowerResult{
  return once(state,playerId,requestId,()=>{
    const no=common(ctx,state,playerId);
    if(no)return {ok:false,reason:no};
    const d=state.defenses?.list.find(x=>x.id===defenseId);
    if(!d)return {ok:false,reason:'defense'};
    if(d.ruined)return {ok:false,reason:'ruined'};
    if(ctx.tick<d.readyTick)return {ok:false,reason:'building'};
    if(!childrenOf(d.kind).length)return {ok:false,reason:'max'};
    const next=pickChild(d.kind,branch);
    if(!next)return {ok:false,reason:'branch'};
    const towers=towersOf(state);
    let grown:{c:number;r:number}|undefined;
    if(d.cell){
      // D-052, free build: the Gustavão is out (no rail; the Obuseiro is the top); a larger tier needs its square,
      // centred on the one it has, on free ground (else 'size').
      if(next.rail)return {ok:false,reason:'max'};
      const size=next.size!;
      if(size>(DEFENSES[d.kind].size??1)){
        grown=grownCell(d,size);
        const city=freeCity(ctx.terrain);
        if(!city||!onGround(city,grown,size,size)||taken(ctx,state,pieceRect(grown,size,size),{},d))return {ok:false,reason:'size'};
      }
    }else if(next.rail){
      if(!plan.rail||!railReady(state,ctx.tick))return {ok:false,reason:'rail'};
      if(towers.gustavoes>=GUSTAVAO_LIMIT)return {ok:false,reason:'unique'};
    }else{
      const site=plan.sites.find(s=>s.id===d.site);
      if(!site||next.size!>site.maxSize)return {ok:false,reason:'size'};
    }
    // The Gustavão is ordered from the Obuseiro's site (where the hero stands with it), not from the rail.
    if(!near(ctx,playerId,defenseRect(plan,d)))return {ok:false,reason:'away'};
    // D-048: the Gustavão takes 3 fichas de torre; every other evolution its tier's price in Grana, from the wallet
    // of who evolves it (NEW-20261014-ORQ-carteira-e-pix).
    const cost=next.id==='gustavao'?next.cost:EVOLVE_PRICE[next.tier as 2|3|4|5];
    if(next.id==='gustavao'){if(!payUnits(state.balance,cost))return {ok:false,reason:'balance'};}
    else if(!payFrom(ctx.players.get(playerId),cost))return {ok:false,reason:'grana'};
    if(next.rail){
      const rail=plan.rail!;
      d.site=rail.id;d.x=rail.x;d.y=rail.y;d.r=Math.min(rail.length,rail.width)*plan.cell/2;
      towers.gustavoes++;
    }else{
      d.r=radiusOn(plan,next.size!);
      if(grown){const rect=pieceRect(grown,next.size!,next.size!);d.cell=grown;d.x=rect.x+rect.w/2;d.y=rect.y+rect.h/2;}
    }
    d.kind=next.id;d.owner=playerId;d.hp=d.maxHp=next.hp;d.startTick=ctx.tick;d.readyTick=ctx.tick+ticks(next.buildSeconds);d.fireTick=d.readyTick;
    return {ok:true,defense:d.id,kind:d.kind,cost};
  });
}

/**
 * Repairs a standing defense below its maxHp (torres-ajustes): +REPAIR_FRACTION of maxHp (rounded up, capped), at once,
 * for TOWER_REPAIR_COST R$ from the wallet of who repairs it; the forge's barricade repair, for the towers. A ruin is refused ('ruined'), a whole one
 * too ('full'), and so is a player out of reach ('away').
 */
export function repair(ctx:SimContext,state:StonewardsState,plan:BuildPlan,playerId:string,defenseId:string,requestId?:string):TowerResult{
  return once(state,playerId,requestId,()=>{
    const no=common(ctx,state,playerId);
    if(no)return {ok:false,reason:no};
    const d=state.defenses?.list.find(x=>x.id===defenseId);
    if(!d)return {ok:false,reason:'defense'};
    if(d.ruined)return {ok:false,reason:'ruined'};
    if(d.hp>=d.maxHp)return {ok:false,reason:'full'};
    if(!near(ctx,playerId,defenseRect(plan,d)))return {ok:false,reason:'away'};
    if(!payFrom(ctx.players.get(playerId),TOWER_REPAIR_COST))return {ok:false,reason:'grana'};
    d.hp=Math.min(d.maxHp,d.hp+Math.ceil(d.maxHp*REPAIR_FRACTION));
    return {ok:true,defense:d.id,kind:d.kind,cost:TOWER_REPAIR_COST};
  });
}

/** The one damage path into a defense (stonewards `hit`, D-017). Returns false when `id` is no standing defense. */
export function damageDefense(state:StonewardsState,id:string,amount:number):boolean{
  const d=state.defenses?.list.find(x=>x.id===id);
  if(!d||d.ruined||state.wallDown||!(amount>0))return false;
  d.hp=Math.max(0,d.hp-amount);
  if(d.hp<=0)d.ruined=true;
  return true;
}

/** Siege targets for the enemy-ai (non-blocking discs), every standing defense. */
export function defenseTargets(state:StonewardsState):{id:string;x:number;y:number;radius:number}[]{
  return standingDefenses(state).map(d=>({id:d.id,x:d.x,y:d.y,radius:d.r}));
}

/** The radar bonus (share of range) a defense gets from the ready radars around it (the largest; no stacking). */
export function radarBonus(state:StonewardsState,d:DefenseState,tick:number):number{
  let bonus=0;
  for(const r of state.defenses?.list??[]){
    const radar=DEFENSES[r.kind].radar;
    if(!radar||r===d||r.ruined||tick<r.readyTick)continue;
    if(Math.hypot(r.x-d.x,r.y-d.y)<=radar.reach)bonus=Math.max(bonus,radar.bonus);
  }
  return bonus;
}

const reaches=(def:DefenseDef,e:EnemyState)=>def.hits==='all'||(def.hits==='air')===isFlying(e);
const byDistance=(at:Point)=>(a:EnemyState,b:EnemyState)=>Math.hypot(a.x-at.x,a.y-at.y)-Math.hypot(b.x-at.x,b.y-at.y)||(a.id<b.id?-1:a.id>b.id?1:0);

/** Defenses fire in combat: ready ones (pronta/danificada) on their cooldown, at targets their kind reaches. */
export function defensesStep(ctx:SimContext,state:StonewardsState){
  const towers=state.defenses;
  if(!towers||state.wallDown||ctx.round.phase!=='wave')return;
  const alive=(e:EnemyState)=>e.hp>0&&ctx.enemies.has(e.id);
  const found:EnemyState[]=[];
  let rng:ReturnType<SimContext['rng']['fork']>|undefined;
  for(const d of towers.list){
    if(d.ruined||ctx.tick<d.readyTick||ctx.tick<d.fireTick)continue;
    const def=DEFENSES[d.kind];
    if(def.target==='none')continue;
    const range=def.range*(1+radarBonus(state,d,ctx.tick));
    ctx.enemyIndex.query(d.x,d.y,range,found);
    const pool=found.filter(e=>alive(e)&&reaches(def,e)&&Math.hypot(e.x-d.x,e.y-d.y)>=def.minRange).sort(byDistance(d));
    if(!pool.length)continue;
    d.fireTick=ctx.tick+def.cooldown;d.shots=((d.shots??0)+1)&255;
    if(def.target==='aura'){hitArea(ctx,def,d,range,d.owner);continue;}
    let picks:EnemyState[];
    if(def.target==='strongest')picks=[...pool].sort((a,b)=>b.hp-a.hp).slice(0,def.shots); // stable: ties stay nearest-first
    else if(def.target==='cluster')picks=[densest(pool,def.area)];
    else picks=pool.slice(0,def.shots);
    if(picks[0])d.aim=Math.atan2(picks[0].y-d.y,picks[0].x-d.x);
    for(let i=0;i<picks.length;i++){
      const e=picks[i],at={x:e.x,y:e.y};
      if(def.area>0)hitArea(ctx,def,at,def.area,d.owner);
      else hit(ctx,def,e,d.owner);
      if(i===0&&def.dazzle&&alive(e)&&!e.boss){
        rng??=ctx.rng.fork('towers');
        if(rng.chance(def.dazzle.chance))e.frozenUntil=Math.max(e.frozenUntil??-1,ctx.tick+def.dazzle.ticks);
      }
    }
  }
}

/** The pool member with the most others within `area` (ties: the nearest, already first). */
function densest(pool:readonly EnemyState[],area:number):EnemyState{
  let best=pool[0],most=-1;
  for(const c of pool){
    let n=0;for(const o of pool)if(Math.hypot(o.x-c.x,o.y-c.y)<=area)n++;
    if(n>most){most=n;best=c;}
  }
  return best;
}
function hitArea(ctx:SimContext,def:DefenseDef,at:Point,radius:number,owner:string){
  const victims:EnemyState[]=[];
  ctx.enemyIndex.query(at.x,at.y,radius,victims);
  const list=victims.filter(e=>e.hp>0&&ctx.enemies.has(e.id)&&reaches(def,e)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  for(const e of list)hit(ctx,def,e,owner);
}
function hit(ctx:SimContext,def:DefenseDef,e:EnemyState,owner:string){
  if(def.damage>0&&ctx.damageEnemy(e.id,def.damage,undefined,def.id,owner))return;
  if(def.slow&&!e.boss&&ctx.enemies.has(e.id))e.slowUntil=Math.max(e.slowUntil??-1,ctx.tick+def.slow);
}

