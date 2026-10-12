/** The phone's side of the welcome (VGM-042b): rebuild exactly the room's terrain, or say why not. */
import {CHUNK_VERSION,TERRAIN_VERSION,TerrainField,cityTerrainFor} from '../../maps/index.ts';
import {UPDATE_NEEDED,type WorldDescriptor} from '../../protocol/index.ts';
/** Client side of the welcome (VGM-042b): the room's exact terrain (kind, versions, seed, signature), or the text why not. */
export function terrainFor(world:WorldDescriptor|undefined):TerrainField|string{
  if(!world||world.terrainVersion!==TERRAIN_VERSION||!Number.isInteger(world.seed))return UPDATE_NEEDED;
  // City (D-034): the asset this build decoded, matched by its sha256; a different or missing city is never guessed.
  if(world.kind==='cidade')return cityTerrainFor(world.signature)??UPDATE_NEEDED;
  // An endless room says so (spawn-em-volta/rede-mapa-grande); a different generator is refused, never misdrawn.
  if(world.kind==='infinito'&&world.generatorVersion!==CHUNK_VERSION)return UPDATE_NEEDED;
  const terrain=new TerrainField(world.seed,{world:world.kind==='infinito'?'infinito':'ilha'});
  return terrain.signature===world.signature?terrain:UPDATE_NEEDED;
}
