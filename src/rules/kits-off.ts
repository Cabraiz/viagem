/**
 * Card NEW-20261031-ORQ-kits-so-torres-boas-sem-barricada (the user, 31/10: "remova temporariamente o spawn de
 * barricada no jogo"; "o tamanho maximo que deveria ser era para ser o guarita ... odiei todos os soldados serem
 * diferentes"). Two switches, to turn back on later; nothing is deleted:
 * - BARRICADA_OFF: no kit:barricada is born (KIT_POOL, the tralha's coleta). The id stays in KIT_IDS and the protocol's
 *   DICT; a kit:barricada already in an inventory (checkpoint, live room) still places as before.
 * - TOWERS_SHOWN: the only towers a kit gives and the upgrade tree (rules childrenOf) leads to, until the new art
 *   (card NEW-20261031-ORQ-torres-no-estilo-da-guarita). The rest stay in DEFENSES as legacy: one already built
 *   stands, shoots and is drawn as before, it just evolves into no hidden tower.
 */
export const BARRICADA_OFF=true;
/**
 * Card NEW-20261031-ORQ-torres-3-base-9-evolucoes-regras: the shown towers are the 12 of the tree of today (rules
 * towers.ts BichoId); the Guarita joins the legacy (it is their art until the bichos' own, rules towerArt).
 */
export const TOWERS_SHOWN:readonly string[]=Object.freeze([
  'bicho-tiro','bicho-rajada','bicho-mira','bicho-metralha','bicho-bomba','bicho-morteiro','bicho-foguete','bicho-fogo',
  'bicho-gosma','bicho-teia','bicho-choque','bicho-farol',
]);
/** Off: every tower again (the tree and the pools as before the card). */
export const TOWERS_ONLY_SHOWN=true;
let onlyShown=TOWERS_ONLY_SHOWN;
export const towerShown=(id:string)=>!onlyShown||TOWERS_SHOWN.includes(id);
/**
 * The legacy tests of the whole tree (towers-sim, towers-bots, ...): every tower in the upgrade tree again, in that
 * test's process only. KIT_POOL is fixed at load, so it keeps the shown towers.
 */
export const showEveryTower=()=>{onlyShown=false;};
