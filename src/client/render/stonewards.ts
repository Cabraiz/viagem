/**
 * Stonewards in the world (VGM-046B): the wall/shelter at the base with its life bar, the camp ring (only in the
 * intermission, where the forge works), the chinelo towers, and the gather nodes with their value, units left and the
 * progress of the unit being gathered. Nodes and the ring only show in the intermission: the wave stays readable.
 * City (cidade-06, barricadas-cliente): the 4 barricades across the plaza mouths ('barricada'), a pile drawn by damage
 * stage with a small bar while damaged, a short flash when hit. Structures are routed by kind (stonewards-rules
 * structureRole): only 'torre-chinelo' is a tower. The wall, the barricades and the loot crates use the imported `base`
 * art when the manifest has it (art/base-art.ts), today's Graphics otherwise.
 *
 * Everything that sits on the map follows the double-edge rule (D-022): light body (Papel) + Breu contour. Sizes are
 * CSS px (divided by the camera zoom), so the markers read the same at every zoom. Colors only from the tokens:
 * Verde Cartolina for the wall's life (a favor), Laranja Cone when it is low (with the bar's notch as a second cue).
 * Pure drawing: no simulation, no network; the scene pushes each new RunView and calls update every frame.
 */
import Phaser from 'phaser';
import type {NodeView,RunView,StructureView} from '../../contract/index.ts';
import {BARRICADA_CELLS,CAMP_RADIUS,TOWER_SECONDS} from '../../rules/index.ts';
import {CITY_BUILD_CELL} from '../../maps/index.ts';
import {SIM_HZ} from '../../contract/index.ts';
import type {Projector,Pt} from './projector.ts';
import {HIT_FLASH_MS,WALL_LOW,barricadeBar,barricadeSpan,damageStage,freeBarricadeSpan,isFreeBarricade,gatheredSince,hpDropped,structureBarY,structureRole,wallBar,type DamageStage} from './stonewards-rules.ts';
import {BASE_ART,BASE_ART_SCALED,applyBaseArt,baseFile,baseState,baseStateFrames} from '../art/base-art.ts';

export {WALL_LOW,gatheredSince,structureBarY,wallBar};
import {token,tokenColor,whenFontsReady} from '../ui/tokens.ts';
import {LIT_SHADOW,lightEnabled} from './light.ts';
import {objectiveOf} from './chaveiro/view.ts';
import {TriBand} from './city/tri-band.ts';
import {INTERATIVO_COR} from '../hud/tralha/model.ts';
import {MuralhaLayer} from './muralha.ts';
import {towerArtScale} from './towers/tower-rules.ts';

const LIGHT=lightEnabled();

/** A unit gathered: "+N" rises this long over its node. */
const POP_MS=900;
/** Nodes are marked only this close to the hero (review onda 6, D9). */
export const NODE_SIGHT=12;
const RING_SEGMENTS=56;
/** Loot crates of the city are gather nodes with these ids (sim/stonewards/loot.ts CRATE_PREFIX). */
const CRATE_PREFIX='caixa-';
/** Imported art sits this much under its spot's Graphics, so the life bar drawn there stays on top of the sheet. */
const BAR_OVER_ART=.001;
/** barricada-construir: the car-alert glow (the telegraphs' danger red). */
const ALERT_RED=0xd2392f;
/** Sandbag rows of the procedural barricade, bottom first, by damage stage (3: down, not drawn). */
const PILE_ROWS:Readonly<Record<DamageStage,readonly number[]>>={0:[5,4,3],1:[5,4,2],2:[5,2],3:[]};
/** Share of Papel in the sandbags' colour by damage stage (the rest Pedra): darker as the life drops. */
const PILE_LIGHT:Readonly<Record<DamageStage,number>>={0:1,1:.72,2:.5,3:.4};

interface Pop {text:Phaser.GameObjects.Text;x:number;y:number;born:number}
interface NodeMark {view:NodeView;label:Phaser.GameObjects.Text}

export interface StonewardsRendererOptions {projector:Projector;reduced:boolean;
  /** The local hero (client prediction): nodes are marked only near it. */
  hero?:()=>Pt|undefined;
  /**
   * World px multiplier of what is drawn at the endless map's size (the wall and the towers, and their bars' lift):
   * framing.ts CITY_VIEW_SCALE in the city, so they keep their size next to the heroes under the city zoom. The camp ring
   * (world units) and the CSS-px nodes, bars and pops need nothing. Default 1.
   */
  actorScale?:()=>number;
  /** The map's cell (u) for the scenery-scaled pieces (base-art BASE_ART_SCALED, towerArtScale); default ART_CELL. */
  cell?:()=>number|undefined}

