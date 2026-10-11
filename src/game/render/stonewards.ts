/**
 * Stonewards in the world (VGM-046B): the wall/shelter at the base with its life bar, the camp ring (only in the
 * intermission, where the forge works), the chinelo towers, and the gather nodes with their value, units left and the
 * progress of the unit being gathered. Nodes and the ring only show in the intermission: the wave stays readable.
 *
 * Everything that sits on the map follows the double-edge rule (D-022): light body (Papel) + Breu contour. Sizes are
 * CSS px (divided by the camera zoom), so the markers read the same at every zoom. Colors only from the tokens:
 * Verde Cartolina for the wall's life (a favor), Laranja Cone when it is low (with the bar's notch as a second cue).
 * Pure drawing: no simulation, no network; the scene pushes each new RunView and calls update every frame.
 */
import Phaser from 'phaser';
import type {NodeView,RunView,StructureView} from '../sim/view.ts';
import {CAMP_RADIUS,TOWER_SECONDS} from '../sim/stonewards/rules.ts';
import {SIM_HZ} from '../sim/types.ts';
import type {Projector,Pt} from './projector.ts';
import {WALL_LOW,gatheredSince,wallBar} from './stonewards-rules.ts';

export {WALL_LOW,gatheredSince,wallBar};
import {token,tokenColor,whenFontsReady} from '../../ui/tokens.ts';

/** A unit gathered: "+N" rises this long over its node. */
const POP_MS=900;
/** Node markers: ficha size in CSS px. */
const MARK_W=46,MARK_H=24;
const RING_SEGMENTS=56;

interface Pop {text:Phaser.GameObjects.Text;x:number;y:number;born:number}
interface NodeMark {view:NodeView;label:Phaser.GameObjects.Text}

export interface StonewardsRendererOptions {projector:Projector;reduced:boolean}

export class StonewardsRenderer {
  private scene:Phaser.Scene;
  private options:StonewardsRendererOptions;
  /** Camp ring and node markers, on the ground (under props and bodies). */
  private ground:Phaser.GameObjects.Graphics;
  /** The wall at its own depth (heroes and trees sort around it). */
  private wall:Phaser.GameObjects.Graphics;
  /** Towers, sorted by their own depth. */
  private towers=new Map<string,Phaser.GameObjects.Graphics>();
  private marks=new Map<string,NodeMark>();
  private pops:Pop[]=[];
  private structures:StructureView[]=[];
  private prepare=false;
  private tick=0;
  private now=0;
  private q:Pt={x:0,y:0};
  private ringPts=Array.from({length:RING_SEGMENTS},()=>({x:0,y:0}));
  private readonly c={breu:0,papel:0,lilas:0,cartolina:0,cone:0,escuro:0};
  private labelStyle:Phaser.Types.GameObjects.Text.TextStyle;

  constructor(scene:Phaser.Scene,options:StonewardsRendererOptions){
    this.scene=scene;this.options=options;
    this.ground=scene.add.graphics().setDepth(-9980);
    this.wall=scene.add.graphics();
    const c=this.c;
    c.breu=tokenColor('--c-breu');c.papel=tokenColor('--c-papel');c.lilas=tokenColor('--c-lilas');
    c.cartolina=tokenColor('--c-cartolina');c.cone=tokenColor('--c-cone');
    // Lilás escuro (a mix in tokens.css): the same 72/28 blend of Lilás and Breu, for the stones.
    c.escuro=mix(c.lilas,c.breu,.72);
    this.labelStyle={fontFamily:token('--f-cartaz'),fontSize:'16px',color:token('--c-papel'),stroke:token('--c-breu'),strokeThickness:4};
    whenFontsReady(()=>{for(const m of this.marks.values())m.label.setStyle(this.labelStyle);});
  }

  /** A new authoritative view: structures, nodes, phase; "+N" pops for the units that came out since the last one. */
  push(view:RunView){
    this.tick=view.tick;this.structures=view.structures;
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
    const towerIds=new Set(this.structures.filter(s=>s.kind!=='muralha').map(s=>s.id));
    for(const [id,g] of this.towers)if(!towerIds.has(id)){g.destroy();this.towers.delete(id);}
  }

  /** After a view turn or a depth re-base: positions and depths are recomputed on the next update anyway. */
  refresh(){this.update(this.now);}

