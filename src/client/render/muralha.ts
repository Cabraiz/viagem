/**
 * Muralha de tralha on the map (NEW-20261021-ORQ-muralha-tralha-no-jogo): the images of each free barricade square,
 * as muralha-rules.ts plans them (a whole straight piece, or halves toward the neighbours + a pillar), from the base
 * sheets BASE_ART.muralha / .pilar. StonewardsRenderer asks it first for a free square; while the sheets are missing or
 * not loaded it answers undefined and the square keeps today's art (the sofa / sandbag pile).
 */
import type Phaser from 'phaser';
import type {StructureView} from '../../contract/index.ts';
import {CITY_BUILD_CELL} from '../../maps/index.ts';
import {artPiece} from '../art/manifest.ts';
import {BASE_ART,baseFile,baseFrame,type BaseFrameRef} from '../art/base-art.ts';
import type {Pt} from './projector.ts';
import {cellKey,hashCell,muralhaColumn,muralhaEstado,muralhaHalf,muralhaPlan,muralhaScale,type MuralhaAxis} from './muralha-rules.ts';

const SHEET={reto:BASE_ART.muralha,pilar:BASE_ART.pilar} as const;
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
  private a:Pt={x:0,y:0};private b:Pt={x:0,y:0};
  private ref:BaseFrameRef={key:'',frame:0};
  /** Screen y of the top of the last square drawn (a whole wall's middle, or its pillar): where its life bar goes. */
  top=0;
  constructor(private scene:Phaser.Scene,private projection:MuralhaProjection){}

  /** Both sheets are in the manifest and their textures are loaded. */
  ready():boolean{
    for(const id of Object.values(SHEET)){
      const s=sheetOf(id),f=s&&baseFrame(id,`${s.pecas[0]}:inteira`,0,0,this.ref);
      if(!f||!this.scene.textures.exists(f.key))return false;
    }
    return true;
  }
  /** The free barricade squares standing in this view: who is whose neighbour. */
  setSquares(squares:readonly Pick<StructureView,'c'|'r'|'hp'>[]){
    this.cells.clear();
    for(const s of squares)if(s.c!==undefined&&s.r!==undefined&&s.hp>0)this.cells.add(cellKey(s.c,s.r));
  }
  /**
   * Places the images of free square `s` (its ground centre, `depth` = its art depth) and returns them, [] when it is
   * down; undefined (its images hidden) without the sheets: the caller draws today's art.
   */
  draw(s:StructureView,depth:number):Phaser.GameObjects.Image[]|undefined{
    const list=this.images.get(s.id)??[];
    if(s.c===undefined||s.r===undefined||!this.ready()){for(const i of list)i.setVisible(false);return undefined;}
    this.images.set(s.id,list);
    const estado=muralhaEstado(s.hp,s.maxHp),plan=estado?muralhaPlan({c:s.c,r:s.r,rot:s.rot},this.cells):[];
    while(list.length<plan.length)list.push(this.scene.add.image(0,0,'__DEFAULT').setName('base-muralha-tralha'));
    for(let i=plan.length;i<list.length;i++)list[i].setVisible(false);
    const pr=this.projection,cx=(s.c+.5)*CITY_BUILD_CELL,cy=(s.r+.5)*CITY_BUILD_CELL;
    const at=pr.project(cx,cy,this.a),x=at.x,y=at.y;
    this.top=y;
    plan.forEach((d,n)=>{
      const img=list[n],id=SHEET[d.kind],sheet=sheetOf(id)!;
      const axis:MuralhaAxis=d.axis??'c',step=pr.project(cx+(axis==='c'?CITY_BUILD_CELL:0),cy+(axis==='r'?CITY_BUILD_CELL:0),this.b);
      const dx=step.x-x,dy=step.y-y;
      const col=d.kind==='reto'?muralhaColumn(dx,dy):hashCell(s.c!,s.r!,7)&1;
      const f=baseFrame(id,`${sheet.pecas[d.piece]}:${estado}`,col,0,this.ref);
      if(!f){img.setVisible(false);return;}
      if(img.texture.key!==f.key)img.setTexture(f.key,f.frame);else img.setFrame(f.frame);
      const k=muralhaScale(dx,sheet.celula);
      img.setOrigin(sheet.anchor[0],sheet.anchor[1]).setScale(k.x,k.y).setPosition(x,y).setVisible(true);
      this.top=Math.min(this.top,y-sheet.cell[1]*sheet.anchor[1]*k.y*(d.kind==='pilar'?1:RETO_TOP)*(KEPT[estado!]??1));
      if(d.toward===undefined){img.setCrop();img.setDepth(d.kind==='pilar'?depth+PILLAR_OVER:depth);return;}
      // Half toward the neighbour: the frame's side of the ground centre that faces it on screen.
      const w=sheet.cell[0],h=sheet.cell[1],mid=Math.round(sheet.anchor[0]*w);
      if(muralhaHalf(d.toward,dx)>0)img.setCrop(mid,0,w-mid,h);else img.setCrop(0,0,mid,h);
      const q=CITY_BUILD_CELL/4*d.toward;
      img.setDepth(pr.depth(cx+(axis==='c'?q:0),cy+(axis==='r'?q:0))-(pr.depth(cx,cy)-depth));
    });
    return list.slice(0,plan.length);
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