export class StonewardsRenderer {
  /** Economy mode (scene.setEconomy): drops the towers' cast shadows (lighting card). */
  economy=false;
  private scene:Phaser.Scene;
  private options:StonewardsRendererOptions;
  /** Camp ring and node markers, on the ground (under props and bodies). */
  private ground:Phaser.GameObjects.Graphics;
  /** The wall at its own depth (heroes and trees sort around it). */
  private wall:Phaser.GameObjects.Graphics;
  /** Towers, sorted by their own depth. */
  private towers=new Map<string,Phaser.GameObjects.Graphics>();
  /** City barricades (procedural pile and bar), each at its own depth. */
  private barricades=new Map<string,Phaser.GameObjects.Graphics>();
  /**
   * The procedural piles frozen into triangles (city/tri-band.ts), one per barricade, rebuilt only when its look changes
   * (stage, flash, ends, scale): a pile is ~1 500 Graphics commands that Phaser replayed and triangulated every frame, even
   * off camera (BUG-20261014-ORQ-engasgo-andando-celular). The bar stays on the live Graphics.
   */
  private piles=new Map<string,TriBand>();private pileKeys=new Map<string,string>();
  /** Imported base art: by structure id (wall, barricades) or `node:<id>` (crates); created only when the art exists. */
  private images=new Map<string,Phaser.GameObjects.Image>();
  /** muralha-tralha-no-jogo: the junk wall the free barricade squares wear (render/muralha.ts), when its sheets are loaded. */
  private muralha:MuralhaLayer;
  /** Life of each structure in the last view, and when a hit one stops flashing (renderer clock). */
  private lastHp=new Map<string,number>();
  private flashUntil=new Map<string,number>();
  private marks=new Map<string,NodeMark>();
  private pops:Pop[]=[];
  private structures:StructureView[]=[];
  private prepare=false;
  /** D-047: the chaveiro objective runs: the Quadradão stands in the wall's place (render/chaveiro), the wall is not drawn. */
  private objective=false;
  private tick=0;
  private now=0;
  /** barricada-construir part 2: the barricada square that wears the gold outline (hud/tralha). */
  outline?:string;
  private q:Pt={x:0,y:0};
  private ringPts=Array.from({length:RING_SEGMENTS},()=>({x:0,y:0}));
  private readonly c={breu:0,papel:0,lilas:0,cartolina:0,cone:0,pedra:0,casca:0,claro:0};
  private labelStyle:Phaser.Types.GameObjects.Text.TextStyle;

  constructor(scene:Phaser.Scene,options:StonewardsRendererOptions){
    this.scene=scene;this.options=options;
    this.ground=scene.add.graphics().setDepth(-9980).setName('base-chao');
    this.wall=scene.add.graphics().setName('base-muralha');
    this.muralha=new MuralhaLayer(scene,options.projector);
    const c=this.c;
    c.breu=tokenColor('--c-breu');c.papel=tokenColor('--c-papel');c.lilas=tokenColor('--c-lilas');
    c.cartolina=tokenColor('--c-cartolina');c.cone=tokenColor('--c-cone');
    // The same mixes as tokens.css --c-pedra, --c-casca and --c-papel-claro (no new hue).
    c.pedra=mix(c.papel,c.breu,.55);c.casca=mix(c.cone,c.breu,.45);c.claro=mix(c.papel,0xffffff,.35);
    this.labelStyle={fontFamily:token('--f-cartaz'),fontSize:'16px',color:token('--c-papel'),stroke:token('--c-breu'),strokeThickness:4};
    whenFontsReady(()=>{for(const m of this.marks.values())m.label.setStyle(this.labelStyle);});
  }

