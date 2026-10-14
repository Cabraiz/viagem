/**
 * Bancos on the HUD (card NEW-20261014-ORQ-bancos-e-veiculos), pure:
 * - the ATMs on the WC3 minimap, as its extras (wc-minimap draws kind 'banco' as a "$" square): Cartolina with notes,
 *   Cone while a critter robs it, dim when empty ("SEM CÉDULAS");
 * - the row of the announcement slot "Bicho sacando no Juros & Juros!" when a critter starts robbing a bank (once per
 *   robbery, and not again for the same bank within BANK_ALERT_REPEAT_MS).
 */
import type {BankView} from '../../contract/index.ts';
import {BANK_SHORT} from '../../rules/index.ts';
import type {MmExtra} from './wc-minimap/minimap.ts';

/** Token colours (ui/tokens.css): Cartolina (a favor), Cone (perigo), and Papel over Breu for an empty one. */
export const BANK_MM_COLORS=Object.freeze({cheio:'#7ED957',bicho:'#FF7A1F',vazio:'#8A7F95'});
/** How long the robbery row stays (ms), and the quiet time before the same bank can call again. */
export const BANK_ALERT_MS=3500,BANK_ALERT_REPEAT_MS=20000;

export function bankExtras(banks:readonly BankView[]|undefined):MmExtra[]{
  const c=BANK_MM_COLORS;
  return (banks??[]).map(b=>({kind:'banco',x:b.x,y:b.y,color:b.state==='bicho'?c.bicho:b.state==='sem-cedulas'||b.saldo<=0?c.vazio:c.cheio}));
}
export const robberyText=(b:Pick<BankView,'name'>)=>`Bicho sacando no ${BANK_SHORT[b.name]}!`;

/** Calls a robbery once when it starts (a bank turning 'bicho'), at most once per BANK_ALERT_REPEAT_MS per bank. */
export class BankAlert {
  private robbed=new Set<string>();
  private called=new Map<string,number>();
  step(banks:readonly BankView[]|undefined,nowMs:number):{show?:{text:string;bank:string}}{
    let show:{text:string;bank:string}|undefined;
    const now=new Set<string>();
    for(const b of banks??[]){
      if(b.state!=='bicho')continue;
      now.add(b.id);
      if(this.robbed.has(b.id))continue;
      const at=this.called.get(b.id);
      if(!show&&(at===undefined||nowMs-at>=BANK_ALERT_REPEAT_MS)){show={text:robberyText(b),bank:b.id};this.called.set(b.id,nowMs);}
    }
    this.robbed=now;
    return show?{show}:{};
  }
  reset(){this.robbed.clear();this.called.clear();}
}
