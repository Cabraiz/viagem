/**
 * Imported art v2 → city materials (card NEW-20261012-ORQ-cidade-ligar-arte-v2). Pure: no Phaser, no DOM.
 * Reads the art index (art/manifest.ts) and decides which sheets the city loads, under which texture keys, which frame
 * and anchor each one draws with, and at which scale; the layer (city-layer.ts) only draws what this plan says and
 * keeps today's procedural drawing wherever the plan has nothing (an empty manifest gives an empty plan: no sheet is
 * loaded and the city draws exactly as before).
 *
 * Groups used (scripts/art-v2/spec.mjs):
 * - `predios`: 4-view sheets, meta {footprint:[a,b], ruin?, storeys?, framesPerView?}. The id's family (the name before
 *   the size/number) says what it is: `entulho` → rubble blocks; `muro-pedra`, `penhasco`, `portao` (walls, cliffs,
 *   gates: they need neighbour-aware pieces, not done yet) and the landmarks `arena`, `templo` are not used. Everything
 *   else is a building: ruined blocks take `ruin` pieces (intact ones when there are none), intact blocks the others.
 * - `props`: 4-view sheets, meta {prop:<family>}; PROP_FAMILIES maps the render prop kinds onto them (variants seeded
 *   by prop id).
 * - `base`: `chafariz-congelado` (footprint 3×3) stands on the fountain's water by the praça. The other base pieces
 *   (camp wall, nodes, forge, towers, loot box) belong to the run's structures, not to the city asset.
 * - `cenario` (E8, importar-cenario-novo): the new scenery's base sheets (`files.sheet`, 4 views), for the decor pieces the
 *   city asset lists (CityArtOptions.decor; decorRule says how each one stands and scales). Nests and ground decals of
 *   that group are the live layer's (live/art.ts), not loaded here.
 * - `chao`: kept OFF (GROUND_FROM_MANIFEST, D-038: the delivered ground is too smooth); when switched on the first
 *   `cidade-nevada/*` tile of each meta.ground kind loads as `city:ground:<kind>`, which the layer already paints.
 *
 * Building scale (D-037 asks 1 storey ≈ 2.3 u; the delivery draws 1 storey ≈ 1.2 u on the footprint's own grid):
 * - 'a': every building/rubble sheet is shown twice as large (ART_SCALE/2 instead of 1/ART_SCALE): 1 storey ≈ 2.4 u,
 *   and one footprint cell of the art covers 2×2 city cells (a "1x1" takes a 2×2 lot).
 * - 'b': as delivered (one art cell = one city cell).
 * Blocks are cut into lots (planLots) that each show one sheet; the cells no lot covers are filled with small pieces,
 * rubble or a low mound (fillLots): with the art on no building is drawn as the procedural brick column.
 */
import type {ArtFile,ArtGroup,ArtIndex,ArtPiece} from '../../art/manifest.ts';
import {groupFileUrl} from '../../art/manifest.ts';
import type {CityAsset,CityBlock,CityProp,GroundKind,PropKind} from './asset.ts';
import {hashId,type BlockPiece} from './chunks.ts';
import {ART_SCALE} from './materials.ts';
import {HEIGHT_PX,TILE_Y} from './projection.ts';

export type CityArtHeight='a'|'b';
/**
 * Building scale in use (see above); `?altura=a|b` overrides it for comparisons. Chosen with prints: 'b'. In the city
 * the hero is drawn at CITY_VIEW_SCALE (≈ 52 px ≈ 1.24 u tall), so the delivered storey (≈ 1.2 u) already reads as "about
 * a hero", which is what D-037 asks; 'a' makes a storey twice the hero and, since a 2×2-cell lot fits in no 1-cell-deep
 * block, leaves about a third of the building cells without a lot (low mounds, fillLots).
 */
export const CITY_ART_HEIGHT:CityArtHeight='b';
/** City cells per art footprint cell for each option. */
export const LOT_UNIT:Readonly<Record<CityArtHeight,1|2>>={a:2,b:1};
/**
 * Ground from the manifest: OFF until the next ground batch (D-038, card ligar-arte-v2 item 3). Turning it on needs
 * no other change: the plan then loads `city:ground:<kind>` and the layer paints those kinds.
 */
export const GROUND_FROM_MANIFEST=false;
/** The ground tiles of this map (ids `<mapa>/<material>-<n>`). */
const GROUND_MAP='cidade-nevada/';

