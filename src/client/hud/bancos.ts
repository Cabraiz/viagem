/**
 * Bancos on the HUD (card NEW-20261014-ORQ-bancos-e-veiculos), pure:
 * - the ATMs on the WC3 minimap, as its extras (wc-minimap draws kind 'banco' as its "$" icon, by `state`): Cartolina with notes,
 *   Cone while a critter robs it, dim when empty ("SEM CÉDULAS");
 * - the row of the announcement slot "Bicho sacando no Juros & Juros!" when a critter starts robbing a bank (once per
 *   robbery, and not again for the same bank within BANK_ALERT_REPEAT_MS).
 */
import type {BankView} from '../../contract/index.ts';
import {bicoRobberyText} from './bicos.ts';
import type {MmExtra} from './wc-minimap/minimap.ts';
import {token} from '../ui/tokens.ts';

/** a over b at `t` of b (#rrggbb), as the render's dim colour (Papel 45 % over Breu). */
const over=(a:string,b:string,t:number)=>{
  const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16),ch=(s:number)=>Math.round((x>>s&255)*(1-t)+(y>>s&255)*t);
  return '#'+((ch(16)<<16|ch(8)<<8|ch(0))>>>0).toString(16).padStart(6,'0').toUpperCase();
};

/** Token colours (ui/tokens.css): Cartolina (a favor), Cone (perigo), and Papel over Breu for an empty one. */
export const BANK_MM_COLORS=Object.freeze({cheio:token('--c-cartolina'),bicho:token('--c-cone'),vazio:over(token('--c-papel'),token('--c-breu'),.55)});
/** How long the robbery row stays (ms), and the quiet time before the same bank can call again. */
export const BANK_ALERT_MS=3500,BANK_ALERT_REPEAT_MS=20000;

export function bankExtras(banks:readonly BankView[]|undefined):MmExtra[]{
  const c=BANK_MM_COLORS;
  return (banks??[]).map(b=>{
    const state=b.state==='bicho'?'bicho':b.state==='sem-cedulas'||b.saldo<=0?'vazio':'cheio';
    return {kind:'banco',x:b.x,y:b.y,color:c[state],state};
  });
}
/** Bicos: the shop's gig names the robbery ("Bicho no caixa do Telemarketing!", hud/bicos.ts). */
export const robberyText=(b:Pick<BankView,'bico'>)=>bicoRobberyText(b);

/** Calls a robbery once when it starts (a bank turning 'bicho'), at most once per BANK_ALERT_REPEAT_MS per bank. */
export class BankAlert {
  private robbed=new Set<string>();
  private called=new Map<string,number>();
  step(banks:readonly BankView[]|undefined,nowMs:number):{show?:{text:string;bank:string}}{
    let show:{text:string;bank:string}|undefined;
    const now=new Set<string>();
    for(const b of banks??[]){
      if(b.state!=='bicho')continue;
      if(this.robbed.has(b.id)){now.add(b.id);continue;}
      const at=this.called.get(b.id);
      // A robbery that starts in the quiet time is let go; one that loses the frame to another bank calls next frame.
      if(at!==undefined&&nowMs-at<BANK_ALERT_REPEAT_MS){now.add(b.id);continue;}
      if(show)continue;
      show={text:robberyText(b),bank:b.id};this.called.set(b.id,nowMs);now.add(b.id);
    }
    this.robbed=now;
    return show?{show}:{};
  }
  reset(){this.robbed.clear();this.called.clear();}
}
