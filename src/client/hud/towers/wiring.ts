/**
 * The obra menu in the real match (torres-ligar): what explore.ts needs to drive ObraHud from the room. Pure (no DOM),
 * node-tested (tests/client/towers-wiring.test.ts).
 * - obraViewFrom: the ObraView of one frame from the latest RunView (the defenses are structures with a `tier`), the
 *   terrain's build plan (maps buildPlanFor) projected to the screen, and what this client knows of the rail.
 * - branchForWire: the model names a child by its tree label ('A2', 'B6'…); the room accepts /^(A|B|C|A4b|A5b)$/.
 * - ObraRequests: one pending request per site until {t:'built'} answers or OBRA_PENDING_MS pass, the short stamp of an
 *   accepted obra, the refusal's words, and the rail this client laid itself.
 */
import {DEFENSES,DEFENSE_LIMIT,GUSTAVAO_LIMIT,RAIL,isDefenseId,type DefenseId} from '../../../rules/index.ts';
import {ticks,type RunView,type StructureView} from '../../../contract/index.ts';
import type {BuildPlan} from '../../../maps/index.ts';
import {RAIL_SITE_ID,type ObraAction,type ObraSite,type ObraTower,type ObraView} from './model.ts';

/** A request without an answer stops spinning after this; a late answer still counts (stamp, rail). */
export const OBRA_PENDING_MS=3000;
/** How long an accepted obra's marker keeps its stamp class (the stamp itself is a 100 ms beat, obra.css). */
export const OBRA_DONE_MS=600;
/** How long a refusal stays in the announcement slot. */
export const OBRA_TOAST_MS=2600;
/** Positions come over the wire in 1/512 u steps (protocol4 POS_SCALE): a defense sits on a site within this. */
export const SITE_MATCH_EPSILON=.05;

/** What the room accepts as an upgrade's branch (multiplayer/room.ts BRANCH). */
export const WIRE_BRANCH=/^(A|B|C|A4b|A5b)$/;
/**
 * The branch the room accepts for a child picked by its tree label: the alternatives 'A4b'/'A5b' as they are, every
 * other child by its line's letter (rules pickChild takes the main line on a letter). Undefined for an unknown label.
 */
export function branchForWire(label:string):string|undefined{
  if(label==='A4b'||label==='A5b')return label;
  for(const id of Object.keys(DEFENSES) as DefenseId[]){const d=DEFENSES[id];if(d.label===label)return d.branch??undefined;}
  return undefined;
}

/** Why the room said no to a build, upgrade or repair (src/sim/towers/system.ts TowerRefusal), in a few pt-BR words. */
export const OBRA_REFUSALS:Readonly<Record<string,string>>=Object.freeze({
  'wall-down':'Muralha caída',
  phase:'Só no intervalo',
  player:'Caído não constrói',
  site:'Esse ponto não existe',
  occupied:'Ponto já ocupado',
  size:'Não cabe neste ponto',
  // D-048: 'balance' is fichas de torre short (a Vigia, the Gustavão); 'grana' is R$ short (an evolution, a repair).
  balance:'Falta ficha de torre',
  grana:'Falta grana',
  limit:`Limite de ${DEFENSE_LIMIT} defesas`,
  rail:'Precisa do trilho',
  unique:`Só ${GUSTAVAO_LIMIT} Gustavão`,
  defense:'Essa defesa sumiu',
  building:'Ainda em obra',
  ruined:'Virou ruína',
  max:'Já tá no máximo',
  branch:'Esse ramo não existe',
  duplicate:'Esse pedido já foi',
  // torres-ajustes: the sim's reach rule (BUILD_REACH from the obra) and a repair of a whole defense.
  away:'Chegue mais perto',
  full:'Já tá inteira',
});
export const OBRA_REFUSED='Agora não dá';
export const OBRA_RAIL_TAKEN='O trilho já tá posto';
export const OBRA_OFFLINE='Sem conexão',OBRA_WATCHING='Assistindo',OBRA_NO_ANSWER='A sala não respondeu';
export const refusalText=(reason:string|undefined)=>(reason!==undefined&&Object.hasOwn(OBRA_REFUSALS,reason)?OBRA_REFUSALS[reason]:undefined)??OBRA_REFUSED;
/** Why a build/upgrade could not even leave this phone (net.build/upgrade returned undefined). */
export function unreachableText(state:{connected:boolean;spectator:boolean}):string{
  return !state.connected?OBRA_OFFLINE:state.spectator?OBRA_WATCHING:OBRA_REFUSALS.phase;
}