/** predios families that are not building lots (see above). */
const UNUSED_FAMILIES=['muro-pedra','penhasco','portao','arena','templo'];
const RUBBLE_FAMILY='entulho';
/** Render prop kind → delivered prop families (meta.prop), variants chosen per prop id. */
export const PROP_FAMILIES:Readonly<Record<PropKind,readonly string[]>>={
  rubble:['rocha'],car:['carro-velho'],lamp:['poste'],pine:['arvore-nevada'],crate:['caixote'],barrel:['barril'],
  bench:['banco-praca'],
  debris:['placa-torta','sofa-calcada','carrinho-supermercado','cone-transito','bicicleta-presa-gelo','lixeira','isopor','tronco-caido'],
};
export const FOUNTAIN_PIECE='chafariz-congelado';
/**
 * The 2- and 4-view base sheets art/base-art.ts draws (its BASE_ART wall, barricade and junk wall; the crate has one view and ~50 KB):
 * their city lite copies keep the cell (cityLiteScale 1), so base-art swaps the url only. Not imported from base-art
 * so the plan (and scripts/art-lite.mjs) stays apart from the Stonewards renderer; tests/client/art-lite.test.ts checks both lists agree.
 */
export const BASE_LITE_PIECES:readonly string[]=['muralha-acampamento','barricada','muralha-tralha','muralha-tralha-pilar'];
/**
 * Prop sheets against the city hero (proporcoes-postes-predios; hero 1.75 m ≈ 1.245 u drawn): delivered at
 * 1/ART_SCALE they stood about twice too tall — the lamp 4.1× the hero, a barrel or a crate at its head. × 0.56 puts
 * the car about the hero's height, barrels, crates, benches and street junk at its waist or chest, the bent sign
 * ~1.4×; the lamp × 0.46, ~1.9× the hero (the Orquestrador's mark against the drawn houses).
 * The pines keep theirs (≈ 3.4×, a 6 m snowy pine) and so do the rocks (rubble piles).
 */
export const PROP_WORLD_SCALE:Readonly<Record<PropKind,number>>={lamp:.46,car:.56,crate:.56,barrel:.56,bench:.56,debris:.56,pine:1,rubble:1};

/**
 * One texture to load: a single-page sheet of `views` frames (or more: extra rows are other states, unused). The frame
 * size and the scale are the texture's: a lite copy's (cityTexture) when the file has one.
 */
export interface CitySheet {key:string;url:string;frameWidth:number;frameHeight:number;
  /** Image origin y (fraction of the frame) of the anchor line: the footprint's front corner, or a prop's feet. */
  originY:number;
  /** Footprint in art cells (buildings, rubble, the fountain), a ≥ b not required. */
  footprint?:[number,number];
  /** Height drawn above the anchor line, world units at the sheet's display scale (occluders, chunk bounds). */
  height:number;
  /** Display scale (game px per texture px). */
  scale:number;
  /** Texture px per art px: below 1 on a smaller lite copy (cityTexture). The anchors count in art px (frame / texel). */
  texel?:number}
/** Texture px per art px of a sheet (1 without a smaller lite copy). */
export const texelOf=(s:Pick<CitySheet,'texel'>)=>s.texel??1;

export interface CityArtPlan {
  height:CityArtHeight;
  /** City cells per art footprint cell. */
  unit:1|2;
  sheets:CitySheet[];
  /** Lot pools by block look. */
  buildings:{intact:CitySheet[];ruin:CitySheet[];rubble:CitySheet[]};
  props:Partial<Record<PropKind,CitySheet[]>>;
  fountain?:CitySheet;
  /** Ground texture per kind (only with GROUND_FROM_MANIFEST). */
  ground:Partial<Record<GroundKind,CitySheet>>;
  /** Base sheet of each decor id the map uses (`cenario` group), by id. */
  decor:Record<string,DecorSheet>;
}

/** The new scenery's art group (E8: public/art/city/decor). */
export const DECOR_GROUP='cenario';
/**
 * How a decor piece stands (the adapter's rules, scripts/art-v2/adaptar/decor.mjs ruleOf):
 * - 'footprint' (buildings with storeys, places, mountains, cliffs, ramps): the footprint's front corner on the anchor,
 *   one art cell (ART_CELL) per city cell, like the building lots;
 * - 'wall' (the 6 wall and fence families): centred on its cell, the lowest row on the anchor;
 * - 'prop' (objects, poles): feet on the anchor at the footprint's centre.
 */
export type DecorRule='footprint'|'wall'|'prop';
export interface DecorSheet extends CitySheet {rule:DecorRule;
  /** Drawn over its cells instead of the procedural piece there ('footprint', 'wall' and the DECOR_FILL objects). */
  covers:boolean}
