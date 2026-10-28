/**
 * What a match will download, known in the waiting room before "Tô pronto!" (NEW-20261013-ORQ-3g-precarga-partida).
 * Pure (no Phaser, no DOM): the same planners the scene's preload calls (sprite sheets, city art plan, horde, base,
 * frames and telegraph art from the art v2 index), so every URL here is exactly one the game asks for later and the
 * preloader's download is what Phaser then finds in the cache.
 *
 * Priorities: P0 = the map's ground and this player's hero with its walk clips (the match opens with them:
 * preload-heroi-primeiro); P1 = its attack clips first (cena-nasce-rapido), teammates' heroes, the upgrade cards' and the crates' item stickers, enemies and the base pieces; P2 = the city's pine, items,
 * effects and HUD art.
 * Not listed: the city's buildings, props, decor and live sheets (the scene, open behind the waiting room, streams them
 * itself nearest the camera first, render/city/art-stream.ts: fetched here in list order they took the bandwidth from
 * the art around the hero, partida-abre-com-P0), the endless map's trees (which ones depends on the terrain seed the room sends with the match; the scene
 * fetches the ones by the spawn itself) and the city's map file (the room's mapLoad already gates on it).
 */
import {PASSIVE_IDS,classes} from '../../rules/index.ts';
import type {MapId} from '../../protocol/index.ts';
import {itemDisplay} from '../hud/items.ts';
import {uiArtUrl} from '../ui/icon.ts';
import {spriteCatalog} from '../sprites/sprite-catalog.ts';
import {directionalSheet} from '../sprites/sprite-sheets.ts';
import {movementSheets} from '../sprites/movement128.ts';
import {spriteUrl,thumbUrl,treeUrl} from '../sprites/art-urls.ts';
import {artIndex} from '../art/manifest.ts';
import {artLoads,liteEnemyUrl} from '../art/horde-art.ts';
import {baseLoads} from '../art/base-art.ts';
import {framesLoads} from '../art/frames-art.ts';
import {telegraphArtLoads} from '../render/telegraph-art.ts';
import {arsenalLoads} from '../render/arsenal-rules.ts';
import {buildCityArtPlan,cityArtOptions} from '../render/city/art-plan.ts';
import {ALBEDO_URL} from '../render/city/relevo/albedo-meta.ts';

export type AssetPriority='P0'|'P1'|'P2';
export type AssetKind='hero'|'icon'|'ground'|'building'|'decor'|'enemy'|'base'|'effect';
export interface MatchAsset {url:string;priority:AssetPriority;kind:AssetKind;bytes?:number}
/** The room as the waiting room sees it: this player's class, the others' (unknown ones skipped) and the map. */
export interface MatchRoom {
  self:string;
  others:readonly (string|undefined)[];
  map:MapId;
  /** Page query (`?arte=0`, `?altura=a|b` change the city plan, as in the scene). */
  search?:string;
  /** Known file sizes by URL (optional: progress then also counts bytes). */
  sizes?:Readonly<Record<string,number>>;
}

/** The URL the scene's CharacterSprites.queue fetches for a class's sheet; undefined for a class with no sheet. */
export const heroSheetUrl=(classId:string)=>movementSheets(classId,'idle')[0]?.url??(spriteCatalog[classId]?directionalSheet(classId)?.url??spriteUrl(classId):undefined);
/** The island/endless ground the scene loads outside the city (scene.ts preload). */
export const ENDLESS_GROUND=['/art/terrain/soil-grass.webp','/art/terrain/riverbed.webp'] as const;
const RANK:Record<AssetPriority,number>={P0:0,P1:1,P2:2};
/**
 * A class's detailed clips (movement128: walk then attack, the 8 directions each; M16: the 5 drawn directions, then the
 * other rest sheets), the URLs the scene's Movement128Textures fetches; empty for a class without them. The waiting room
 * downloads the own hero's in P0, so no sheet of the player's own hero is fetched after the match opens (card
 * preload-heroi-primeiro).
 */
export const heroMotionUrls=(classId:string)=>[...new Set((['walk','attack','idle'] as const).flatMap(motion=>movementSheets(classId,motion).map(p=>p.url)))]
  .filter(url=>url!==heroSheetUrl(classId));

/** The imported `ui` art of every sticker an upgrade card can wear (the passives and the coxinha), each once. */
export const offerIconUrls=()=>[...new Set([...PASSIVE_IDS,'heal'].map(id=>uiArtUrl(itemDisplay(id).icon)).filter((u):u is string=>!!u))];

