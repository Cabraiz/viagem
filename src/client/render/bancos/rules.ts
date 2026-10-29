/**
 * Bancos in the world (card NEW-20261014-ORQ-bancos-e-veiculos): what the render reads from the run's banks
 * (RunView.banks), pure so it is tested. A withdrawal is the room's bank-cash event (its `by` says who took the note):
 * a hero's note flies up green with the "RETIRE SEU DINHEIRO" beep, a critter's flies away dark. Without the room's events
 * (the sandbox's fake banks) it is a saldo that dropped by whole notes between two views.
 */
import {SIM_HZ,type BankView,type StampedEvent} from '../../../contract/index.ts';
import {BANCO,BANK_BEEP,BANK_LINES} from '../../../rules/index.ts';

/** A note's flight (ms); the beep's and the screen line's balloons (ms). */
export const NOTE_MS=1100,BEEP_MS=1400,LINE_MS=2600;
/** At most this many notes per view (a long gap between views does not fire a burst). */
export const NOTES_PER_VIEW=3;
/** A screen line shows on every LINE_EVERY-th hero note of a bank (the first one too). */
export const LINE_EVERY=4;

export type NoteBy='hero'|'enemy';
/** Notes that left a bank between two views: whole notes of its saldo drop; a refill (saldo up) is none. */
export function notesBetween(prev:Pick<BankView,'saldo'|'state'>|undefined,next:Pick<BankView,'saldo'|'state'>):{count:number;by:NoteBy}{
  const by:NoteBy=next.state==='bicho'||prev?.state==='bicho'&&next.state!=='sacando'?'enemy':'hero';
  if(!prev||next.saldo>=prev.saldo)return {count:0,by};
  return {count:Math.min(NOTES_PER_VIEW,Math.max(1,Math.round((prev.saldo-next.saldo)/BANCO.nota))),by};
}
/** Notes per bank and withdrawer from the room's new bank-cash events (after lastEventId). */
export function notesFromEvents(events:readonly StampedEvent[],lastEventId:number):Map<string,{hero:number;enemy:number}>{
  const out=new Map<string,{hero:number;enemy:number}>();
  for(const e of events){
    if(e.eventId<=lastEventId||e.type!=='bank-cash')continue;
    const n=out.get(e.bank)??{hero:0,enemy:0};n[e.by]++;out.set(e.bank,n);
  }
  return out;
}
/** The saldo's share of a full ATM, 0..1 (the ring on the ground). */
export const saldoShare=(b:Pick<BankView,'saldo'>)=>Math.max(0,Math.min(1,b.saldo/BANCO.saldo));
/** Seconds until an empty ATM is full again (0 when it is not empty or has no deadline). */
/**
 * What each frozen piece of a bank's ground is drawn for (card Q2, NEW-20261021-E5-q2-graphics-assados): the hold ring
 * (paying or not), the saldo ring (critter or not, the saldo's share) and the shadow (the view). All in the bank's local
 * space, at the camera's contour width `k` (to the hundredth): the renderer re-freezes a piece only when its key changes,
 * and the paying pulse is a scale, not a redraw.
 */
export function groundKeys(b:Pick<BankView,'saldo'|'state'>,k:number,view:number):{hold:string;ring:string;shadow:string}{
  const kq=Math.round(k*100);
  return {hold:`${b.state==='sacando'?1:0}|${kq}`,ring:`${b.state==='bicho'?1:0}|${saldoShare(b)}|${kq}`,shadow:`${view}`};
}
/** The saldo ring's breathing while a hero is paid (1: still; reduced effects never breathe). */
export const groundPulse=(b:Pick<BankView,'state'>,now:number,reduced:boolean)=>b.state==='sacando'&&!reduced?1+Math.sin(now*.01)*.04:1;

export function emptySeconds(b:Pick<BankView,'state'|'until'>,tick:number):number{
  return b.state==='sem-cedulas'&&b.until!==undefined?Math.max(0,Math.ceil((b.until-tick)/SIM_HZ)):0;
}
/** m:ss */
export const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

export type ScreenLook='azul'|'verde'|'vermelho'|'apagado';
/**
 * The ATM's screen: blue "24h" at rest, green "R$ 2" paying, red "SAQUE" blinking while a critter robs it (still red
 * with reduced motion), dark "SEM CÉDULAS m:ss" when empty.
 */