/**
 * Objects that fill a whole block cell (the boulders on the border band, maps/city-decor.ts): an object anchored on its
 * feet, at the footprint scale (one art cell per city cell) instead of the props' one, so the cell reads as rock.
 */
export const DECOR_FILL=/^pedregulho-\d+$/;
export const DECOR_WALL_FAMILIES=['alambrado','cerca-madeira','grade','muro-condominio','muro-pichado','tapume'] as const;
const DECOR_FOOTPRINT=/^(ninho-|montanha-|morro-|penhasco|rampa$|ponte$|cachoeira-)/;
export function decorRule(id:string,meta?:Record<string,unknown>):DecorRule{
  if(DECOR_WALL_FAMILIES.some(f=>id.startsWith(`${f}-`)))return 'wall';
  return Number.isInteger(meta?.storeys)||DECOR_FOOTPRINT.test(id)?'footprint':'prop';
}
/**
 * Walls and objects are drawn at their delivered height (hero ≈ 2.3 u, like the props: scripts/art-v2/adaptar
 * WORLD_HEIGHT and DECOR_HEIGHT) times the props' city factor (PROP_WORLD_SCALE: the city hero is ≈ 1.24 u).
 * To check on the prints of the city with the delivery.
 */
export const DECOR_PROP_SCALE=.56;
const NEST_ID=/^ninho-[a-z]+-(ativo|dormindo|destruido)$/;
/** Ground decals (live/rules.ts isDecal; repeated here so the plan does not import the live layer). */
const DECAL_ID=/^(bueiro|faixa-pedestre|mancha-oleo|pegadas-\d+|poca-congelada-\d+|rachadura-\d+)$/;

export interface CityArtOptions {height?:CityArtHeight;ground?:boolean;
  /** false = no art at all (`?arte=0`). */
  enabled?:boolean;
  /**
   * World units per city cell the lots stand on (the asset's unitsPerCell; default ART_CELL, the art's own cell). The
   * footprint sheets (buildings, rubble, the fountain) are drawn cell / ART_CELL larger so one art cell still covers one
   * city cell: on the 1.7× Cidade Nevada (1.496 u, NEW-20261013-ORQ-cidade-escala-1-7) the buildings grow 1.7×. Props
   * keep their absolute size (PROP_WORLD_SCALE), whatever the cell.
   */
  cell?:number;
  /** Decor ids the map uses (the asset's `decor`): only their sheets load. None: no decor sheet. */
  decor?:Iterable<string>}

/** `?arte=0` (no art) and `?altura=a|b` from a query string. */
export function cityArtOptions(search:string):CityArtOptions{
  const p=new URLSearchParams(search),h=p.get('altura');
  return {enabled:p.get('arte')!=='0',...(h==='a'||h==='b'?{height:h}:{})};
}

/** Family of a piece id: the name before its size (`casa-terrea-2x1-3` → `casa-terrea`) or number (`arena-1`). */
export const pieceFamily=(id:string)=>id.replace(/(-\d+x\d+)?(-\d+)?$/,'');
const footprintOf=(p:ArtPiece):[number,number]|undefined=>{
  const f=p.meta?.footprint;
  return Array.isArray(f)&&f.length===2&&f.every(n=>Number.isInteger(n)&&n>0&&n<=8)?[f[0] as number,f[1] as number]:undefined;
};
/** The 4-view sheet of a piece: one file, one page, at least 4 frames. */
function viewSheet(p:ArtPiece,minViews=4):ArtFile|undefined{
  const f=p.files.sheet??Object.values(p.files)[0];
  if(!f||!f.file||(f.views??0)<minViews||(f.pages&&f.pages.length>1))return undefined;
  return f;
}
/**
 * City lite copies (scripts/art-lite.mjs, NEW-20261021-E1-decor-lite-arte-perto): the sheet of a piece the city draws
 * (the plan's lots, props, fountain and decor, and the nests of the live layer) that weighs over ~200 KB has a smaller
 * lossy copy under /art/lite/city/ (cityLiteScale), its cell in the file's `liteCell`. Which file of a piece gets one: its view sheet,
 * for the pieces the plan or the nests can draw, and the base's wall and barricades (art/base-art.ts loads them in the
 * city's preload, NEW-20261021-E1-base-lite-muralha); unused building families and the other base pieces never load.
 * Undefined: none.
 */
