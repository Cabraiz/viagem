/**
 * Build menu view-model (torres-hud, D-041): what the intermission's obra menu shows for one build site, from the rules
 * port's defense tree (src/rules/towers.ts) and a view of the team's towers. Pure (no DOM): node-tested.
 * Until torres-fio puts the defenses on the wire, the HUD takes an ObraView injected by its host (the sandbox drives it
 * from fake data shaped like the sim's TowersState). The refusals mirror src/sim/towers/system.ts in the same order, so
 * a card the menu offers is one the sim accepts.
 * Prices (D-048, ficha de torre and Grana): building the Vigia costs 1 ficha and the Gustavão 3 (`tokens`, the rail
 * comes free); every other evolution costs `grana` R$ by the tier it reaches (rules priceOf, price.ts evolvePriceLabel).
 */
import {DEFENSES,DEFENSE_LIMIT,GUSTAVAO_LIMIT,RAIL,ROOT_DEFENSE,TOWER_TOKENS,childrenOf,priceOf,tokensOf,unitsOf,type Balance,type Branch,type DefenseDef,type DefenseId,type DefenseSize} from '../../../rules/index.ts';
import {fichasText,granaShort} from '../price.ts';
import {uiArtUrl} from '../../ui/icon.ts';

/**
 * The imported sticker of a defense (icones-no-hud: `ui/torre-<DefenseId>`, art v2), or undefined: the rail, an unknown
 * key, or the art not loaded (then the menu keeps its suit). Only a DefenseId has one.
 */
export const towerSticker=(key:string):string|undefined=>Object.hasOwn(DEFENSES,key)?uiArtUrl(`torre-${key}`):undefined;

/** A tower as the menu sees it (the sim's DefenseState, reduced). */
export interface ObraTower {id:string;kind:DefenseId;building?:boolean;ruined?:boolean}
/**
 * A build site at its screen point (CSS px, projected by the host). `distance`: world units from the hero, when the host
 * knows it (the edge arrow of an off-screen site picks the nearest and shows it in metres).
 */
export interface ObraSite {id:string;x:number;y:number;maxSize:DefenseSize;tower?:ObraTower;distance?:number}
/** The Gustavão's rail ('trilho') at its screen point: laid once per run; `ready` once its obra is done. */
export interface ObraRail {x:number;y:number;laid:boolean;ready:boolean;distance?:number}
export interface ObraView {
  /** Round phase 'prepare' (the intermission): the only time the menu shows. */
  prepare:boolean;
  sites:readonly ObraSite[];rail?:ObraRail;
  /** The team's one pile of material (CampView.units): the fichas de torre that build the Vigia and the Gustavão. */
  balance:Balance;
  /** My wallet (CampView.grana, R$, carteira-e-pix: the viewer's own): what pays every other evolution. */
  grana:number;
  /** Standing defenses of the team (ruins do not count) and Gustavões built this run (a ruined one counts). */
  standing:number;gustavoes:number;
  /**
   * The world draws the towers (Executor-3's TowerRenderer, torres-render): a built site's marker goes light (its suit
   * and the evolve arrow only). Default false: until that renderer is in the scene, the marker IS the tower everyone sees.
   */
  drawnInWorld?:boolean;
  /** Sites (or RAIL_SITE_ID) with a build/upgrade sent and not answered yet (torres-ligar): "Obra pedida…", no tap. */
  pending?:readonly string[];
  /** Sites whose obra the room just accepted: the marker's short stamp (played once per acceptance). */
  done?:readonly string[];
  /** Watching (a spectator): the markers and the tree show, the confirm stays off and says "Assistindo". */
  readOnly?:boolean;
  /**
   * Changes exactly when anything but the screen points changed (wiring.ts obraViewFrom). Given, the HUD compares it
   * instead of the whole view; absent (the sandbox), the HUD compares the view's content.
   */
  revision?:string;
}

/** 'balance': fichas de torre short (the Vigia, the Gustavão); 'grana': R$ short (an evolution), like the sim's refusals. */
export type ObraBlock='balance'|'grana'|'limit'|'unique'|'rail'|'size'|'building'|'root'|'origin';
export type ObraAction={type:'build';site:string}|{type:'upgrade';defense:string;branch:string};
export interface ObraCard {
  key:string;name:string;label:string;branch:Branch|null;effect:string;
  /** Material units (DefenseDef.cost); 0 for the free rail. What a card pays is `tokens` or `grana` (D-048). */
  cost:number;
  /** Paid in fichas de torre (the Vigia 1, the Gustavão 3): what the card shows and what affordability counts. */
  tokens?:number;
  /** Paid in Grana, R$ (every evolution but the Gustavão: rules EVOLVE_PRICE by the tier it reaches). */
  grana?:number;
  /** buy: an option (blocked or not); have: the defense standing there; obra: under construction. */
  status:'buy'|'have'|'obra';
  block?:ObraBlock;
  /** What is missing when block = 'balance' (fichas) or 'grana' (R$). */
  missing?:number;
  action?:ObraAction;
  rail?:true;
}
export interface ObraTree {site:string;head:ObraCard;branches:ObraCard[]}

