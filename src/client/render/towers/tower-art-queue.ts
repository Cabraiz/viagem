/** The defenses' delivered sheets (moved from towers.ts, corte C2): texture keys, lite URLs, what to load and queueing it. */
import type Phaser from 'phaser';
import {artIndex,groupFileUrl} from '../../art/manifest.ts';
import {TOWER_KINDS,towerArt,type TowerKind} from './tower-rules.ts';

/** How long a defense made before its sheet waits unseen for it (fetched first: ~1 s on a 9 Mbps phone), then procedural. */
export const TOWER_ART_WAIT_MS=5000;
/** Texture keys of a defense's imported sheets. */
export const towerBaseKey=(kind:string)=>`art:torres:${kind}:base`;
export const towerGunKey=(kind:string)=>`art:torres:${kind}:idle`;
export const towerFireKey=(kind:string)=>`art:torres:${kind}:fire`;
/**
 * Public URL of the lite copy of a defense's sheet (scripts/art-lite.mjs, family towers): one sheet per file, its
 * pages joined, frames in order at `liteCell`.
 */
export const towerLiteUrl=(kind:string,name:string)=>`/art/lite/towers/${kind}/${name}.webp`;
/** A delivered tower sheet to load: texture key, URL and frame size. */
export interface TowerLoad {key:string;url:string;frameWidth:number;frameHeight:number}
/**
 * The delivered sheets of `kind` (every kind without it): the lite copy when the manifest has one (`liteCell`, a single
 * page even when the delivered sheet is paged), else a single-page delivered file; the rest stays procedural. The fire
 * sheet (torres-animacao-idle-tiro) only with `fire`: a phone holds it only for the kinds standing in the match.
 */
export function towerLoads(kind?:TowerKind,fire=!!kind):TowerLoad[]{
  const group=artIndex().groups.torres;if(!group)return [];
  const out:TowerLoad[]=[];
  for(const k of kind?[kind]:TOWER_KINDS as readonly TowerKind[]){
    const art=towerArt(k);if(!art)continue;
    for(const [key,name,file] of [[towerBaseKey(k),'base',art.base],[towerGunKey(k),'idle',art.idle],[towerFireKey(k),'fire',art.fire]] as const){
      if(!file||name==='fire'&&!fire)continue;
      if(file.liteCell)out.push({key,url:towerLiteUrl(k,name),frameWidth:file.liteCell[0],frameHeight:file.liteCell[1]});
      else if(file.file&&(file.pages?.length??1)<=1)out.push({key,url:groupFileUrl(group,file.file),frameWidth:file.cell[0],frameHeight:file.cell[1]});
    }
  }
  return out;
}
/** Queues the delivered tower sheets not loaded yet (towerLoads; the fire sheets too with `fire`) on the scene's loader. */
export function queueTowerArt(scene:Phaser.Scene,fire=false){
  for(const l of towerLoads(undefined,fire))if(!scene.textures.exists(l.key))scene.load.spritesheet(l.key,l.url,{frameWidth:l.frameWidth,frameHeight:l.frameHeight});
}