  /** A new authoritative view: structures, nodes, phase; "+N" pops for the units that came out since the last one. */
  push(view:RunView){
    this.tick=view.tick;this.structures=view.structures;this.objective=objectiveOf(view)!==undefined;
    this.prepare=view.round?.phase==='prepare'&&!view.camp?.wallDown;
    const nodes=this.prepare?view.nodes??[]:[];
    const before=new Map([...this.marks].map(([id,m])=>[id,m.view]));
    for(const g of gatheredSince(before,nodes))this.pop(g.node,g.amount);
    const seen=new Set<string>();
    for(const n of nodes){
      seen.add(n.id);
      let m=this.marks.get(n.id);
      if(!m){m={view:n,label:this.scene.add.text(0,0,'',this.labelStyle).setOrigin(.5,.5)};this.marks.set(n.id,m);}
      m.view=n;
      // Plain x: the served Londrina subset draws the multiplication sign as a missing glyph on the canvas.
      const text=`x${n.value}`;
      if(m.label.text!==text)m.label.setText(text);
    }
    for(const [id,m] of this.marks)if(!seen.has(id)){m.label.destroy();this.marks.delete(id);}
    // A structure that lost life flashes briefly (never with reduced effects).
    if(!this.options.reduced)for(const id of hpDropped(this.lastHp,this.structures))this.flashUntil.set(id,this.now+HIT_FLASH_MS);
    this.lastHp=new Map(this.structures.map(s=>[s.id,s.hp]));
    for(const id of this.flashUntil.keys())if(!this.lastHp.has(id))this.flashUntil.delete(id);
    const of=(role:string)=>new Set(this.structures.filter(s=>structureRole(s.kind)===role).map(s=>s.id));
    prune(this.towers,of('tower'));prune(this.barricades,of('barricade'));prune(this.piles,of('barricade'));
    this.muralha.prune(of('barricade'));
    this.muralha.setSquares(this.structures.filter(s=>structureRole(s.kind)==='barricade'&&isFreeBarricade(s)));
    for(const id of [...this.pileKeys.keys()])if(!this.piles.has(id))this.pileKeys.delete(id);
    prune(this.images,new Set([...this.lastHp.keys(),...[...this.marks.keys()].map(id=>`node:${id}`)]));
  }

  /** After a view turn or a depth re-base: positions and depths are recomputed on the next update anyway. */
  refresh(){this.update(this.now);}

  update(time:number){
    this.now=time;
    const k=1/Math.max(.05,this.scene.cameras.main.zoom),u=this.options.actorScale?.()??1;
    this.ground.clear();
    const wall=this.structures.find(s=>structureRole(s.kind)==='wall');
    if(wall&&this.prepare)this.drawRing(wall,k);
    for(const m of this.marks.values())this.drawNode(m,k,u);
    this.drawWall(this.objective?undefined:wall,k,u);
    for(const s of this.structures){
      const role=structureRole(s.kind);
      if(role==='tower')this.drawTower(s,k,u);else if(role==='barricade')this.drawBarricade(s,wall,k,u);
    }
    this.drawPops(k);
  }

  destroy(){
    this.ground.destroy();this.wall.destroy();
    for(const g of this.towers.values())g.destroy();this.towers.clear();
    for(const g of this.barricades.values())g.destroy();this.barricades.clear();
    for(const b of this.piles.values())b.destroy();this.piles.clear();this.pileKeys.clear();
    for(const i of this.images.values())i.destroy();this.images.clear();
    this.muralha.destroy();
    for(const m of this.marks.values())m.label.destroy();this.marks.clear();
    for(const p of this.pops)p.text.destroy();this.pops=[];
  }

  private project(x:number,y:number){return this.options.projector.project(x,y,this.q);}
  private flashing(id:string){const t=this.flashUntil.get(id);return t!==undefined&&this.now<t;}
  /**
   * The imported art of `key` (piece `id` in `state`, camera column `view`), shown and returned; undefined (and its
   * image hidden) when the piece, the state or the texture is missing. The image is created only once the art exists.
   */
  /** World px per art px of the city scenery (towerArtScale) under this projection and map cell. */
  private artPx(){
    const pr=this.options.projector,a=pr.project(0,0,{x:0,y:0}),b=pr.project(1,0,{x:0,y:0}),c=pr.project(0,1,{x:0,y:0});
    const cell=this.options.cell?.();
    return towerArtScale(Math.max(1,Math.abs(b.x-a.x)+Math.abs(c.x-a.x)),cell&&cell>0?cell:undefined);
  }
  private art(key:string,id:string,state:string|undefined,view:number,u:number,frame=0){
    let img=this.images.get(key);
    if(!state||!baseFile(id)){img?.setVisible(false);return undefined;}
    if(!img){img=this.scene.add.image(0,0,'__DEFAULT').setVisible(false);this.images.set(key,img);}
    if(!applyBaseArt(img,id,state,view,u,frame,BASE_ART_SCALED.has(id)?this.artPx():undefined)){img.setVisible(false);return undefined;}
    return img.setVisible(true);
  }