  update(time:number){
    this.now=time;
    const k=1/Math.max(.05,this.scene.cameras.main.zoom);
    this.ground.clear();
    const wall=this.structures.find(s=>s.kind==='muralha');
    if(wall&&this.prepare)this.drawRing(wall,k);
    for(const m of this.marks.values())this.drawNode(m,k);
    this.drawWall(wall,k);
    for(const s of this.structures)if(s.kind!=='muralha')this.drawTower(s,k);
    this.drawPops(k);
  }

  destroy(){
    this.ground.destroy();this.wall.destroy();
    for(const g of this.towers.values())g.destroy();this.towers.clear();
    for(const m of this.marks.values())m.label.destroy();this.marks.clear();
    for(const p of this.pops)p.text.destroy();this.pops=[];
  }

  private project(x:number,y:number){return this.options.projector.project(x,y,this.q);}

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

  /** Node: a ficha on the ground in front of its tree or rock, with its kind, "×value", units left and progress. */
  private drawNode(m:NodeMark,k:number){
    const n=m.view,g=this.ground,c=this.c;
    const p=this.project(n.x,n.y),x=p.x,y=p.y+18*k;
    const w=MARK_W*k,h=MARK_H*k,empty=n.remaining<=0,alpha=empty?.45:1;
    g.fillStyle(c.breu,.88*alpha).fillRoundedRect(x-w/2,y-h/2,w,h,6*k);
    g.lineStyle(2*k,c.papel,alpha).strokeRoundedRect(x-w/2,y-h/2,w,h,6*k);
    // Kind glyph on the left: a coconut (Papel with three Breu eyes) or a stone (Lilás escuro with a Papel edge).
    const gx=x-w/2+11*k,gy=y;
    if(n.kind==='pedra'){
      const pts=[{x:gx-7*k,y:gy+5*k},{x:gx-6*k,y:gy-3*k},{x:gx,y:gy-7*k},{x:gx+7*k,y:gy-3*k},{x:gx+7*k,y:gy+5*k}];
      g.fillStyle(c.escuro,alpha).fillPoints(pts,true).lineStyle(1.5*k,c.papel,alpha).strokePoints(pts,true);
    }else{
      g.fillStyle(c.papel,alpha).fillCircle(gx,gy,7*k).lineStyle(1.5*k,c.breu,alpha).strokeCircle(gx,gy,7*k);
      g.fillStyle(c.breu,alpha).fillCircle(gx-2.5*k,gy-2*k,1.3*k).fillCircle(gx+2.5*k,gy-2*k,1.3*k).fillCircle(gx,gy+2.5*k,1.3*k);
    }
    m.label.setPosition(x+8*k,y).setScale(k).setAlpha(alpha).setDepth(-9970);
    // Units left as pips under the ficha: Papel = still there, Breu outline = gathered. Shape, not only color.
    const cap=Math.max(1,Math.min(8,n.capacity)),pip=4*k,gap=2*k,total=cap*pip+(cap-1)*gap;
    for(let i=0;i<cap;i++){
      const px=x-total/2+i*(pip+gap),py=y+h/2+3*k,full=i<n.remaining;
      g.fillStyle(full?c.papel:c.breu,alpha).fillRect(px,py,pip,pip);
      g.lineStyle(1*k,c.breu,alpha).strokeRect(px,py,pip,pip);
    }
    // The unit being gathered right now: a Cartolina bar along the bottom edge (feedback while standing there).
    if(n.progress>0&&!empty){
      g.fillStyle(c.cartolina,1).fillRect(x-w/2+3*k,y+h/2-5*k,(w-6*k)*Math.min(1,n.progress),3*k);
    }
  }

