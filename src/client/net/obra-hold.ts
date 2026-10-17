/**
 * D-052 (obra-hud-ajustes): the hero holds still while their own new free obra is under way (the room's holdsObra,
 * sim/towers/system.ts: a piece or a free-built root from its start to its ready tick; the room cuts the step to 0). The
 * phone mirrors it in the prediction, or every step it takes there snaps back.
 * - Each free build this phone sends (net.buildAt) is remembered by its req with the order (piece, cell, rot).
 * - The room's accepted answer ({t:'built',ok}) names the structure (`defense`, its wire id, when the room sends it);
 *   without it the structure is found by the order: the same kind at the same top-left cell.
 * - While one of them stands in the frames in an obra phase ('obra-1..3'), the hero holds. Done, ruined or gone: dropped.
 * An evolution (net.upgrade) never holds, nor do the old build sites (net.build): only buildAt orders are tracked.
 * Pure (no DOM), node-tested (tests/client/obra-hold.test.ts).
 */
export interface ObraOrder {piece:string;c:number;r:number;rot?:number}
/** An accepted obra: its wire id (once known), whether a frame showed it building, frames that did not carry it yet. */
interface Held extends ObraOrder {id?:string;seen?:boolean;misses?:number}
/** What the hold reads of a frame structure (StructureView by shape). */
export interface HoldStructure {id:string;kind:string;phase?:string;c?:number;r?:number}

/** Orders without an answer are forgotten past this many (a lost answer must not pin the hero). */
const SENT_MAX=32;
const building=(s:HoldStructure)=>!!s.phase?.startsWith('obra');

export class ObraHold {
  private readonly sent=new Map<number,ObraOrder>();
  private readonly held:Held[]=[];
  /** A free build left this phone with request id `req`. */
  order(req:number,order:ObraOrder){
    this.sent.set(req,order);
    if(this.sent.size>SENT_MAX)this.sent.delete(this.sent.keys().next().value!);
  }
  /** The room's answer to a build: an accepted free build is held until the frames show it done. */
  answer(result:{req:number;ok:boolean;defense?:string}){
    const order=this.sent.get(result.req);
    if(!order)return;
    this.sent.delete(result.req);
    if(result.ok)this.held.push({...order,...(result.defense?{id:result.defense}:{})});
  }
  /** Whether the hero holds still in this frame's structures; obras finished or gone are dropped. */
  holding(structures:readonly HoldStructure[]):boolean{
    let any=false;
    for(let i=this.held.length-1;i>=0;i--){
      const h=this.held[i];
      const s=h.id!==undefined?structures.find(x=>x.id===h.id):structures.find(x=>x.kind===h.piece&&x.c===h.c&&x.r===h.r);
      if(s&&building(s)){h.seen=true;h.id??=s.id;any=true;continue;}
      // Seen building and now done (or gone): released. Not seen yet: the frame may not carry it yet (2 s of frames).
      if(h.seen||s)this.held.splice(i,1);
      else if((h.misses=(h.misses??0)+1)>40)this.held.splice(i,1);
    }
    return any;
  }
  /** A new run: nothing held. */
  reset(){this.sent.clear();this.held.length=0;}
}