export function cityLiteFile(group:string,id:string,p:ArtPiece):string|undefined{
  // base: the junk wall has 2 views (the two diagonals, base-art BASE_ART.muralha).
  if(!viewSheet(p,group==='base'?2:4))return undefined;
  if(group==='predios'&&UNUSED_FAMILIES.some(u=>pieceFamily(id)===u||pieceFamily(id).startsWith(`${u}-`)))return undefined;
  if(group==='base'&&id!==FOUNTAIN_PIECE&&!BASE_LITE_PIECES.includes(id))return undefined;
  if(group!=='predios'&&group!=='base'&&group!=='props'&&group!==DECOR_GROUP)return undefined;
  return p.files.sheet?'sheet':Object.keys(p.files)[0];
}
/**
 * Cell scale of a piece's city lite copy (scripts/art-lite.mjs): 1 (the same cell, lossy only) for the pieces drawn at
 * the footprint scale (0.85 game px per art px on the Cidade Nevada: buildings, places, mountains, the fountain, the
 * border boulders); 0.75 for those drawn smaller (props, walls, nests: ≤ 0.63), as sharp on screen. The towers' 0.5
 * left the houses visibly softer on the prints: the canvas has the page's CSS size, a 3× phone screen magnifies it.
 */
export function cityLiteScale(group:string,id:string,p:Pick<ArtPiece,'meta'>):number{
  if(group==='predios'||group==='base')return 1;
  if(group===DECOR_GROUP&&!NEST_ID.test(id)&&(decorRule(id,p.meta)==='footprint'||DECOR_FILL.test(id)))return 1;
  return .75;
}
/**
 * Every file of a piece with a city lite copy, and its cell scale: the view sheet (cityLiteFile, cityLiteScale) and, in
 * the decor, the live layer's loops (`anim`, `anim-<name>`: live/art.ts), those at their own cell (lossy only: the live
 * layer places them in art px of the base cell).
 */
