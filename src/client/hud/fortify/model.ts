/**
 * D-052 slice 3 (card NEW-20261016-ORQ-carro-e-fortificacao-livre, HUD), pure rules kept apart from the DOM so node
 * tests import them:
 * - The "Puxar" button: shown when the hero is within CAR_PULL_REACH of the car's body (or already holds the rope);
 *   "Soltar" while this player is on the rope. It only sends {t:'puxar',on} and shows what the room says back.
 * - The free build ("Construir"): the piece picked (the tower root, a wall segment, a barricade), its rot, the cell under
 *   the finger or the mouse, and the ghost's colour (render/fortify-rules: local check, the room's answer for that very
 *   cell wins). One {t:'build',piece,c,r,rot?} per confirm; a dragged wall sends one per new cell.
 * - The wall counter: free walls standing over WALL_LIMIT (proposal §2), barricades over BARRICADE_LIMIT.
 * The limits and prices are the approved proposal's; the room (slice 2) is the judge and answers 'limite'.
 */
import {CAR_PULL_REACH,CAR_RADIUS,type BuildRot,type FreeBuildRefusal,type PullRefusal} from '../../../contract/index.ts';
import {DEFENSE_LIMIT,FREE_PIECE_DEFS} from '../../../rules/index.ts';
import {cellRect,cellUnder,footprintCells,ghostLook,ghostRefusal,type CellRect,type FortStructure,type GhostContext} from '../../render/fortify-rules.ts';
import type {GhostInput} from '../../render/fortify.ts';

/** Proposal §2: wall segments and barricades a team may have standing. */
export const WALL_LIMIT=FREE_PIECE_DEFS.muro.limit,BARRICADE_LIMIT=FREE_PIECE_DEFS.barricada.limit;
/** The tower root built from the free build (TOWER_TOKENS.root: 1 ficha). */
export const ROOT_PIECE='vigia-do-predio';
export type FortPiece=typeof ROOT_PIECE|'muro'|'barricada';
export interface PieceCard {piece:FortPiece;name:string;price:string;limit:number}
export const PIECES:readonly PieceCard[]=Object.freeze([
  {piece:ROOT_PIECE,name:'Vigia',price:'1 ficha',limit:DEFENSE_LIMIT},
  {piece:'muro',name:'Muro',price:`R$ ${FREE_PIECE_DEFS.muro.price}`,limit:WALL_LIMIT},
  // barricada-construir part 2: no barricada here: it comes from the map's tralha (hud/tralha) and is placed as a kit.
]);
/** "Construir aqui" before the ghost has a place (FortBuild.confirm 'none'): what the phone says. */
export const FORT_AIM_FIRST='Arraste no mapa primeiro';
/** A request without an answer stops counting as pending after this. */
export const FORT_PENDING_MS=3000;

interface CarLike {x:number;y:number;movers?:readonly string[];rope?:string}
export interface PullState {show:boolean;on:boolean;label:'Puxar'|'Soltar';pushing:boolean}
/**
 * The Puxar button for this player: on the rope → "Soltar" (shown anywhere); else "Puxar" within CAR_PULL_REACH of the
 * car's body (its radius CAR_RADIUS). `pushing`: this player moves the car without the rope (the HUD says "Empurrando").
 */
export function pullState(car:CarLike|undefined,me:string,hero:{x:number;y:number}|undefined):PullState{
  if(!car)return {show:false,on:false,label:'Puxar',pushing:false};
  const on=car.rope===me,pushing=!on&&!!car.movers?.includes(me);
  const near=!!hero&&Math.hypot(hero.x-car.x,hero.y-car.y)-CAR_RADIUS<=CAR_PULL_REACH;
  return {show:on||near,on,label:on?'Soltar':'Puxar',pushing};
}

/** The free pieces standing (built with a cell: the city's old barricades have none). */
export function fortCounts(structures:readonly FortStructure[]){
  let walls=0,barricades=0;
  for(const s of structures){
    if(s.hp<=0)continue;
    if(s.kind==='muro')walls++;
    else if(s.kind==='barricada'&&s.c!==undefined)barricades++;
  }
  return {walls,barricades};
}
export const wallCounterText=(walls:number)=>`Muros ${walls}/${WALL_LIMIT}`;

/** Why the room said no, in a few pt-BR words (contract FreeBuildRefusal + the towers' ones the free build keeps). */
export const FORT_REFUSALS:Readonly<Record<FreeBuildRefusal|'balance'|'grana'|'away'|'duplicate'|'phase',string>>=Object.freeze({
  tranca:'Isso tranca o chaveiro, chefe',
  carro:'Colado no carro não dá',
  ninho:'Muito perto do ninho',
  ocupado:'Já tem coisa aí',
  limite:'Chegou no limite',
  fora:'Aí não dá pra construir',
  pausa:'Escolham a carta primeiro',
  balance:'Falta ficha de torre',
  grana:'Falta grana',
  away:'Chegue mais perto',
  duplicate:'Esse pedido já foi',
  phase:'Agora não dá',
});
export const PULL_REFUSALS:Readonly<Record<PullRefusal,string>>=Object.freeze({
  longe:'Chegue mais perto do carro',
  ocupado:'Já tem gente na corda',
  pausa:'Escolham a carta primeiro',
  fase:'Agora não dá',
  duplicate:'Esse pedido já foi',
});
const textOf=(table:Readonly<Record<string,string>>,reason:string|undefined)=>reason!==undefined&&Object.hasOwn(table,reason)?table[reason]:'Agora não dá';
export const fortRefusalText=(reason:string|undefined)=>textOf(FORT_REFUSALS,reason);
export const pullRefusalText=(reason:string|undefined)=>textOf(PULL_REFUSALS,reason);

