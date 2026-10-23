/**
 * D-052 slice 4 (card NEW-20261016-ORQ-carro-e-fortificacao-livre, render), PLACEHOLDER until the art arrives:
 * - wall segments ('muro', one grid cell each): a Papel block with the Breu contour (D-022), each at its own actor depth,
 *   darker and lower by damage stage, a small bar while damaged, a short flash when hit; a fallen one is rubble;
 * - the build ghost (the HUD sets it: piece, cell, rot and its look) as a translucent box of the piece's footprint,
 *   Verde Cartolina when it may go there, Laranja Cone when not, drawn over everything so the finger always sees it;
 * - the hints: the faint top of the same footprint on the free sites nearest to the car (fortify-rules buildHints);
 * - the rope (ObjectiveView.car.rope): from the hero holding it to the car's bumper on his side, sagging with slack.
 * Free barricades are the city barricades (stonewards.ts, turned by rot); defenses are the towers renderer's.
 * Pure drawing: the scene pushes each new RunView and calls update every frame; the rules are in fortify-rules.ts.
 * Card NEW-20261021-E2-obra-muro-assado: each wall segment is frozen into triangles (TriBand) per wallKey and frozen
 * again only when that key changes; per frame it only moves (the obra-muro Graphics replayed ~740 commands a frame).
 * Card NEW-20261022-ORQ-trocar-procedurais-por-arte: with the muro-bloco sheets loaded a segment wears the painted
 * cinder-block wall (muralha.ts MURO_SHEETS: straight pieces along its run, pillars at ends and corners) and its band
 * only holds the life bar; the Papel block stays only while the sheets are missing or loading.
 */
import Phaser from 'phaser';
import type {RunView,StructureView} from '../../contract/index.ts';
import type {Projector,Pt} from './projector.ts';
import {boxFaces,mix,type Box,type Face} from './chaveiro/iso.ts';
import {CAR_HALF} from './chaveiro/figures.ts';
import {objectiveOf} from './chaveiro/view.ts';
import {HIT_FLASH_MS,damageStage,hpDropped,wallBar} from './stonewards-rules.ts';
import {cellRect,footprintCells,ropeLine,wallKey,type CellRect,type GhostLook} from './fortify-rules.ts';
import {TriBand} from './city/tri-band.ts';
import {MURO_SHEETS,MuralhaLayer} from './muralha.ts';
import {tokenColor} from '../ui/tokens.ts';
import {HEIGHT_PX} from './city/projection.ts';

/** Wall segment height (u) when whole; each damage stage takes a share off. */
const WALL_H=.95;
/** The ghost's box height (u) per piece: a defense stands tall, the wall like the wall, the barricade low. */
const GHOST_H=(piece:string)=>piece==='muro'?WALL_H:piece==='barricada'?1.1:1.3;
/** The ghost's fill alpha; the hints' outline alpha. */
const GHOST_ALPHA=.5,HINT_ALPHA=.35;
/** Rope hand and bumper heights (u). */
const HAND_Z=.62,BUMPER_Z=.38;

export interface FortifyOptions {projector:Projector;reduced:boolean;cell:number;
  /** Where a player is now (the scene's smoothed actor), or undefined when not drawn. */
  playerAt:(id:string)=>Pt|undefined;
  /** The car's heading as drawn (chaveiro renderer): the rope hooks to the bumper the hero is behind. */
  carHeading?:()=>number}
/** `w`/`h`: the footprint in cells when the HUD knows the room's own (a kit de torre: rules pieceCells), else the catalog's. */
export interface GhostInput {piece:string;c:number;r:number;rot?:number;w?:number;h?:number;look:GhostLook}