export const RAIL_SITE_ID=RAIL.siteId;
export const BRANCH_NAME:Readonly<Record<Branch,string>>=Object.freeze({A:'Mais atiradores',B:'Explosivos',C:'Controle e apoio'});
/** One line per defense (pt-BR, at most one short joke). */
export const EFFECT:Readonly<Record<DefenseId,string>>=Object.freeze({
  'vigia-do-predio':'Um vigia e um 38',
  'vigias-armados':'2 alvos por rajada',
  'atiradores-do-telhado':'3 alvos por rajada',
  'ninho-de-metralhadora':'Chuva de bala, 4 alvos',
  'guarnicao-do-predio':'6 alvos, sem dó',
  'ninho-do-sniper':'Mira no mais forte',
  'equipe-antimaterial':'Chefe treme na base',
  'rojao-de-festa':'Explode em área',
  'morteiro':'Cai onde tem bolo',
  'lanca-foguetes':'4 foguetes de uma vez',
  'obuseiro':'Área grande, bem lento',
  'gustavao':'Apaga meio mapa',
  'holofote':'Ofusca e atrasa',
  'arame-e-sirene':'Atrasa quem encosta',
  'antiaerea-quadrupla':'Só no que voa',
  'posto-de-radar':'Pulso e +30% de alcance',
  // torres-3-base-9-evolucoes: the tree of today (same damage, the way differs).
  'bicho-tiro':'Um tiro por vez','bicho-rajada':'3 alvos por rajada','bicho-mira':'Mira no mais forte','bicho-metralha':'Chuva de bala',
  'bicho-bomba':'Explode em área','bicho-morteiro':'Cai onde tem bolo','bicho-foguete':'3 foguetes de uma vez','bicho-fogo':'Queima quem chega perto',
  'bicho-gosma':'Gosma que atrasa','bicho-teia':'Teia em área','bicho-choque':'Choque que ofusca','bicho-farol':'Atrasa e +30% de alcance',
});
export const RAIL_NAME='Linha férrea',RAIL_EFFECT='Trilho do Gustavão';

/** The short reason a card is blocked (shown with the lock and a dashed edge, never by colour alone; the tag's
 * aria-label says it in full). Short enough to leave the name its line at 125 %. */
export function blockText(card:Pick<ObraCard,'block'|'missing'>):string{
  switch(card.block){
    // "Falta 1 ficha" (the lock and the dashed edge say the rest); an evolution's units stay a bare number.
    case 'balance':return `Falta ${card.missing??0} ${card.missing===1?'ficha':'fichas'}`;
    // "Falta R$ 3": the lock and the dashed edge say the rest.
    case 'grana':return granaShort(card.missing??0).html;
    case 'limit':return `Limite ${DEFENSE_LIMIT}`;
    case 'unique':return `Já tem ${GUSTAVAO_LIMIT}`;
    case 'rail':return 'Sem trilho';
    case 'size':return 'Não cabe';
    case 'building':return 'Em obra';
    case 'root':return 'Vigia antes';
    case 'origin':return 'Do Obuseiro';
    default:return '';
  }
}
/** The reason in full words, for the tag's aria-label. */
export function blockSpeech(card:Pick<ObraCard,'block'|'missing'>):string{
  switch(card.block){
    case 'balance':return `Falta ${fichasText(card.missing??0)}`;
    case 'grana':return granaShort(card.missing??0).speech;
    case 'limit':return `A turma já tem ${DEFENSE_LIMIT} torres`;
    case 'unique':return `Só ${GUSTAVAO_LIMIT} Gustavão por partida`;
    case 'rail':return 'Precisa da linha férrea pronta';
    case 'size':return 'Não cabe neste ponto';
    case 'building':return 'Ainda em obra';
    case 'root':return 'Primeiro construa a Vigia';
    case 'origin':return 'Evolui do Obuseiro Pesado';
    default:return '';
  }
}
export const selectable=(card:ObraCard)=>card.status==='buy'&&!card.block&&!!card.action;

/** The builds paid in fichas de torre (D-048): the Vigia and the Gustavão; every other defense is an evolution in Grana. */
export const tokensFor=(id:DefenseId):number|undefined=>id===ROOT_DEFENSE?TOWER_TOKENS.root:id==='gustavao'?TOWER_TOKENS.gustavao:undefined;
/** What pays: the team's whole fichas (the HUD never shows the units behind them) and my wallet (carteira-e-pix). */
const walletOf=(view:Pick<ObraView,'balance'|'grana'>)=>({tokens:tokensOf(unitsOf(view.balance)),grana:Number.isFinite(view.grana)?view.grana:0});
/** What is missing for the card (0: it is paid): fichas for a `tokens` card, R$ for a `grana` one (the free rail: 0). */
const shortOf=(c:Pick<ObraCard,'tokens'|'grana'>,wallet:{tokens:number;grana:number})=>
  c.tokens!==undefined?Math.max(0,c.tokens-wallet.tokens):c.grana!==undefined?Math.max(0,Math.ceil(c.grana-wallet.grana-1e-9)):0;
