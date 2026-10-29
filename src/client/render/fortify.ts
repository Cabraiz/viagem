/**
 * D-052 slice 4 (card NEW-20261016-ORQ-carro-e-fortificacao-livre, render), PLACEHOLDER until the art arrives:
 * - wall segments ('muro', one grid cell each): a Papel block with the Breu contour (D-022), each at its own actor depth,
 *   darker and lower by damage stage, a small bar while damaged, a short flash when hit; a fallen one is rubble;
 * - the build ghost (the HUD sets it: piece, cell, rot and its look) as a translucent box of the piece's footprint,
 *   Verde Cartolina when it may go there, Laranja Cone when not, drawn over everything so the finger always sees it;
 * - the hints: the faint top of the same footprint on the free sites nearest to the car (fortify-rules buildHints);
 * - the rope (ObjectiveView.car.rope; card puxar-uno-corda): tied to the car's front bumper, always drawn: to the hands
 *   of the hero holding it, sagging with slack, or lying on the ground ahead with a loop at its end (fortify-rules ropeRest).
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
import {cellRect,footprintCells,ropeLine,ropeRest,wallKey,type CellRect,type GhostLook} from './fortify-rules.ts';
import {TriBand} from './city/tri-band.ts';
import {MURO_SHEETS,MuralhaLayer,TRALHA_SHEETS} from './muralha.ts';
import {tokenColor} from '../ui/tokens.ts';
import {HEIGHT_PX} from './city/projection.ts';
import {UsableGlow,WallGlow} from './usable-glow.ts';

/** Wall segment height (u) when whole; each damage stage takes a share off. */
const WALL_H=.95;
/** The ghost's box height (u) per piece: a defense stands tall, the wall like the wall, the barricade low. */
const GHOST_H=(piece:string)=>piece==='muro'?WALL_H:piece==='barricada'?1.1:1.3;
/** The ghost's fill alpha; the hints' outline alpha. */
const GHOST_ALPHA=.5,HINT_ALPHA=.35;
/**
 * barricada-tocar-no-mapa (user, 25/10: "o cubo laranja está maior do que a barricada"): a barricada's ghost is its own
 * junk-wall art, translucent and tinted (Amarelo Encarte where it may go, red where not), over its footprint's outline
 * on the ground (the cells the sim takes, so the drawing and the collision read as one).
 */
const GHOST_ART_ALPHA=.72,GHOST_RED=0xd2392f;
/** Rope hand and bumper heights (u). */
const HAND_Z=.62,BUMPER_Z=.38;
/** The loop at the free rope's end (u, its half width on the ground). */
const ROPE_LOOP=.16;
const GHOST_ID='fantasma-barricada',EMPTY:ReadonlySet<string>=new Set();

export interface FortifyOptions {projector:Projector;reduced:boolean;cell:number;
  /** Where a player is now (the scene's smoothed actor), or undefined when not drawn. */
  playerAt:(id:string)=>Pt|undefined;
  /** The car's heading as drawn (chaveiro renderer): the rope is tied to its front bumper. */
  carHeading?:()=>number;
  /**
   * barricada-tocar-no-mapa: a kit de torre's ghost as the tower's own art (the towers renderer) at its footprint's
   * centre, tinted; null hides it. False while that art is not loaded: the box stands in.
   */
  towerGhost?:(g:{kind:string;x:number;y:number;color:number}|null)=>boolean}
/** `w`/`h`: the footprint in cells when the HUD knows the room's own (a kit de torre: rules pieceCells), else the catalog's. */
export interface GhostInput {piece:string;c:number;r:number;rot?:number;w?:number;h?:number;look:GhostLook}

