/**
 * The city's viaducts (NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 3; plans/mapa-175-viaduto.md §4): a second floor
 * over the streets. Pure geometry, shared by the room and the phone, so both decide every floor the same way.
 *
 * A viaduct is a straight deck (a cell rect) and one ramp (a cell rect against one end of the deck, `up` pointing from
 * its foot to the deck). Every body has a floor, 0 (the ground) or 1 (the deck), and collides with that floor's mask:
 *   - the ground: the asset's walkable bitset, where the pillars and the ramp's embankment are solid, except its
 *     RAMP_FOOT_CELLS nearest the foot (the ground still walks onto the ramp's foot); the street under the deck is open;
 *   - the deck: the deck rect and the whole ramp, nothing else (no way off the side).
 * The floor only changes on the ramp (floorAfter): past RAMP_SWITCH_CELLS from the foot a body is on floor 1, below it
 * on floor 0; on the deck it keeps the floor it had (above or under). The switch line sits inside the walkable foot on
 * both floors, so a body of radius + step under one cell crosses it either way and never touches the other floor's walls.
 */

/** Direction from a ramp's foot to the deck. */
export type RampUp='N'|'E'|'S'|'W';
export const RAMP_UPS:readonly RampUp[]=Object.freeze(['N','E','S','W'] as RampUp[]);
/** [c, r, w, h] in cells. */
export type ViaductRect=readonly [number,number,number,number];
export interface CityViaductRamp {readonly rect:ViaductRect; readonly up:RampUp}
export interface CityViaduct {
  readonly id:string;
  readonly deck:ViaductRect;
  readonly ramp:CityViaductRamp;
  /** Pillar cells [c, r] under the deck (solid on the ground). */
  readonly pillars:readonly (readonly [number,number])[];
  /** Height of the deck's top over the ground (u). */
  readonly height:number;
}
/** Cells of the ramp from its foot that the ground still walks (the rest of the ramp is its embankment, solid). */
export const RAMP_FOOT_CELLS=2;
/** Distance from the foot (cells) past which a body on the ramp is on the deck's floor. */
export const RAMP_SWITCH_CELLS=1;
/** A ramp is at least this long (cells): the walkable foot plus one cell of embankment. */
export const RAMP_MIN_CELLS=RAMP_FOOT_CELLS+1;
/** Floor of a body: 0 the ground, 1 a deck. */
export type Floor=0|1;
/** A body's floor from its optional `andar` (absent = the ground). */
export const floorOf=(b:{andar?:number}):Floor=>b.andar===1?1:0;

/** Units along the ramp from its foot edge toward the deck (negative before the foot); undefined off its sides. */
export function rampRun(v:CityViaduct,unit:number,x:number,y:number):number|undefined{
  const [c,r,w,h]=v.ramp.rect,x0=c*unit,y0=r*unit,x1=(c+w)*unit,y1=(r+h)*unit;
  switch(v.ramp.up){
    case 'N':return x>=x0&&x<x1?y1-y:undefined;
    case 'S':return x>=x0&&x<x1?y-y0:undefined;
    case 'W':return y>=y0&&y<y1?x1-x:undefined;
    default:return y>=y0&&y<y1?x-x0:undefined;
  }
}
/** Length of the ramp along its axis (cells). */
export const rampCells=(v:CityViaduct)=>v.ramp.up==='N'||v.ramp.up==='S'?v.ramp.rect[3]:v.ramp.rect[2];
const inRect=(rect:ViaductRect,unit:number,x:number,y:number)=>x>=rect[0]*unit&&y>=rect[1]*unit&&x<(rect[0]+rect[2])*unit&&y<(rect[1]+rect[3])*unit;
/** True when (x, y) lies over the deck rect (either floor). */
export const overDeck=(v:CityViaduct,unit:number,x:number,y:number)=>inRect(v.deck,unit,x,y);
/** True when (x, y) lies on the ramp's footprint. */
export const onRamp=(v:CityViaduct,unit:number,x:number,y:number)=>inRect(v.ramp.rect,unit,x,y);

/**
 * The floor of a body that moved to (x, y) from floor `floor`: 1 on a ramp past RAMP_SWITCH_CELLS, 0 elsewhere on a ramp
 * and off every viaduct, the same floor over a deck.
 */