  /** The forge's camp: Breu line under a Papel line, on the ground around the wall. */
  private drawRing(wall:StructureView,k:number){
    const pts=this.ringPts;
    for(let i=0;i<RING_SEGMENTS;i++){
      const a=i/RING_SEGMENTS*Math.PI*2,p=this.project(wall.x+Math.cos(a)*CAMP_RADIUS,wall.y+Math.sin(a)*CAMP_RADIUS);
      pts[i].x=p.x;pts[i].y=p.y;
    }
    this.ground.lineStyle(6*k,this.c.breu,.55).strokePoints(pts,true);
    this.ground.lineStyle(2.5*k,this.c.papel,.95).strokePoints(pts,true);
  }

  /**
   * Node (review onda 6, D9): the resource's own sticker on the ground in front of its tree or rock, no box. "x2" only
   * when a unit is worth more than 1; the units left (pips) and the Cartolina progress bar only while someone gathers
   * there. Only nodes within NODE_SIGHT units of the hero are marked; an empty one fades.
   */
  private drawNode(m:NodeMark,k:number,u:number){
    const n=m.view,g=this.ground,c=this.c,hero=this.options.hero?.();
    const near=!hero||Math.hypot(n.x-hero.x,n.y-hero.y)<=NODE_SIGHT;
    m.label.setVisible(near&&n.value>1&&n.remaining>0);
    if(n.id.startsWith(CRATE_PREFIX))this.drawCrate(n,near,u);
    if(!near)return;
    const p=this.project(n.x,n.y),x=p.x,y=p.y+14*k,empty=n.remaining<=0,alpha=empty?.35:1;
    if(n.kind==='pedra'){
      // A flat grey stone with a chipped face (never the lilac gem of the XP, never the base's little house).
      const pts=[[-11,4],[-9,-3],[-3,-7],[6,-6],[11,-1],[9,5],[-5,7]].map(([a,b])=>({x:x+a*k,y:y+b*k}));
      g.lineStyle(6*k,c.claro,alpha).strokePoints(pts,true);
      g.fillStyle(c.pedra,alpha).fillPoints(pts,true).lineStyle(2*k,c.breu,alpha).strokePoints(pts,true);
      g.fillStyle(c.claro,alpha).fillTriangle(x-3*k,y-7*k,x+6*k,y-6*k,x+1*k,y-1*k);
      g.lineStyle(1.5*k,c.breu,alpha).lineBetween(x+1*k,y-1*k,x-2*k,y+5*k);
    }else{
      // Half a coconut: brown husk ring, white flesh (never three holes: that read as the boss's skull).
      g.fillStyle(c.claro,alpha).fillCircle(x,y,11*k);
      g.fillStyle(c.casca,alpha).fillCircle(x,y,8.5*k).lineStyle(2*k,c.breu,alpha).strokeCircle(x,y,8.5*k);
      // The flesh sits high in the shell (a coconut cut open, seen from above-front), never a centred ring (a life buoy).
      g.fillStyle(c.claro,alpha).fillEllipse(x,y-2.5*k,11*k,8*k).lineStyle(1.5*k,c.breu,alpha).strokeEllipse(x,y-2.5*k,11*k,8*k);
    }
    m.label.setPosition(x+19*k,y).setScale(k).setAlpha(alpha).setDepth(-9970);
    if(!(n.progress>0)||empty)return;
    const cap=Math.max(1,Math.min(8,n.capacity)),pip=4*k,gap=2*k,total=cap*pip+(cap-1)*gap;
    for(let i=0;i<cap;i++){
      const px=x-total/2+i*(pip+gap),py=y+13*k,full=i<n.remaining;
      g.fillStyle(full?c.papel:c.breu,1).fillRect(px,py,pip,pip);
      g.lineStyle(1*k,c.breu,1).strokeRect(px,py,pip,pip);
    }
    g.fillStyle(c.breu,1).fillRect(x-total/2-k,y+19*k,total+2*k,5*k);
    g.fillStyle(c.cartolina,1).fillRect(x-total/2,y+20*k,total*Math.min(1,n.progress),3*k);
  }

