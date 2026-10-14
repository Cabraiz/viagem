/**
 * Bancos in the world (card NEW-20261014-ORQ-bancos-e-veiculos): what the render reads from the run's banks
 * (ObjectiveView.banks, contract/objective.ts), pure so it is tested. The sim sends each bank's saldo and state; a
 * withdrawal is a saldo that dropped by whole notes between two views (no event needed on the wire): a hero's note
 * flies up green with the "RETIRE SEU DINHEIRO" beep, a critter's flies away dark.
 */
import {SIM_HZ,type BankView} from '../../../contract/index.ts';
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
/** The saldo's share of a full ATM, 0..1 (the ring on the ground). */
export const saldoShare=(b:Pick<BankView,'saldo'>)=>Math.max(0,Math.min(1,b.saldo/BANCO.saldo));
/** Seconds until an empty ATM is full again (0 when it is not empty or has no deadline). */
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
  private last=new Map<string,BankView>();
  private heroNotes=new Map<string,number>();
  push(banks:readonly BankView[]|undefined,tick:number,now:number){
    this.tick=tick;this.banks=banks?[...banks]:[];
    const seen=new Set<string>();
    for(const b of this.banks){
      seen.add(b.id);
      const {count,by}=notesBetween(this.last.get(b.id),b);
      for(let i=0;i<count;i++)this.notes.push({bank:b.id,born:now+i*120,by,slot:i});
      if(count&&by==='hero'){
        const n=this.heroNotes.get(b.id)??0;this.heroNotes.set(b.id,n+count);
        this.balloons=this.balloons.filter(x=>x.bank!==b.id);
        const line=lineAt(b.id,n);
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
