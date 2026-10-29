/**
 * PIX voando (card NEW-20261029-ORQ-bico-sem-limite-pix-voando; user, 29/10: "foco é que quando trabalha aparece
 * dinheiros (pix) em volta"): while a hero works a shift (BankView.workers), notes and PIX diamonds sprout at their feet
 * and spiral up around them; every note paid (bank-cash by 'hero') pops a "+R$ 5" over their head that rises into the
 * wallet. Pure and allocation-free per frame: a fixed pool of bits and of pops, reused round-robin (the oldest gives way),
 * drawn by the bank renderer with its one Graphics and a few pooled Texts. Offsets are screen px at zoom 1 from the
 * hero's foot (the renderer multiplies by 1/zoom).
 */
import {BICO} from '../../../rules/index.ts';

/** Bits in the air at most (every worker shares them), and a new one per worker every BIT_EVERY_MS. */
export const BIT_POOL=24,BIT_MS=1300,BIT_EVERY_MS=200;
/** "+R$ 5" pops at most, and how long one rises. */
export const POP_POOL=6,POP_MS=1200;
/** A bit's kind: a green note or the PIX diamond. */
export type BitKind='nota'|'pix';

export interface PixBit {worker:string;born:number;kind:BitKind;
  /** Where on the spiral it starts (0..1 of a turn) and which way it turns (±1). */
  phase:number;spin:1|-1}
export interface PixPop {worker:string;born:number;text:string;
  /** A small side step, so two pops of one view do not sit on each other. */
  slot:number}
/** A bit at a time: its offset from the foot, its tilt and its alpha. */
export interface BitPose {dx:number;dy:number;tilt:number;alpha:number;scale:number}

/** The pop's text for a note of `amount` R$. */
export const popText=(amount:number=BICO.nota)=>`+R$ ${amount}`;

/** A cheap hash of (worker, n) into 0..1: the bits' spread is the same on every screen and in the tests. */
export function spread(worker:string,n:number):number{
  let h=2166136261^n;
  for(let i=0;i<worker.length;i++)h=Math.imul(h^worker.charCodeAt(i),16777619);
  h=Math.imul(h^h>>>15,2246822507);h^=h>>>13;
  return (h>>>0)/4294967296;
}

/**
 * Where a bit is `now`, or undefined once it is done (or not born): it sprouts at the foot, spirals out and up around
 * the body (an ellipse: the ground is seen from above) and fades at the top. Reduced motion has no bits.
 */
export function bitPose(bit:PixBit,now:number,out:BitPose):BitPose|undefined{
  const t=(now-bit.born)/BIT_MS;
  if(t<0||t>=1)return undefined;
  const a=(bit.phase+bit.spin*t*1.1)*Math.PI*2,r=10+20*t;
  out.dx=Math.cos(a)*r;
  out.dy=Math.sin(a)*r*.45-6-58*t;
  out.tilt=Math.sin(a)*.5;
  out.alpha=t<.12?t/.12:t>.7?(1-t)/.3:1;
  out.scale=.7+.3*Math.min(1,t*4);
  return out;
}
/** A pop's rise (px up, at zoom 1) and alpha `now`, or undefined once done. Reduced motion: it stays and fades. */
export function popPose(pop:PixPop,now:number,reduced:boolean):{dx:number;dy:number;alpha:number}|undefined{
  const t=(now-pop.born)/POP_MS;
  if(t<0||t>=1)return undefined;
  return {dx:(pop.slot%2?1:-1)*Math.min(pop.slot,1)*14,dy:-72-(reduced?0:34*t),alpha:t>.65?(1-t)/.35:1};
}

/** The swarm: the bits and the pops in the air. step() every frame with who works now; cash() for each paid note. */
export class PixSwarm {
  readonly bits:(PixBit|undefined)[]=new Array(BIT_POOL).fill(undefined);
  readonly pops:(PixPop|undefined)[]=new Array(POP_POOL).fill(undefined);
  private nextBit=0;private nextPop=0;
  /** When each worker last sprouted a bit, and how many it sprouted (the spread's index). */
  private last=new Map<string,{at:number;n:number}>();
  private turn=0;

  /** A new bit per worker every BIT_EVERY_MS (no catching up after a pause); a worker gone forgets its clock. */
  step(now:number,workers:Iterable<string>,reduced:boolean){
    const seen=new Set<string>();
    for(const id of workers){
      seen.add(id);
      const w=this.last.get(id);
      if(w&&now-w.at<BIT_EVERY_MS)continue;
      const n=w?w.n+1:0;
      this.last.set(id,{at:now,n});
      if(reduced)continue;
      const s=spread(id,n);
      this.bits[this.nextBit]={worker:id,born:now,kind:n%3===2?'pix':'nota',phase:s,spin:s<.5?1:-1};
      this.nextBit=(this.nextBit+1)%BIT_POOL;
    }
    for(const id of [...this.last.keys()])if(!seen.has(id))this.last.delete(id);
  }
  /**
   * `count` notes paid at a shop worked by `workers` (the room's bank-cash does not say whose: one each, by turns). Each
   * pops "+R$ 5" over its worker and a burst of two bits.
   */
  cash(now:number,workers:readonly string[],count:number,amount:number=BICO.nota,reduced=false){
    if(!workers.length)return;
    for(let i=0;i<count;i++){
      const id=workers[this.turn++%workers.length];
      this.pops[this.nextPop]={worker:id,born:now+i*90,text:popText(amount),slot:i};
      this.nextPop=(this.nextPop+1)%POP_POOL;
      if(reduced)continue;
      for(let j=0;j<2;j++){
        const s=spread(id,1e6+this.turn*2+j);
        this.bits[this.nextBit]={worker:id,born:now+i*90,kind:j?'pix':'nota',phase:s,spin:j?1:-1};
        this.nextBit=(this.nextBit+1)%BIT_POOL;
      }
    }
  }
}
