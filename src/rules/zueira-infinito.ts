/**
 * Names of the endless map's points of interest (D-033 tone). The chunk generator (maps/terrain/chunks.ts) still scatters
 * the three island landmark kinds — stall, fountain, flag on a hill — under the island's names, which are part of the
 * chunk hash, so the client shows these instead: the island's own names stay on the island. Pure deep-frozen data.
 */
/** Landmark kind, the island `landmarks` index the chunk POI copies: 0 stall, 1 fountain, 2 flag on a hill. */
export type PoiKind=0|1|2;
export const INFINITO_POI_NAMES:readonly (readonly string[])[]=Object.freeze([
  Object.freeze(['Barraca do Pastel de Vento','Caldo de Cana Batizado','Espetinho Sem Procedência','Bar do Fiado Eterno','Quiosque do Troco Sumido','Churros Sem Recheio']),
  Object.freeze(['Fonte Que Ninguém Bebe','Chafariz do Boleto Vencido','Bebedouro da Ressaca','Fonte do Desejo Parcelado','Poça Ornamental','Lago do Celular Afogado']),
  Object.freeze(['Mirante do Sinal Fraco','Morro do Grito Sem Eco','Mastro do Churrasco Furado','Topo do Tio Que Sumiu','Wi-Fi da Vizinha Pega Aqui','Morro da Sandália Perdida']),
]);

/** The name a chunk's POI shows on the endless map: one per kind, picked by the map seed and the chunk (same map and chunk, same name, every client). */
export function infinitoPoiName(kind:number,cx:number,cy:number,seed=0):string{
  const list=INFINITO_POI_NAMES[kind===1||kind===2?kind:0];
  // Integer hash of the seed and chunk coordinates (no float drift between devices).
  let h=Math.imul(cx|0,0x27d4eb2d)^Math.imul(cy|0,0x165667b1)^Math.imul(seed|0,0x9e3779b1);
  h=Math.imul(h^(h>>>15),0x2c1b3c6d);h^=h>>>13;
  return list[(h>>>0)%list.length];
}