/**
 * Ordered list (P0, then P1, then P2; plan order inside each) of every file the match needs, each URL once at its
 * highest priority.
 */
export function assetsParaPartida(room:MatchRoom):MatchAsset[]{
  const out=new Map<string,MatchAsset>();
  const add=(url:string|undefined,priority:AssetPriority,kind:AssetKind)=>{
    if(!url)return;
    const seen=out.get(url);
    if(seen&&RANK[seen.priority]<=RANK[priority])return;
    const bytes=room.sizes?.[url];
    out.set(url,{url,priority,kind,...(bytes!==undefined?{bytes}:{})});
  };
  const known=(id:string)=>classes.some(c=>c.id===id);
  // P0: own sheet and own portrait ('hero' texture), the ground, then the own walk clips.
  add(heroSheetUrl(room.self),'P0','hero');
  if(known(room.self))add(thumbUrl(room.self),'P0','icon');
  const index=artIndex();
  const city=room.map==='cidade-nevada'?buildCityArtPlan(index,cityArtOptions(room.search??'')):undefined;
  if(city){
    for(const s of city.sheets)if(s.key.startsWith('city:ground:'))add(s.url,'P0','ground');
    // The relief's ground albedo (relevo/baker.ts; not with ?chao=0): in before the first frame, so the ground does not
    // change under the players mid-match on a slow link.
    if(new URLSearchParams(room.search??'').get('chao')!=='0')add(ALBEDO_URL,'P0','ground');
  }
  else for(const url of ENDLESS_GROUND)add(url,'P0','ground');
  // The walk closes P0 (the first step walks); the attack opens P1 (cena-nasce-rapido: its 8 clips, ~2 MB, held the
  // ready button ~2 s on a slow phone; still fetched right after, behind the waiting room's countdown).
  const motion=heroMotionUrls(room.self);
  for(const url of motion)if(url.includes('.walk128-'))add(url,'P0','hero');
  for(const url of motion)if(!url.includes('.walk128-'))add(url,'P1','hero');
  // P1: teammates (sheet and class icon), enemies, base pieces.
  for(const id of new Set(room.others)){
    if(!id||id===room.self)continue;
    add(heroSheetUrl(id),'P1','hero');
    if(known(id))add(thumbUrl(id),'P1','icon');
  }
  // The level-up cards' stickers (hud/offer.ts: every passive, and the coxinha of a full build): the <img> of a card
  // asked for only when the window opens came in seconds late behind the city's stream, an empty frame (card
  // ofertas-sem-xp-e-icones: Cartão Fidelidade, Café Coado na Meia).
  for(const url of offerIconUrls())add(url,'P1','icon');
  // The crates' floating items (caixa-aparece-tarde): every arsenal sticker, which the scene's preload asks for in a room
  // (the map opens with crates of any item); fetched here, the first frame finds them in the cache.
  for(const l of arsenalLoads())if(!l.strip)add(l.url,'P1','icon');
  // The loader requests the enemies' lite copies (liteEnemyUrl): the same URLs here.
  const enemyPrefix=index.groups.inimigos?liteEnemyUrl(`/${index.groups.inimigos.output.replace(/^public\//,'')}/`):undefined;
  const horde=artLoads();
  for(const l of horde)if(enemyPrefix&&l.url.startsWith(enemyPrefix))add(l.url,'P1','enemy');
  for(const l of baseLoads())add(l.url,'P1','base');
  // P2: the city's pine (the scene's preload takes it), items/projectiles, frames and telegraph art.
  if(city)add(treeUrl('arvore-nevada'),'P2','decor');
  for(const l of horde)add(l.url,'P2','effect');
  for(const l of framesLoads())add(l.url,'P2','effect');
  for(const l of telegraphArtLoads())add(l.url,'P2','effect');
  return [...out.values()].sort((a,b)=>RANK[a.priority]-RANK[b.priority]);
}
/** English alias. */
export const matchAssets=assetsParaPartida;
/** Stable identity of a room's list (the waiting room restarts the preload only when it changes). */
export const matchKey=(room:Pick<MatchRoom,'self'|'others'|'map'>)=>
  JSON.stringify([room.self,[...new Set(room.others.filter(Boolean))].sort(),room.map,Object.keys(artIndex().groups).length]);