export function screenOf(b:Pick<BankView,'state'|'until'>,tick:number,now:number,reduced:boolean):{look:ScreenLook;text:string}{
  switch(b.state){
    case 'sacando':return {look:'verde',text:`R$ ${BANCO.nota}`};
    case 'bicho':return {look:reduced||Math.floor(now/260)%2===0?'vermelho':'apagado',text:'SAQUE'};
    case 'sem-cedulas':{const s=emptySeconds(b,tick);return {look:'apagado',text:s>0?`SEM CÉDULAS ${clock(s)}`:'SEM CÉDULAS'};}
    default:return {look:'azul',text:'24h'};
  }
}
/** The screen line of the n-th hero note of a bank (0-based), or undefined between them. */
export function lineAt(bankId:string,n:number):string|undefined{
  if(n%LINE_EVERY!==0)return undefined;
  let h=0;for(const ch of bankId)h=(h*31+ch.charCodeAt(0))>>>0;
  return BANK_LINES[(h+n/LINE_EVERY)%BANK_LINES.length];
}

export interface FlyingNote {bank:string;born:number;by:NoteBy;
  /** Its place in the burst (0, 1, 2): a few ms and a step apart. */
  slot:number}
export interface Balloon {bank:string;born:number;text:string;beep:boolean}

/** The banks between views: their last view, the notes in the air and the balloons over them. */
export class BankTracker {
  banks:BankView[]=[];
  tick=0;
  notes:FlyingNote[]=[];
  balloons:Balloon[]=[];
  /** The hero notes each bank paid in the last push (the PIX swarm pops one "+R$ 5" each over its workers). */
  paid:{bank:string;count:number}[]=[];
  private last=new Map<string,BankView>();
  private heroNotes=new Map<string,number>();
  private lastEventId=-1;
  /** `events`: the room's view events (bank-cash says who took each note); undefined = guess from the saldo (sandbox). */
  push(banks:readonly BankView[]|undefined,tick:number,now:number,events?:readonly StampedEvent[]){
    this.tick=tick;this.banks=banks?[...banks]:[];
    const seen=new Set<string>();this.paid=[];
    const cash=events&&notesFromEvents(events,this.lastEventId);
    if(events)for(const e of events)if(e.eventId>this.lastEventId)this.lastEventId=e.eventId;
    for(const b of this.banks){
      seen.add(b.id);
      let took:{hero:number;enemy:number};
      if(cash)took=cash.get(b.id)??{hero:0,enemy:0};
      else{const {count,by}=notesBetween(this.last.get(b.id),b);took={hero:by==='hero'?count:0,enemy:by==='enemy'?count:0};}
      const count=Math.min(NOTES_PER_VIEW,took.hero);
      // The hero's notes first, then the critter's, NOTES_PER_VIEW in all.
      for(let slot=0;slot<Math.min(NOTES_PER_VIEW,took.hero+took.enemy);slot++)this.notes.push({bank:b.id,born:now+slot*120,by:slot<count?'hero':'enemy',slot});
      if(took.hero)this.paid.push({bank:b.id,count:took.hero});
      if(count){
        const n=this.heroNotes.get(b.id)??0;this.heroNotes.set(b.id,n+count);
        this.balloons=this.balloons.filter(x=>x.bank!==b.id);
        // The line falls on a multiple of LINE_EVERY among this view's notes (n..n+count-1), not only on n itself.
        const at=Math.ceil(n/LINE_EVERY)*LINE_EVERY,line=at<n+count?lineAt(b.id,at):undefined;
        this.balloons.push(line?{bank:b.id,born:now,text:line,beep:false}:{bank:b.id,born:now,text:BANK_BEEP,beep:true});
      }
      this.last.set(b.id,b);
    }
    for(const id of [...this.last.keys()])if(!seen.has(id)){this.last.delete(id);this.heroNotes.delete(id);}
  }
  /** Drops what finished flying or showing. */
  settle(now:number){
    this.notes=this.notes.filter(n=>now-n.born<NOTE_MS);
    this.balloons=this.balloons.filter(b=>now-b.born<(b.beep?BEEP_MS:LINE_MS));
  }
}
