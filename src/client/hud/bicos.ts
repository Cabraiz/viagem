/**
 * Bicos on the client (card NEW-20261024-ORQ-bancos-viram-bicos, etapa 4), pure:
 * - workShop: the shop the hero may clock in now (standing in its ring, BANCO.holdR, while it is open): the action
 *   button says Trabalhar there, in the interaction colour (Cartolina, like the ring on the ground);
 * - WorkLatch: a tap on Trabalhar clocks in (PlayerInput.work rides every step) and nothing has to be held; moving the
 *   stick, a second tap, leaving the ring, the shop closing or the manager throwing the hero out clocks out;
 * - the shop's tag and the HUD's lines: the gig's name and its pay, who is on the shift, the queue (no limit since
 *   bico-sem-limite-pix-voando: no saldo, no closed sign).
 */
import type {BankView,BicoId,Point,SimEvent} from '../../contract/index.ts';
import {BANCO,BICO,BICOS,BICO_EXPULSO} from '../../rules/index.ts';

/** The action button's word and accessible names while the hero stands in a shop's ring, and while inside. */
export const WORK_WORD='Trabalhar',WORKING_WORD='No turno';
export const workLabel=(bico:BicoId)=>`Trabalhar de ${BICOS[bico].nome}: toque para entrar no turno, mexa para sair`;
export const workingLabel=(bico:BicoId)=>`No turno de ${BICOS[bico].nome}: toque ou mexa para sair`;

/** The open shop whose ring the hero stands in (the nearest), else undefined. A closed one ('sem-cedulas', only from a room before bico-sem-limite) takes nobody. */
export function workShop(banks:readonly BankView[]|undefined,hero:Point|undefined):BankView|undefined{
  if(!hero)return undefined;
  let best:BankView|undefined,bestD=Infinity;
  for(const b of banks??[]){
    if(b.state==='sem-cedulas')continue;
    const d=Math.hypot(b.x-hero.x,b.y-hero.y);
    if(d<=BANCO.holdR&&d<bestD){best=b;bestD=d;}
  }
  return best;
}
/** The shop `id` works in now (BankView.workers), else undefined. */
export const workingIn=(banks:readonly BankView[]|undefined,id:string)=>banks?.find(b=>b.workers?.includes(id));

/** How long a tap waits for the room to show the hero inside before it lets go (a ban, a lost race): ms. */
export const WORK_WAIT_MS=1500;
const moving=(d:Point)=>Math.hypot(d.x,d.y)>.05;

/**
 * Trabalhar as the input sends it. tap() asks to clock in (or, inside, to leave); step() is each 50 ms input step and
 * returns PlayerInput.work; view() is each room view: inside (the room lists us among the workers) or not, and whether
 * the button still offers a shop.
 */
export class WorkLatch {
  private on=false;private since=0;private inside=false;
  get asked(){return this.on;}
  tap(now:number){
    if(this.on){this.off();return;}
    this.on=true;this.since=now;this.inside=false;
  }
  step(direction:Point){
    if(this.on&&moving(direction))this.off();
    return this.on;
  }
  view(inside:boolean,offered:boolean,now:number){
    if(!this.on)return;
    if(inside){this.inside=true;return;}
    // Was in and is not any more (the shop closed, the manager), or the shop is gone, or the room never took us in.
    if(this.inside||!offered||now-this.since>WORK_WAIT_MS)this.off();
  }
  off(){this.on=false;this.inside=false;}
}

export type BicoTagLook='normal'|'bicho'|'vazio'|'turno';
/**
 * The tag over a shop: "Telemarketing: R$ 2/s" open, "Telemarketing" over "Você no turno · 2 na fila" with a shift (two
 * lines: one is wider than a phone's third), "Telemarketing: bicho no caixa!" while a critter robs it; just the name if a
 * room from before closed it. `nameOf`: a player's name ("Você" for the local one).
 */
export function bicoTag(b:Pick<BankView,'bico'|'state'|'workers'|'fila'>,nameOf:(id:string)=>string):{look:BicoTagLook;text:string}{
  const nome=BICOS[b.bico].nome;
  if(b.state==='sem-cedulas')return {look:'vazio',text:nome};
  if(b.state==='bicho')return {look:'bicho',text:`${nome}: bicho no caixa!`};
  if(b.workers?.length){
    const who=b.workers.length===1?`${nameOf(b.workers[0])} no turno`:`${b.workers.length} no turno`,fila=b.fila?` · ${b.fila} na fila`:'';
    return {look:'turno',text:`${nome}
${who}${fila}`};
  }
  return {look:'normal',text:`${nome}: R$ ${BICO.porSegundo}/s`};
}
/** How long the HUD's line of one's own shift stays (ms). */
export const BICO_LINE_MS=3200;
/** The HUD's robbery row for a shop. */
export const bicoRobberyText=(b:Pick<BankView,'bico'>)=>`Bicho no caixa do ${BICOS[b.bico].nome}!`;
/**
 * The HUD line for the local player's own bico event: entering, the gig's joke; thrown out, the manager's line.
 * Leaving says nothing (the player chose it).
 */
export function bicoLine(e:Extract<SimEvent,{type:'bico'}>,localId:string,banks:readonly BankView[]|undefined):string|undefined{
  if(e.player!==localId)return undefined;
  if(e.what==='expulso')return BICO_EXPULSO;
  if(e.what!=='entrou')return undefined;
  const b=banks?.find(x=>x.id===e.bank);
  return b?BICOS[b.bico].frase:undefined;
}
