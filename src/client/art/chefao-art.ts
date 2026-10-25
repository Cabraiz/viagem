/**
 * The chefões' sheets on demand (BUG-20261025-ORQ-celular-travando). Each HD chefão (manifest.ts HD_ENEMIES: his HD
 * idle/walk/slam pages up to 4096² on a phone plus his other files at the approved cell) is ~390 MB of GPU memory once
 * decoded. The room's {t:'elenco'} names the run's rotation (a mini-chefe may be one of them) and, last, the run's
 * chefão (multiplayer/simulation.ts rotationIds), and the scene used to load them all at the opening: on the user's phone
 * (Redmi Note 14 Pro, 25/10) two of them, 903 → 1692 MB of textures and 2.5 s of uploads in the first minute, the game
 * stuttering "toda hora, quando inicia o jogo".
 * Now (ChefaoArtPlan, pure; the scene does the loads):
 *  - the elenco's HD chefões never load at the opening;
 *  - the run's chefão (the elenco's last HD id) loads CHEFAO_LEAD_S before the minuto de Minerva ends (he comes after the
 *    1st wave, which leaves after it: a minute or more to spare), CHEFAO_NO_MINERVA_S into combat in a run without
 *    Minerva, or when his arrival scene names him (RunCena.who);
 *  - any other one loads when he shows up (render/layers.ts asks the art of every enemy it draws);
 *  - a chefão killed lets his sheets go CHEFAO_RELEASE_MS later (his death plays first); one coming back loads again.
 */
import {HD_ENEMIES} from './manifest.ts';

export const CHEFAO_LEAD_S=20;
export const CHEFAO_NO_MINERVA_S=30;
export const CHEFAO_RELEASE_MS=8000;

/** An elenco id that waits for its moment (the HD chefões). */
export const chefaoDeferred=(id:string)=>HD_ENEMIES.has(id);

export interface ChefaoArtInput {
  elenco:readonly string[];
  /** The run is in combat (Minerva included). */
  combat:boolean;
  nowMs:number;
  /** The room's tick (20 Hz) and RunState.minervaAteTick while Minerva lasts. */
  tick:number;
  minervaAteTick?:number;
  /** RunState.cena.who while the arrival scene lasts. */
  cenaWho?:string;
}
export interface ChefaoArtStep {load:string[];release:string[]}

export class ChefaoArtPlan {
  private combatSince?:number;
  private sawMinerva=false;
  /** The run's chefão was asked (by the clock or his scene): the clock does not ask him again. */
  private waveAsked=false;
  private readonly loaded=new Set<string>();
  private readonly releaseAt=new Map<string,number>();
  private readonly hz:number;
  constructor(hz=20){this.hz=hz;}
  /** The run's chefão as the elenco names him (its last HD id), or undefined. */
  static waveChefao(elenco:readonly string[]){for(let i=elenco.length-1;i>=0;i--)if(chefaoDeferred(elenco[i]))return elenco[i];return undefined;}
  /** A kill event of kind `id` (or one put off: another of his kind still stands): his sheets go CHEFAO_RELEASE_MS later. */
  killed(id:string,nowMs:number){if(chefaoDeferred(id))this.releaseAt.set(id,nowMs+CHEFAO_RELEASE_MS);}
  step(i:ChefaoArtInput):ChefaoArtStep{
    const load:string[]=[],release:string[]=[];
    for(const [id,at] of this.releaseAt)if(i.nowMs>=at){this.releaseAt.delete(id);this.loaded.delete(id);release.push(id);}
    // Out of combat (lobby, result): a rematch's run starts its clock over.
    if(!i.combat){this.combatSince=undefined;this.sawMinerva=this.waveAsked=false;return {load,release};}
    this.combatSince??=i.nowMs;
    if(i.minervaAteTick!==undefined)this.sawMinerva=true;
    const ask=(id:string|undefined)=>{if(id&&chefaoDeferred(id)&&!this.loaded.has(id)){this.loaded.add(id);this.releaseAt.delete(id);load.push(id);}};
    if(i.cenaWho){ask(i.cenaWho);this.waveAsked=true;}
    if(!this.waveAsked){
      const due=i.minervaAteTick!==undefined?i.tick>=i.minervaAteTick-CHEFAO_LEAD_S*this.hz
        :this.sawMinerva||i.nowMs-this.combatSince>=CHEFAO_NO_MINERVA_S*1000;
      const wave=due?ChefaoArtPlan.waveChefao(i.elenco):undefined;
      if(wave){this.waveAsked=true;ask(wave);}
    }
    return {load,release};
  }
}
