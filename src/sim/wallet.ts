/**
 * Each player's wallet (NEW-20261014-ORQ-carteira-e-pix; contract wallet.ts). The balance is SimPlayer.grana (absent =
 * 0), checkpointed with the player. Pure helpers shared by the kill credit (assemble.ts), the purchases (forge, towers,
 * Dona Cida), the chaveiro's vaquinha, the PIX and the inheritance (multiplayer/simulation.ts):
 * - seated: every player of the run with a seat (not a spectator), downed and offline included, in join order;
 * - split: equal whole parts; the remainder goes one R$ at a time from the run's split cursor (rotating), so the same
 *   seed and commands always split the same way and a checkpoint resumes it;
 * - vaquinha: the chaveiro's bill paid at the end (equal parts, the short pay what they have, the richest cover the rest).
 */
import type {SimPlayer,VaquinhaShare} from '../contract/index.ts';
import {Rng,PIX_MEMOS} from '../contract/index.ts';
import type {SimContext} from './context.ts';
import {isStanding} from './revive.ts';

/** A player's balance in R$ (absent = 0). */
export const walletOf=(p:Pick<SimPlayer,'grana'>|undefined)=>p?.grana??0;
/** Adds `amount` (may be negative) to the player's wallet; a wallet back at 0 keeps the field (it was touched). */
export function addGrana(p:SimPlayer,amount:number){p.grana=walletOf(p)+amount;}
/** Takes `amount` from the wallet when it holds that much; false (nothing taken) otherwise. */
export function payFrom(p:SimPlayer|undefined,amount:number):boolean{
  if(!p||!(walletOf(p)>=amount))return false;
  addGrana(p,-amount);return true;
}
/** The run's seated players (a seat: not a spectator), in join order. */
export function seatedPlayers(players:ReadonlyMap<string,SimPlayer>):SimPlayer[]{return [...players.values()].filter(p=>!p.spectator);}
/** What a split keeps between calls (StonewardsState.splitCursor): where the next remainder starts. */
export interface SplitCursor {splitCursor:number}
/**
 * Splits `amount` R$ among `to` (in the given order): floor(amount / n) each, then the remainder one R$ each from
 * index `cursor.splitCursor % n` on, the cursor moving past the last one paid. Nothing happens with nobody to pay.
 * Returns what each got, in `to` order.
 */
export function splitAmong(to:readonly SimPlayer[],amount:number,cursor:SplitCursor):number[]{
  const n=to.length,total=Math.max(0,Math.floor(amount));
  if(!n||!total)return to.map(()=>0);
  const part=Math.floor(total/n),rest=total-part*n,start=((cursor.splitCursor%n)+n)%n;
  const got=to.map(()=>part);
  for(let i=0;i<rest;i++)got[(start+i)%n]++;
  if(rest)cursor.splitCursor=(start+rest)%n;
  to.forEach((p,i)=>{if(got[i])addGrana(p,got[i]);});
  return got;
}
/** Kill credit's split: among the standing seated players (an explosion, a tower without owner), or every seat if none stands. */
export function splitStanding(players:ReadonlyMap<string,SimPlayer>,amount:number,cursor:SplitCursor){
  const seated=seatedPlayers(players),standing=seated.filter(isStanding);
  return splitAmong(standing.length?standing:seated,amount,cursor);
}

/**
 * Who a kill pays (contract wallet.ts): the boss always split among every seat (downed included); otherwise the
 * killer (`by`), else the kill's credit (a tower's owner), when that is a seated player still here; else split among
 * the standing seats.
 */
export function payKill(players:ReadonlyMap<string,SimPlayer>,enemy:{boss?:boolean},amount:number,cursor:SplitCursor,by?:string,credit?:string){
  if(!(amount>0))return;
  if(enemy.boss){splitAmong(seatedPlayers(players),amount,cursor);return;}
  for(const id of [by,credit]){
    const p=id===undefined?undefined:players.get(id);
    if(p&&!p.spectator){addGrana(p,amount);return;}
  }
  splitStanding(players,amount,cursor);
}

/**
 * The chaveiro's vaquinha: `bill` R$ from `payers` (join order). Each owes floor(bill / n); one who has less pays all
 * they have; what is still missing (the shortfalls and the remainder of the division) is covered from the richest
 * left down (ties: join order). What nobody can pay is the debt. Deducts the wallets.
 */
export function vaquinha(payers:readonly SimPlayer[],bill:number):{grana:number;paid:number;debt:number;share:VaquinhaShare[]}{
  const total=Math.max(0,Math.floor(bill)),n=payers.length;
  const share=payers.map(p=>({id:p.id,had:Math.max(0,walletOf(p)),paid:0}));
  const grana=share.reduce((s,x)=>s+x.had,0);
  if(n){
    const part=Math.floor(total/n);
    for(const s of share)s.paid=Math.min(s.had,part);
    let missing=total-share.reduce((s,x)=>s+x.paid,0);
    const order=share.map((s,i)=>({s,i})).sort((a,b)=>(b.s.had-b.s.paid)-(a.s.had-a.s.paid)||a.i-b.i);
    for(const {s} of order){
      if(missing<=0)break;
      const more=Math.min(s.had-s.paid,missing);
      s.paid+=more;missing-=more;
    }
    payers.forEach((p,i)=>{if(share[i].paid)addGrana(p,-share[i].paid);});
  }
  const paid=share.reduce((s,x)=>s+x.paid,0);
  return {grana,paid,debt:total-paid,share};
}

/** The PIX's description: an index into PIX_MEMOS from the run's PIX stream (absent: seeded from the tick's rng). */
export function drawMemo(ctx:Pick<SimContext,'rng'>,stream:{pixRng?:number}):number{
  const rng=stream.pixRng===undefined?ctx.rng.fork('pix'):new Rng(stream.pixRng);
  const memo=Math.floor(rng.next()*PIX_MEMOS.length);
  stream.pixRng=rng.state;
  return memo;
}
