/**
 * Muralha de tralha on the map (NEW-20261021-ORQ-muralha-tralha-no-jogo): the images of each free barricade square,
 * as muralha-rules.ts plans them (a whole straight piece, or halves toward the neighbours + a pillar), from the base
 * sheets BASE_ART.muralha / .pilar. StonewardsRenderer asks it first for a free square; while the sheets are missing or
 * not loaded it answers undefined and the square keeps today's art (the sofa / sandbag pile).
 * The built muro (fortify.ts) wears its own sheets (MURO_SHEETS, card trocar-procedurais-por-arte) through the same layer.
 */
import type Phaser from 'phaser';
import type {StructureView} from '../../contract/index.ts';
import {CITY_BUILD_CELL} from '../../maps/index.ts';
import {BARRICADA_CELLS} from '../../rules/index.ts';
import {artPiece} from '../art/manifest.ts';
import {BASE_ART,baseFile,baseFrame,type BaseFrameRef} from '../art/base-art.ts';
import type {Pt} from './projector.ts';
import {MURALHA_GROSSURA,cellKey,hashCell,retoOf,muralhaColumn,muralhaEstado,muralhaGroups,muralhaHalf,muralhaPlan,muralhaScale,type MuralhaAxis,type MuralhaCounts} from './muralha-rules.ts';

/**
 * The two sheets a wall draws from: straight pieces and pillars (base ids); `size`: the cells a square's side spans
 * (absent: 1), its neighbours that many cells away and its pieces drawn that many times wider and taller; `thick`: each
 * straight piece is drawn twice, once this share of the square's side behind the wall's line and once in front of it
 * (absent: once, on the line): a thicker wall, just as long. `oriented` (the barricadas since barricada-tocar-no-mapa):
 * a piece is `size` cells long and 1 thick along its rot and always draws one whole straight piece along it (no halves,
 * no pillars: its ends are its footprint's, end to end with the next one).
 */
export interface MuralhaSheets {reto:string;pilar:string;size?:number;thick?:number;oriented?:boolean}
/**
 * The junk wall of the free barricadas (the default): pieces BARRICADA_CELLS long and 1 thick along their rot
 * (barricada-tocar-no-mapa; the sim's blocker follows the same line), thicker across it (barricada-grossura-e-contorno,
 * user 24/10: "mais gordinha" without growing longer).
 */
export const TRALHA_SHEETS:MuralhaSheets=Object.freeze({reto:BASE_ART.muralha,pilar:BASE_ART.pilar,size:BARRICADA_CELLS,thick:MURALHA_GROSSURA,oriented:true});
/** The built muro (fortify.ts, card trocar-procedurais-por-arte): cinder blocks, same template and rules, 1-cell squares. */
export const MURO_SHEETS:MuralhaSheets=Object.freeze({reto:BASE_ART.muro,pilar:BASE_ART.muroPilar});
/** Rows of a straight piece: across the wall's line, in share of `thick` (behind first, so the front one covers it). */
const ROWS_THICK=[-1,1] as const,ROWS_ONE=[0] as const;
/** Halves sit a little over their square's depth toward the neighbour; the pillar over both (it covers the joint). */
const PILLAR_OVER=.002;
/** Share of a straight frame's height over the ground centre that the whole wall fills at its middle (the rest is the far end rising). */
const RETO_TOP=.76;
/** About the share of the height each damage row keeps (scripts/import-muralha-tralha.mjs BITES), for the bar. */
const KEPT:Readonly<Record<string,number>>={inteira:1,avariada:.75,'quase-caindo':.5};

export interface MuralhaProjection {project(x:number,y:number,out:Pt):Pt;depth(x:number,y:number):number}
interface Sheet {pecas:readonly string[];celula:number;anchor:[number,number];cell:[number,number]}