export interface FortNet {
  buildAt(piece:string,c:number,r:number,rot?:BuildRot):number|undefined;
}
const keyOf=(piece:string,c:number,r:number,rot:BuildRot)=>`${piece}:${c}:${r}:${rot}`;

/**
 * The build mode: open/closed, the piece, the rot, the cell under the pointer, the requests sent and the room's answers
 * by cell (so the ghost turns red where the room said 'tranca' or 'fora'). Clock injected (ms) for the tests.
 */
export class FortBuild {
  open=false;
  piece:FortPiece=ROOT_PIECE;
  rot:BuildRot=0;
  /** The ghost's top-left cell, once the pointer gave one. */
  cell:{c:number;r:number}|undefined;
  private readonly answers=new Map<string,{ok:boolean}>();
  private readonly sent=new Map<number,{key:string;at:number}>();
  /** Cells sent by the current wall drag (one command per new cell). */
  private dragged=new Set<string>();
  private readonly now:()=>number;
  constructor(now:()=>number=()=>performance.now()){this.now=now;}

  toggle(open=!this.open){this.open=open;if(!open){this.cell=undefined;this.dragged.clear();}}
  pick(piece:FortPiece){this.piece=piece;if(piece==='muro')this.rot=0;}
  turn(){this.rot=this.rot===1?0:1;}
  /** The pointer is over world point p: the ghost's cell centres the footprint under it. */
  point(p:{x:number;y:number},cell:number){const [w,h]=footprintCells(this.piece,this.rot);this.cell=cellUnder(p.x,p.y,w,h,cell);}
  rect(cell:number):CellRect|undefined{
    if(!this.cell)return undefined;
    const [w,h]=footprintCells(this.piece,this.rot);
    return cellRect(this.cell.c,this.cell.r,w,h,cell);
  }
  /** The ghost for the scene (scene.setBuildGhost), or null when closed or with no cell yet. */
  ghost(ctx:GhostContext):GhostInput|null{
    const rect=this.open?this.rect(ctx.cell):undefined;
    if(!rect)return null;
    const answer=this.answers.get(keyOf(this.piece,rect.c,rect.r,this.rot));
    return {piece:this.piece,c:rect.c,r:rect.r,...(this.rot?{rot:this.rot}:{}),look:ghostLook(ghostRefusal(rect,ctx),answer)};
  }
  /**
   * Confirms the ghost's cell: sends the build unless the same cell waits for an answer. Returns 'sent', 'pending'
   * (already on its way), 'none' (no cell) or 'offline' (net.buildAt gave no request).
   */
  confirm(net:FortNet):'sent'|'pending'|'none'|'offline'{
    if(!this.open||!this.cell)return 'none';
    const {c,r}=this.cell,key=keyOf(this.piece,c,r,this.rot);
    if(this.pendingKeys().includes(key))return 'pending';
    const req=net.buildAt(this.piece,c,r,this.rot||undefined);
    if(req===undefined)return 'offline';
    this.sent.set(req,{key,at:this.now()});
    return 'sent';
  }
  /** A wall drag: each new cell under the pointer is built once per drag. */
  drag(net:FortNet){
    if(this.piece!=='muro'||!this.cell)return 'none';
    const k=`${this.cell.c}:${this.cell.r}`;
    if(this.dragged.has(k))return 'pending';
    this.dragged.add(k);
    return this.confirm(net);
  }
  endDrag(){this.dragged.clear();}
  /** The room's answer ({t:'built'}): the refusal's words, or undefined (accepted, or not one of ours). */
  answer(result:{req:number;ok:boolean;reason?:string}):string|undefined{
    const r=this.sent.get(result.req);
    if(!r)return undefined;
    this.sent.delete(result.req);
    this.answers.set(r.key,{ok:result.ok});
    return result.ok?undefined:fortRefusalText(result.reason);
  }
  /** Whether a req is one this build mode sent (the obra menu's answers share {t:'built'}). */
  owns(req:number){return this.sent.has(req);}
  pendingKeys(){const t=this.now();return [...this.sent.values()].filter(s=>t-s.at<FORT_PENDING_MS).map(s=>s.key);}
  /** The world changed a lot (a new run): forget the answers and the requests. */
  reset(){this.answers.clear();this.sent.clear();this.dragged.clear();this.toggle(false);}
  /** A standing piece changed (built, fallen): the room's old answers may no longer hold. */
  forgetAnswers(){this.answers.clear();}
}

/**
 * NEW-20261021-ORQ-barricada-construir: the one entry point of the build gesture (still open: drag a line, marked spots
 * or the car's fan). Orders one barricada square per cell (the room checks each: carro, ocupado, grana…); returns the
 * request ids sent (undefined: offline). A dev shortcut calls it until the gesture lands.
 */
export function construirEm(net:FortNet,cells:readonly {c:number;r:number}[]):(number|undefined)[]{
  return cells.map(({c,r})=>net.buildAt('barricada',c,r));
}