export class FortifyRenderer {
  private walls=new Map<string,{band:TriBand;key:string}>();
  /** The painted cinder-block wall the segments wear once its sheets are loaded. */
  private muro:MuralhaLayer;
  private wallViews:StructureView[]=[];
  private lastHp=new Map<string,number>();
  private flashUntil=new Map<string,number>();
  private faces=new Map<string,Face[]>();
  private ghostG:Phaser.GameObjects.Graphics;
  private hintG:Phaser.GameObjects.Graphics;
  private ropeG:Phaser.GameObjects.Graphics;
  private ghost:GhostInput|null=null;
  private hints:CellRect[]=[];
  private car?:{x:number;y:number;rope?:string};
  private now=0;
  private readonly q:Pt={x:0,y:0};
  private readonly pts=[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}];
  private readonly c={breu:0,papel:0,cartolina:0,cone:0};

  constructor(private scene:Phaser.Scene,private options:FortifyOptions){
    this.ghostG=scene.add.graphics().setName('obra-fantasma').setDepth(1e6);
    this.hintG=scene.add.graphics().setName('obra-dicas');
    this.ropeG=scene.add.graphics().setName('carro-corda');
    const c=this.c;c.breu=tokenColor('--c-breu');c.papel=tokenColor('--c-papel');c.cartolina=tokenColor('--c-cartolina');
    c.cone=tokenColor('--c-cone');
    this.muro=new MuralhaLayer(scene,options.projector,MURO_SHEETS,options.cell);
  }

  push(view:RunView){
    this.wallViews=view.structures.filter(s=>s.kind==='muro');
    if(!this.options.reduced)for(const id of hpDropped(this.lastHp,this.wallViews))this.flashUntil.set(id,this.now+HIT_FLASH_MS);
    this.lastHp=new Map(this.wallViews.map(s=>[s.id,s.hp]));
    for(const [id,w] of this.walls)if(!this.lastHp.has(id)){w.band.destroy();this.walls.delete(id);this.flashUntil.delete(id);}
    this.muro.prune(new Set(this.lastHp.keys()));this.muro.setSquares(this.wallViews);
    const car=objectiveOf(view)?.car as {x:number;y:number;rope?:string}|undefined;
    this.car=car&&{x:car.x,y:car.y,rope:car.rope};
  }
  /** The HUD's ghost (null: not building). */
  setGhost(ghost:GhostInput|null){this.ghost=ghost;}
  /** The faint hints (fortify-rules buildHints), empty when not building. */
  setHints(hints:readonly CellRect[]){this.hints=[...hints];}

  update(time:number){
    this.now=time;
    const k=1/Math.max(.05,this.scene.cameras.main.zoom);
    for(const s of this.wallViews)this.drawWall(s,k);
    this.drawGhost(k);this.drawHints(k);this.drawRope(k);
  }

  destroy(){
    for(const w of this.walls.values())w.band.destroy();this.walls.clear();this.muro.destroy();
    this.ghostG.destroy();this.hintG.destroy();this.ropeG.destroy();
  }

  private look(key:string,boxes:()=>Box[]):Face[]{
    let f=this.faces.get(key);
    if(!f){f=boxFaces(boxes(),0,this.options.projector.view);this.faces.set(key,f);if(this.faces.size>64)this.faces.delete(this.faces.keys().next().value!);}
    return f;
  }
  private fill(g:Phaser.GameObjects.Graphics,x:number,y:number,faces:readonly Face[],k:number,alpha=1,line=this.c.breu){
    const p=this.options.projector.project(x,y,this.q);
    this.fillAt(g,p.x,p.y,faces,k,alpha,line);
  }
  private fillAt(g:Phaser.GameObjects.Graphics,ax:number,ay:number,faces:readonly Face[],k:number,alpha=1,line=this.c.breu){
    const pts=this.pts;
    for(const f of faces){
      for(let i=0;i<4;i++){pts[i].x=ax+f.pts[i].x;pts[i].y=ay+f.pts[i].y;}
      g.fillStyle(f.color,f.alpha*alpha).fillPoints(pts,true);
      if(f.line)g.lineStyle(1.2*k,line,.9*alpha).strokePoints(pts,true);
    }
  }

  private drawWall(s:StructureView,k:number){
    const ratio=s.maxHp>0?s.hp/s.maxHp:0,down=s.hp<=0,stage=damageStage(ratio,down),cell=this.options.cell;
    const flash=(this.flashUntil.get(s.id)??0)>this.now,view=this.options.projector.view;
    const bar=wallBar(s.hp,s.maxHp),showBar=!down&&bar.fraction<1,depth=this.options.projector.depth(s.x,s.y);
    // The painted wall when its sheets are loaded ([] when down: nothing), the band then holds only the bar over it.
    const art=this.muro.draw(s,depth);
    const key=`${art?'arte|':''}${wallKey(stage,flash&&!art,view,showBar?bar:undefined,k)}`;
    let w=this.walls.get(s.id);
    if(w?.key!==key&&art){
      w?.band.destroy();
      const band=TriBand.make(this.scene,g=>{
        if(!showBar)return;
        const bw=26*k,bh=5*k;
        g.fillStyle(this.c.breu,1).fillRect(-bw/2-k,-bh-k,bw+2*k,bh+2*k);
        g.fillStyle(bar.low?this.c.cone:this.c.cartolina,1).fillRect(-bw/2,-bh,bw*bar.fraction,bh);
      }).setName('obra-muro-barra');
      w={band,key};this.walls.set(s.id,w);
    }
    if(art){
      // Over the art's top (the pillar or the wall's middle), above every piece of it.
      const p=this.options.projector.project(s.x,s.y,this.q);
      w!.band.setPosition(p.x,this.muro.top-6*k).setDepth(depth+.01);
      for(const img of art)img.setAlpha(flash?.7:1);
      return;
    }
    if(w?.key!==key){
      w?.band.destroy();
      const worn=mix(this.c.papel,this.c.breu,.22),color=flash?mix(this.c.papel,0xffffff,.6):stage>=2?worn:this.c.papel;
      const faces=this.look(`muro|${stage}|${flash?1:0}|${view}`,()=>down
        ?[{x:-.2*cell,y:.1*cell,z:0,l:.35*cell,w:.3*cell,h:.18,color:this.c.papel},{x:.2*cell,y:-.15*cell,z:0,l:.3*cell,w:.35*cell,h:.14,color:mix(this.c.papel,this.c.breu,.22)}]
        :[{x:0,y:0,z:0,l:.96*cell,w:.96*cell,h:WALL_H*(1-.18*stage),color}]);
      // Drawn in the segment's local space (its projected centre at 0,0), then frozen.
      const band=TriBand.make(this.scene,g=>{
        this.fillAt(g,0,0,faces,k);
        if(!showBar)return;
        const bw=26*k,bh=5*k,by=-WALL_H*HEIGHT_PX-10*k;
        g.fillStyle(this.c.breu,1).fillRect(-bw/2-k,by-k,bw+2*k,bh+2*k);
        g.fillStyle(bar.low?this.c.cone:this.c.cartolina,1).fillRect(-bw/2,by,bw*bar.fraction,bh);
      }).setName('obra-muro');
      w={band,key};this.walls.set(s.id,w);
    }
    const p=this.options.projector.project(s.x,s.y,this.q);
    w!.band.setPosition(p.x,p.y).setDepth(depth);
  }

  private drawGhost(k:number){
    const g=this.ghostG;g.clear();
    const gh=this.ghost;if(!gh)return;
    const [w,h]=gh.w&&gh.h?[gh.w,gh.h]:footprintCells(gh.piece,gh.rot),r=cellRect(gh.c,gh.r,w,h,this.options.cell),ok=gh.look==='ok';
    const color=ok?this.c.cartolina:this.c.cone,view=this.options.projector.view;
    const faces=this.look(`fantasma|${gh.piece}|${w}x${h}|${ok?1:0}|${view}`,()=>[{x:0,y:0,z:0,l:w*this.options.cell,w:h*this.options.cell,h:GHOST_H(gh.piece),color}]);
    this.fill(g,r.cx,r.cy,faces,k,GHOST_ALPHA,color);
  }

  private drawHints(k:number){
    const g=this.hintG;g.clear();
    if(!this.ghost||!this.hints.length)return;
    const proj=this.options.projector,pts=this.pts;
    for(const h of this.hints){
      const corners=[[h.x0,h.y0],[h.x1,h.y0],[h.x1,h.y1],[h.x0,h.y1]];
      corners.forEach(([x,y],i)=>{const p=proj.project(x,y,this.q);pts[i].x=p.x;pts[i].y=p.y;});
      g.fillStyle(this.c.cartolina,HINT_ALPHA*.4).fillPoints(pts,true);
      g.lineStyle(1.5*k,this.c.cartolina,HINT_ALPHA).strokePoints(pts,true);
    }
    // Under the actors: the hints lie on the ground.
    g.setDepth(proj.depth(this.hints[0].cx,this.hints[0].cy)-1e3);
  }

  private drawRope(k:number){
    const g=this.ropeG;g.clear();
    const car=this.car,holder=car?.rope&&this.options.playerAt(car.rope);
    if(!car||!holder)return;
    const line=ropeLine(holder,car,CAR_HALF.l,this.options.carHeading?.()??0),proj=this.options.projector,N=10;
    const a=proj.project(line.ax,line.ay,{x:0,y:0}),b=proj.project(line.bx,line.by,{x:0,y:0});
    const za=HAND_Z*HEIGHT_PX,zb=BUMPER_Z*HEIGHT_PX,sag=line.sag*HEIGHT_PX;
    g.lineStyle(2.4*k,this.c.breu,1).beginPath();
    for(let i=0;i<=N;i++){
      const t=i/N,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t-(za+(zb-za)*t)+sag*4*t*(1-t);
      if(i)g.lineTo(x,y);else g.moveTo(x,y);
    }
    g.strokePath();
    g.setDepth(Math.max(proj.depth(line.ax,line.ay),proj.depth(line.bx,line.by))+.5);
  }
}
