/**
 * Kits de torre (card NEW-20261020-ORQ-torre-pela-caixa), pure rules kept apart from the DOM so node tests import them.
 * barricada-tocar-no-mapa (the user, 25/10: "clicar no inventário da barricada e clicar no mapa, e você segura após o
 * clique para pôr a direção"): a tap on the kit's slot (hud/inventory.ts {t:'kit'}) selects it; the hero no longer
 * walks to the spot nor presses Construir. NEW-20261031-ORQ-construir-andando-ate-a-obra: the release walks the hero
 * there again (walk.ts BuildWalk), so the order goes from by the obra (KIT_REACH = the sim's BUILD_REACH).
 * - The map's press (hud/kit-place/gesture.ts) puts the ghost there (press), with the room's own footprint (rules
 *   pieceCells: the root takes 1 cell, a 3×2 tower its 3×3 square); the mouse hovering shows it before the press.
 * - Held and dragged past KIT_TURN_DRAG u, a barricade turns to the drag's axis (rot 0 along x, 1 along y); the ghost
 *   stays where the press was. R turns it on the PC.
 * - Letting go builds there (release → confirm); a red ghost says why instead and the mode stays.
 * - Its colour: the room's answer for that very cell wins, else the local check (render/fortify-rules ghostRefusal:
 *   the car, a nest, a standing piece); never the reach any more: far away, the hero walks there (walk.ts).
 * - Tapping the kit again, or a weapon, ends the mode; Esc does it on the PC.
 * - One {t:'place',slot,c,r,rot?} per confirm (net.place); the room answers {t:'built'}. A tower kit is done when the
 *   room takes it; a wall kit stays in the mode while it has charges. The kit leaving its slot (spent, dropped) ends it.
 */
import type {BuildRot} from '../../../contract/index.ts';
import {RADIUS,walkable,type CityTerrain,type TerrainField} from '../../../maps/index.ts';
import {KIT_PLACE_REACH,isTowerKit,kitPiece,pieceCells,type KitPiece} from '../../../rules/index.ts';
import {cellRect,cellUnder,distToRect,ghostLook,ghostRefusal,type CellRect,type GhostContext} from '../../render/fortify-rules.ts';
import type {GhostInput} from '../../render/fortify.ts';
import type {TowerKind} from '../../render/towers/tower-rules.ts';
import {fortRefusalText} from '../fortify/model.ts';
import type {BuildOrder} from './walk.ts';
export {BuildWalk,WALK_WORDS,standGround} from './walk.ts';

/** The room's reach for a kit (rules KIT_PLACE_REACH, from the hero to the footprint's edge): farther, the hero walks. */
export const KIT_REACH=KIT_PLACE_REACH;
/** A press dragged this far (world u) turns a barricade to the drag's axis; shorter, a tap keeps its rot. */
export const KIT_TURN_DRAG=.35;
/** What the HUD says when a kit is picked: where to tap now (the phone has no hover to show the ghost first). */
export const KIT_TAP_HINT='Toca no mapa pra pôr; segura e arrasta pra girar';
/** A request without an answer stops counting as pending after this. */
export const KIT_PENDING_MS=3000;
/** What the phone says before the first aim, and the kit's own refusals (sim/inventory.ts PlaceResult). */
export const KIT_REFUSALS:Readonly<Record<string,string>>=Object.freeze({slot:'O kit sumiu da mochila','not-kit':'Isso não é kit',
  away:'Longe demais, chega mais perto',defense:'Esse kit não monta aqui'});
export const kitRefusalText=(reason:string|undefined)=>reason!==undefined&&Object.hasOwn(KIT_REFUSALS,reason)?KIT_REFUSALS[reason]:fortRefusalText(reason);

/**
 * The room's ground check (sim/towers/free-build.ts onGround): every cell's centre walkable on the city, else 'fora'.
 * Undefined off the city (the room refuses everything there anyway).
 */