export function cityLiteFiles(group:string,id:string,p:ArtPiece):{name:string;scale:number}[]{
  const sheet=cityLiteFile(group,id,p),out=sheet?[{name:sheet,scale:cityLiteScale(group,id,p)}]:[];
  if(group===DECOR_GROUP)for(const [name,f] of Object.entries(p.files))
    if((name==='anim'||name.startsWith('anim-'))&&f.file&&!(f.pages&&f.pages.length>1))out.push({name,scale:1});
  return out;
}
export const cityLiteUrl=(url:string)=>url.replace(/^\/art\/city\//,'/art/lite/city/');
/**
 * What the city loads for a file: its lite copy (url, cell and texture px per art px) when the file has `liteCell`,
 * else the file. `scale` (game px per art px) comes back per texture px. A lite copy that fails keeps its mound or
 * stays undrawn (art/horde-art.ts liteOnly): the approved file has other cells.
 */
export function cityTexture(group:ArtGroup,f:ArtFile,scale:number):Pick<CitySheet,'url'|'frameWidth'|'frameHeight'|'scale'|'texel'>{
  const url=groupFileUrl(group,f.file!),lite=f.liteCell;
  if(!lite)return {url,frameWidth:f.cell[0],frameHeight:f.cell[1],scale};
  const texel=lite[0]/f.cell[0];
  return {url:cityLiteUrl(url),frameWidth:lite[0],frameHeight:lite[1],scale:scale/texel,texel};
}

const originYOf=(f:ArtFile,bottomPx:number)=>{
  const y=f.anchor?.[1];
  return typeof y==='number'&&y>0&&y<=1?y:1-bottomPx/f.cell[1];
};
/** World height drawn above the front corner of a footprint sheet (its back corner sits (A+B)·TILE_Y higher). */
export function sheetHeight(frameHeight:number,originY:number,footprint:[number,number],cell:number,scale:number):number{
  const backPx=(footprint[0]+footprint[1])*cell*TILE_Y*ART_SCALE;
  return Math.max(0.3,(frameHeight*originY-backPx)*scale/HEIGHT_PX);
}

/**
 * Cell size the art is drawn for (materials.ts convention: D-026 0.88 u, the .w3x cell). It converts footprints to art
 * pixels (sheetHeight, buildingAnchor's origin), so it stays 0.88 on a bigger map; CityArtOptions.cell scales the display.
 */
export const ART_CELL=0.88;

const empty=(height:CityArtHeight):CityArtPlan=>({height,unit:LOT_UNIT[height],sheets:[],buildings:{intact:[],ruin:[],rubble:[]},props:{},ground:{},decor:{}});

/** Builds the plan from an art index. Deterministic: pieces in id order. */
export function buildCityArtPlan(index:ArtIndex,options:CityArtOptions={}):CityArtPlan{
  const height=options.height??CITY_ART_HEIGHT,plan=empty(height);
  if(options.enabled===false)return plan;
  const cell=options.cell??ART_CELL;
  if(!(cell>0))throw new RangeError(`city art cell must be > 0, got ${String(cell)}`);
  // Footprint sheets: one art cell (ART_CELL) on `unit` city cells of `cell` u; props as delivered × PROP_WORLD_SCALE.
  const unit=plan.unit,big=unit/ART_SCALE*cell/ART_CELL,small=1/ART_SCALE;
  const each=(g:ArtGroup|undefined)=>g?Object.keys(g.pieces).sort().map(id=>[id,g.pieces[id]] as const):[];
  const predios=index.groups.predios,props=index.groups.props,base=index.groups.base,chao=index.groups.chao;
  const footprintSheet=(group:ArtGroup,key:string,p:ArtPiece,f:ArtFile,fp:[number,number]):CitySheet=>{
    const originY=originYOf(f,16);
    return {key,...cityTexture(group,f,big),originY,footprint:fp,height:sheetHeight(f.cell[1],originY,fp,ART_CELL,big)};
  };
  for(const [id,p] of each(predios)){
    const fam=pieceFamily(id),fp=footprintOf(p),f=viewSheet(p);
    if(!fp||!f||UNUSED_FAMILIES.some(u=>fam===u||fam.startsWith(`${u}-`)))continue;
    const pool=fam===RUBBLE_FAMILY?'rubble':p.meta?.ruin===true?'ruin':'intact';
    const prefix=pool==='rubble'?'city:rubble':'city:building';
    const s=footprintSheet(predios!,`${prefix}:${fp[0]}x${fp[1]}${pool==='ruin'?'-ruin':''}/${id}`,p,f,fp);
    plan.buildings[pool].push(s);plan.sheets.push(s);
  }
  const byFamily=new Map<string,{id:string;p:ArtPiece;f:ArtFile}[]>();
  for(const [id,p] of each(props)){
    const fam=typeof p.meta?.prop==='string'?p.meta.prop as string:pieceFamily(id),f=viewSheet(p);
    if(!f)continue;
    const list=byFamily.get(fam)??[];list.push({id,p,f});byFamily.set(fam,list);
  }
  for(const kind of Object.keys(PROP_FAMILIES).sort() as PropKind[]){
    const out:CitySheet[]=[];
    for(const fam of PROP_FAMILIES[kind])for(const {id,f} of byFamily.get(fam)??[]){
      const originY=originYOf(f,8);
      const scale=small*PROP_WORLD_SCALE[kind];
      const s:CitySheet={key:`city:prop:${kind}/${id}`,...cityTexture(props!,f,scale),originY,height:f.cell[1]*originY*scale/HEIGHT_PX};
      out.push(s);plan.sheets.push(s);
    }
    if(out.length)plan.props[kind]=out;
  }
  const fountain=base?.pieces[FOUNTAIN_PIECE],ff=fountain&&viewSheet(fountain),ffp=fountain&&footprintOf(fountain);
  if(base&&fountain&&ff&&ffp){plan.fountain=footprintSheet(base,`city:base:${FOUNTAIN_PIECE}`,fountain,ff,ffp);plan.sheets.push(plan.fountain);}
  if(options.ground??GROUND_FROM_MANIFEST)for(const [id,p] of each(chao)){
    const kind=p.meta?.ground as GroundKind|undefined,f=p.files.sheet??Object.values(p.files)[0];
    if(!kind||!id.startsWith(GROUND_MAP)||plan.ground[kind]||!f?.file||p.meta?.mask)continue;
    const s:CitySheet={key:`city:ground:${kind}`,url:groupFileUrl(chao!,f.file),frameWidth:f.cell[0],frameHeight:f.cell[1],originY:0,height:0,scale:1};
    plan.ground[kind]=s;plan.sheets.push(s);
  }
  const cenario=index.groups[DECOR_GROUP];
  if(cenario)for(const id of [...new Set(options.decor??[])].sort()){
    const p=cenario.pieces[id],f=p&&viewSheet(p);
    if(!p||!f||NEST_ID.test(id)||DECAL_ID.test(id))continue;
    const rule=decorRule(id,p.meta),key=`city:decor:${id}`;
    let s:DecorSheet;
    if(rule==='footprint'){
      const fp=footprintOf(p)??[1,1];
      s={...footprintSheet(cenario,key,p,f,fp),rule,covers:true};
    }else{
      const fill=rule==='prop'&&DECOR_FILL.test(id),originY=originYOf(f,rule==='wall'?16:8),scale=fill?big:small*DECOR_PROP_SCALE;
      s={key,...cityTexture(cenario,f,scale),originY,height:f.cell[1]*originY*scale/HEIGHT_PX,rule,covers:rule==='wall'||fill};
    }
    plan.decor[id]=s;plan.sheets.push(s);
  }
  return plan;
}

/** True when the plan paints anything (an empty manifest, or `arte=0`, gives false). */
export const planHasArt=(plan:CityArtPlan|undefined)=>!!plan&&plan.sheets.length>0;
/**
 * True when the plan has building or rubble sheets (any lot pool). Without them (a manifest of props, ground or the
 * fountain only) the blocks keep the procedural columns: no fill, no mounds (a whole city of mounds would read as
 * invisible walls).
 */
export const planHasBuildingArt=(plan:CityArtPlan|undefined)=>{
  const b=plan?.buildings;
  return !!b&&b.intact.length+b.ruin.length+b.rubble.length>0;
};

/** One sheet on a rectangle of a block (cells), turned by `turns` quarter turns (materials.ts buildingFrame). */
export interface CityLot {id:string;blockId:string;x:number;y:number;w:number;h:number;sheet:CitySheet;
  /** Footprint a×b of the sheet in its own orientation (art cells). */
  a:number;b:number;turns:number;
  /** Drawn height above the block base (world units): at least the block's own. */
  height:number}

/** Lot pool of a block: rubble blocks → rubble pieces, ruins → ruin pieces (intact without any), buildings → intact. */
export function lotPool(block:Pick<CityBlock,'kind'|'ruined'>,plan:CityArtPlan):CitySheet[]{
  const b=plan.buildings;
  if(block.kind==='rubble')return b.rubble;
  if(block.kind!=='building')return [];
  return block.ruined&&b.ruin.length?b.ruin:b.intact;
}

/** Footprint shapes of a pool in both orientations (art cells), largest area first, then widest. */
function poolShapes(pool:readonly CitySheet[]):{w:number;h:number}[]{
  const shapes=new Map<string,{w:number;h:number}>();
  for(const s of pool){const [a,b]=s.footprint!;shapes.set(`${a}x${b}`,{w:a,h:b});shapes.set(`${b}x${a}`,{w:b,h:a});}
  return [...shapes.values()].sort((p,q)=>q.w*q.h-p.w*p.h||q.w-p.w);
}
/** A lot of `shape` (art cells, as laid on the block) at cell (x,y): a seeded variant of that footprint and its turns. */
function seededLot(block:CityBlock,pool:readonly CitySheet[],shape:{w:number;h:number},seed:number,x:number,y:number,u:number,id:string):CityLot{
  const variants=pool.filter(s=>{const [a,b]=s.footprint!;return (a===shape.w&&b===shape.h)||(a===shape.h&&b===shape.w);});
  const sheet=variants[(seed>>>3)%variants.length],[a,b]=sheet.footprint!;
  const turns=a===b?(seed>>>7)%4:a===shape.w?2*((seed>>>7)%2):1+2*((seed>>>7)%2);
  return {id,blockId:block.id,x,y,w:shape.w*u,h:shape.h*u,sheet,a,b,turns,height:Math.max(block.height,sheet.height)};
}

/**
 * Cuts a block into lots (the city's lot planner): the block is a grid of floor(w/unit) × floor(h/unit) lot units,
 * filled row by row; each free unit takes, among the pool footprints (either orientation) that fit in the free space,
 * one seeded by the block id and position among those at least half the area of the largest fit; then a variant of
 * that footprint seeded the same way, and its turns (exact orientation → 0 or 2, swapped → 1 or 3, square → 0..3).
 * Leftover cells (the last unit < `unit` cells, or units no footprint fits) are for the fill pass (fillLots). Pure and
 * deterministic.
 */
export function planLots(block:CityBlock,plan:CityArtPlan):CityLot[]{
  const pool=lotPool(block,plan),u=plan.unit;
  if(!pool.length)return [];
  const W=Math.floor(block.w/u),H=Math.floor(block.h/u);
  if(W<1||H<1)return [];
  const fits=poolShapes(pool);
  const used=new Uint8Array(W*H),out:CityLot[]=[];
  const free=(i:number,j:number,w:number,h:number)=>{
    if(i+w>W||j+h>H)return false;
    for(let y=j;y<j+h;y++)for(let x=i;x<i+w;x++)if(used[y*W+x])return false;
    return true;
  };
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){
    if(used[j*W+i])continue;
    const ok=fits.filter(f=>free(i,j,f.w,f.h));
    if(!ok.length)continue;
    const seed=hashId(`${block.id}@${i},${j}`),max=ok[0].w*ok[0].h,pick=ok.filter(f=>f.w*f.h*2>=max);
    const shape=pick[seed%pick.length];
    for(let y=j;y<j+shape.h;y++)for(let x=i;x<i+shape.w;x++)used[y*W+x]=1;
    out.push(seededLot(block,pool,shape,seed,block.x+i*u,block.y+j*u,u,`${block.id}/${out.length}`));
  }
  return out;
}