  /**
   * The wall/shelter: a ring of stones with a lona tent and its flag, plus the life bar above it. `u`: world px per
   * endless-map world px (actorScale) for the art; `k`: world px per CSS px for the bar.
   */
  private drawWall(wall:StructureView|undefined,k:number,u:number){
    const g=this.wall;g.clear();
    if(!wall){g.setVisible(false);return;}
    g.setVisible(true);
    const p=this.project(wall.x,wall.y),x=p.x,y=p.y,down=wall.hp<=0,depth=this.options.projector.depth(wall.x,wall.y);
    g.setDepth(depth);
    // Imported art: the sheet's damage state from the camera's view (a round piece: no turn of its own); the bar stays.
    const img=this.art(wall.id,BASE_ART.wall,baseState(BASE_ART.wall,wall.maxHp>0?wall.hp/wall.maxHp:0,down),this.options.projector.view,u);
    if(img){
      img.setPosition(x,y).setDepth(depth-BAR_OVER_ART);
      if(this.flashing(wall.id))img.setTintFill(this.c.claro);else img.clearTint();
    }else this.drawWallBody(g,x,y,down,u);
    if(down)return;
    // Life bar (CSS px): Breu track, Papel edge, Cartolina fill; under WALL_LOW it turns Cone and gets a notch.
    const {fraction,low}=wallBar(wall.hp,wall.maxHp),bw=72*k,bh=8*k,bx=x-bw/2,by=structureBarY('muralha',y,k,u);
    this.drawBar(g,bx,by,bw,bh,fraction,low,k);
  }

  /** Today's procedural wall (no imported art): shadow, stone ring, tent and flag. */
  private drawWallBody(g:Phaser.GameObjects.Graphics,x:number,y:number,down:boolean,u:number){
    const c=this.c;
    // Shadow, stone ring (a low wall), tent, flag. Drawn in world px: the wall is part of the map, it zooms with it
    // (× u: the endless map's size next to the heroes, also in the city).
    g.fillStyle(c.breu,.25).fillEllipse(x,y+6*u,150*u,56*u);
    const stones=down?7:14;
    for(let i=0;i<stones;i++){
      const a=Math.PI*(1+i/(stones-1)),sx=x+Math.cos(a)*62*u,sy=y+Math.sin(a)*24*u-4*u;
      g.fillStyle(c.pedra,1).fillRoundedRect(sx-11*u,sy-10*u,22*u,16*u,5*u).lineStyle(2*u,c.breu,1).strokeRoundedRect(sx-11*u,sy-10*u,22*u,16*u,5*u);
    }
    if(!down){
      const tent=[{x:x-40*u,y:y+6*u},{x:x,y:y-62*u},{x:x+40*u,y:y+6*u}];
      g.fillStyle(c.papel,1).fillPoints(tent,true).lineStyle(2.5*u,c.breu,1).strokePoints(tent,true);
      g.fillStyle(c.breu,1).fillTriangle(x-10*u,y+6*u,x,y-18*u,x+10*u,y+6*u);
      g.lineStyle(3*u,c.breu,1).lineBetween(x,y-62*u,x,y-92*u);
      const flag=[{x:x,y:y-92*u},{x:x+26*u,y:y-85*u},{x:x,y:y-77*u}];
      g.fillStyle(c.lilas,1).fillPoints(flag,true).lineStyle(2*u,c.breu,1).strokePoints(flag,true);
    }
    for(let i=0;i<stones;i++){
      const a=Math.PI*(i/(stones-1)),sx=x+Math.cos(a)*62*u,sy=y+Math.sin(a)*24*u-2*u;
      g.fillStyle(c.pedra,1).fillRoundedRect(sx-12*u,sy-11*u,24*u,18*u,5*u).lineStyle(2*u,c.breu,1).strokeRoundedRect(sx-12*u,sy-11*u,24*u,18*u,5*u);
    }
  }

  /** A life bar (CSS px, `k`): Breu track, Papel edge, Cartolina fill; under WALL_LOW it turns Cone and gets a notch. */
  private drawBar(g:Phaser.GameObjects.Graphics,bx:number,by:number,bw:number,bh:number,fraction:number,low:boolean,k:number){
    const c=this.c;
    g.fillStyle(c.breu,1).fillRoundedRect(bx-2*k,by-2*k,bw+4*k,bh+4*k,4*k);
    g.fillStyle(low?c.cone:c.cartolina,1).fillRect(bx,by,bw*fraction,bh);
    g.lineStyle(2*k,c.papel,1).strokeRoundedRect(bx-2*k,by-2*k,bw+4*k,bh+4*k,4*k);
    if(low)g.fillStyle(c.breu,1).fillTriangle(bx+bw*WALL_LOW-4*k,by-2*k,bx+bw*WALL_LOW+4*k,by-2*k,bx+bw*WALL_LOW,by+4*k);
  }

