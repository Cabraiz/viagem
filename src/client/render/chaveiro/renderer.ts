/**
 * The chaveiro objective in the world (D-047, card NEW-20261013-ORQ-chaveiro-render), provisional art (figures.ts):
 * - the Quadradão 1.0 at the plaza: trembling with the engine on and smoke at the exhaust; its parts fall at the
 *   `parts` marks and stay on the ground; with the alarm, hazard lights and sound waves; a life bar (hits of the limit);
 * - the moto with the chaveiro and Dona Cida: riding, over the speed bump, around the block (alarm), dead (the "2 to
 *   push" icon with the push's progress), delivering (he stands with the bag), fallen (a critter touched it), and the
 *   chaveiro at the car's door while opening it (a 15 s bar);
 * - on the ground: the speed bumps of the route, the next delivery spot (marked ahead), the shadows;
 * - the end: the trunk opens and the charger comes out ("conector errado"); perda total: the car darker, still running.
 * Each figure draws at its own actor depth (the city's column occlusion through the projector) and fades while it
 * covers the hero. Pure drawing: the scene pushes each view's objective and calls update every frame.
 */
import Phaser from 'phaser';
import type {Projector,Pt} from '../projector.ts';
import {token,tokenColor,whenFontsReady} from '../../ui/tokens.ts';
import {LIT_SHADOW,lightEnabled} from '../light.ts';
import {boxFaces,faceBounds,isoOffset,mix,M,viewTurn,type Box,type Face} from './iso.ts';
import {CAR_HALF,CAR_TOP,carBoxes,fallenParts,fallingPart,motoBoxes,standingChaveiro} from './figures.ts';
import {CAR_LOW,PART_FALL_MS,alarmOn,alarmWaves,chargerLabel,engineShake,hazardLit,motoLift,motoPose,openProgress,routeHeadingAt,trunkOpen,voltaCentre,voltaLap} from './rules.ts';
import {ChaveiroTracker} from './tracker.ts';
import {CAR_PARTS,type ChaveiroView} from './view.ts';

const LIGHT=lightEnabled();
/** Effects over the figures (waves, smoke, icons, bars), under the horde's bars (95000) and balloons. */
const FX_DEPTH=94900;
/** The car is parked along the world's x axis (the sim gives no heading). */
const CAR_HEADING=0;
/** Smoke: a puff every SMOKE_MS from the exhaust, living SMOKE_LIFE_MS. */
const SMOKE_MS=380,SMOKE_LIFE_MS=1600;
/** The covering figure's alpha while the hero is behind it. */
const COVER_ALPHA=.45;

export interface ChaveiroRendererOptions {projector:Projector;reduced:boolean;
  /** The local hero (or the watched figure): a figure covering it fades. */
  hero?:()=>Pt|undefined}

/** A smoke puff, drawn with its figure (so a building in front hides it too). */
interface Puff {x:number;y:number;z:number;born:number;dark:boolean;drift:number;moto:boolean}
/** Car faces cached by look (parts, hazard, trunk step, wrecked, view): the car is redrawn every frame, its boxes rarely change. */
const CAR_CACHE_MAX=48;

export class ChaveiroRenderer {
  private scene:Phaser.Scene;
  private options:ChaveiroRendererOptions;
  /** Shadows, speed bumps, the delivery spot and the fallen parts: on the ground, under every figure. */
  private ground:Phaser.GameObjects.Graphics;
  private car:Phaser.GameObjects.Graphics;
  private moto:Phaser.GameObjects.Graphics;
  /** The chaveiro at the car's door (abrindo), at his own depth. */
  private opener:Phaser.GameObjects.Graphics;
  private fx:Phaser.GameObjects.Graphics;
  private label:Phaser.GameObjects.Text;
  private deliveryText:Phaser.GameObjects.Text;
  private state=new ChaveiroTracker();
  private now=0;
  private carFaces=new Map<string,Face[]>();
  private puffs:Puff[]=[];
  private lastPuff=0;
  private q:Pt={x:0,y:0};
  private readonly c={breu:0,papel:0,cone:0,cartolina:0,lilas:0,claro:0};

