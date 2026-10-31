/**
 * The floor at the live cap (crates.ts floorStep): a floor crate the starved player does not see makes room, one nobody
 * on the map sees first (kits-so-torres-boas: with only the shown kits in the pool, the colours taken hid most of the
 * 60 and the floor stopped). Undefined: none to drop.
 */
export function floorRoom<P,R extends {point?:number;origin?:string}>(crates:Record<string,R>,live:(id:string)=>boolean,
  p:P,players:readonly P[],hiddenTo:(p:P,record:R)=>boolean):string|undefined{
  const mine=Object.keys(crates).filter(id=>live(id)&&crates[id].point!==undefined&&crates[id].origin==='dropped'&&hiddenTo(p,crates[id]));
  return mine.find(id=>players.every(o=>hiddenTo(o,crates[id])))??mine[0];
}