  /**
   * City barricade across a plaza mouth, at its own depth (the city's actor depth through the projector, like the
   * wall). Imported art: the damage state's row, column = (camera view + the mouth's turn) mod 4. Otherwise a sandbag
   * pile 2 u long across the mouth (barricadeSpan) whose rows thin out and darken by damage stage, and nothing
   * once down. A small bar while damaged (never when whole or down); a short flash when hit.
   */
  private drawBarricade(s:StructureView,wall:StructureView|undefined,k:number,u:number){
    let g=this.barricades.get(s.id);
    if(!g){g=this.scene.add.graphics().setName('base-barricada');this.barricades.set(s.id,g);}
    g.clear();
    const down=s.hp<=0,ratio=s.maxHp>0?s.hp/s.maxHp:0,stage=damageStage(ratio,down),flash=this.flashing(s.id);
    // D-052: a free-build barricade lies along its own footprint (rot), not across a plaza mouth.
    const span=isFreeBarricade(s)?freeBarricadeSpan(s,CITY_BUILD_CELL*BARRICADA_CELLS):barricadeSpan(s,wall),depth=this.options.projector.depth(s.x,s.y);
    const p=this.project(s.x,s.y),x=p.x,y=p.y;
    g.setDepth(depth);
    // A free square wears the junk wall (muralha.ts) once its sheets are loaded; [] when down. Otherwise today's art.
    const junk=isFreeBarricade(s)?this.muralha.draw(s,depth-BAR_OVER_ART):undefined;
    if(junk)this.images.get(s.id)?.setVisible(false);
    const img=junk?undefined:this.art(s.id,BASE_ART.barricade,baseState(BASE_ART.barricade,ratio,down),this.options.projector.view+span.turn,u);
    const pile=this.piles.get(s.id);
    // barricada-construir: the car too close (StructureView untilTick on a free barricade): a red glow, pulsing faster
    // as the 6 s run out, then the room destroys it.
    const alert=isFreeBarricade(s)&&s.untilTick!==undefined&&this.tick<s.untilTick;
    if(alert){
      const left=(s.untilTick!-this.tick)/SIM_HZ,pulse=.5+.5*Math.sin(this.now/(left<2?60:140));
      const reach=CITY_BUILD_CELL*BARRICADA_CELLS*1.4,l=this.project(s.x-reach,s.y),lx=l.x,ly=l.y,r=this.project(s.x+reach,s.y),w=Math.hypot(r.x-lx,r.y-ly);
      g.fillStyle(ALERT_RED,.25+.35*pulse).fillEllipse(x,y,w,w*.55);
    }
    // barricada-construir part 2: the square under the mouse or tapped wears the gold outline (the alert's red wins).
    if(!alert&&isFreeBarricade(s)&&s.id===this.outline){
      const c0=s.c!*CITY_BUILD_CELL,r0=s.r!*CITY_BUILD_CELL,side=CITY_BUILD_CELL*BARRICADA_CELLS,pts=[[c0,r0],[c0+side,r0],[c0+side,r0+side],[c0,r0+side]]
        .map(([wx,wy])=>{const q=this.project(wx,wy);return {x:q.x,y:q.y};});
      g.lineStyle(5*k,this.c.breu,.6).strokePoints(pts,true).lineStyle(3*k,INTERATIVO_COR,1).strokePoints(pts,true);
    }
    if(junk){
      for(const i of junk){if(flash)i.setTintFill(this.c.claro);else if(alert)i.setTint(ALERT_RED);else i.clearTint();}
      pile?.setVisible(false);
    }else if(img){
      img.setPosition(x,y).setDepth(depth-BAR_OVER_ART);
      if(flash)img.setTintFill(this.c.claro);else if(alert)img.setTint(ALERT_RED);else img.clearTint();
      pile?.setVisible(false);
    }else{
      const a=this.project(span.ax,span.ay),ax=a.x,ay=a.y,b=this.project(span.bx,span.by),bx=b.x,by=b.y;
      const key=`${stage}|${flash?1:0}|${Math.round(ax)},${Math.round(ay)},${Math.round(bx)},${Math.round(by)}|${u.toFixed(3)}|${k.toFixed(2)}`;
      let band=pile;
      if(!band||this.pileKeys.get(s.id)!==key){
        band?.destroy();
        band=TriBand.make(this.scene,gr=>this.drawPile(gr,ax,ay,bx,by,stage,flash,u,k));
        this.piles.set(s.id,band);this.pileKeys.set(s.id,key);
      }
      band.setDepth(depth).setVisible(true);
    }
    const bar=barricadeBar(s.hp,s.maxHp);
    if(!bar.show)return;
    const bw=48*k,bh=6*k;
    // The junk wall is lower than the sofa the lift was made for: the bar sits just over it (muralha.ts top).
    this.drawBar(g,x-bw/2,junk?this.muralha.top-bh-6*k:structureBarY('barricada',y,k,u),bw,bh,bar.fraction,bar.low,k);
  }

