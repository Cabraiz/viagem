/**
 * The chaveiro objective in the world (D-047, card NEW-20261013-ORQ-chaveiro-render), provisional art (figures.ts):
 * - the Quadradão 1.0 at the plaza: trembling with the engine on and smoke at the exhaust; its parts fall at the
 *   `parts` marks and stay on the ground; with the alarm, hazard lights and sound waves; a life bar (hits of the limit);
 * - the moto with the chaveiro and Dona Cida: riding, over the speed bump, around the block (alarm), dead (the "2 to
 *   push" icon with the push's progress), delivering (he stands with the bag), fallen (a critter touched it), and the
 *   chaveiro at the car's door while opening it (a 15 s bar);
 * - on the ground: the next delivery spot (marked ahead), the shadows (the speed bumps have no drawing);
 * - the end: the trunk opens and the charger comes out ("conector errado"); perda total: the car darker, still running.
 * Card NEW-20261022-ORQ-uno-no-jogo: once its sheet is in, the car is the imported Uno (uno-art.ts, 8 views) instead of
 * the boxes; its lost parts and the wreck only darken it and the trunk does not open (no such views yet).
 * Each figure draws at its own actor depth (the city's column occlusion through the projector) and fades while it
 * covers the hero. Pure drawing: the scene pushes each view's objective and calls update every frame.
 * Card trocar-procedurais-por-arte: the moto with its riders and the chaveiro standing are the painted sheet
 * (moto-art.ts) once it is loaded; the boxes stay only while it is missing or loading.
 */
import Phaser from 'phaser';
import type {Projector,Pt} from '../projector.ts';
import {token,tokenColor,whenFontsReady} from '../../ui/tokens.ts';
import {LIT_SHADOW,lightEnabled} from '../light.ts';
import {boxFaces,faceBounds,isoOffset,mix,M,viewTurn,type Box,type Face} from './iso.ts';
import {CAR_HALF,CAR_TOP,carBoxes,fallenParts,fallingPart,motoBoxes,standingChaveiro} from './figures.ts';
import {CAR_LOW,PART_FALL_MS,alarmOn,easeAngle,wheelStep,alarmWaves,chargerLabel,engineShake,hazardLit,motoLift,motoPose,openProgress,trunkOpen,voltaCentre,voltaLap,deliveryKey,deliveryPulse,fallenKey} from './rules.ts';
import {ChaveiroTracker} from './tracker.ts';
import {MOTO_POSE_STATE,applyMotoArt,imageBounds,motoColumn} from './moto-art.ts';
import {TriBand} from '../city/tri-band.ts';
import {CAR_PARTS,type ChaveiroView} from './view.ts';
import {UsableGlow} from '../usable-glow.ts';
import {UNO_CELL,UNO_FOOT,UNO_KEY,UNO_SCALE,UNO_URL,unoBox,unoFootY,unoFrame} from './uno-art.ts';

const LIGHT=lightEnabled();
/** Effects over the figures (waves, smoke, icons, bars), under the horde's bars (95000) and balloons. */
const FX_DEPTH=94900;
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
/** The ground's frozen pieces, in the order the one Graphics drew them: the delivery ring under the shadows, the fallen parts over. */
const DELIVERY_DEPTH=-9979.001,FALLEN_DEPTH=-9978.999;
/** Frozen figures kept per role (car, moto, the chaveiro standing): a few looks each (hazard on/off, poses, headings). */
const FROZEN_MAX=24;
/** The moto's heading is frozen in this many steps per turn (5.6°: its route turns rarely). */
const HEADING_STEPS=64;

/**
 * A figure frozen into triangles (city/tri-band.ts), one per look: Phaser 3.90 replays a Graphics' commands every frame
 * and triangulates every fillPoints with earcut, which made the car and the moto (≈ 4 700 commands) the heaviest thing
 * of a city frame on a phone (BUG-20261014-ORQ-engasgo-andando-celular). A look is drawn once; each frame only moves
 * it (the engine's shake, the moto's bounce), sets its depth and alpha. Kept small: the oldest look goes first.
 */
