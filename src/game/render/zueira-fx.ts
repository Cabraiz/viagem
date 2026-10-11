/**
 * Zueira events in the scene (VGM-053B): the blackout and the kill-cam of a round's last critter.
 * - Blackout ("apagão"): a Breu rectangle over the world at BLACKOUT_DEPTH for the event's 3 s (fade in/out, lighter and
 *   slower with reduced motion); the horde renderer draws the critters' eyes over it and lifts what is dangerous
 *   (render/blackout-rules.ts). It ends early if the wave ends.
 * - Kill-cam: a second Phaser camera drawn inside the HUD's kill-cam window (hud/killcam.ts) for KILLCAM_MS, pointed at
 *   where the last critter fell, where a copy of it gets knocked out in slow motion and flies off (only that camera
 *   sees the copy). The main camera, the hero and the controls never change.
 */
import Phaser from 'phaser';
import type {RunView} from '../sim/view.ts';
import type {HappeningKind} from '../sim/types.ts';
import {BLACKOUT_DEPTH,blackoutAlpha} from './blackout-rules.ts';
import {KILLCAM_MS} from '../fun/zueira.ts';
import {ENEMY_ART,FX,enemyKind,enemyTexture} from './keys.ts';
import {deathLine,kindStyle} from './jokes.ts';
import {token,tokenColor} from '../../ui/tokens.ts';

type Pt={x:number;y:number};
export interface Rect {x:number;y:number;width:number;height:number}
export interface ZueiraFxOptions {
  reduced:boolean;
  /** World point to scene px, and its depth. */
  project:(p:Pt)=>Pt;
  depth:(p:Pt)=>number;
  /** The kill-cam window's picture on the canvas (canvas px), or undefined when the HUD does not show it. */
  killcamRect:()=>Rect|undefined;
  /** Blackout level for the horde (eyes, lifted danger). */
  setBlackout:(level:number)=>void;
  /** Tick length in ms (end of the blackout from the server's endsTick). */
  tickMs:number;
}

/** Kill-cam camera zoom over the main camera's: the same size the critter has on screen (the picture is small). */
export const KILLCAM_ZOOM=1;
/** Phases of the knock-out (share of KILLCAM_MS): it reels, then it is launched spinning off the top of the picture. */
export const KO_HIT=.3;

interface Killcam {kind:string;id:string;at:Pt;start:number;end:number;cam?:Phaser.Cameras.Scene2D.Camera;ghost:Phaser.GameObjects.Image;puff:Phaser.GameObjects.Image;pop:Phaser.GameObjects.Text}

export class ZueiraFx {
  private scene:Phaser.Scene;
  private options:ZueiraFxOptions;
  private dark:Phaser.GameObjects.Rectangle;
  private blackout?:{start:number;end:number};
  private killcam?:Killcam;
  private lastEventId=-1;
  private now=0;
  /** Last frame, for the acceptance probe (dev) and tests of the wiring. */
  readonly last={dark:0,happening:undefined as HappeningKind|undefined,killcam:false,killcamKind:'' as string,killcamCamera:false};

  constructor(scene:Phaser.Scene,options:ZueiraFxOptions){
    this.scene=scene;this.options=options;
    this.dark=scene.add.rectangle(0,0,1,1,tokenColor('--c-breu'),1).setOrigin(0,0).setDepth(BLACKOUT_DEPTH).setAlpha(0).setVisible(false);
  }
  setReduced(reduced:boolean){this.options.reduced=reduced;}

  push(view:RunView){
    if(view.tick<0)return;
    for(const e of view.events){
      if(e.eventId<=this.lastEventId)continue;
      this.lastEventId=e.eventId;
      if(e.type==='happening'){
        this.last.happening=e.kind;
        if(e.kind==='apagao')this.blackout={start:this.now,end:this.now+Math.max(0,e.endsTick-view.tick)*this.options.tickMs};
      }else if(e.type==='last-bicho')this.startKillcam(e.kind,`${e.round}:${e.kind}:${e.eventId}`,{x:e.x,y:e.y});
    }
    // The dark goes with the wave: a round that ends (or a run) never stays dark.
    if(this.blackout&&view.round?.phase!=='wave')this.blackout.end=Math.min(this.blackout.end,this.now);
  }
  /** New run or a fresh server: event ids start over. */
  resetEvents(){this.lastEventId=-1;}