export function floorAfter(viaducts:readonly CityViaduct[],unit:number,x:number,y:number,floor:Floor):Floor{
  for(const v of viaducts){
    if(onRamp(v,unit,x,y)){
      const s=rampRun(v,unit,x,y);
      return s!==undefined&&s>RAMP_SWITCH_CELLS*unit?1:0;
    }
    if(overDeck(v,unit,x,y))return floor;
  }
  return 0;
}

/**
 * Height (u) of the surface a body on `floor` stands on at (x, y), over the ground: the deck's height on a deck, rising
 * from 0 at the ramp's foot to it at the top, 0 on the ground.
 */
export function surfaceHeight(viaducts:readonly CityViaduct[],unit:number,x:number,y:number,floor:Floor):number{
  if(floor!==1)return 0;
  for(const v of viaducts){
    if(onRamp(v,unit,x,y)){
      const s=rampRun(v,unit,x,y)??0,len=rampCells(v)*unit;
      return v.height*Math.max(0,Math.min(1,s/len));
    }
    if(overDeck(v,unit,x,y))return v.height;
  }
  return 0;
}

/** The foot of the ramp (u): the middle of its foot edge. */
export function rampFoot(v:CityViaduct,unit:number):{x:number;y:number}{
  const [c,r,w,h]=v.ramp.rect;
  switch(v.ramp.up){
    case 'N':return {x:(c+w/2)*unit,y:(r+h)*unit};
    case 'S':return {x:(c+w/2)*unit,y:r*unit};
    case 'W':return {x:(c+w)*unit,y:(r+h/2)*unit};
    default:return {x:c*unit,y:(r+h/2)*unit};
  }
}
/**
 * Where a body heads to change floor (u): `to` 1, a point on the ramp just past the switch line (it climbs from there);
 * `to` 0, a point on the ground just before the foot (it walks down there).
 */
export function floorPortal(v:CityViaduct,unit:number,to:Floor):{x:number;y:number}{
  const f=rampFoot(v,unit),run=(to===1?RAMP_SWITCH_CELLS+.75:-.75)*unit;
  switch(v.ramp.up){
    case 'N':return {x:f.x,y:f.y-run};
    case 'S':return {x:f.x,y:f.y+run};
    case 'W':return {x:f.x-run,y:f.y};
    default:return {x:f.x+run,y:f.y};
  }
}

/**
 * Cells [c, r] of the ramp's embankment (solid on the ground): every ramp cell farther than RAMP_FOOT_CELLS from the foot.
 */
export function embankmentCells(v:CityViaduct):[number,number][]{
  const [c,r,w,h]=v.ramp.rect,out:[number,number][]=[];
  for(let y=r;y<r+h;y++)for(let x=c;x<c+w;x++){
    const fromFoot=v.ramp.up==='N'?r+h-1-y:v.ramp.up==='S'?y-r:v.ramp.up==='W'?c+w-1-x:x-c;
    if(fromFoot>=RAMP_FOOT_CELLS)out.push([x,y]);
  }
  return out;
}
/** Cells solid on the ground because of the viaduct: its pillars and the ramp's embankment. */
export const groundSolidCells=(v:CityViaduct):[number,number][]=>[...v.pillars.map(([c,r]):[number,number]=>[c,r]),...embankmentCells(v)];

/**
 * Checks a viaduct against a grid of cellsW × cellsH; the error text, or undefined when it is sound: rects inside the
 * grid, the ramp at least RAMP_MIN_CELLS long, its top edge against the deck's end and its width within the deck's, the
 * pillars on the deck, a height in (0, 20] u.
 */
