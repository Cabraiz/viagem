/**
 * The room bots' money (NEW-20261029-ORQ-pix-sem-acumular; evidence/auditoria-economia-29-10.md items 6 and 8). Pure:
 * the view and the wallets in, a number or an item out; room-bots.ts makes the calls.
 *  - PIX to the bank (the forger-to-be): only up to what its next purchase may cost above its part of the chaveiro's
 *    bill (bankNeed), never everything above the sender's part. Before, the bank held it all (6p s3 [714,9,10,0,9,3])
 *    and the same Grana went round from bot to bot (PIX R$1397 > R$1302 earned).
 *  - Dona Cida (cidaPick): the Grana a bot keeps above its part buys her sweets in a wave, at the moto.
 */
import {CIDA_ITEMS,PIX_MAX,type CidaItemId,type PlayerRunView,type RunView} from '../src/contract/index.ts';
import {EVOLVE_PRICE,forgePrice} from '../src/rules/index.ts';
import {CIDA_REACH,MAX_TOWERS,granaReserve} from '../src/sim/index.ts';

/** The dearest step of a tower (an evolution to tier 5, R$): the bank keeps at least this ready. */
export const BANK_STEP=EVOLVE_PRICE[5];
/** A bot buys at the moto this far from it (u): CIDA_REACH less a margin, so a moto still moving never refuses ('away'). */
export const CIDA_BOT_REACH=CIDA_REACH-.3;
/** The order a bot takes the sweets in: damage, then guard, then speed (each once while its 30 s last). */
export const CIDA_BOT_ORDER:readonly CidaItemId[]=['pacoca','cocada','brigadeiro'];

type View=Pick<RunView,'objective'|'players'|'camp'|'structures'|'tick'|'round'>;

/**
 * The Grana the bank may hold (R$): its part of the chaveiro's bill (granaReserve) and the dearest thing it may buy
 * next: a tower step (BANK_STEP) or the forge's inflating recipes at today's price (the chinelo tower only while there
 * is room for it, bot-brain pickRecipe).
 */
export function bankNeed(view:View):number{
  const forge=view.camp?.forge;
  const towers=view.structures.filter(s=>s.kind.startsWith('torre-')&&(s.untilTick===undefined||s.untilTick>view.tick)).length;
  const next=Math.max(BANK_STEP,view.camp?forgePrice('gambiarra',forge):0,view.camp&&towers<MAX_TOWERS?forgePrice('torre-chinelo',forge):0);
  return granaReserve(view)+next;
}

/**
 * The PIX a bot sends the bank (R$, 0: none): what is above its own part of the bill, up to PIX_MAX and to what the
 * bank lacks for bankNeed. The rest stays in the sender's wallet (Dona Cida, its own share of the bill).
 */
export function pixAmount(view:View,grana:number,bankGrana:number):number{
  return Math.max(0,Math.min(PIX_MAX,grana-granaReserve(view),bankNeed(view)-bankGrana));
}

/**
 * The sweet this bot buys now, or nothing: the chaveiro running, a wave on (not the intermission), the bot standing
 * within CIDA_BOT_REACH of the moto, the item in stock, its effect not on the bot already, and its price above what the
 * bot keeps (its part of the bill; the bank also its next purchase, bankNeed). In CIDA_BOT_ORDER.
 */
export function cidaPick(view:View,selfId:string,grana:number,bank=false):CidaItemId|undefined{
  const o=view.objective;
  if(!o||o.ended||view.round?.phase==='prepare')return undefined;
  const self=view.players.find(p=>p.id===selfId) as (PlayerRunView&{x?:number;y?:number})|undefined;
  if(!self||!self.online||self.spectator||self.downed||self.eliminated||self.hp<=0||self.x===undefined||self.y===undefined)return undefined;
  if(Math.hypot(self.x-o.moto.x,self.y-o.moto.y)>CIDA_BOT_REACH)return undefined;
  const spare=grana-(bank?bankNeed(view):granaReserve(view));
  for(const id of CIDA_BOT_ORDER){
    const index=CIDA_ITEMS.findIndex(i=>i.id===id),item=CIDA_ITEMS[index];
    const until=item.effect==='speed'?self.fastUntil:item.effect==='damage'?self.mightUntil:self.guardUntil;
    if((o.stock[index]??0)>0&&(until??0)<=view.tick&&spare>=item.price)return id;
  }
  return undefined;
}