  update(now:number){
    this.now=now;
    const b=this.blackout,level=b?blackoutAlpha(now,b.start,b.end,this.options.reduced):0;
    if(b&&now>b.end+1000)this.blackout=undefined;
    this.options.setBlackout(level>0?1:0);
    this.last.dark=level;
    if(level>0){
      const v=this.scene.cameras.main.worldView,m=64;
      this.dark.setPosition(v.x-m,v.y-m).setSize(v.width+2*m,v.height+2*m).setAlpha(level).setVisible(true);
    }else if(this.dark.visible)this.dark.setVisible(false);
    this.updateKillcam(now);
  }

  private startKillcam(kind:string,id:string,at:Pt){
    this.stopKillcam();
    const k=enemyKind(kind),s=this.scene,feet=this.options.project(at),depth=this.options.depth(at)+2;
    const ghost=s.add.image(feet.x,feet.y,enemyTexture(kind)).setOrigin(.5,ENEMY_ART[k].originY).setDepth(depth);
    const puff=s.add.image(feet.x,feet.y-ENEMY_ART[k].height*.4,FX.puff).setDepth(depth+1).setVisible(false).setTint(kindStyle(kind).tint);
    const style=kindStyle(kind);
    const pop=s.add.text(feet.x,feet.y,deathLine(kind,id),{fontFamily:token('--f-cartaz'),fontSize:'30px',fontStyle:'900',color:style.fill,stroke:style.stroke,strokeThickness:8})
      .setOrigin(.5,0).setDepth(depth+2).setVisible(false);
    // Only the kill-cam sees the copy: on the main screen the critter already went poof.
    this.scene.cameras.main.ignore([ghost,puff,pop]);
    this.killcam={kind,id,at,start:this.now,end:this.now+KILLCAM_MS,ghost,puff,pop};
  }
  private stopKillcam(){
    const k=this.killcam;if(!k)return;
    if(k.cam)this.scene.cameras.remove(k.cam,true);
    k.ghost.destroy();k.puff.destroy();k.pop.destroy();
    this.killcam=undefined;
  }
  private updateKillcam(now:number){
    const k=this.killcam;
    this.last.killcam=!!k;this.last.killcamKind=k?.kind??'';this.last.killcamCamera=false;
    if(!k)return;
    if(now>=k.end){this.stopKillcam();this.last.killcam=false;return;}
    const rect=this.options.killcamRect();
    if(!rect||rect.width<8||rect.height<8){if(k.cam)k.cam.setVisible(false);return;}
    if(!k.cam){
      k.cam=this.scene.cameras.add(rect.x,rect.y,rect.width,rect.height,false,'killcam');
      k.cam.setBackgroundColor(token('--cena-grama'));
      k.cam.ignore(this.dark);
    }
    const cam=k.cam;
    if(cam.x!==rect.x||cam.y!==rect.y||cam.width!==rect.width||cam.height!==rect.height)cam.setViewport(rect.x,rect.y,rect.width,rect.height);
    cam.setVisible(true).setZoom(this.scene.cameras.main.zoom*KILLCAM_ZOOM);
    this.last.killcamCamera=true;
    // The knock-out, in slow motion: it reels (squash), then flies up spinning and shrinking; poof and its line.
    const t=Math.min(1,(now-k.start)/KILLCAM_MS),feet=this.options.project(k.at),art=ENEMY_ART[enemyKind(k.kind)];
    const reduced=this.options.reduced;
    let x=feet.x,y=feet.y,rot=0,scale=1;
    if(reduced){rot=Math.PI/2;}
    else if(t<KO_HIT){const w=Math.sin(t/KO_HIT*Math.PI*3);scale=1+.08*w;rot=.12*w;}
    else{const u=(t-KO_HIT)/(1-KO_HIT),e=u*u;y-=420*e;x+=60*u;rot=u*Math.PI*5;scale=1-.45*u;}
    k.ghost.setPosition(x,y).setRotation(rot).setScale(scale).setAlpha(reduced?1:t>.92?(1-t)/.08:1);
    const hit=reduced||t>=KO_HIT;
    k.puff.setVisible(hit&&(reduced||t<KO_HIT+.25)).setScale(reduced?1.2:1+2*(t-KO_HIT)).setAlpha(reduced?.9:Math.max(0,1-(t-KO_HIT)*4));
    // The line lands on the ground where it stood, under the critter flying off the top of the picture.
    k.pop.setVisible(hit).setPosition(feet.x,feet.y+4+(reduced?0:6*(1-Math.min(1,(t-KO_HIT)*4)))).setRotation(-.06);
    // A still picture on the spot (the critter leaves it), framed on its body.
    cam.centerOn(feet.x,feet.y-art.height*.45);
  }

  /** Depth of the blackout and what it covers now (audit, dev probe). */
  blackoutDepth(){return this.dark.depth;}
  destroy(){this.stopKillcam();this.dark.destroy();}
}
