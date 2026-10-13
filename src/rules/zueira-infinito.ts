/**
 * Names of the endless map's points of interest (D-033 tone). The chunk generator (maps/terrain/chunks.ts) still scatters
 * the three island landmark kinds — stall, fountain, flag on a hill — under the island's names, which are part of the
 * chunk hash, so the client shows these instead: the island's own names stay on the island. Pure deep-frozen data.
 */
/** Landmark kind, the island `landmarks` index the chunk POI copies: 0 stall, 1 fountain, 2 flag on a hill. */
export type PoiKind=0|1|2;
export const INFINITO_POI_NAMES:readonly (readonly string[])[]=Object.freeze([
  Object.freeze(['Barraca do Pastel de Vento','Caldo de Cana Batizado','Espetinho Sem Procedência','Bar do Fiado Eterno','Quiosque do Troco Sumido','Feirinha do Rolo']),
  Object.freeze(['Fonte da Água Que Ninguém Bebe','Chafariz do Desejo Vencido','Bebedouro da Ressaca','Fonte das Moedas Penhoradas','Poça Ornamental','Lago do Celular Afogado']),
  Object.freeze(['Mirante do Sinal de Uma Barra','Morro do Grito Sem Eco','Mastro do Churrasco Cancelado','Topo do Tio Que Sumiu','Mirante do Wi-Fi da Vizinha','Morro da Sandália Perdida']),
]);

/** The name a chunk's POI shows on the endless map: one per kind, picked by the chunk (same chunk, same name, every client). */
export function infinitoPoiName(kind:number,cx:number,cy:number):string{
  const list=INFINITO_POI_NAMES[kind===1||kind===2?kind:0];
  // Integer hash of the chunk coordinates (no float drift between devices).
  let h=Math.imul(cx|0,0x27d4eb2d)^Math.imul(cy|0,0x165667b1);
  h=Math.imul(h^(h>>>15),0x2c1b3c6d);h^=h>>>13;
  return list[(h>>>0)%list.length];
}