export function kitGround(terrain:TerrainField|undefined):((rect:CellRect,cell:number)=>boolean)|undefined{
  const city=(terrain as Partial<CityTerrain>|undefined)?.world==='cidade'?terrain as CityTerrain:undefined;
  if(!city)return undefined;
  const p={x:0,y:0};
  return (rect,cell)=>{
    for(let j=0;j<rect.h;j++)for(let i=0;i<rect.w;i++){p.x=(rect.c+i+.5)*cell;p.y=(rect.r+j+.5)*cell;if(!walkable(p,city))return false;}
    return true;
  };
}
/** What the ghost checks beyond the fortify rules: the city's ground and the bodies standing there (the room's 'taken'). */
export interface KitGhostContext extends GhostContext {
  ground?:((rect:CellRect,cell:number)=>boolean)|undefined;
  /** The other heroes standing and the live enemies (never the builder: the room lets them build under their feet). */
  bodies?:Iterable<{x:number;y:number}>;
}
export interface KitNet {place(slot:number,piece:string,c:number,r:number,rot?:BuildRot):number|undefined}
export interface KitSlotLike {id:string}
const CELL_REASONS:ReadonlySet<string>=new Set(['tranca','carro','ninho','ocupado','fora']);
const bodyOn=(rect:CellRect,bodies:Iterable<{x:number;y:number}>|undefined)=>{
  if(bodies)for(const b of bodies)if(distToRect(b.x,b.y,rect)<RADIUS)return true;
  return false;
};
const keyOf=(piece:string,c:number,r:number,rot:BuildRot)=>`${piece}:${c}:${r}:${rot}`;
const NO_KITS:readonly KitPiece[]=Object.freeze([]);
/**
 * torre-folha-ao-pegar-kit: the tower kits in the backpack not in `seen` yet (added to it), for the scene to fetch
 * their kind's sheets as the kit comes in, not at its first ghost (~2.5 s of a green box on a phone). The walls'
 * (muro, barricada) are the base art, already there.
 */
export function towerKitsArrived(slots:readonly (KitSlotLike|undefined)[]|undefined,seen:Set<string>):readonly KitPiece[]{
  let out:KitPiece[]|undefined;
  if(slots)for(const s of slots){
    const piece=kitPiece(s?.id);
    if(!piece||!isTowerKit(piece)||seen.has(piece))continue;
    seen.add(piece);(out??=[]).push(piece);
  }
  return out??NO_KITS;
}
/** torre-folha-ao-pegar-kit, the host's side: every frame's backpack; a new scene starts over (its textures are its own). */
export class KitArt {
  private scene:unknown;
  private readonly seen=new Set<string>();
  sync(scene:{needTowerArt(kind:TowerKind):void},slots:readonly (KitSlotLike|undefined)[]|undefined){
    if(this.scene!==scene){this.scene=scene;this.seen.clear();}
    for(const kind of towerKitsArrived(slots,this.seen))scene.needTowerArt(kind as TowerKind);
  }
}

export class KitPlace {
  /** The kit being placed: its inventory slot and item id. */
  kit:{slot:number;id:string;piece:KitPiece}|undefined;
  rot:BuildRot=0;
  cell:{c:number;r:number}|undefined;
  /** Why the last ghost (ghost()) is red, a refusal reason for kitRefusalText; undefined when it is green. */
  blocked:string|undefined;
  /** The map point of the press being held (the ghost's place while the drag turns it), undefined when none. */
  private anchor:{x:number;y:number}|undefined;
  private readonly answers=new Map<string,{ok:boolean;reason?:string}>();
  private readonly sent=new Map<number,{key:string;at:number;tower:boolean}>();
  private readonly now:()=>number;
  constructor(now:()=>number=()=>performance.now()){this.now=now;}