function sheetOf(id:string):Sheet|undefined{
  const meta=artPiece('base',id)?.meta,file=baseFile(id);
  const pecas=meta?.pecas,celula=meta?.celula;
  if(!file||!Array.isArray(pecas)||typeof celula!=='number'||!(celula>0))return undefined;
  return {pecas:pecas as string[],celula,anchor:file.anchor??[.5,.75],cell:file.cell};
}

export class MuralhaLayer {
  private images=new Map<string,Phaser.GameObjects.Image[]>();
  private cells=new Set<string>();
  /** The wall (muralha-rules muralhaGroups) of each standing square, by cellKey: one gold outline per wall. */
  private groups=new Map<string,number>();
  private a:Pt={x:0,y:0};private b:Pt={x:0,y:0};
  private ref:BaseFrameRef={key:'',frame:0};
  /** Screen y of the top of the last square drawn (a whole wall's middle, or its pillar): where its life bar goes. */
  top=0;
  /**
   * `sheets`: which wall (the junk wall by default); `cell`: the build grid's cell (world units) the squares' c/r count in
   * (the city's CITY_BUILD_CELL by default).
   */
  constructor(private scene:Phaser.Scene,private projection:MuralhaProjection,private sheets:MuralhaSheets=TRALHA_SHEETS,private cell=CITY_BUILD_CELL){}