  /** The wall/shelter: a ring of stones with a lona tent and its flag, plus the life bar above it. */
  private drawWall(wall:StructureView|undefined,k:number){
    const g=this.wall;g.clear();
    if(!wall){g.setVisible(false);return;}
    g.setVisible(true);
    const p=this.project(wall.x,wall.y),c=this.c,x=p.x,y=p.y,down=wall.hp<=0;
    g.setDepth(this.options.projector.depth(wall.x,wall.y));
    // Shadow, stone ring (a low wall), tent, flag. Drawn in world px: the wall is part of the map, it zooms with it.
    g.fillStyle(c.breu,.25).fillEllipse(x,y+6,150,56);
    const stones=down?7:14;
    for(let i=0;i<stones;i++){
      const a=Math.PI*(1+i/(stones-1)),sx=x+Math.cos(a)*62,sy=y+Math.sin(a)*24-4;
      g.fillStyle(c.escuro,1).fillRoundedRect(sx-11,sy-10,22,16,5).lineStyle(2,c.breu,1).strokeRoundedRect(sx-11,sy-10,22,16,5);
    }
    if(!down){
      const tent=[{x:x-40,y:y+6},{x:x,y:y-62},{x:x+40,y:y+6}];
      g.fillStyle(c.papel,1).fillPoints(tent,true).lineStyle(2.5,c.breu,1).strokePoints(tent,true);
      g.fillStyle(c.breu,1).fillTriangle(x-10,y+6,x,y-18,x+10,y+6);
      g.lineStyle(3,c.breu,1).lineBetween(x,y-62,x,y-92);
      const flag=[{x:x,y:y-92},{x:x+26,y:y-85},{x:x,y:y-77}];
      g.fillStyle(c.lilas,1).fillPoints(flag,true).lineStyle(2,c.breu,1).strokePoints(flag,true);
    }
    for(let i=0;i<stones;i++){
      const a=Math.PI*(i/(stones-1)),sx=x+Math.cos(a)*62,sy=y+Math.sin(a)*24-2;
      g.fillStyle(c.escuro,1).fillRoundedRect(sx-12,sy-11,24,18,5).lineStyle(2,c.breu,1).strokeRoundedRect(sx-12,sy-11,24,18,5);
    }
    if(down)return;
    // Life bar (CSS px): Breu track, Papel edge, Cartolina fill; under WALL_LOW it turns Cone and gets a notch.
    const {fraction,low}=wallBar(wall.hp,wall.maxHp),bw=96*k,bh=10*k,bx=x-bw/2,by=y-104-24*k;
    g.fillStyle(c.breu,1).fillRoundedRect(bx-2*k,by-2*k,bw+4*k,bh+4*k,4*k);
    g.fillStyle(low?c.cone:c.cartolina,1).fillRect(bx,by,bw*fraction,bh);
    g.lineStyle(2*k,c.papel,1).strokeRoundedRect(bx-2*k,by-2*k,bw+4*k,bh+4*k,4*k);
    if(low)g.fillStyle(c.breu,1).fillTriangle(bx+bw*WALL_LOW-4*k,by-2*k,bx+bw*WALL_LOW+4*k,by-2*k,bx+bw*WALL_LOW,by+4*k);
  }

  /** Chinelo tower: a small stand with a sandal on top and a Papel bar of the time it has left. */
  private drawTower(s:StructureView,k:number){
    let g=this.towers.get(s.id);
    if(!g){g=this.scene.add.graphics();this.towers.set(s.id,g);}
    g.clear();
    const p=this.project(s.x,s.y),c=this.c,x=p.x,y=p.y;
    g.setDepth(this.options.projector.depth(s.x,s.y));
    g.fillStyle(c.breu,.25).fillEllipse(x,y+3,46,18);
    g.lineStyle(2,c.breu,1).fillStyle(c.papel,1);
    g.fillRect(x-14,y-34,5,34).strokeRect(x-14,y-34,5,34).fillRect(x+9,y-34,5,34).strokeRect(x+9,y-34,5,34);
    g.fillRoundedRect(x-20,y-42,40,10,3).strokeRoundedRect(x-20,y-42,40,10,3);
    // The sandal: a Lilás sole with a Papel strap (Havaiana of the vó).
    g.fillStyle(c.lilas,1).fillEllipse(x,y-52,30,13).strokeEllipse(x,y-52,30,13);
    g.lineStyle(3,c.papel,1).lineBetween(x-3,y-56,x+8,y-50).lineBetween(x-3,y-56,x+8,y-56);
    if(s.untilTick!==undefined){
      const left=Math.max(0,Math.min(1,(s.untilTick-this.tick)/(TOWER_SECONDS*SIM_HZ))),bw=36*k,bh=5*k,by=y-66-8*k;
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

/** a·w + b·(1−w), per channel. */
function mix(a:number,b:number,w:number){
  const ch=(v:number,s:number)=>(v>>s)&255,m=(s:number)=>Math.round(ch(a,s)*w+ch(b,s)*(1-w));
  return (m(16)<<16)|(m(8)<<8)|m(0);
}
