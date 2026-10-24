/**
 * NEW-20261021-ORQ-barricada-construir part 2, the barricadas de tralha on the map (pure, node-tested):
 * - which barricada square is under a world point (the build grid's cell; the structures' c/r);
 * - hover (the mouse) and the tapped square: its gold outline (INTERATIVO_COR, Warcraft 3's neutral/interactive: green
 *   and red already mean ally and enemy) and the two circles COLETAR / DESTRUIR over it; the car's red alert glow wins;
 * - the requests sent and the room's answers in words, and the coleta's bar (until, in sim ticks).
 */
import {BARRICADA_CELLS,COLETAR_SECONDS,DESTRUIR_PIX} from '../../../rules/index.ts';
import {SIM_HZ} from '../../../contract/index.ts';
import type {FortStructure} from '../../render/fortify-rules.ts';
import type {TralhaAnswer} from '../../net/client.ts';

/** The interactive outline (gold yellow) and its CSS twin for the circles. */
export const INTERATIVO_COR=0xffd23f,INTERATIVO_CSS='var(--c-amarelo)';

export interface TralhaNet {tralha(kind:'destruir'|'coletar',id:string):number|undefined}
export type TralhaSquare=FortStructure&{untilTick?:number};

/** The map pieces a hero collects or destroys: the barricada de tralha and the barraca (NEW-20261023-ORQ-barracas-no-caminho). */
export const isTralhaKind=(kind:string)=>kind==='barricada'||kind==='barraca';
/**
 * The standing barricada square or barraca covering the cell under world point p (undefined: none); both are
 * BARRICADA_CELLS × BARRICADA_CELLS (the barraca's footprint is the same 2×2).
 */
export function squareAt(structures:readonly TralhaSquare[],p:{x:number;y:number},cell:number):TralhaSquare|undefined{
  const c=Math.floor(p.x/cell),r=Math.floor(p.y/cell),n=BARRICADA_CELLS;
  return structures.find(s=>isTralhaKind(s.kind)&&s.hp>0&&s.c!==undefined&&s.r!==undefined&&s.c<=c&&c<s.c+n&&s.r<=r&&r<s.r+n);
}

const REFUSALS:Readonly<Record<string,string>>={
  longe:'Chega mais perto da tralha',
  cheio:'Mão cheia: monta essa antes',
  ocupado:'Alguém já tá desmontando',
  nada:'Essa já era',
  sumiu:'Alguém chegou primeiro',
  apanhou:'Apanhou, largou a tralha',
  caiu:'Caído não desmonta nada',
  fase:'Agora não dá',
  player:'Agora não dá',
};
export const tralhaRefusalText=(reason:string|undefined)=>reason!==undefined&&Object.hasOwn(REFUSALS,reason)?REFUSALS[reason]:'Agora não dá';

export class TralhaPick {
  /** The tapped square (the circles over it). */
  selected?:string;
  /** The square under the mouse. */
  hover?:string;
  /** The coleta under way: its request and the sim tick it ends. */
  coleta?:{req:number;id:string;until:number;start:number};
  /** The kind of the tapped piece ('barricada' or 'barraca'), for the answer's words. */
  private selectedKind?:string;
  private sent=new Map<number,{kind:'destruir'|'coletar';id:string;piece?:string}>();

  /** A tap on the map: selects the square under it (true: the tap was ours) or clears the selection. */
  tap(structures:readonly TralhaSquare[],p:{x:number;y:number},cell:number):boolean{
    const s=squareAt(structures,p,cell);
    this.selected=s?.id;this.selectedKind=s?.kind;
    return !!s;
  }
  /** The mouse over the map: the hovered square (the cursor turns into a hand there). */
  move(structures:readonly TralhaSquare[],p:{x:number;y:number}|undefined,cell:number):boolean{
    this.hover=p?squareAt(structures,p,cell)?.id:undefined;
    return this.hover!==undefined;
  }
  /** The square that wears the gold outline: the tapped one, else the hovered one; none while the car's alert glows on it. */
  outline(structures:readonly TralhaSquare[],tick:number):string|undefined{
    const id=this.selected??this.hover,s=id===undefined?undefined:structures.find(x=>x.id===id);
    if(!s||s.hp<=0)return undefined;
    return s.untilTick!==undefined&&tick<s.untilTick?undefined:id;
  }
  /** A gone square loses its selection (and hover). */
  sync(structures:readonly TralhaSquare[]){
    const alive=(id?:string)=>id!==undefined&&structures.some(s=>s.id===id&&s.hp>0);
    if(!alive(this.selected))this.selected=undefined;
    if(!alive(this.hover))this.hover=undefined;
  }
  /** One of the two circles: sends it for the selected square ('none': nothing selected). */
  act(kind:'destruir'|'coletar',net:TralhaNet,tick:number):'sent'|'none'|'offline'{
    const id=this.selected;
    if(id===undefined)return 'none';
    const req=net.tralha(kind,id);
    if(req===undefined)return 'offline';
    this.sent.set(req,{kind,id,piece:this.selectedKind});
    if(kind==='coletar')this.coleta={req,id,until:tick+COLETAR_SECONDS*SIM_HZ,start:tick};
    this.selected=undefined;
    return 'sent';
  }
  owns(req:number){return this.sent.has(req);}
  /** The room's answer: words to show (undefined: nothing to say). */
  answer(a:TralhaAnswer):string|undefined{
    const r=this.sent.get(a.req);
    if(!r)return undefined;
    const ended=a.t==='destruiu'||a.done||!a.ok;
    if(ended)this.sent.delete(a.req);
    if(a.t==='coleta'){
      if(a.ok&&a.until!==undefined&&this.coleta?.req===a.req)this.coleta.until=a.until;
      if(ended&&this.coleta?.req===a.req)this.coleta=undefined;
      if(a.done)return r.piece==='barraca'?'Barraca na mão! Monta onde quiser':'Tralha na mão! Monta onde quiser';
    }
    if(!a.ok)return tralhaRefusalText(a.reason);
    if(a.t==='destruiu')return `+R$ ${a.pix??DESTRUIR_PIX}: virou sucata`;
    return undefined;
  }
  /** The coleta's bar, 0..1 (undefined: none under way). */
  progress(tick:number):number|undefined{
    const c=this.coleta;
    if(!c)return undefined;
    return Math.max(0,Math.min(1,(tick-c.start)/Math.max(1,c.until-c.start)));
  }
  reset(){this.selected=this.hover=this.coleta=undefined;this.sent.clear();}
}