/** Largest footprint (art cells) a fill lot may take: the 1×1 and 1×2 pieces (BUG-20261013-ORQ-predios-procedurais-fora). */
export const FILL_MAX_AREA=2;
/**
 * Height (world units) of the low snow-and-debris mound a building or rubble cell is drawn as when no art shows on
 * it: a cell no piece fits (last resort of fillLots), or a lot whose texture has not arrived yet. As low as the maps'
 * rubble blocks (from-maps.ts RUBBLE_HEIGHT), whatever the cell size: the procedural brick column is never drawn
 * with the art on. The collision does not change (the cell stays solid; the mound marks it).
 */
export const MOUND_HEIGHT=0.3;

/** What a block shows with the art on: its lots (planLots, then the fill lots) and the cells left as low mounds. */
export interface BlockArt {lots:CityLot[];
  /** Cells (grid x, y) no lot covers: drawn as the low mound (MOUND_HEIGHT), never as the procedural building. */
  mounds:{x:number;y:number}[]}

/**
 * Fill pass over the cells planLots leaves (BUG-20261013-ORQ-predios-procedurais-fora), in grid cells (a lot of an
 * a×b footprint takes a·unit × b·unit cells, whatever the cell size in world units). Each free cell, row by row,
 * takes the first pool with a piece that fits with its top-left corner there (in a pool the largest such footprint,
 * ties seeded by block id and cell):
 * 1. a building piece of at most FILL_MAX_AREA art cells (any turn), the block's own look first (the ruin pool for
 *    ruins, the intact one for buildings), then the other building pool — buildings only;
 * 2. a rubble (`entulho`) piece of at most FILL_MAX_AREA art cells, low — buildings and rubble blocks;
 * 3. else the cell is a mound (MOUND_HEIGHT).
 * Walls, cliffs and gates get nothing (they keep their procedural look), and so does every block of a plan without
 * building art (planHasBuildingArt). The planLots lots are kept as they are, except those touching a `reserved` cell.
 * `reserved` (grid cells another piece of art stands on — the praça's fountain, fountainLot): no lot covers them and
 * they are no mound either; the piece drawn there covers them (bug: a ruin was filled over the fountain's basin).
 * Pure and deterministic.
 */