const near=(a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(a.x-b.x)<=SITE_MATCH_EPSILON&&Math.abs(a.y-b.y)<=SITE_MATCH_EPSILON;
/** The tower defenses among a view's structures (the wall, the forge's towers and the barricades have no tier). */
export const defensesOf=(view:Pick<RunView,'structures'>|undefined)=>(view?.structures??[]).filter((s):s is StructureView&{kind:DefenseId}=>s.tier!==undefined&&isDefenseId(s.kind));
const ruinedOf=(s:StructureView)=>s.phase==='ruina';
const towerOf=(s:StructureView&{kind:DefenseId}):ObraTower=>({id:s.id,kind:s.kind,
  ...(s.phase?.startsWith('obra')?{building:true}:{}),...(ruinedOf(s)?{ruined:true}:{})});

export interface ObraSource {
  /** The intermission (net.run combat and the view's round 'prepare'), with nothing else holding the screen. */
  prepare:boolean;
  view:RunView|undefined;plan:BuildPlan;
  /** World point → screen point (CSS px), the scene's locate(p).screen. */
  project:(p:{x:number;y:number})=>{x:number;y:number};
  /** What this client knows of the rail (not on the wire: ObraRequests.rail). */
  rail?:{laid:boolean;ready:boolean};
  /** The local hero (world units): each site's distance from it, for the edge arrows of the off-screen sites. */
  hero?:{x:number;y:number};
  pending?:readonly string[];done?:readonly string[];drawnInWorld?:boolean;
  /** Watching (a spectator): the plan shows, nothing can be confirmed. */
  readOnly?:boolean;
}

/** What one snapshot says about one plan (computed once per RunView, not per frame). */
interface Snapshot {plan:BuildPlan;towers:(ObraTower|undefined)[];onRail:boolean;balance:{units:number};grana:number;standing:number;gustavoes:number;sig:string}
const snapshots=new WeakMap<RunView,Snapshot>();
const planIds=new WeakMap<BuildPlan,number>();let nextPlan=0;
const EMPTY_VIEW={structures:[]} as unknown as RunView;
function snapshotOf(view:RunView|undefined,plan:BuildPlan):Snapshot{
  const key=view??EMPTY_VIEW,hit=snapshots.get(key);
  if(hit&&hit.plan===plan)return hit;
  const balance={units:view?.camp?.units??0},grana=view?.camp?.grana??0;
  const defenses=defensesOf(view);
  const towers=plan.sites.map(site=>{
    // One defense per site (a new obra clears the ruin); a standing one wins over a ruin if both ever show.
    const here=defenses.filter(d=>d.kind!=='gustavao'&&near(d,site));
    const d=here.find(x=>!ruinedOf(x))??here[0];
    return d&&towerOf(d);
  });
  // A Gustavão on the rail means the rail was laid and finished, whoever laid it.
  const onRail=!!plan.rail&&defenses.some(d=>d.kind==='gustavao'&&near(d,plan.rail!));
  const standing=defenses.filter(d=>!ruinedOf(d)).length,gustavoes=defenses.filter(d=>d.kind==='gustavao').length;
  if(!planIds.has(plan))planIds.set(plan,++nextPlan);
  const sig=`${planIds.get(plan)}|${balance.units},${grana}|${standing},${gustavoes},${onRail?1:0}|${towers.map(t=>t?`${t.id}:${t.kind}:${t.building?'o':''}${t.ruined?'r':''}`:'').join(';')}`;
  const snap={plan,towers,onRail,balance,grana,standing,gustavoes,sig};
  snapshots.set(key,snap);
  return snap;
}

/**
 * The ObraView of one frame (empty and closed outside the intermission). What the snapshot says is read once per
 * RunView; per frame only the screen points are projected. `revision` changes exactly when something but the points
 * did, so the HUD rebuilds its DOM only then (no per-frame comparison of the whole view).
 */
export function obraViewFrom(src:ObraSource):ObraView{
  const snap=snapshotOf(src.view,src.plan),{balance,grana,standing,gustavoes}=snap;
  const extra={...(src.drawnInWorld?{drawnInWorld:true}:{}),...(src.pending?.length?{pending:src.pending}:{}),...(src.done?.length?{done:src.done}:{}),
    ...(src.readOnly?{readOnly:true}:{})};
  const rail=src.prepare&&src.plan.rail?{laid:snap.onRail||!!src.rail?.laid,ready:snap.onRail||!!src.rail?.ready}:undefined;
  const revision=`${src.prepare?1:0}|${snap.sig}|${rail?`${rail.laid?1:0}${rail.ready?1:0}`:'-'}|${src.pending?.join(',')??''}|${src.done?.join(',')??''}|${src.drawnInWorld?1:0}${src.readOnly?1:0}`;
  if(!src.prepare)return {prepare:false,sites:[],balance,grana,standing,gustavoes,revision,...extra};
  const hero=src.hero,far=(p:{x:number;y:number})=>hero?{distance:Math.hypot(p.x-hero.x,p.y-hero.y)}:{};
  const sites:ObraSite[]=src.plan.sites.map((site,i)=>{
    const at=src.project(site),tower=snap.towers[i];
    return {id:site.id,x:at.x,y:at.y,maxSize:site.maxSize,...(tower?{tower}:{}),...far(site)};
  });
  const railAt=rail&&src.project(src.plan.rail!);
  return {prepare:true,sites,...(rail&&railAt?{rail:{x:railAt.x,y:railAt.y,...rail,...far(src.plan.rail!)}}:{}),balance,grana,standing,gustavoes,revision,...extra};
}

/** The site an action is about (the upgrade names the defense: its site in the view). */
export function siteOf(action:ObraAction,view:ObraView|undefined):string|undefined{
  if(action.type==='build')return action.site;
  return view?.sites.find(s=>s.tower?.id===action.defense)?.id;
}

export interface ObraNet {
  build(site:string):number|undefined;
  upgrade(defense:string,branch?:string):number|undefined;
}
export interface BuiltAnswer {req:number;ok:boolean;kind?:string;reason?:string}

/**
 * The requests this client sent and their answers. Clock injected (ms) so tests drive it; ticks come from the views.
 * The rail ('trilho') is not in the snapshot (TODO card NEW-20261013-E4-trilho-no-snapshot): this client knows it only
 * when it laid it (an ok answer of kind 'linha-ferrea', ready RAIL.buildSeconds later) or when the room refused its own
 * try as 'occupied' (someone else laid it: taken as ready after the same build time from then). Everyone else learns
 * it from the Gustavão on it. Reset per run.
 */
export class ObraRequests {
  private readonly sent=new Map<number,{site:string;at:number;rail:boolean;expired?:true}>();
  private readonly stamps=new Map<string,number>();
  private railTick:number|undefined;
  // A plain field, not a parameter property: node's type stripping loads this file in the tests.
  private readonly now:()=>number;
  constructor(now:()=>number=()=>performance.now()){this.now=now;}

  /** Sends the action; the text to show when it could not leave (offline, watching), else undefined. */
  send(action:ObraAction,site:string|undefined,net:ObraNet,state:{connected:boolean;spectator:boolean}):string|undefined{
    if(site!==undefined&&this.pendingSites().includes(site))return undefined;
    const req=action.type==='build'?net.build(action.site):net.upgrade(action.defense,branchForWire(action.branch));
    if(req===undefined)return unreachableText(state);
    if(site!==undefined)this.sent.set(req,{site,at:this.now(),rail:action.type==='build'&&action.site===RAIL_SITE_ID});
    return undefined;
  }
  /** The room's answer ({t:'built'}) at view tick `tick`: the text to show (a refusal), or undefined. Unknown req: ignored. */
  answer(result:BuiltAnswer,tick:number):string|undefined{
    const r=this.sent.get(result.req);
    if(!r)return undefined;
    this.sent.delete(result.req);
    if(result.ok){
      if(result.kind===RAIL.id||r.rail)this.railTick??=tick;
      this.stamps.set(r.site,this.now()+OBRA_DONE_MS);
      return undefined;
    }
    // The rail was already laid (by someone else): now this client knows it.
    if(r.rail&&result.reason==='occupied'){this.railTick??=tick;return OBRA_RAIL_TAKEN;}
    return refusalText(result.reason);
  }
  /** Requests that just passed OBRA_PENDING_MS without an answer: true once per batch (one "A sala não respondeu"). */
  expire():boolean{
    const t=this.now();let any=false;
    for(const [req,r] of this.sent){
      if(!r.expired&&t-r.at>=OBRA_PENDING_MS){r.expired=true;any=true;}
      // A late answer may come a while after; past that the room is gone (or dropped it): forget it.
      if(t-r.at>=OBRA_PENDING_MS*10)this.sent.delete(req);
    }
    for(const [site,until] of this.stamps)if(t>=until)this.stamps.delete(site);
    return any;
  }
  pendingSites():string[]{return [...new Set([...this.sent.values()].filter(r=>!r.expired).map(r=>r.site))];}
  doneSites():string[]{const t=this.now();return [...this.stamps].filter(([,until])=>t<until).map(([site])=>site);}
  /** The rail as this client knows it at view tick `tick`. */
  rail(tick:number):{laid:boolean;ready:boolean}{
    const laid=this.railTick!==undefined;
    return {laid,ready:laid&&tick>=this.railTick!+ticks(RAIL.buildSeconds)};
  }
  /** A new run (rematch, another map): no rail, no requests. */
  resetRun(){this.sent.clear();this.stamps.clear();this.railTick=undefined;}
}

/**
 * Whether the scene draws the towers itself (ObraView.drawnInWorld): the optional `towersInWorld()` getter Executor-3
 * adds to the scene in card NEW-20261013-ORQ-torres-render. Read defensively, so today (no getter) it is false and the
 * markers stay the towers everyone sees.
 */
export function towersInWorld(scene:unknown):boolean{
  const get=(scene as {towersInWorld?:unknown}|null|undefined)?.towersInWorld;
  return typeof get==='function'&&(get as ()=>unknown).call(scene)===true;
}