class FrozenFigures {
  private looks=new Map<string,{band:TriBand;faces:Face[]}>();
  private shown?:TriBand;
  constructor(private scene:Phaser.Scene,private breu:()=>number){}
  /** The look `key` (made from `faces` the first time, its contour `k` CSS px wide) shown alone; returns its faces. */
  show(key:string,faces:()=>Face[],k:number,x:number,y:number,depth:number,alpha:number):Face[]{
    let look=this.looks.get(key);
    if(look){this.looks.delete(key);this.looks.set(key,look);}
    else{
      const f=faces(),breu=this.breu();
      const band=TriBand.make(this.scene,g=>{
        for(const face of f){
          g.fillStyle(face.color,face.alpha).fillPoints(face.pts,true);
          if(face.line)g.lineStyle(1.2*k,breu,.9).strokePoints(face.pts,true);
        }
      });
      look={band,faces:f};this.looks.set(key,look);
      while(this.looks.size>FROZEN_MAX){const [old,o]=this.looks.entries().next().value!;if(o.band===this.shown)this.shown=undefined;o.band.destroy();this.looks.delete(old);}
    }
    if(this.shown&&this.shown!==look.band)this.shown.setVisible(false);
    this.shown=look.band;
    look.band.setPosition(x,y).setDepth(depth).setAlpha(alpha).setVisible(true);
    return look.faces;
  }
  hide(){this.shown?.setVisible(false);this.shown=undefined;}
  destroy(){for(const l of this.looks.values())l.band.destroy();this.looks.clear();this.shown=undefined;}
}

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
  /** D-052, the car moves: its heading eased toward the tracker's (radians, unquantized) and the frame's clock. */
  private carTurn=0;
  private lastTime?:number;
  /** The car's heading drawn this frame (radians, in HEADING_STEPS): the rope (fortify.ts) hooks to its bumpers. */
  carHeading=0;
  private readonly c={breu:0,papel:0,cone:0,cartolina:0,lilas:0,claro:0};
  /** The car, the moto and the standing chaveiro, frozen per look (FrozenFigures). */
  private frozenCar:FrozenFigures;private frozenMoto:FrozenFigures;private frozenOpener:FrozenFigures;
  /**
   * Card Q2: the parts lying on the ground (frozen per set, like the car) and the delivery ring (frozen per contour
   * width, breathing by scale): the chaveiro's ground Graphics replayed ~250 commands every frame for them.
   */
  private frozenFallen:FrozenFigures;
  private delivery?:{band:TriBand;key:string};
  /**
   * The painted moto (moto-art.ts, card trocar-procedurais-por-arte): the moto with its riders and the chaveiro standing,
   * shown instead of their frozen boxes once the sheet is loaded.
   */
  private motoImg:Phaser.GameObjects.Image;private standImg:Phaser.GameObjects.Image;
  /** The imported Uno (uno-art.ts), made once its sheet is in; until then (or if it fails) the boxes. */
  private uno?:Phaser.GameObjects.Image;
  /** contorno-usavel-wc3: the car is pulled on its rope: the Warcraft 3 gold outline around the imported Uno. */
  private glow?:UsableGlow;

  constructor(scene:Phaser.Scene,options:ChaveiroRendererOptions){
    this.scene=scene;this.options=options;
    const breu=()=>this.c.breu;
    this.frozenCar=new FrozenFigures(scene,breu);this.frozenMoto=new FrozenFigures(scene,breu);this.frozenOpener=new FrozenFigures(scene,breu);
    this.frozenFallen=new FrozenFigures(scene,breu);
    this.ground=scene.add.graphics().setDepth(-9979).setName('chaveiro-chao');
    this.car=scene.add.graphics().setName('chaveiro-carro');this.moto=scene.add.graphics().setName('chaveiro-moto');this.opener=scene.add.graphics().setName('chaveiro-abrindo');
    this.fx=scene.add.graphics().setDepth(FX_DEPTH).setName('chaveiro-fx');
    this.motoImg=scene.add.image(0,0,'__DEFAULT').setName('chaveiro-moto-arte').setVisible(false);
    this.standImg=scene.add.image(0,0,'__DEFAULT').setName('chaveiro-em-pe-arte').setVisible(false);
    const c=this.c;
    c.breu=tokenColor('--c-breu');c.papel=tokenColor('--c-papel');c.cone=tokenColor('--c-cone');
    c.cartolina=tokenColor('--c-cartolina');c.lilas=tokenColor('--c-lilas');c.claro=mix(c.papel,0xffffff,.35);
    const style=()=>({fontFamily:token('--f-cartaz'),fontSize:'16px',color:token('--c-breu'),backgroundColor:token('--c-papel'),padding:{x:6,y:3}});
    this.label=scene.add.text(0,0,'conector errado',style()).setOrigin(.5,1).setDepth(FX_DEPTH+2).setVisible(false);
    this.deliveryText=scene.add.text(0,0,'',{...style(),fontSize:'14px'}).setOrigin(.5,1).setDepth(FX_DEPTH+1).setVisible(false);
    whenFontsReady(()=>{this.label.setStyle(style());this.deliveryText.setStyle({...style(),fontSize:'14px'});});
    if(!scene.textures.exists(UNO_KEY)){
      scene.load.spritesheet(UNO_KEY,UNO_URL,{frameWidth:UNO_CELL,frameHeight:UNO_CELL});
      if(!scene.load.isLoading())scene.load.start();
    }
  }

  /** The Uno's image once its sheet is in (undefined: the provisional boxes). */
  private unoImage():Phaser.GameObjects.Image|undefined{
    if(!this.uno&&this.scene.textures.exists(UNO_KEY))this.uno=this.scene.add.image(0,0,UNO_KEY,0).setOrigin(.5,UNO_FOOT).setName('chaveiro-uno');
    return this.uno;
  }

  /** A new view: the objective (undefined hides it all) at the server tick. */
  push(view:ChaveiroView|undefined,tick:number){this.state.push(view,tick,this.now,this.options.reduced);}

  /** After a view turn or a depth re-base. */
  refresh(){this.update(this.now);}

  update(time:number){
    const dt=this.lastTime===undefined?0:time-this.lastTime;
    this.now=this.lastTime=time;
    this.ground.clear();this.car.clear();this.moto.clear();this.opener.clear();this.fx.clear();
    const st=this.state,view=st.view;
    this.label.setVisible(false);this.deliveryText.setVisible(false);
    if(!view){this.puffs=[];this.frozenCar.hide();this.frozenMoto.hide();this.frozenOpener.hide();this.frozenFallen.hide();this.motoImg.setVisible(false);this.standImg.setVisible(false);this.delivery?.band.setVisible(false);this.uno?.setVisible(false);this.glow?.begin(time);this.glow?.end();this.carTurn=this.carHeading=0;return;}
    const k=1/Math.max(.05,this.scene.cameras.main.zoom),reduced=this.options.reduced,proj=this.options.projector;
    // The car turns toward its move (eased; at once with reduced effects), frozen in HEADING_STEPS like the moto; the
    // side facing the screen shows its wheels turning by how far it rolled.
    this.carTurn=reduced?st.carHeading:easeAngle(this.carTurn,st.carHeading,dt);
    const carStep=((Math.round(this.carTurn/(Math.PI*2)*HEADING_STEPS)%HEADING_STEPS)+HEADING_STEPS)%HEADING_STEPS;
    const carH=this.carHeading=carStep/HEADING_STEPS*Math.PI*2;
    const nearSide=viewTurn(-Math.sin(carH),Math.cos(carH),proj.view),near:1|-1=nearSide.x+nearSide.y>0?1:-1;
    const wheel=wheelStep(st.carRoll),look={heading:carStep,near,wheel};
    const alarm=alarmOn(view,st.tick),wrecked=view.ended==='defeat';
    const fallingBits=st.settle(time);

    // Ground: the delivery spot, the shadows, the fallen parts. The speed bumps are not drawn (the old Papel/Breu
    // stripes, card remover-desenhos-antigos): the moto's slowing down and its line say it until there is art.
    if(view.delivery)this.drawDelivery(view.delivery,k);
    else this.delivery?.band.setVisible(false);
    this.drawShadow(view.car.x,view.car.y,CAR_HALF.l,CAR_HALF.w,carH);
    const parts=fallenParts(view.car.parts,fallingBits);
    if(parts.length){
      const at=proj.project(view.car.x,view.car.y,this.q);
      this.frozenFallen.show(fallenKey(view.car.parts,fallingBits,carStep,proj.view,k),()=>boxFaces(parts,carH,proj.view),k,at.x,at.y,FALLEN_DEPTH,1);
    }else this.frozenFallen.hide();

    // The car (and the parts falling off it), trembling: the engine never stops.
    const ended=st.endedAt!==undefined?time-st.endedAt:0;
    const shake=engineShake(time,reduced,alarm),hazard=hazardLit(alarm,time)||(reduced&&alarm);
    const trunk=view.ended==='victory'?Math.round(trunkOpen(ended)*20)/20:0;
    // Sorted at its centre (not its front corner): critters hitting its sides and back stay in front of it, a figure
    // behind its centre line goes under it (the car is long; the sim's critters hit it from all around).
    const carDepth=proj.depth(view.car.x,view.car.y),carAt=proj.project(view.car.x,view.car.y,this.q);
    const carX=carAt.x+shake.x,carY=carAt.y+shake.y;
    const uno=this.unoImage();let unoTop:{x:number;y:number;width:number;height:number}|undefined;
    if(uno){
      // The imported Uno (uno-art.ts): the view of its nose, wheels on the footprint's lowest corner; the parts it lost
      // darken it (the sheet has no damaged views yet), wrecked darker still; the parts falling are drawn live over it.
      this.frozenCar.hide();
      const lost=bitCount(view.car.parts)/CAR_PARTS.length,tint=wrecked?0x6c6c74:mix(0xffffff,0x9a96a0,lost);
      const frame=unoFrame(carH,proj.view),footY=carY+unoFootY(carH,proj.view);
      unoTop=unoBox(frame,carX,footY);
      uno.setFrame(frame).setScale(UNO_SCALE).setPosition(carX,footY).setDepth(carDepth).setTint(tint).setVisible(true);
      uno.setAlpha(this.coversBox(unoTop,carDepth)?COVER_ALPHA:1);
      const glow=this.glow??=new UsableGlow(this.scene,reduced);glow.begin(time);
      if(!view.ended)glow.mark('uno',uno,k);
      glow.end();
      if(fallingBits){
        const boxes:Box[]=[];
        for(const [bit,at] of this.state.falling)if(fallingBits&bit)boxes.push(...fallingPart(CAR_PARTS[Math.log2(bit)],(time-at)/PART_FALL_MS));
        this.car.setDepth(carDepth+.01).setAlpha(1);
        this.drawFaces(this.car,view.car.x,view.car.y,boxFaces(boxes,carH,proj.view),k,shake);
      }
      if(hazard)this.drawHazard(view.car.x,view.car.y,k);
    }else if(fallingBits){
      // A part falling moves every frame: drawn live for its ~0.6 s.
      this.frozenCar.hide();
      const carFaces=this.carLook(view.car.parts&~fallingBits,hazard,trunk,wrecked,fallingBits,time,look);
      this.car.setDepth(carDepth);
      this.drawFaces(this.car,view.car.x,view.car.y,carFaces,k,shake);
      this.car.setAlpha(this.covers(view.car.x,view.car.y,carFaces,carDepth)?COVER_ALPHA:1);
    }else{
      const parts=view.car.parts,key=`${parts}|${hazard?1:0}|${trunk}|${wrecked?1:0}|${carStep}|${wheel}|${proj.view}|${Math.round(k*10)}`;
      const faces=this.frozenCar.show(key,()=>this.carLook(parts,hazard,trunk,wrecked,0,time,look),k,carX,carY,carDepth,1);
      if(this.covers(view.car.x,view.car.y,faces,carDepth))this.frozenCar.show(key,()=>faces,k,carX,carY,carDepth,COVER_ALPHA);
    }

    // The moto and its riders.
    const mode=view.moto.mode;
    let mx=view.moto.x,my=view.moto.y,heading=st.heading;
    if(mode==='volta'&&!reduced){const c=voltaCentre(view.moto,view.car),lap=voltaLap(time);mx=c.x+lap.dx;my=c.y+lap.dy;heading=lap.heading;}
    this.drawShadow(mx,my,.8*M,.3*M,heading);
    const motoDepth=proj.depth(mx,my),pose=motoPose(mode),turn=Math.round(heading/(Math.PI*2)*HEADING_STEPS);
    const motoAt=proj.project(mx,my,this.q),lift=isoOffset(0,0,motoLift(mode,time,reduced),proj.view).y;
    const motoX=motoAt.x,motoY=motoAt.y+lift,motoKey=`${pose}|${((turn%HEADING_STEPS)+HEADING_STEPS)%HEADING_STEPS}|${proj.view}|${Math.round(k*10)}`;
    const motoFace=()=>boxFaces(motoBoxes(pose,0),turn/HEADING_STEPS*Math.PI*2,proj.view);
    // The painted moto when its sheet is loaded (the boxes stay hidden), else the frozen boxes.
    const motoArt=applyMotoArt(this.motoImg,MOTO_POSE_STATE[pose],motoColumn(heading,proj.view));
    if(motoArt){
      this.frozenMoto.hide();
      this.motoImg.setPosition(motoX,motoY).setDepth(motoDepth).setAlpha(this.coversImage(mx,my,this.motoImg,motoDepth)?COVER_ALPHA:1).setVisible(true);
    }else{
      this.motoImg.setVisible(false);
      const motoFaces=this.frozenMoto.show(motoKey,motoFace,k,motoX,motoY,motoDepth,1);
      if(this.covers(mx,my,motoFaces,motoDepth))this.frozenMoto.show(motoKey,motoFace,k,motoX,motoY,motoDepth,COVER_ALPHA);
    }
    const standing=mode==='entrega'||mode==='abrindo'||view.ended==='victory';
    if(!standing){this.frozenOpener.hide();this.standImg.setVisible(false);}
    if(mode==='entrega'){
      // He stands beside the moto with the bag.
      const side=this.local(mx,my,heading,0,1.0*M),at=proj.project(side.x,side.y,this.q);
      if(applyMotoArt(this.standImg,'em-pe-bolsa',motoColumn(heading,proj.view))){
        this.frozenOpener.hide();
        this.standImg.setPosition(at.x,at.y).setDepth(proj.depth(side.x,side.y)).setAlpha(1).setVisible(true);
      }else{
        this.standImg.setVisible(false);
        this.frozenOpener.show(`bag|${motoKey}`,()=>boxFaces(standingChaveiro(0,0,true),turn/HEADING_STEPS*Math.PI*2,proj.view),k,at.x,at.y,proj.depth(side.x,side.y),1);
      }
    }else if(mode==='abrindo'||view.ended==='victory'){
      // At the car's door (its left side, toward +y), facing it, the tool jiggling at the lock: just in front of the
      // car when that side faces the screen, just behind it otherwise (one figure against a big one: no column split).
      const at=this.local(view.car.x,view.car.y,carH,.2*M,(CAR_HALF.w+.45*M));
      const front=near>0;
      const tool=reduced?0:Math.round(Math.abs(Math.sin(time*.012))*3)/3,door=this.options.projector.project(at.x,at.y,{x:0,y:0});
      if(applyMotoArt(this.standImg,'em-pe-ferramenta',motoColumn(carH-Math.PI/2,proj.view))){
        // The painted chaveiro at the door: the whole figure bobs a pixel with the lock work.
        this.frozenOpener.hide();
        this.standImg.setPosition(door.x,door.y-tool*k).setDepth(carDepth+(front?.5:-.5)).setAlpha(1).setVisible(true);
      }else{
        this.standImg.setVisible(false);
        this.frozenOpener.show(`door|${tool}|${carStep}|${proj.view}|${Math.round(k*10)}`,()=>boxFaces(standingChaveiro(0,0,false,tool),carH-Math.PI/2,proj.view),k,door.x,door.y,carDepth+(front?.5:-.5),1);
      }
      if(mode==='abrindo'&&!view.ended)this.drawOpening(at.x,at.y,openProgress(view.etaS),k);
    }

    // Effects over everything: smoke, alarm waves, the push icon, the bars, the end label.
    this.smoke(view,mx,my,heading,alarm,time,reduced,k);
    if(alarm)this.drawWaves(view.car.x,view.car.y,k,time,st.alarmSince);
    if(mode==='morta')this.drawPush(mx,my,view.moto.push??0,k,time);
    // The painted fall has its own stars over the chaveiro's head.
    if(mode==='tombo'&&!motoArt)this.drawDizzy(mx,my,heading,k,time);
    if(!view.ended)this.drawCarBar(view.car,k,unoTop?.y);
    if(view.ended==='victory'&&chargerLabel(ended)){
      const p=this.at(view.car.x,view.car.y,-1.7*M,0,CAR_TOP+.9*M);
      this.label.setPosition(p.x,p.y).setScale(k).setVisible(true);
    }
  }

  destroy(){
    this.ground.destroy();this.car.destroy();this.moto.destroy();this.opener.destroy();this.fx.destroy();
    this.frozenCar.destroy();this.frozenMoto.destroy();this.frozenOpener.destroy();this.frozenFallen.destroy();
    this.motoImg.destroy();this.standImg.destroy();
    this.delivery?.band.destroy();this.delivery=undefined;this.uno?.destroy();this.uno=undefined;this.glow?.destroy();this.glow=undefined;
    this.label.destroy();this.deliveryText.destroy();this.puffs=[];
  }

  /** Screen point of a world point plus a local offset (forward, left, up in units) at the car's heading. */
  private at(x:number,y:number,fwd:number,left:number,z:number):Pt{
    const h=this.carHeading,p=this.options.projector.project(x,y,this.q),o=isoOffset(fwd*Math.cos(h)-left*Math.sin(h),fwd*Math.sin(h)+left*Math.cos(h),z,this.options.projector.view);
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
  private carLook(parts:number,hazard:boolean,trunk:number,wrecked:boolean,falling:number,time:number,look:{heading:number;near:1|-1;wheel:number}):Face[]{
    const view=this.options.projector.view,key=`${parts}|${hazard?1:0}|${trunk}|${wrecked?1:0}|${look.heading}|${look.near}|${look.wheel}|${view}`;
    if(!falling){const hit=this.carFaces.get(key);if(hit)return hit;}
    const boxes:Box[]=carBoxes({parts,hazard,trunk,wrecked,near:look.near,wheel:look.wheel});
    for(const [bit,at] of this.state.falling)boxes.push(...fallingPart(CAR_PARTS[Math.log2(bit)],(time-at)/PART_FALL_MS));
    const faces=boxFaces(boxes,this.carHeading,view);
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
  /** The same for a figure drawn as an image: `b` its bounds on the screen (world px). */
  private coversBox(b:{x:number;y:number;width:number;height:number},depth:number){
    const hero=this.options.hero?.();if(!hero)return false;
    if(this.options.projector.depth(hero.x,hero.y)>=depth)return false;
    const h=this.options.projector.project(hero.x,hero.y,{x:0,y:0});
    return h.x>b.x&&h.x<b.x+b.width&&h.y-30>b.y&&h.y-10<b.y+b.height;
  }
  /** covers() for a painted figure (moto-art.ts): its image's box around its ground point (x, y). */
  private coversImage(x:number,y:number,image:Phaser.GameObjects.Image,depth:number){
    const p=this.options.projector.project(x,y,this.q),b=imageBounds(image);
    return this.coversBox({x:p.x+b.x0,y:p.y+b.y0,width:b.x1-b.x0,height:b.y1-b.y0},depth);
  }
  /** The hazard lights on the imported Uno: a Cone lamp at each corner, lit with the alarm's blink. */
  private drawHazard(x:number,y:number,k:number){
    for(const [fwd,left] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
      const p=this.at(x,y,fwd*CAR_HALF.l*.92,left*CAR_HALF.w*.78,.62*M);
      this.fx.fillStyle(this.c.breu,.85).fillCircle(p.x,p.y,6*k).fillStyle(this.c.cone,1).fillCircle(p.x,p.y,4.2*k);
    }
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
  /** The next delivery: a ring on the ground (frozen, breathing by scale) and a tag with the seconds until he gets there. */
  private drawDelivery(d:{x:number;y:number;etaS:number},k:number){
    const p=this.options.projector.project(d.x,d.y,this.q),r=1.2*M*42,key=deliveryKey(k);
    if(this.delivery?.key!==key){
      this.delivery?.band.destroy();
      const c=this.c;
      this.delivery={key,band:TriBand.make(this.scene,g=>{
        g.lineStyle(3*k,c.breu,.9).strokeEllipse(0,0,r*2,r);
        g.lineStyle(2*k,c.papel,1).strokeEllipse(0,0,r*2,r);
      }).setDepth(DELIVERY_DEPTH)};
    }
    this.delivery.band.setPosition(p.x,p.y).setScale(deliveryPulse(this.now,this.options.reduced)).setVisible(true);
    this.deliveryText.setText(`entrega em ${Math.max(0,Math.ceil(d.etaS))} s`).setPosition(p.x,p.y-r*.6).setScale(k).setVisible(true);
  }
  /** Smoke puffs: the car's exhaust always (the engine runs), the moto's when it runs (light) or died (dark). */
  private smoke(view:ChaveiroView,mx:number,my:number,heading:number,alarm:boolean,time:number,reduced:boolean,k:number){
    if(reduced){this.puffs=[];return;}
    if(time-this.lastPuff>=SMOKE_MS){
      this.lastPuff=time;
      const pipe=this.local(view.car.x,view.car.y,this.carHeading,-1.95*M,-.5*M);
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
  /** `roof`: the imported Uno's top on the screen (its roof is above the boxes' CAR_TOP): the bar clears it. */
  private drawCarBar(car:ChaveiroView['car'],k:number,roof?:number){
    const top=this.at(car.x,car.y,0,0,CAR_TOP),left=car.limit>0?Math.max(0,1-car.hits/car.limit):0,low=left<CAR_LOW;
    const bw=72*k,bh=8*k,bx=top.x-bw/2,by=Math.min(top.y-40*k,roof===undefined?Infinity:roof-bh-8*k),g=this.fx,c=this.c;
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
/** How many bits are set (the parts the car lost). */
function bitCount(n:number){let c=0;for(;n;n&=n-1)c++;return c;}

function star(g:Phaser.GameObjects.Graphics,x:number,y:number,r:number,fill:number,edge:number,k:number){
  const pts=Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,rr=i&1?r*.45:r;return {x:x+Math.cos(a)*rr,y:y+Math.sin(a)*rr};});
  g.fillStyle(fill,1).fillPoints(pts,true).lineStyle(1.2*k,edge,1).strokePoints(pts,true);
}