export function fillLots(block:CityBlock,plan:CityArtPlan,lots:readonly CityLot[],reserved?:(x:number,y:number)=>boolean):BlockArt{
  const touches=(l:CityLot)=>{if(reserved)for(let y=l.y;y<l.y+l.h;y++)for(let x=l.x;x<l.x+l.w;x++)if(reserved(x,y))return true;return false;};
  const out:BlockArt={lots:lots.filter(l=>!touches(l)),mounds:[]};
  if((block.kind!=='building'&&block.kind!=='rubble')||!planHasBuildingArt(plan))return out;
  const u=plan.unit,{x:bx,y:by,w:W,h:H}=block,used=new Uint8Array(W*H);
  for(const l of out.lots)for(let y=l.y;y<l.y+l.h;y++)for(let x=l.x;x<l.x+l.w;x++)used[(y-by)*W+(x-bx)]=1;
  if(reserved)for(let j=0;j<H;j++)for(let i=0;i<W;i++)if(reserved(bx+i,by+j))used[j*W+i]=1;
  const small=(pool:readonly CitySheet[])=>pool.filter(s=>s.footprint![0]*s.footprint![1]<=FILL_MAX_AREA);
  const b=plan.buildings,own=block.kind==='building'?(block.ruined?b.ruin:b.intact):[];
  const other=block.kind==='building'?(block.ruined?b.intact:b.ruin):[];
  // Pools in order: the block's own look, the other building look, rubble.
  const stages=[small(own),small(other),small(b.rubble)].filter(p=>p.length).map(pool=>({pool,shapes:poolShapes(pool)}));
  const free=(i:number,j:number,w:number,h:number)=>{
    if(i+w>W||j+h>H)return false;
    for(let y=j;y<j+h;y++)for(let x=i;x<i+w;x++)if(used[y*W+x])return false;
    return true;
  };
  let n=0;
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){
    if(used[j*W+i])continue;
    const seed=hashId(`${block.id}@f${i},${j}`);
    let placed=false;
    for(const stage of stages){
      const pool=stage.pool,shapes=stage.shapes.filter(f=>free(i,j,f.w*u,f.h*u));
      if(!shapes.length)continue;
      const max=shapes[0].w*shapes[0].h,pick=shapes.filter(f=>f.w*f.h===max),shape=pick[seed%pick.length];
      for(let y=j;y<j+shape.h*u;y++)for(let x=i;x<i+shape.w*u;x++)used[y*W+x]=1;
      out.lots.push(seededLot(block,pool,shape,seed,bx+i,by+j,u,`${block.id}/f${n++}`));
      placed=true;break;
    }
    if(!placed){used[j*W+i]=1;out.mounds.push({x:bx+i,y:by+j});}
  }
  return out;
}