export function viaductProblem(v:CityViaduct,cellsW:number,cellsH:number):string|undefined{
  const fits=([c,r,w,h]:ViaductRect)=>[c,r,w,h].every(Number.isInteger)&&w>0&&h>0&&c>=0&&r>=0&&c+w<=cellsW&&r+h<=cellsH;
  if(!fits(v.deck))return 'deck must be a cell rect inside the grid';
  if(!fits(v.ramp.rect))return 'ramp.rect must be a cell rect inside the grid';
  if(!RAMP_UPS.includes(v.ramp.up))return `ramp.up must be one of ${RAMP_UPS.join(', ')}`;
  if(rampCells(v)<RAMP_MIN_CELLS)return `ramp must be at least ${RAMP_MIN_CELLS} cells long`;
  const [dc,dr,dw,dh]=v.deck,[rc,rr,rw,rh]=v.ramp.rect;
  const across=v.ramp.up==='N'||v.ramp.up==='S'?rc>=dc&&rc+rw<=dc+dw:rr>=dr&&rr+rh<=dr+dh;
  const touches=v.ramp.up==='N'?rr===dr+dh:v.ramp.up==='S'?rr+rh===dr:v.ramp.up==='W'?rc===dc+dw:rc+rw===dc;
  if(!across||!touches)return 'ramp must start at an end of the deck, within its width';
  for(const p of v.pillars){
    if(!(Array.isArray(p)&&p.length===2&&Number.isInteger(p[0])&&Number.isInteger(p[1])))return 'pillars must be [c, r] cells';
    if(!(p[0]>=dc&&p[0]<dc+dw&&p[1]>=dr&&p[1]<dr+dh))return 'pillars must stand under the deck';
  }
  if(!(Number.isFinite(v.height)&&v.height>0&&v.height<=20))return 'height must be in (0, 20] u';
  return undefined;
}

/**
 * The deck floor's walkable samples (the asset's sample grid, sw × sh, `perCell` samples a cell): 1 on every deck and
 * ramp sample, 0 elsewhere.
 */
export function deckSamples(viaducts:readonly CityViaduct[],sw:number,sh:number,perCell:number):Uint8Array{
  const out=new Uint8Array(sw*sh);
  const fill=([c,r,w,h]:ViaductRect)=>{
    for(let y=r*perCell;y<(r+h)*perCell&&y<sh;y++)for(let x=c*perCell;x<(c+w)*perCell&&x<sw;x++)out[y*sw+x]=1;
  };
  for(const v of viaducts){fill(v.deck);fill(v.ramp.rect);}
  return out;
}

/** Any terrain, as the floor helpers below read it (a CityTerrain has these methods; other worlds have none). */
interface FloorTerrain {onDeck?:()=>unknown;floorAt?:(x:number,y:number,floor:Floor)=>Floor;clearDisc?:(x:number,y:number,r:number)=>boolean}
/**
 * The body a floor change must fit (u): the hero's disc (maps world.ts RADIUS; every body's walk is checked with it).
 * A body crossing the switch line half off the ramp's side (the ground beside the ramp's foot is open) stays on its
 * floor until it fits the other one: it never stands on a floor whose walls it overlaps.
 */
export const FLOOR_FIT=.22;
/**
 * The terrain a body on floor `floor` collides with: a city's onDeck() view for floor 1 (the enemy view's one keeps the
 * blockers solid), the terrain itself for floor 0 and for any terrain without decks.
 */
export function onFloor<T>(terrain:T,floor:number|undefined):T{
  if(floor!==1)return terrain;
  const deck=(terrain as FloorTerrain|undefined)?.onDeck;
  return (typeof deck==='function'?deck.call(terrain):terrain) as T;
}
/** The floor of a body of floor `floor` that moved to (x, y) on `terrain` (CityTerrain.floorAt; 0 off the city). */
export function floorOn(terrain:unknown,x:number,y:number,floor:Floor):Floor{
  const at=(terrain as FloorTerrain|undefined)?.floorAt;
  if(typeof at!=='function')return 0;
  const next=at.call(terrain,x,y,floor);
  if(next===floor)return next;
  const there=onFloor(terrain,next) as FloorTerrain|undefined;
  return typeof there?.clearDisc==='function'&&!there.clearDisc(x,y,FLOOR_FIT)?floor:next;
}
/** Sets a body's `andar` to its floor after a move (floorOn): 1 on a deck, deleted on the ground. */
export function settleFloor(terrain:unknown,body:{x:number;y:number;andar?:1}):void{
  setFloor(body,floorOn(terrain,body.x,body.y,floorOf(body)));
}
/** Writes `floor` into a body: andar 1, or no andar (the ground). */
export function setFloor(body:{andar?:1},floor:Floor|undefined):void{
  if(floor===1)body.andar=1;else if(body.andar!==undefined)delete body.andar;
}