  get active(){return !!this.kit;}
  /** A press on the map is held (its release builds). */
  get pressing(){return !!this.anchor;}
  footprint():[number,number]{return this.kit?pieceCells(this.kit.piece,this.rot) as [number,number]:[1,1];}
  /** A tap on the kit's slot: the mode for that kit, no ghost until the map is pressed (or hovered). False: no kit. */
  start(slot:number,id:string):boolean{
    const piece=kitPiece(id);
    if(!piece)return false;
    this.kit={slot,id,piece};this.rot=0;this.cell=undefined;this.anchor=undefined;this.answers.clear();
    return true;
  }
  cancel(){this.kit=undefined;this.cell=undefined;this.blocked=undefined;this.anchor=undefined;}
  /** The map pressed at world point p: the ghost goes there and waits for the drag (turn) or the release (build). */
  press(p:{x:number;y:number},cell:number){
    if(!this.kit)return;
    this.anchor={x:p.x,y:p.y};this.point(p,cell);
  }
  /**
   * The pointer at world point p: while pressed, a drag past KIT_TURN_DRAG turns a barricade to its axis (the ghost
   * stays on the press); otherwise (the mouse hovering) the ghost follows it.
   */
  move(p:{x:number;y:number},cell:number){
    if(!this.kit)return;
    const a=this.anchor;
    if(!a){this.point(p,cell);return;}
    const dx=p.x-a.x,dy=p.y-a.y;
    if(this.canTurn()&&Math.hypot(dx,dy)>=KIT_TURN_DRAG){const rot=Math.abs(dx)>=Math.abs(dy)?0:1;if(rot!==this.rot){this.rot=rot;this.point(a,cell);}}
  }
  /** The press let go: true when it should build (a press was held and the ghost has a cell). */
  release():boolean{const held=!!this.anchor;this.anchor=undefined;return held&&!!this.kit&&!!this.cell;}
  /** Only a barricade turns (the towers are squares, the muro one cell). */
  canTurn(){return this.kit?.piece==='barricada';}
  /** R on the PC: the other axis, the ghost centred where it was. */
  turn(cell?:number){
    if(!this.canTurn())return;
    const at=cell!==undefined?this.rect(cell):undefined;
    this.rot=this.rot===1?0:1;
    if(at&&cell!==undefined)this.point(this.anchor??{x:at.cx,y:at.cy},cell);
  }
  /** The pointer is over world point p: the ghost centres the footprint under it. */
  point(p:{x:number;y:number},cell:number){const [w,h]=this.footprint();this.cell=cellUnder(p.x,p.y,w,h,cell);}
  rect(cell:number):CellRect|undefined{
    if(!this.kit||!this.cell)return undefined;
    const [w,h]=this.footprint();
    return cellRect(this.cell.c,this.cell.r,w,h,cell);
  }
  /** The ghost for the scene (scene.setBuildGhost), or null when not placing. */
  ghost(ctx:KitGhostContext):GhostInput|null{
    const rect=this.rect(ctx.cell);
    if(!rect||!this.kit)return null;
    const answer=this.answers.get(keyOf(this.kit.piece,rect.c,rect.r,this.rot));
    const local=ctx.ground&&!ctx.ground(rect,ctx.cell)?'fora':ghostRefusal(rect,{...ctx,piece:this.kit.piece})??(bodyOn(rect,ctx.bodies)?'ocupado':undefined);
    const look=ghostLook(local,answer);
    // Why it is red, in the words the room would use: the local check, else the room's own answer.
    this.blocked=look==='bloqueado'?local??answer?.reason??'ocupado':undefined;
    return {piece:this.kit.piece,c:rect.c,r:rect.r,w:rect.w,h:rect.h,...(this.rot?{rot:this.rot}:{}),look};
  }
  /** The ghost's cell, rot and rect frozen for the walk there (walk.ts), its ghost green; undefined without a cell. */
  order(cell:number):BuildOrder|undefined{
    const rect=this.rect(cell);
    if(!rect||!this.kit||!this.cell)return undefined;
    return {cell:{...this.cell},rot:this.rot,rect,ghost:{piece:this.kit.piece,c:rect.c,r:rect.r,w:rect.w,h:rect.h,...(this.rot?{rot:this.rot}:{}),look:'ok'}};
  }
  /** Back on a frozen order (the hero got there): confirm sends that cell, whatever the mouse hovered since. */
  aim(order:Pick<BuildOrder,'cell'|'rot'>){this.cell={...order.cell};this.rot=order.rot;}
  /** The kit's slot after an inventory change: follows the same id, or ends the mode when it is gone. */
  sync(slots:readonly (KitSlotLike|undefined)[]|undefined){
    if(!this.kit)return;
    if(slots?.[this.kit.slot]?.id===this.kit.id)return;
    const moved=slots?.findIndex(s=>s?.id===this.kit!.id)??-1;
    if(moved>=0)this.kit.slot=moved;else this.cancel();
  }
  /** Sends the ghost's cell: 'sent', 'pending' (that cell waits for its answer), 'none' (no cell) or 'offline'. */
  confirm(net:KitNet):'sent'|'pending'|'none'|'offline'{
    if(!this.kit||!this.cell)return 'none';
    const {c,r}=this.cell,key=keyOf(this.kit.piece,c,r,this.rot);
    if(this.pendingKeys().includes(key))return 'pending';
    const req=net.place(this.kit.slot,this.kit.piece,c,r,this.rot||undefined);
    if(req===undefined)return 'offline';
    this.sent.set(req,{key,at:this.now(),tower:this.kit.piece!=='muro'&&this.kit.piece!=='barricada'});
    return 'sent';
  }
  owns(req:number){return this.sent.has(req);}
  /** The room's answer ({t:'built'}): the refusal's words, or undefined. An accepted tower kit ends the mode. */
  answer(result:{req:number;ok:boolean;reason?:string}):string|undefined{
    const s=this.sent.get(result.req);
    if(!s)return undefined;
    this.sent.delete(result.req);
    // Only what that very cell decides paints it (the reach, the limit or the pause do not stay on the cell). An accepted
    // piece now stands there: the cell is taken (red) before the frames bring the structure.
    if(result.ok)this.answers.set(s.key,{ok:false,reason:'ocupado'});
    else if(CELL_REASONS.has(result.reason??''))this.answers.set(s.key,{ok:false,...(result.reason?{reason:result.reason}:{})});
    if(result.ok){if(s.tower)this.cancel();return undefined;}
    return kitRefusalText(result.reason);
  }
  pendingKeys(){const t=this.now();return [...this.sent.values()].filter(s=>t-s.at<KIT_PENDING_MS).map(s=>s.key);}
  /** A new run: nothing pending, no mode. */
  reset(){this.answers.clear();this.sent.clear();this.cancel();}
}
