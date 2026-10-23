/**
 * Kits de torre (card NEW-20261020-ORQ-torre-pela-caixa), pure rules kept apart from the DOM so node tests import them.
 * construir-no-botao (the user, 23/10): no window. A tap on the kit's slot (hud/inventory.ts {t:'kit'}) selects it, the
 * attack button turns into Construir with the kit's sticker (hud/skill.ts), and pressing it builds.
 * - The ghost stays KIT_AHEAD u in front of the hero (the way it last walked; at first towards the camera) and walks
 *   with it (follow, every frame), with the room's own footprint (rules pieceCells: the root takes 1 cell, a 3×2 tower
 *   its 3×3 square).
 * - Its colour: the room's answer for that very cell wins, else the local check (render/fortify-rules ghostRefusal:
 *   the car, a nest, a standing piece) plus the reach (KIT_REACH from the hero, the room's BUILD_REACH).
 * - Tapping the kit again, or a weapon, puts the weapon back in the button (Atacar); Esc does it on the PC.
 * - One {t:'place',slot,c,r,rot?} per confirm (net.place); the room answers {t:'built'}. A tower kit is done when the
 *   room takes it; a wall kit stays in the mode while it has charges. The kit leaving its slot (spent, dropped) ends it.
 */
import type {BuildRot} from '../../../contract/index.ts';
import {RADIUS,walkable,type CityTerrain,type TerrainField} from '../../../maps/index.ts';
import {kitPiece,pieceCells,type KitPiece} from '../../../rules/index.ts';
import {cellRect,cellUnder,distToRect,ghostLook,ghostRefusal,type CellRect,type GhostContext} from '../../render/fortify-rules.ts';
import type {GhostInput} from '../../render/fortify.ts';
import {fortRefusalText} from '../fortify/model.ts';

/** How far ahead of the hero (u) the ghost starts. */
export const KIT_AHEAD=1.8;
/** The room's reach (sim/towers/system.ts BUILD_REACH; a test keeps them equal): farther, the ghost is red. */
export const KIT_REACH=3;
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

export class KitPlace {
  /** The kit being placed: its inventory slot and item id. */
  kit:{slot:number;id:string;piece:KitPiece}|undefined;
  rot:BuildRot=0;
  cell:{c:number;r:number}|undefined;
  /** Why the last ghost (ghost()) is red, a refusal reason for kitRefusalText; undefined when it is green. */
  blocked:string|undefined;
  /** The hero's last walking direction (unit), for the ghost's first place. */
  private dir={x:0,y:1};
  private last:{x:number;y:number}|undefined;
  private readonly answers=new Map<string,{ok:boolean;reason?:string}>();
  private readonly sent=new Map<number,{key:string;at:number;tower:boolean}>();
  private readonly now:()=>number;
  constructor(now:()=>number=()=>performance.now()){this.now=now;}

  get active(){return !!this.kit;}
  /**
   * Each frame: the hero's position (the way it walks turns the ghost). `intent`, the walk the player asks for (the
   * scene's heroIntent), wins over the position's change: the reconciled position may step back when the hero stops.
   */
  hero(at:{x:number;y:number}|undefined,intent?:{x:number;y:number}){
    if(!at)return;
    if(intent){const d=Math.hypot(intent.x,intent.y);if(d>1e-3)this.dir={x:intent.x/d,y:intent.y/d};this.last={x:at.x,y:at.y};return;}
    if(this.last){const dx=at.x-this.last.x,dy=at.y-this.last.y,d=Math.hypot(dx,dy);if(d>.02){this.dir={x:dx/d,y:dy/d};}}
    this.last={x:at.x,y:at.y};
  }
  /** Each frame while placing: the ghost KIT_AHEAD u in front of the hero, the way it faces. */
  follow(at:{x:number;y:number}|undefined,cell:number){
    if(this.kit&&at)this.point({x:at.x+this.dir.x*KIT_AHEAD,y:at.y+this.dir.y*KIT_AHEAD},cell);
  }
  footprint():[number,number]{return this.kit?pieceCells(this.kit.piece,this.rot) as [number,number]:[1,1];}
  /** A tap on the kit's slot: the mode for that kit, the ghost ahead of the hero. Undefined when the id is no kit. */
  start(slot:number,id:string,hero:{x:number;y:number}|undefined,cell:number):boolean{
    const piece=kitPiece(id);
    if(!piece)return false;
    this.kit={slot,id,piece};this.rot=0;this.cell=undefined;this.answers.clear();
    if(hero)this.point({x:hero.x+this.dir.x*KIT_AHEAD,y:hero.y+this.dir.y*KIT_AHEAD},cell);
    return true;
  }
  cancel(){this.kit=undefined;this.cell=undefined;this.blocked=undefined;}
  /** Only a barricade turns (the towers are squares, the muro one cell). */
  canTurn(){return this.kit?.piece==='barricada';}
  turn(){if(this.canTurn())this.rot=this.rot===1?0:1;}
  /** The pointer is over world point p: the ghost centres the footprint under it. */
  point(p:{x:number;y:number},cell:number){const [w,h]=this.footprint();this.cell=cellUnder(p.x,p.y,w,h,cell);}
  rect(cell:number):CellRect|undefined{
    if(!this.kit||!this.cell)return undefined;
    const [w,h]=this.footprint();
    return cellRect(this.cell.c,this.cell.r,w,h,cell);
  }
  /** The ghost for the scene (scene.setBuildGhost), or null when not placing. */
  ghost(ctx:KitGhostContext,hero?:{x:number;y:number}):GhostInput|null{
    const rect=this.rect(ctx.cell);
    if(!rect||!this.kit)return null;
    const answer=this.answers.get(keyOf(this.kit.piece,rect.c,rect.r,this.rot));
    const far=!!hero&&distToRect(hero.x,hero.y,rect)>KIT_REACH;
    const local=far||(ctx.ground&&!ctx.ground(rect,ctx.cell))?'fora':ghostRefusal(rect,ctx)??(bodyOn(rect,ctx.bodies)?'ocupado':undefined);
    const look=ghostLook(local,answer);
    // Why it is red, in the words the room would use: the reach, the local check, else the room's own answer.
    this.blocked=look==='bloqueado'?(far?'away':local??answer?.reason??'ocupado'):undefined;
    return {piece:this.kit.piece,c:rect.c,r:rect.r,w:rect.w,h:rect.h,...(this.rot?{rot:this.rot}:{}),look};
  }
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