  /**
   * The procedural pile from screen point A to B (the mouth's ends): Breu shadow, Casca posts at the ends with a plank
   * across their tops, Papel sandbags with a Breu contour (D-022) in rows that thin out by stage (PILE_ROWS). Damaged:
   * one post broken short, the plank hanging from the other, a torn bag. About to fall: two rows, one leaning post, no
   * plank. Down: nothing (a fallen barricade is gone). Stage reads by shape, not only colour.
   * `u`: actor scale (sizes at the endless map's size); `k`: world px per CSS px (the contour never under 1.5 CSS px).
   */
  private drawPile(g:Phaser.GameObjects.Graphics,ax:number,ay:number,bx:number,by:number,stage:DamageStage,flash:boolean,u:number,k:number){
    const c=this.c,len=Math.max(1,Math.hypot(bx-ax,by-ay)),line=Math.max(2*u,1.5*k);
    const fill=flash?c.claro:mix(c.papel,c.pedra,PILE_LIGHT[stage]),at=(t:number)=>({x:ax+(bx-ax)*t,y:ay+(by-ay)*t});
    const bagW=len/5*1.12,bagH=14*u,radius=Math.min(bagH/2,5*u);
    // A Casca board with a Breu edge (posts and planks).
    const board=(x0:number,y0:number,x1:number,y1:number,w:number,alpha=1)=>{
      g.lineStyle(w*u+2*line,c.breu,alpha).lineBetween(x0,y0,x1,y1);
      g.lineStyle(w*u,c.casca,alpha).lineBetween(x0,y0,x1,y1);
    };
    const bag=(cx:number,cy:number,alpha=1)=>{
      g.fillStyle(fill,alpha).fillRoundedRect(cx-bagW/2,cy-bagH/2,bagW,bagH,radius);
      g.lineStyle(line,c.breu,alpha).strokeRoundedRect(cx-bagW/2,cy-bagH/2,bagW,bagH,radius);
    };
    // Down: nothing (the old flat bags and fallen plank, card remover-desenhos-antigos): a fallen barricade is gone.
    if(stage===3)return;
    g.lineStyle(bagH*1.5,c.breu,.22).lineBetween(ax,ay+4*u,bx,by+4*u);
    // Posts at both ends, behind the bags: whole stands both with the plank on top; damaged has one broken short and
    // the plank hanging; about to fall keeps one leaning post.
    const POST=48,e0=at(.04),e1=at(.96);
    if(stage===0){
      board(e0.x,e0.y,e0.x,e0.y-POST*u,6);board(e1.x,e1.y,e1.x,e1.y-POST*u,6);
      board(e0.x,e0.y-(POST-8)*u,e1.x,e1.y-(POST-8)*u,7);
    }else if(stage===1){
      board(e0.x,e0.y,e0.x,e0.y-POST*u,6);board(e1.x,e1.y,e1.x,e1.y-26*u,6);
      board(e0.x,e0.y-(POST-8)*u,e1.x,e1.y-10*u,7);
    }else board(e0.x,e0.y,e0.x+16*u,e0.y-38*u,6);
    const rows=PILE_ROWS[stage],base=rows[0];
    rows.forEach((n,r)=>{
      // Upper rows are shorter and centred; back bags (smaller screen y) first so the near ones overlap them.
      const order=Array.from({length:n},(_,i)=>at(.5+((i+.5)/n-.5)*(n/base)));
      order.sort((p,q)=>p.y-q.y);
      for(const q of order)bag(q.x,q.y-r*bagH*.82);
    });
    if(stage>=1){
      // A torn bag: a Breu slit on the top row's first bag.
      const top=rows.length-1,q=at(.5+(.5/rows[top]-.5)*(rows[top]/base)),cy=q.y-top*bagH*.82;
      g.lineStyle(line,c.breu,1).lineBetween(q.x-bagW*.25,cy-bagH*.15,q.x+bagW*.15,cy+bagH*.2);
    }
  }

