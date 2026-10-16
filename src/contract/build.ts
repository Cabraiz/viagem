/**
 * D-052, fortification anywhere (card NEW-20261016-ORQ-carro-e-fortificacao-livre, slice 2): what the client and the
 * room share about a free build. The rules (costs, limits, the "do not lock the chaveiro" check) live in the sim.
 *
 * {t:'build',round,req,piece,c,r,rot?} builds `piece` with the top-left cell of its footprint at (c,r) of the build grid
 * (maps/build-sites.ts CITY_BUILD_CELL, origin 0,0 of the city). Without `rot` the footprint lies as in the catalog
 * (W×H); rot 1 turns it to H×W. A dragged wall is one command per cell (the sim queues them on the hero). The answer
 * stays {t:'built',req,ok,kind?|reason?}. The piece type (a tower id or a FreePiece) is rules/towers.ts BuildPiece.
 */
/** The new pieces beside the tower root: a wall segment (1 cell) and a barricade (2×1, slows instead of blocking). */
export type FreePiece='muro'|'barricada';
export const FREE_PIECES:readonly FreePiece[]=Object.freeze(['muro','barricada']);
export type BuildRot=0|1;
/** A rot the room accepts: 0, 1 or absent. */
export const isBuildRot=(v:unknown):v is BuildRot|undefined=>v===undefined||v===0||v===1;
/**
 * The free build's refusals, added to the towers' ones: it locks the chaveiro's path ('tranca'), too close to the car
 * ('carro') or to a living nest ('ninho'), a cell already taken ('ocupado'), the piece's limit ('limite'), a cell off the
 * walkable mesh ('fora': a building, a cliff, off the map) and the level-up pause of D-050 ('pausa').
 */
export type FreeBuildRefusal='tranca'|'carro'|'ninho'|'ocupado'|'limite'|'fora'|'pausa';
export const FREE_BUILD_REFUSALS:readonly FreeBuildRefusal[]=Object.freeze(['tranca','carro','ninho','ocupado','limite','fora','pausa']);
