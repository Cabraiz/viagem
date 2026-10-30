/**
 * Active cast for tooling (NEW-20261029-ORQ-ferramentas-so-elenco-ativo): benches, smoke, prints and diag scripts use
 * only the 6 released heroes (rules PERSONAGENS_LIBERADOS) and the 3 enemies (rules INIMIGOS_LIBERADOS, card
 * so-3-inimigos). Until that list is on main the enemies are FALLBACK: the mendigo's sim body (bebado, whose numbers
 * the mendigo takes) and the aberração-saci (elite). Only ids createEnemy accepts are kept (isEnemyKind), so an id the
 * sim does not know yet drops out instead of throwing; the list switches by itself when the rules file lands.
 * Changing the cast changes the benches' stateHash: compare before/after with the same version of this file.
 */
import {PERSONAGENS_LIBERADOS,PERSONAGEM_PADRAO} from '../src/rules/personagens-liberados.ts';
import {isEnemyKind} from '../src/sim/enemies/catalog.ts';

export const HEROIS:readonly string[]=PERSONAGENS_LIBERADOS;
/** Default hero of prints, smoke and single-player benches. */
export const HEROI_PADRAO:string=PERSONAGEM_PADRAO;
/** The i-th hero of the rotation (wraps). */
export const heroiAt=(i:number)=>HEROIS[((i%HEROIS.length)+HEROIS.length)%HEROIS.length];
/** n heroes in rotation order (6 → each of the 6 once). */
export const herois=(n:number)=>Array.from({length:n},(_,i)=>heroiAt(i));

const FALLBACK=['bebado','aberracao-saci'];
/** rules/inimigos-liberados.ts by a path in a variable (tsc does not need it to exist); only a missing file falls back. */
async function liberados():Promise<readonly string[]>{
  const url=new URL('../src/rules/inimigos-liberados.ts',import.meta.url).href;
  try{
    const m=await import(url) as {INIMIGOS_LIBERADOS?:readonly string[]};
    if(m.INIMIGOS_LIBERADOS?.length)return m.INIMIGOS_LIBERADOS;
  }catch(err){if((err as {code?:string}).code!=='ERR_MODULE_NOT_FOUND')throw err;}
  return FALLBACK;
}
const aceitos=(await liberados()).filter(isEnemyKind);
/** The enemies the sim can make today, common first, elite second, then the rest (sanfoneiro). */
export const INIMIGOS:readonly string[]=aceitos.length?aceitos:['bebado'];
export const INIMIGO_COMUM=INIMIGOS[0];
export const INIMIGO_ELITE=INIMIGOS[1]??INIMIGO_COMUM;
/** Horde rotation of 6 slots: mostly the common one, the elite once, the third kind once (common while absent). */
export const ROTA_INIMIGOS:readonly string[]=[INIMIGO_COMUM,INIMIGO_COMUM,INIMIGO_ELITE,INIMIGO_COMUM,INIMIGOS[2]??INIMIGO_COMUM,INIMIGO_COMUM];
export const inimigoAt=(i:number)=>ROTA_INIMIGOS[((i%ROTA_INIMIGOS.length)+ROTA_INIMIGOS.length)%ROTA_INIMIGOS.length];