  constructor(scene:Phaser.Scene,options:ChaveiroRendererOptions){
    this.scene=scene;this.options=options;
    this.ground=scene.add.graphics().setDepth(-9979);
    this.car=scene.add.graphics();this.moto=scene.add.graphics();this.opener=scene.add.graphics();
    this.fx=scene.add.graphics().setDepth(FX_DEPTH);
    const c=this.c;
    c.breu=tokenColor('--c-breu');c.papel=tokenColor('--c-papel');c.cone=tokenColor('--c-cone');
    c.cartolina=tokenColor('--c-cartolina');c.lilas=tokenColor('--c-lilas');c.claro=mix(c.papel,0xffffff,.35);
    const style=()=>({fontFamily:token('--f-cartaz'),fontSize:'16px',color:token('--c-breu'),backgroundColor:token('--c-papel'),padding:{x:6,y:3}});
    this.label=scene.add.text(0,0,'conector errado',style()).setOrigin(.5,1).setDepth(FX_DEPTH+2).setVisible(false);
    this.deliveryText=scene.add.text(0,0,'',{...style(),fontSize:'14px'}).setOrigin(.5,1).setDepth(FX_DEPTH+1).setVisible(false);
    whenFontsReady(()=>{this.label.setStyle(style());this.deliveryText.setStyle({...style(),fontSize:'14px'});});
  }

  /** A new view: the objective (undefined hides it all) at the server tick. */
  push(view:ChaveiroView|undefined,tick:number){this.state.push(view,tick,this.now,this.options.reduced);}

  /** After a view turn or a depth re-base. */
  refresh(){this.update(this.now);}

