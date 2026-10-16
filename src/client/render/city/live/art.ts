/**
 * Cenário vivo: which imported sheets the live layer loads (pure, no Phaser). From the art index (art/manifest.ts) it
 * picks, in any group, the files of the new scenery that move or belong to the nests:
 * - `anim-<name>` overlays of the places and `anim` of the lit objects (4 rows = views 0/90/180/270, frames columns);
 * - the 4-view `views` sheet of every `ninho-<tema>-<estado>` (the nests are not decor: the scene places them);
 * - the ground decals (rules.isDecal: any file of theirs, 1 view, baked into the ground by decalMeshes).
 * Texture keys are `city:live:<id>:<file>`; the base images of the decor are the city layer's (E1), not loaded here.
 */
import type {ArtFile,ArtIndex} from '../../../art/manifest.ts';
import {groupFileUrl} from '../../../art/manifest.ts';
import type {LivePiece} from './layer.ts';
import {isDecal} from './rules.ts';

export interface LiveSheet {key:string;url:string;frameWidth:number;frameHeight:number}
export const liveTextureKey=(id:string,file:string)=>`city:live:${id}:${file}`;
const NEST=/^ninho-[a-z]+-(ativo|dormindo|destruido)$/;
const isLiveFile=(id:string,file:string)=>file==='anim'||file.startsWith('anim-')||(NEST.test(id)&&file==='views')||isDecal(id);

/** Every live sheet of the index (first group wins on a repeated id), single-page files only. */
export function liveSheets(index:ArtIndex):LiveSheet[]{
  const out:LiveSheet[]=[],seen=new Set<string>();
  for(const group of Object.values(index.groups))for(const [id,piece] of Object.entries(group.pieces))
    for(const [name,file] of Object.entries(piece.files)){
      const key=liveTextureKey(id,name);
      if(!isLiveFile(id,name)||!file.file||seen.has(key))continue;
      seen.add(key);
      out.push({key,url:groupFileUrl(group,file.file),frameWidth:file.cell[0],frameHeight:file.cell[1]});
    }
  return out;
}

/** The live layer's piece lookup over the index: meta, files and texture keys of an id (first group that has it). */
export function livePieces(index:ArtIndex):(id:string)=>LivePiece|undefined{
  const cache=new Map<string,LivePiece|undefined>();
  return id=>{
    if(cache.has(id))return cache.get(id);
    let found:LivePiece|undefined;
    for(const group of Object.values(index.groups)){
      const p=group.pieces[id];
      if(p){found={meta:p.meta,files:p.files as Record<string,ArtFile>,key:file=>liveTextureKey(id,file)};break;}
    }
    cache.set(id,found);
    return found;
  };
}