export class FortifyRenderer {
  private walls=new Map<string,{band:TriBand;key:string}>();
  /** The painted cinder-block wall the segments wear once its sheets are loaded. */
  private muro:MuralhaLayer;
  /** contorno-usavel-wc3: the Warcraft 3 gold outline on the painted wall segments (built and repaired by the player). */
  private glow:UsableGlow;
  /** The muro's pieces this frame, glowed per wall (one outline around the segments that touch). */
  private wallGlow=new WallGlow();
  private wallViews:StructureView[]=[];
  private lastHp=new Map<string,number>();
  private flashUntil=new Map<string,number>();
  private faces=new Map<string,Face[]>();
  private ghostG:Phaser.GameObjects.Graphics;
  private hintG:Phaser.GameObjects.Graphics;
  private ropeG:Phaser.GameObjects.Graphics;
  private ghost:GhostInput|null=null;
  /** The barricada ghost's art (its own layer: the junk wall's sheets, one piece). */
  private ghostWall:MuralhaLayer;
  private hints:CellRect[]=[];
  private car?:{x:number;y:number;rope?:string};
  private now=0;
  private readonly q:Pt={x:0,y:0};
  private readonly pts=[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}];
  private readonly c={breu:0,papel:0,cartolina:0,cone:0,corda:0,amarelo:0};
  private readonly ropePts:Pt[]=[];

  constructor(private scene:Phaser.Scene,private options:FortifyOptions){
    this.ghostG=scene.add.graphics().setName('obra-fantasma').setDepth(1e6);
    this.hintG=scene.add.graphics().setName('obra-dicas');
    this.ropeG=scene.add.graphics().setName('carro-corda');
    const c=this.c;c.breu=tokenColor('--c-breu');c.papel=tokenColor('--c-papel');c.cartolina=tokenColor('--c-cartolina');c.amarelo=tokenColor('--c-amarelo');
    c.cone=tokenColor('--c-cone');c.corda=mix(c.papel,c.breu,.3);
    this.muro=new MuralhaLayer(scene,options.projector,MURO_SHEETS,options.cell);
    this.ghostWall=new MuralhaLayer(scene,options.projector,TRALHA_SHEETS,options.cell);
    this.glow=new UsableGlow(scene,!!options.reduced);
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
    this.glow.begin(time);
    for(const s of this.wallViews)this.drawWall(s,k);
    this.wallGlow.flush(this.glow,k);
    this.glow.end();
    this.drawGhost(k);this.drawHints(k);this.drawRope(k);
  }

  destroy(){
    for(const w of this.walls.values())w.band.destroy();this.walls.clear();this.muro.destroy();this.ghostWall.destroy();this.glow.destroy();
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
    if(art&&!down)this.wallGlow.add(s.id,this.muro.groupOf(s),art);
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
    const gh=this.ghost;if(!gh){this.ghostWall.prune(EMPTY);this.options.towerGhost?.(null);return;}
    const [w,h]=gh.w&&gh.h?[gh.w,gh.h]:footprintCells(gh.piece,gh.rot),r=cellRect(gh.c,gh.r,w,h,this.options.cell),ok=gh.look==='ok';
    if(gh.piece==='barricada'&&this.drawWallGhost(g,gh,r,ok,k)){this.options.towerGhost?.(null);return;}
    this.ghostWall.prune(EMPTY);
    if(gh.piece!=='muro'&&gh.piece!=='barricada'&&this.options.towerGhost?.({kind:gh.piece,x:r.cx,y:r.cy,color:ok?this.c.amarelo:GHOST_RED})){
      this.footprint(g,r,ok?this.c.amarelo:GHOST_RED,k);return;
    }
    this.options.towerGhost?.(null);
    const color=ok?this.c.cartolina:this.c.cone,view=this.options.projector.view;
    const faces=this.look(`fantasma|${gh.piece}|${w}x${h}|${ok?1:0}|${view}`,()=>[{x:0,y:0,z:0,l:w*this.options.cell,w:h*this.options.cell,h:GHOST_H(gh.piece),color}]);
    this.fill(g,r.cx,r.cy,faces,k,GHOST_ALPHA,color);
  }

  /** The barricada's ghost as its art (false: the sheets are not loaded, the box stands in). */
  private drawWallGhost(g:Phaser.GameObjects.Graphics,gh:GhostInput,r:CellRect,ok:boolean,k:number):boolean{
    const color=ok?this.c.amarelo:GHOST_RED;
    const view={id:GHOST_ID,kind:'barricada',x:r.cx,y:r.cy,hp:1,maxHp:1,c:gh.c,r:gh.r,...(gh.rot?{rot:gh.rot}:{})} as StructureView;
    const images=this.ghostWall.draw(view,1e6+1);
    if(!images)return false;
    for(const img of images)img.setAlpha(GHOST_ART_ALPHA).setTint(color);
    this.footprint(g,r,color,k);
    return true;
  }
  /** A ghost's footprint on the ground: the cells the room takes. */
  private footprint(g:Phaser.GameObjects.Graphics,r:CellRect,color:number,k:number){
    const proj=this.options.projector,pts=this.pts;
    [[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]].forEach(([x,y],i)=>{const p=proj.project(x,y,this.q);pts[i].x=p.x;pts[i].y=p.y;});
    g.fillStyle(color,.22).fillPoints(pts,true);
    g.lineStyle(2*k,color,.9).strokePoints(pts,true);
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
    const car=this.car;
    if(!car)return;
    const holder=car.rope!==undefined?this.options.playerAt(car.rope):undefined,heading=this.options.carHeading?.()??0;
    const proj=this.options.projector,pts=this.ropePts;pts.length=0;
    let depth:number;
    if(holder){
      // Held: from the hands to the front bumper, sagging with the slack.
      const line=ropeLine(holder,car,CAR_HALF.l,heading),N=10;
      const a=proj.project(line.ax,line.ay,{x:0,y:0}),b=proj.project(line.bx,line.by,{x:0,y:0});
      const za=HAND_Z*HEIGHT_PX,zb=BUMPER_Z*HEIGHT_PX,sag=line.sag*HEIGHT_PX;
      for(let i=0;i<=N;i++){const t=i/N;pts.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t-(za+(zb-za)*t)+sag*4*t*(1-t)});}
      depth=Math.max(proj.depth(line.ax,line.ay),proj.depth(line.bx,line.by))+.5;
    }else{
      // Free (puxar-uno-corda): tied at the bumper, it drops to the ground and lies ahead of the nose, a loop at its end.
      const rest=ropeRest(car,CAR_HALF.l,heading);
      rest.forEach((p,i)=>{const s=proj.project(p.x,p.y,{x:0,y:0}),z=BUMPER_Z*Math.max(0,1-i/2.5)**2*HEIGHT_PX;pts.push({x:s.x,y:s.y-z});});
      depth=proj.depth(rest[0].x,rest[0].y)+.5;
    }
    // The Uno's contour (Breu) around a Papel strand, every other stretch a shade darker: it reads as a twisted rope.
    g.lineStyle(4.8*k,this.c.breu,1).strokePoints(pts,false);
    g.lineStyle(2.6*k,this.c.papel,1).strokePoints(pts,false);
    g.lineStyle(2.6*k,this.c.corda,1);
    for(let i=1;i<pts.length;i+=2)g.lineBetween(pts[i-1].x+(pts[i].x-pts[i-1].x)*.35,pts[i-1].y+(pts[i].y-pts[i-1].y)*.35,pts[i].x,pts[i].y);
    if(!holder){
      // The loop a hero takes: a small ring on the ground, the iso squash (half as tall as wide).
      const end=pts[pts.length-1],r=ROPE_LOOP*HEIGHT_PX;
      g.lineStyle(4.8*k,this.c.breu,1).strokeEllipse(end.x,end.y,r*2,r);
      g.lineStyle(2.6*k,this.c.papel,1).strokeEllipse(end.x,end.y,r*2,r);
    }
    g.setDepth(depth);
  }
}