  update(time:number){
    this.now=time;
    const g=this.ground;g.clear();this.car.clear();this.moto.clear();this.opener.clear();this.fx.clear();
    const st=this.state,view=st.view;
    this.label.setVisible(false);this.deliveryText.setVisible(false);
    if(!view){this.puffs=[];return;}
    const k=1/Math.max(.05,this.scene.cameras.main.zoom),reduced=this.options.reduced,proj=this.options.projector;
    const alarm=alarmOn(view,st.tick),wrecked=view.ended==='defeat';
    const fallingBits=st.settle(time);

    // Ground: speed bumps, the delivery spot, the shadows, the fallen parts.
    for(const s of view.stops??[])if(s.kind==='lombada')this.drawBump(s.x,s.y,routeHeadingAt(view.route,s));
    if(view.delivery)this.drawDelivery(view.delivery,k);
    this.drawShadow(view.car.x,view.car.y,CAR_HALF.l,CAR_HALF.w,CAR_HEADING);
    const parts=fallenParts(view.car.parts,fallingBits);
    if(parts.length)this.drawFigure(g,view.car.x,view.car.y,CAR_HEADING,parts,k,1);

    // The car (and the parts falling off it), trembling: the engine never stops.
    const ended=st.endedAt!==undefined?time-st.endedAt:0;
    const shake=engineShake(time,reduced,alarm),hazard=hazardLit(alarm,time)||(reduced&&alarm);
    const trunk=view.ended==='victory'?Math.round(trunkOpen(ended)*20)/20:0;
    const carFaces=this.carLook(view.car.parts&~fallingBits,hazard,trunk,wrecked,fallingBits,time);
    // Sorted at its centre (not its front corner): critters hitting its sides and back stay in front of it, a figure
    // behind its centre line goes under it (the car is long; the sim's critters hit it from all around).
    const carDepth=proj.depth(view.car.x,view.car.y);
    this.car.setDepth(carDepth);
    this.drawFaces(this.car,view.car.x,view.car.y,carFaces,k,shake);
    this.car.setAlpha(this.covers(view.car.x,view.car.y,carFaces,carDepth)?COVER_ALPHA:1);

    // The moto and its riders.
    const mode=view.moto.mode;
    let mx=view.moto.x,my=view.moto.y,heading=st.heading;
    if(mode==='volta'&&!reduced){const c=voltaCentre(view.moto,view.car),lap=voltaLap(time);mx=c.x+lap.dx;my=c.y+lap.dy;heading=lap.heading;}
    this.drawShadow(mx,my,.8*M,.3*M,heading);
    const motoDepth=proj.depth(mx,my);
    this.moto.setDepth(motoDepth);
    const motoFaces=this.drawFigure(this.moto,mx,my,heading,motoBoxes(motoPose(mode),motoLift(mode,time,reduced)),k,1);
    this.moto.setAlpha(this.covers(mx,my,motoFaces,motoDepth)?COVER_ALPHA:1);
    if(mode==='entrega'){
      // He stands beside the moto with the bag.
      const side=this.local(mx,my,heading,0,1.0*M),f=standingChaveiro(0,0,true);
      this.opener.setDepth(proj.depth(side.x,side.y));
      this.drawFigure(this.opener,side.x,side.y,heading,f,k,1);
    }else if(mode==='abrindo'||view.ended==='victory'){
      // At the car's door (its left side, toward +y), facing it, the tool jiggling at the lock: just in front of the
      // car when that side faces the screen, just behind it otherwise (one figure against a big one: no column split).
      const at=this.local(view.car.x,view.car.y,CAR_HEADING,.2*M,(CAR_HALF.w+.45*M));
      const side=viewTurn(-Math.sin(CAR_HEADING),Math.cos(CAR_HEADING),proj.view),front=side.x+side.y>0;
      const f=standingChaveiro(0,0,false,reduced?0:Math.abs(Math.sin(time*.012)));
      this.opener.setDepth(carDepth+(front?.5:-.5));
      this.drawFigure(this.opener,at.x,at.y,CAR_HEADING-Math.PI/2,f,k,1);
      if(mode==='abrindo'&&!view.ended)this.drawOpening(at.x,at.y,openProgress(view.etaS),k);
    }

    // Effects over everything: smoke, alarm waves, the push icon, the bars, the end label.
    this.smoke(view,mx,my,heading,alarm,time,reduced,k);
    if(alarm)this.drawWaves(view.car.x,view.car.y,k,time,st.alarmSince);
    if(mode==='morta')this.drawPush(mx,my,view.moto.push??0,k,time);
    if(mode==='tombo')this.drawDizzy(mx,my,heading,k,time);
    if(!view.ended)this.drawCarBar(view.car,k);
    if(view.ended==='victory'&&chargerLabel(ended)){
      const p=this.at(view.car.x,view.car.y,-1.7*M,0,CAR_TOP+.9*M);
      this.label.setPosition(p.x,p.y).setScale(k).setVisible(true);
    }
  }

  destroy(){
    this.ground.destroy();this.car.destroy();this.moto.destroy();this.opener.destroy();this.fx.destroy();
    this.label.destroy();this.deliveryText.destroy();this.puffs=[];
  }

