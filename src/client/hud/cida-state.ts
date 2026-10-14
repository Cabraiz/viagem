/**
 * Dona Cida's tray as state (D-047, card chaveiro-hud), with no DOM so node pins it down; hud/cida.ts only draws it and
 * keeps the timers. What it decides:
 * - whether her button may show (the objective runs, the hero stands by the moto, no offer window, the run not over,
 *   and the obra window not open: the two windows are never open together, the last opened wins);
 * - opening and closing the tray (it closes by itself when the button may not show: walking away, falling, an offer or
 *   the obra window opening, the end);
 * - one purchase at a time: a tap on a blocked sweet says why, a sent one waits for the room's 'bought' (or gives up
 *   after CIDA_TIMEOUT_MS), and the note line says what happened.
 */
import type {CidaItemId,ObjectiveView} from '../../contract/index.ts';
import {cidaBought,cidaButtonShown,cidaOffers,cidaRefusal,cidaSells,liveObjective,nearMoto,type CidaOffer} from './chaveiro.ts';

/** Answers slower than this are given up (the tag comes back, the note says so); the forge's number. */
export const CIDA_TIMEOUT_MS=3000;
/** A bought tag keeps its "LEVEI" stamp this long. */
export const CIDA_STAMP_MS=900;
/** A note that answered a tap goes back to the default after this long. */
export const CIDA_NOTE_MS=2600;
export const CIDA_DEFAULT_NOTE='Cada doce dura 30 s.';
export const CIDA_PENDING_NOTE='Embrulhando…';
export const CIDA_OFFLINE_NOTE='Sem conexão com a sala. Tenta de novo.';
export const CIDA_TIMEOUT_NOTE='Sem resposta da sala. Tenta de novo.';

export interface CidaAnswer {req:number;item:string;ok:boolean;grana?:number;reason?:string}
/** What the HUD knows each view (and each predicted hero spot). */
export interface CidaInput {
  view?:{objective?:ObjectiveView};
  /** The local hero stands (not caído, out or watching). */
  standing:boolean;
  hero?:{x:number;y:number};
  /** An offer window (or the combat strip) is on screen. */
  offerOpen:boolean;
  /** The result is up. */
  ended:boolean;
}
/** A note to show: `keep` stays until the next one (the pending line), else it goes back after CIDA_NOTE_MS. */
export interface CidaNote {text:string;keep:boolean}

export class CidaTray {
  open=false;
  /** The button may show now (the tray, once open, holds its place instead). */
  shown=false;
  offers:CidaOffer[]=[];
  sells=false;
  grana=0;
  note=CIDA_DEFAULT_NOTE;
  pending?:{req:number;item:CidaItemId;name:string};
  private near=false;
  /** The obra window is open: her button hides and the tray stays shut (D-047 review: one window at a time). */
  private obra=false;
  private input?:CidaInput;

  /** A new view or hero spot. Returns true when the tray just closed by itself. */
  sync(input:CidaInput):boolean{
    this.input=input;
    const objective=liveObjective(input.view);
    this.near=nearMoto(input.hero,objective?.moto,this.near);
    this.shown=!this.obra&&cidaButtonShown({live:!!objective,standing:input.standing,near:this.near,offerOpen:input.offerOpen,ended:input.ended});
    if(objective){this.offers=cidaOffers(objective);this.sells=cidaSells(this.offers);this.grana=objective.grana;}
    if(this.open&&!this.shown){this.shut();return true;}
    return false;
  }
  /** The obra window opened (it wins: the tray closes) or closed. Returns true when the tray just closed. */
  yieldTo(obra:boolean):boolean{
    this.obra=obra;
    if(this.input)return this.sync(this.input);
    if(obra&&this.open){this.shut();return true;}
    return false;
  }
  /** The button, C on a desktop: opens while the button may show, closes when open. Returns whether it changed. */
  toggle():boolean{
    if(this.open){this.shut();return true;}
    if(!this.shown)return false;
    this.open=true;return true;
  }
  /** The close button, Esc. Returns whether it changed. */
  close():boolean{if(!this.open)return false;this.shut();return true;}
  private shut(){this.open=false;this.pending=undefined;this.note=CIDA_DEFAULT_NOTE;}

  /**
   * A tap on a sweet (1–3 on a desktop). `send` sends {t:'cida'} and returns its request id (undefined: no room now).
   * Returns the note to show, or undefined when the tap does nothing (tray shut, a purchase already on its way).
   */
  tap(item:CidaItemId,send:(item:CidaItemId)=>number|undefined):CidaNote|undefined{
    if(!this.open||this.pending)return undefined;
    const offer=this.offers.find(o=>o.id===item);
    if(!offer)return undefined;
    if(offer.blocked)return this.say(cidaRefusal(offer.blocked,offer));
    const req=send(item);
    if(req===undefined)return this.say(CIDA_OFFLINE_NOTE);
    this.pending={req,item,name:offer.name};
    return this.say(CIDA_PENDING_NOTE,true);
  }
  /**
   * The room's 'bought'. Returns what to draw (`stamp`: the sweet that gets LEVEI) or undefined for another request's
   * answer. A 'duplicate' (a resend the room already handled) only clears the pending line.
   */
  reply(answer:CidaAnswer):{note:CidaNote;stamp?:CidaItemId}|undefined{
    const p=this.pending;
    if(!p||answer.req!==p.req)return undefined;
    this.pending=undefined;
    if(answer.ok)return {note:this.say(cidaBought(p.name)),stamp:p.item};
    if(answer.reason==='duplicate')return {note:this.say(CIDA_DEFAULT_NOTE,true)};
    return {note:this.say(cidaRefusal(answer.reason,this.offers.find(o=>o.id===p.item)))};
  }
  /** No answer for `req` in CIDA_TIMEOUT_MS: give it up. Returns the note, or undefined when it was already answered. */
  timeout(req:number):CidaNote|undefined{
    if(this.pending?.req!==req)return undefined;
    this.pending=undefined;
    return this.say(CIDA_TIMEOUT_NOTE);
  }
  /** A note's time is up: back to the default line (never over the pending one). */
  resetNote(){if(!this.pending)this.note=CIDA_DEFAULT_NOTE;}
  private say(text:string,keep=false):CidaNote{this.note=text;return {text,keep};}
}