  /** Pieces in each sheet (meta.pecas), for muralhaPlan. */
  private counts():MuralhaCounts{
    return {retos:sheetOf(this.sheets.reto)?.pecas.length??0,pilares:sheetOf(this.sheets.pilar)?.pecas.length??0};
  }
  /** Both sheets are in the manifest and their textures are loaded. */
  ready():boolean{
    for(const id of [this.sheets.reto,this.sheets.pilar]){
      const s=sheetOf(id),f=s&&baseFrame(id,`${s.pecas[0]}:inteira`,0,0,this.ref);
      if(!f||!this.scene.textures.exists(f.key))return false;
    }
    return true;
  }
  /** The free barricade squares standing in this view: who is whose neighbour. */
  setSquares(squares:readonly Pick<StructureView,'c'|'r'|'hp'>[]){
    this.cells.clear();
    for(const s of squares)if(s.c!==undefined&&s.r!==undefined&&s.hp>0)this.cells.add(cellKey(s.c,s.r));
    this.groups=muralhaGroups(this.cells,this.sheets.size??1);
  }
  /** The wall square `s` belongs to (usable-glow.ts WallGlow), or its own id when it is not standing. */
  groupOf(s:Pick<StructureView,'id'|'c'|'r'>):number|string{
    return s.c===undefined||s.r===undefined?s.id:this.groups.get(cellKey(s.c,s.r))??s.id;
  }
  /**
   * Places the images of free square `s` (its ground centre, `depth` = its art depth) and returns them, [] when it is
   * down; undefined (its images hidden) without the sheets: the caller draws today's art.
   */
  draw(s:StructureView,depth:number):Phaser.GameObjects.Image[]|undefined{
    const list=this.images.get(s.id)??[];
    if(s.c===undefined||s.r===undefined||!this.ready()){for(const i of list)i.setVisible(false);return undefined;}
    this.images.set(s.id,list);
    const size=this.sheets.size??1,thick=this.sheets.thick??0,estado=muralhaEstado(s.hp,s.maxHp),oriented=!!this.sheets.oriented,along:MuralhaAxis=s.rot===1?'r':'c';
    const plan=!estado?[]:oriented?[{kind:'reto' as const,piece:retoOf(s.c,s.r,along,this.counts().retos,size),axis:along}]:muralhaPlan({c:s.c,r:s.r,rot:s.rot},this.cells,this.counts(),size);
    const rowsOf=(kind:'reto'|'pilar')=>kind==='reto'&&thick>0?ROWS_THICK:ROWS_ONE;
    let count=0;for(const d of plan)count+=rowsOf(d.kind).length;
    while(list.length<count)list.push(this.scene.add.image(0,0,'__DEFAULT').setName(`base-${this.sheets.reto}`));
    for(let i=count;i<list.length;i++)list[i].setVisible(false);
    // The square's side (u) and ground centre: its pieces span the side (barricada-2x: 2 cells for the junk wall).
    // An oriented piece is 1 cell thick across its line: its ground centre is its footprint's.
    const pr=this.projection,side=this.cell*size,cx=s.c*this.cell+(oriented&&along==='r'?this.cell:side)/2,cy=s.r*this.cell+(oriented&&along==='c'?this.cell:side)/2,base=pr.depth(cx,cy)-depth;
    // How much deeper the front row sits than the line (either axis): the pillar stays over it.
    const lift=thick>0?Math.abs(pr.depth(cx+thick*side,cy)-pr.depth(cx,cy))+Math.abs(pr.depth(cx,cy+thick*side)-pr.depth(cx,cy)):0;
    this.top=pr.project(cx,cy,this.a).y;
    let n=0;
    for(const d of plan)for(const row of rowsOf(d.kind)){
      const img=list[n++],id=this.sheets[d.kind],sheet=sheetOf(id)!;
      // This row's ground centre: shifted across the wall's line (world: the other axis) by `thick` of the side.
      const axis:MuralhaAxis=d.axis??'c',across=row*thick*side,gx=cx+(axis==='r'?across:0),gy=cy+(axis==='c'?across:0);
      const at=pr.project(gx,gy,this.a),x=at.x,y=at.y;
      const step=pr.project(gx+(axis==='c'?side:0),gy+(axis==='r'?side:0),this.b),dx=step.x-x,dy=step.y-y;
      const col=d.kind==='reto'?muralhaColumn(dx,dy):hashCell(s.c!,s.r!,7)&1;
      const f=baseFrame(id,`${sheet.pecas[d.piece]}:${estado}`,col,0,this.ref);
      if(!f){img.setVisible(false);continue;}
      if(img.texture.key!==f.key)img.setTexture(f.key,f.frame);else img.setFrame(f.frame);
      const k=muralhaScale(dx,sheet.celula);
      img.setOrigin(sheet.anchor[0],sheet.anchor[1]).setScale(k.x,k.y).setPosition(x,y).setVisible(true);
      this.top=Math.min(this.top,y-sheet.cell[1]*sheet.anchor[1]*k.y*(d.kind==='pilar'?1:RETO_TOP)*(KEPT[estado!]??1));
      if(d.kind==='pilar'){img.setCrop();img.setDepth(depth+lift+PILLAR_OVER);continue;}
      // Half toward the neighbour: the frame's side of the ground centre that faces it on screen, a quarter side toward it.
      const q=d.toward===undefined?0:side/4*d.toward;
      img.setDepth(pr.depth(gx+(axis==='c'?q:0),gy+(axis==='r'?q:0))-base);
      if(d.toward===undefined){img.setCrop();continue;}
      const w=sheet.cell[0],h=sheet.cell[1],mid=Math.round(sheet.anchor[0]*w);
      if(muralhaHalf(d.toward,dx)>0)img.setCrop(mid,0,w-mid,h);else img.setCrop(0,0,mid,h);
    }
    return list.slice(0,count);
  }
  /** The images square `id` shows now (uno-atravessa-tralha: the run-over pieces are cut from them). */
  shown(id:string):Phaser.GameObjects.Image[]{
    return (this.images.get(id)??[]).filter(i=>i.visible);
  }
  /** Drops the images of squares that are gone. */
  prune(keep:ReadonlySet<string>){
    for(const [id,list] of this.images)if(!keep.has(id)){for(const i of list)i.destroy();this.images.delete(id);}
  }
  destroy(){
    for(const list of this.images.values())for(const i of list)i.destroy();
    this.images.clear();this.cells.clear();
  }
}