  /** Screen point of a world point plus a local offset (forward, left, up in units) at the car's heading. */
  private at(x:number,y:number,fwd:number,left:number,z:number):Pt{
    const p=this.options.projector.project(x,y,this.q),o=isoOffset(fwd*Math.cos(CAR_HEADING)-left*Math.sin(CAR_HEADING),fwd*Math.sin(CAR_HEADING)+left*Math.cos(CAR_HEADING),z,this.options.projector.view);
    return {x:p.x+o.x,y:p.y+o.y};
  }
  /** World point at (forward, left) units from (x, y) at `heading`. */
  private local(x:number,y:number,heading:number,fwd:number,left:number){
    return {x:x+fwd*Math.cos(heading)-left*Math.sin(heading),y:y+fwd*Math.sin(heading)+left*Math.cos(heading)};
  }
  /**
   * The car's faces for this look: cached while no part is falling (a falling part moves every frame); the cache is
   * small and dropped whole when full.
   */
  private carLook(parts:number,hazard:boolean,trunk:number,wrecked:boolean,falling:number,time:number):Face[]{
    const view=this.options.projector.view,key=`${parts}|${hazard?1:0}|${trunk}|${wrecked?1:0}|${view}`;
    if(!falling){const hit=this.carFaces.get(key);if(hit)return hit;}
    const boxes:Box[]=carBoxes({parts,hazard,trunk,wrecked});
    for(const [bit,at] of this.state.falling)boxes.push(...fallingPart(CAR_PARTS[Math.log2(bit)],(time-at)/PART_FALL_MS));
    const faces=boxFaces(boxes,CAR_HEADING,view);
    if(!falling){if(this.carFaces.size>=CAR_CACHE_MAX)this.carFaces.clear();this.carFaces.set(key,faces);}
    return faces;
  }
  /** The hero stands behind the figure and inside its screen box: it fades. */
  private covers(x:number,y:number,faces:readonly Face[],depth:number){
    const hero=this.options.hero?.();if(!hero||!faces.length)return false;
    if(this.options.projector.depth(hero.x,hero.y)>=depth)return false;
    const p=this.options.projector.project(x,y,this.q),ax=p.x,ay=p.y,h=this.options.projector.project(hero.x,hero.y,{x:0,y:0});
    const b=faceBounds(faces);
    return h.x>ax+b.x0&&h.x<ax+b.x1&&h.y-30>ay+b.y0&&h.y-10<ay+b.y1;
  }
  /** Fills the boxes' faces at the world point (x, y), Breu contour in CSS px; returns the faces drawn. */
  private drawFigure(g:Phaser.GameObjects.Graphics,x:number,y:number,heading:number,boxes:readonly Box[],k:number,alpha:number,shift?:{x:number;y:number}){
    const faces=boxFaces(boxes,heading,this.options.projector.view);
    this.drawFaces(g,x,y,faces,k,shift,alpha);
    return faces;
  }
  private pts=[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}];
  private drawFaces(g:Phaser.GameObjects.Graphics,x:number,y:number,faces:readonly Face[],k:number,shift?:{x:number;y:number},alpha=1){
    const p=this.options.projector.project(x,y,this.q),ax=p.x+(shift?.x??0),ay=p.y+(shift?.y??0),pts=this.pts;
    for(const f of faces){
      for(let i=0;i<4;i++){pts[i].x=ax+f.pts[i].x;pts[i].y=ay+f.pts[i].y;}
      g.fillStyle(f.color,f.alpha*alpha).fillPoints(pts,true);
      if(f.line)g.lineStyle(1.2*k,this.c.breu,.9*alpha).strokePoints(pts,true);
    }
  }
  /** A figure's cast shadow: its footprint pushed toward the lower right (away from the sun). */
  private drawShadow(x:number,y:number,hl:number,hw:number,heading:number){
    const v=this.options.projector.view,p=this.options.projector.project(x,y,this.q),ax=p.x+10,ay=p.y+4;
    const corners=[[hl,hw],[-hl,hw],[-hl,-hw],[hl,-hw]].map(([u,w])=>{
      const o=isoOffset(u*Math.cos(heading)-w*Math.sin(heading),u*Math.sin(heading)+w*Math.cos(heading),0,v);
      return {x:ax+o.x*1.12,y:ay+o.y*1.12};
    });
    const color=LIGHT?LIT_SHADOW.color:this.c.breu,alpha=LIGHT?LIT_SHADOW.alpha:.25;
    this.ground.fillStyle(color,alpha).fillPoints(corners,true);
  }
  /** A speed bump across the road: Papel and Breu stripes. */
  private drawBump(x:number,y:number,heading:number){
    const g=this.ground,v=this.options.projector.view,p=this.options.projector.project(x,y,this.q);
    const ca=Math.cos(heading),sa=Math.sin(heading),o=(u:number,w:number)=>{const q=isoOffset(u*ca-w*sa,u*sa+w*ca,0,v);return {x:p.x+q.x,y:p.y+q.y};};
    for(let i=-4;i<4;i++){
      const w=.45*M;
      g.fillStyle(i&1?this.c.breu:this.c.papel,.85).fillPoints([o(.4*M,i*w),o(-.4*M,i*w),o(-.4*M,(i+1)*w),o(.4*M,(i+1)*w)],true);
    }
  }
  /** The next delivery: a ring on the ground and a tag with the seconds until he gets there. */
  private drawDelivery(d:{x:number;y:number;etaS:number},k:number){
    const p=this.options.projector.project(d.x,d.y,this.q),r=1.2*M*42;
    const pulse=this.options.reduced?0:Math.sin(this.now*.006)*.08;
    this.ground.lineStyle(3*k,this.c.breu,.9).strokeEllipse(p.x,p.y,r*2*(1+pulse),r*(1+pulse));
    this.ground.lineStyle(2*k,this.c.papel,1).strokeEllipse(p.x,p.y,r*2*(1+pulse),r*(1+pulse));
    this.deliveryText.setText(`entrega · ${Math.max(0,Math.ceil(d.etaS))} s`).setPosition(p.x,p.y-r*.6).setScale(k).setVisible(true);
  }
  /** Smoke puffs: the car's exhaust always (the engine runs), the moto's when it runs (light) or died (dark). */
  private smoke(view:ChaveiroView,mx:number,my:number,heading:number,alarm:boolean,time:number,reduced:boolean,k:number){
    if(reduced){this.puffs=[];return;}
    if(time-this.lastPuff>=SMOKE_MS){
      this.lastPuff=time;
      const pipe=this.local(view.car.x,view.car.y,CAR_HEADING,-1.95*M,-.5*M);
      this.puffs.push({x:pipe.x,y:pipe.y,z:.3*M,born:time,dark:view.ended==='defeat'||alarm,drift:Math.sin(time)*.3,moto:false});
      const mode=view.moto.mode;
      if(mode==='morta'||mode==='anda'||mode==='lombada'||mode==='volta'){
        const m=this.local(mx,my,heading,-.75*M,-.18*M);
        this.puffs.push({x:m.x,y:m.y,z:.35*M,born:time,dark:mode==='morta',drift:Math.cos(time)*.3,moto:true});
      }
    }
    this.puffs=this.puffs.filter(p=>time-p.born<SMOKE_LIFE_MS);
    const v=this.options.projector.view;
    for(const p of this.puffs){
      const t=(time-p.born)/SMOKE_LIFE_MS,s=this.options.projector.project(p.x,p.y,this.q),o=isoOffset(p.drift*t*M,0,p.z+t*1.1*M,v);
      const color=p.dark?mix(this.c.breu,this.c.papel,.25):mix(this.c.papel,0xffffff,.4);
      (p.moto?this.moto:this.car).fillStyle(color,(1-t)*.55).fillCircle(s.x+o.x,s.y+o.y,(4+10*t)*Math.max(.6,k*.8));
    }
  }
  /** The alarm's sound waves: Cone arcs growing off the roof. */
  private drawWaves(x:number,y:number,k:number,time:number,since:number|undefined){
    const top=this.at(x,y,0,0,CAR_TOP);
    const waves=alarmWaves(since,time,this.options.reduced);
    if(!waves.length){
      // Reduced effects: one still ring says it all.
      this.fx.lineStyle(3*k,this.c.cone,.9).strokeEllipse(top.x,top.y-6*k,90*k,30*k);return;
    }
    for(const t of waves){
      const w=(40+120*t)*k,h=w*.42,a=1-t;
      this.fx.lineStyle(4*k,this.c.breu,a*.5).strokeEllipse(top.x,top.y-6*k-20*t*k,w,h);
      this.fx.lineStyle(2.5*k,this.c.cone,a).strokeEllipse(top.x,top.y-6*k-20*t*k,w,h);
    }
  }
  /** The dead moto: "2 to push" (two figures leaning on a box) over it, with the push's progress. */
  private drawPush(x:number,y:number,push:number,k:number,time:number){
    const p=this.options.projector.project(x,y,this.q),cx=p.x,cy=p.y-2.4*M*42,g=this.fx,c=this.c;
    const r=22*k,bob=this.options.reduced?0:Math.sin(time*.008)*2*k;
    g.fillStyle(c.breu,.92).fillCircle(cx,cy+bob,r+3*k);
    g.fillStyle(c.papel,1).fillCircle(cx,cy+bob,r);
    if(push>0){g.lineStyle(4*k,c.cartolina,1).beginPath().arc(cx,cy+bob,r+1*k,-Math.PI/2,-Math.PI/2+push*Math.PI*2).strokePath();}
    // two pushers leaning on a small moto: heads, bodies bent forward, arms on its back, a leg pushing back
    const y0=cy+bob;
    for(const dx of [-13,-4]){
      const hx=cx+dx*k,hy=y0-6*k;
      g.fillStyle(c.breu,1).fillCircle(hx,hy,3.4*k);
      g.lineStyle(3*k,c.breu,1).lineBetween(hx+1*k,hy+3*k,hx-2*k,hy+11*k).lineBetween(hx+1*k,hy+4*k,hx+8*k,hy+5*k)
        .lineBetween(hx-2*k,hy+11*k,hx-6*k,hy+17*k).lineBetween(hx-2*k,hy+11*k,hx+1*k,hy+17*k);
    }
    g.fillStyle(c.lilas,1).fillRoundedRect(cx+4*k,y0-4*k,13*k,8*k,2*k);
    g.fillStyle(c.breu,1).fillCircle(cx+6*k,y0+6*k,3*k).fillCircle(cx+15*k,y0+6*k,3*k);
  }
  /** Fallen: little stars around the riders' heads (they sit on the snow beside the moto). */
  private drawDizzy(x:number,y:number,heading:number,k:number,time:number){
    const at=this.local(x,y,heading,-.4*M,.88*M),p=this.options.projector.project(at.x,at.y,this.q),cy=p.y-1.25*M*42,g=this.fx;
    const spin=this.options.reduced?0:time*.004;
    for(let i=0;i<3;i++){
      const a=spin+i*Math.PI*2/3,sx=p.x+Math.cos(a)*16*k,sy=cy+Math.sin(a)*5*k;
      star(g,sx,sy,5*k,this.c.papel,this.c.breu,k);
    }
  }
  /** The car's life: the hits left of the limit, the wall's bar (Cartolina, Cone and a notch when low). */
  private drawCarBar(car:ChaveiroView['car'],k:number){
    const top=this.at(car.x,car.y,0,0,CAR_TOP),left=car.limit>0?Math.max(0,1-car.hits/car.limit):0,low=left<CAR_LOW;
    const bw=72*k,bh=8*k,bx=top.x-bw/2,by=top.y-40*k,g=this.fx,c=this.c;
    g.fillStyle(c.breu,1).fillRoundedRect(bx-2*k,by-2*k,bw+4*k,bh+4*k,4*k);
    g.fillStyle(low?c.cone:c.cartolina,1).fillRect(bx,by,bw*left,bh);
    g.lineStyle(2*k,c.papel,1).strokeRoundedRect(bx-2*k,by-2*k,bw+4*k,bh+4*k,4*k);
  }
  /** Opening the car: a Papel bar filling over the 15 s, over the chaveiro's head at the door. */
  private drawOpening(x:number,y:number,progress:number,k:number){
    const top=this.at(x,y,0,0,1.9*M),bw=56*k,bh=6*k,bx=top.x-bw/2,by=top.y-10*k,g=this.fx,c=this.c;
    g.fillStyle(c.breu,1).fillRoundedRect(bx-2*k,by-2*k,bw+4*k,bh+4*k,3*k);
    g.fillStyle(c.papel,1).fillRect(bx,by,bw*progress,bh);
  }
}

/** A small five-point star (Papel with a Breu edge), centre (x, y), outer radius r. */
function star(g:Phaser.GameObjects.Graphics,x:number,y:number,r:number,fill:number,edge:number,k:number){
  const pts=Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,rr=i&1?r*.45:r;return {x:x+Math.cos(a)*rr,y:y+Math.sin(a)*rr};});
  g.fillStyle(fill,1).fillPoints(pts,true).lineStyle(1.2*k,edge,1).strokePoints(pts,true);
}