function card(d:DefenseDef,status:ObraCard['status']):ObraCard{
  const price=priceOf(d);
  return {key:d.id,name:d.name,label:d.label,branch:d.branch,cost:d.cost,...price,effect:EFFECT[d.id],status,...(d.rail?{rail:true as const}:{})};
}
function pay(c:ObraCard,view:ObraView):ObraCard{
  const short=c.block?0:shortOf(c,walletOf(view));
  return short>0?{...c,block:c.tokens!==undefined?'balance':'grana',missing:short}:c;
}
/** Why `next` cannot grow out of the tower on `site` (the sim's upgrade order: rail, unique, size; then balance). */
function childBlock(next:DefenseDef,site:ObraSite,view:ObraView):ObraBlock|undefined{
  if(next.rail){
    if(!view.rail?.ready)return 'rail';
    if(view.gustavoes>=GUSTAVAO_LIMIT)return 'unique';
  }else if(next.size!>site.maxSize)return 'size';
  return undefined;
}
const liveTower=(site:ObraSite)=>site.tower&&!site.tower.ruined?site.tower:undefined;

/** The tree for one site: the head (the Vigia to build, or what stands there) and its branches. */
export function treeFor(site:ObraSite,view:ObraView):ObraTree{
  const t=liveTower(site),root=DEFENSES[ROOT_DEFENSE];
  if(!t){
    // An empty site (or a ruin, cleared by the new obra): the head is the Vigia; its branches wait for it.
    const block:ObraBlock|undefined=root.size!>site.maxSize?'size':view.standing>=DEFENSE_LIMIT?'limit':undefined;
    const head=pay(block?{...card(root,'buy'),block}:card(root,'buy'),view);
    if(!head.block)head.action={type:'build',site:site.id};
    return {site:site.id,head,branches:childrenOf(root.id).map(d=>({...card(d,'buy'),block:'root' as const}))};
  }
  const now=DEFENSES[t.kind];
  const head=card(now,t.building?'obra':'have');
  const branches=childrenOf(now.id).map(d=>{
    const c=card(d,'buy');
    if(t.building)return {...c,block:'building' as const};
    const block=childBlock(d,site,view);
    const priced=pay(block?{...c,block}:c,view);
    return priced.block?priced:{...priced,action:{type:'upgrade' as const,defense:t.id,branch:d.label}};
  });
  return {site:site.id,head,branches};
}

/** The rail's tree: laying it (once per run), with the Gustavão it unlocks shown locked (it grows from the Obuseiro). */
export function railTree(view:ObraView):ObraTree{
  const rail=view.rail,g=DEFENSES.gustavao;
  const base:ObraCard={key:RAIL.id,name:RAIL_NAME,label:'',branch:'B',cost:RAIL.cost,effect:RAIL_EFFECT,rail:true,
    status:rail?.laid?(rail.ready?'have':'obra'):'buy'};
  let head=base.status==='buy'?pay(base,view):base;
  if(head.status==='buy'&&!head.block)head={...head,action:{type:'build',site:RAIL_SITE_ID}};
  const gust:ObraCard={...card(g,'buy'),block:view.gustavoes>=GUSTAVAO_LIMIT?'unique':'origin'};
  return {site:RAIL_SITE_ID,head,branches:[gust]};
}

/** The evolve arrow: a ready tower with at least one child the team can build right now. */
export function canEvolve(site:ObraSite,view:ObraView):boolean{
  const t=liveTower(site);
  if(!t||t.building)return false;
  const wallet=walletOf(view);
  return childrenOf(t.kind).some(d=>!childBlock(d,site,view)&&shortOf(priceOf(d),wallet)===0);
}

/** The card a tap on the site preselects: the head when it is buyable, else the first open branch. */
export function defaultPick(tree:ObraTree):string|undefined{
  if(selectable(tree.head))return tree.head.key;
  return tree.branches.find(selectable)?.key;
}
export const cardsOf=(tree:ObraTree)=>[tree.head,...tree.branches];

/**
 * The tree a tap opens on a site (its marker, or the edge arrow of an off-screen one: E4-obras-visiveis-da-base), from
 * the view alone: the rail's or the site's, wherever its point is on screen. Undefined in the intermission's absence,
 * for a site the plan does not have, or while a request on it waits for the room (no second tap).
 */
export function treeToOpen(siteId:string|undefined,view:ObraView|undefined):ObraTree|undefined{
  if(siteId===undefined||!view?.prepare||view.pending?.includes(siteId))return undefined;
  if(siteId===RAIL_SITE_ID)return view.rail?railTree(view):undefined;
  const site=view.sites.find(s=>s.id===siteId);
  return site&&treeFor(site,view);
}