/**
 * A building or rubble piece as the low mound (BlockArt.mounds, or a lot whose texture is still loading): the rubble
 * look (palette entulho, snow icing from pieceDecor) at MOUND_HEIGHT (never above the block), no ruin roof steps or
 * bite. `seams` = which sides touch another mound of the same block (no wall face there); the sides toward an art lot
 * keep their wall.
 */
export function moundPiece(piece:BlockPiece,seams:BlockPiece['seams']):BlockPiece{
  return {id:piece.id,blockId:piece.blockId,kind:'rubble',x:piece.x,y:piece.y,w:piece.w,h:piece.h,
    height:Math.min(piece.height,MOUND_HEIGHT),base:piece.base,seams:{...seams}};
}

/** A block's art with the art on: planLots, then the fill pass (fillLots). */
export const blockArt=(block:CityBlock,plan:CityArtPlan,reserved?:(x:number,y:number)=>boolean):BlockArt=>
  fillLots(block,plan,planLots(block,plan),reserved);
/** Grid cells under a lot (the fountain's footprint), as a `reserved` test for fillLots/blockArt. */
export const lotCells=(lot:CityLot|undefined)=>(x:number,y:number)=>!!lot&&x>=lot.x&&x<lot.x+lot.w&&y>=lot.y&&y<lot.y+lot.h;

/** Prop sheet of a prop (variant seeded by its id), or undefined (procedural / the approved pine sheet). */
export function propSheet(prop:Pick<CityProp,'id'|'kind'>,plan:CityArtPlan):CitySheet|undefined{
  const list=plan.props[prop.kind];
  return list?.length?list[hashId(prop.id)%list.length]:undefined;
}

/**
 * The frozen fountain (base piece) as a lot: centred on the water cells within FOUNTAIN_SEARCH_CELLS of the praça
 * (their bounding box), footprint × unit cells. Undefined without the piece or without water there.
 */
export const FOUNTAIN_SEARCH_CELLS=10;
export function fountainLot(asset:CityAsset,plan:CityArtPlan):CityLot|undefined{
  const s=plan.fountain,praca=asset.points.praca;
  if(!s||!praca)return undefined;
  const pcx=Math.floor((praca.x-asset.origin.x)/asset.cell),pcy=Math.floor((praca.y-asset.origin.y)/asset.cell),r=FOUNTAIN_SEARCH_CELLS;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let cy=Math.max(0,pcy-r);cy<=Math.min(asset.height-1,pcy+r);cy++)for(let cx=Math.max(0,pcx-r);cx<=Math.min(asset.width-1,pcx+r);cx++)
    if(asset.ground[cy*asset.width+cx]==='w'){x0=Math.min(x0,cx);y0=Math.min(y0,cy);x1=Math.max(x1,cx+1);y1=Math.max(y1,cy+1);}
  if(!(x1>x0))return undefined;
  const [a,b]=s.footprint!,w=a*plan.unit,h=b*plan.unit;
  const x=Math.round((x0+x1-w)/2),y=Math.round((y0+y1-h)/2);
  return {id:`fountain/${FOUNTAIN_PIECE}`,blockId:`fountain/${FOUNTAIN_PIECE}`,x,y,w,h,sheet:s,a,b,turns:0,height:s.height};
}