  /**
   * A loot crate's imported art (cidade-07 crates are gather nodes `caixa-*`): closed, opening while gathered (the
   * frame follows the progress) and open and faded once empty. Without the art nothing changes (the node sticker).
   */
  private drawCrate(n:NodeView,near:boolean,u:number){
    const key=`node:${n.id}`,id=BASE_ART.crate;
    if(!near){this.images.get(key)?.setVisible(false);return;}
    const opening=n.remaining<=0||n.progress>0,frames=baseStateFrames(id,'abrindo');
    const frame=n.remaining<=0?frames-1:Math.min(frames-1,Math.floor(n.progress*frames));
    const img=this.art(key,id,opening?'abrindo':'fechada',0,u,opening?frame:0);
    if(!img)return;
    const p=this.project(n.x,n.y);
    img.setPosition(p.x,p.y).setDepth(this.options.projector.depth(n.x,n.y)).setAlpha(n.remaining<=0?.35:1);
  }

  /** Chinelo tower: a small stand with a sandal on top and a Papel bar of the time it has left (`u`, `k`: as drawWall). */
  private drawTower(s:StructureView,k:number,u:number){
    let g=this.towers.get(s.id);
    if(!g){g=this.scene.add.graphics().setName('base-torre');this.towers.set(s.id,g);}
    g.clear();
    const p=this.project(s.x,s.y),c=this.c,x=p.x,y=p.y;
    g.setDepth(this.options.projector.depth(s.x,s.y));
    // Lighting card: a soft cast shadow away from the sun (screen right-down), off in economy mode and with `?luz=0`.
    // Three soft layers of the lit shadow colour, ~0.26 where they all overlap (the contrast rule's cast shadow, not Breu).
    if(LIGHT&&!this.options.reduced&&!this.economy)for(let i=3;i>=1;i--)g.fillStyle(LIT_SHADOW.color,.08+.01*(3-i)).fillEllipse(x+(10+6*i)*u,y+(5+3*i)*u,(40+18*i)*u,(14+5*i)*u);
    g.fillStyle(c.breu,.25).fillEllipse(x,y+3*u,46*u,18*u);
    g.lineStyle(2*u,c.breu,1).fillStyle(c.papel,1);
    g.fillRect(x-14*u,y-34*u,5*u,34*u).strokeRect(x-14*u,y-34*u,5*u,34*u).fillRect(x+9*u,y-34*u,5*u,34*u).strokeRect(x+9*u,y-34*u,5*u,34*u);
    g.fillRoundedRect(x-20*u,y-42*u,40*u,10*u,3*u).strokeRoundedRect(x-20*u,y-42*u,40*u,10*u,3*u);
    // The sandal: a Lilás sole with a Papel strap (Havaiana of the vó).
    g.fillStyle(c.lilas,1).fillEllipse(x,y-52*u,30*u,13*u).strokeEllipse(x,y-52*u,30*u,13*u);
    g.lineStyle(3*u,c.papel,1).lineBetween(x-3*u,y-56*u,x+8*u,y-50*u).lineBetween(x-3*u,y-56*u,x+8*u,y-56*u);
    if(s.untilTick!==undefined){
      const left=Math.max(0,Math.min(1,(s.untilTick-this.tick)/(TOWER_SECONDS*SIM_HZ))),bw=36*k,bh=5*k,by=structureBarY('torre',y,k,u);
      g.fillStyle(c.breu,1).fillRect(x-bw/2-k,by-k,bw+2*k,bh+2*k).fillStyle(c.papel,1).fillRect(x-bw/2,by,bw*left,bh);
    }
  }

  private pop(n:NodeView,amount:number){
    const text=this.scene.add.text(0,0,`+${amount}`,{...this.labelStyle,fontSize:'21px'}).setOrigin(.5,1).setDepth(96000);
    this.pops.push({text,x:n.x,y:n.y,born:this.now});
  }
  private drawPops(k:number){
    this.pops=this.pops.filter(p=>{
      const age=this.now-p.born;
      if(age>=POP_MS){p.text.destroy();return false;}
      const q=this.project(p.x,p.y),t=age/POP_MS,rise=this.options.reduced?0:28*t;
      p.text.setPosition(q.x,q.y-(70+rise)*k).setScale(k).setAlpha(t<.7?1:1-(t-.7)/.3);
      return true;
    });
  }
}

/** Destroys the objects of `map` whose key is not in `keep`. */
function prune(map:Map<string,{destroy():void}>,keep:ReadonlySet<string>){
  for(const [id,o] of map)if(!keep.has(id)){o.destroy();map.delete(id);}
}

/** a·w + b·(1−w), per channel. */
function mix(a:number,b:number,w:number){
  const ch=(v:number,s:number)=>(v>>s)&255,m=(s:number)=>Math.round(ch(a,s)*w+ch(b,s)*(1-w));
  return (m(16)<<16)|(m(8)<<8)|m(0);
}
