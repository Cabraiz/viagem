/**
 * Zueira events in the scene (VGM-053B): the blackout and the kill-cam of a round's last critter.
 * - Blackout ("apagão"): a Breu rectangle over the world at BLACKOUT_DEPTH for the event's 3 s (fade in/out, lighter and
 *   slower with reduced motion); the horde renderer draws the critters' eyes over it and lifts what is dangerous
 *   (render/blackout-rules.ts). It ends early if the wave ends.
 * - Kill-cam: a second Phaser camera drawn inside the HUD's kill-cam window (hud/killcam.ts) for KILLCAM_MS, pointed at
 *   where the last critter fell, where a copy of it gets knocked out in slow motion and flies off (only that camera
 *   sees the copy). The main camera, the hero and the controls never change.
 * - Level-up burst (card levelup-estouro-e-tremida): a ring of light and a short confetti on the local hero when the
 *   team levels up, before the offer opens (hud.ts holds it LEVELUP_BURST_MS); the ring alone, still, with reduced
 *   motion (render/levelup-fx-rules.ts).
 * - Hurt shake: a hit above 10 % of the local player's max hp shakes the camera 2 px for 120 ms, with the towers' rule
 *   (tower-rules.ts shakeAt); the scene adds shakeOffset after centring its camera. None with reduced motion.
 */
import Phaser from 'phaser';
import type {RunView} from '../../contract/index.ts';
import type {HappeningKind} from '../../contract/index.ts';
import {BLACKOUT_DEPTH,blackoutAlpha} from './blackout-rules.ts';
import {KILLCAM_MS} from '../fun/zueira.ts';
import {ENEMY_ART,FX,enemyKind,enemyTexture,fallbackTint,type EnemyKind} from './keys.ts';
import {applyEnemyArt,enemyArtId} from '../art/horde-art.ts';
import {deathLine,kindStyle} from './jokes.ts';
import {killcamFrame} from './killcam-rules.ts';
import {token,tokenColor} from '../ui/tokens.ts';
import {HURT_SHAKE,LEVELUP_DEPTH,burstFrame,hurtOn,hurtShakes} from './levelup-fx-rules.ts';
import {shakeAt,shakeOffset} from './towers/tower-rules.ts';

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
  /**
   * World px multiplier of the critters in the main view (framing.ts CITY_VIEW_SCALE in the city): the kill-cam frames
   * its art-size copy as the endless map does (killcam-rules.ts actorScale). Default 1.
   */
  actorScale?:()=>number;
  /** The local hero's feet (scene px, where its sprite stands) for the level-up burst, and its height (scene px) to size it. */
  heroAt?:()=>Pt|undefined;
  heroHeight?:()=>number;
  /** The local player's id: only hits on it shake the camera. */
  localId?:()=>string|undefined;
}

/** Depth of the knocked-out copy, its poof and its line (seen only by the kill-cam camera). */
export const KILLCAM_DEPTH=97000;

interface Killcam {kind:string;id:string;at:Pt;start:number;end:number;cam?:Phaser.Cameras.Scene2D.Camera;ghost:Phaser.GameObjects.Image;puff:Phaser.GameObjects.Image;pop:Phaser.GameObjects.Text;
  /** The copy as the horde draws it (horde-art.ts applyEnemyArt): imported idle frames when the kind has art. */
  actor:{kind:EnemyKind;art:string;elite:boolean;phase:number};
  /** Whether the ghost showed imported art last frame (undefined before the first): its accent tint follows. */
  tinted?:boolean}

export class ZueiraFx {
  private scene:Phaser.Scene;
  private options:ZueiraFxOptions;
  private dark:Phaser.GameObjects.Rectangle;
  private blackout?:{start:number;end:number};
  private killcam?:Killcam;
  private lastEventId=-1;
  private viewTick=0;
  private now=0;
  /** The level-up burst: when it started and the level it celebrates (one burst per level, from the event or the pause). */
  private burst?:{start:number};
  private burstLevel=0;
  private burstGfx?:Phaser.GameObjects.Graphics;
  private burstColors?:{amarelo:number;papel:number;breu:number;confetti:number[]};
  /** The hurt shake's start (scene ms), and the damage events already read. */
  private shakeBorn=-Infinity;
  private hurtSeen=-1;
  /** Last frame, for the acceptance probe (dev) and tests of the wiring. */
  readonly last={dark:0,happening:undefined as HappeningKind|undefined,killcam:false,killcamKind:'' as string,killcamCamera:false,burst:false,bursts:0,shakes:0};

  constructor(scene:Phaser.Scene,options:ZueiraFxOptions){
    this.scene=scene;this.options=options;
    this.dark=scene.add.rectangle(0,0,1,1,tokenColor('--c-breu'),1).setOrigin(0,0).setDepth(BLACKOUT_DEPTH).setAlpha(0).setVisible(false);
  }
  setReduced(reduced:boolean){this.options.reduced=reduced;}

  push(view:RunView){
    // A new run (rematch) or a fresh server: event ids may start over, and nothing of the old run stays on screen.
    if(view.tick<this.viewTick){this.lastEventId=-1;this.blackout=undefined;this.stopKillcam();this.resetHero();}
    this.viewTick=view.tick;
    this.pushHurt(view);
    for(const e of view.events){
      if(e.eventId<=this.lastEventId)continue;
      this.lastEventId=e.eventId;
      if(e.type==='happening'){
        this.last.happening=e.kind;
        if(e.kind==='apagao')this.blackout={start:this.now,end:this.now+Math.max(0,e.endsTick-view.tick)*this.options.tickMs};
      }else if(e.type==='last-bicho')this.startKillcam(e.kind,`${e.round}:${e.kind}:${e.eventId}`,{x:e.x,y:e.y});
      else if(e.type==='levelup')this.levelUp(e.level);
    }
    // The dark goes with the wave: a round that ends (or a run) never stays dark.
    if(this.blackout&&view.round?.phase!=='wave')this.blackout.end=Math.min(this.blackout.end,this.now);
  }
  /** New run or a fresh server: event ids start over. */
  resetEvents(){this.lastEventId=-1;this.viewTick=0;this.blackout=undefined;this.stopKillcam();this.resetHero();}
  private resetHero(){this.burst=undefined;this.burstLevel=0;this.shakeBorn=-Infinity;this.hurtSeen=-1;this.burstGfx?.clear().setVisible(false);}

  /**
   * The team reached `level`: the burst on the local hero, once per level (the levelup event and the room's pause both
   * call it, whichever arrives first).
   */
  levelUp(level:number){
    if(!(level>this.burstLevel))return;
    this.burstLevel=level;this.burst={start:this.now};this.last.bursts++;
  }
  /** A hit on the local player above HURT_SHAKE_SHARE of its max hp (this view's new events) starts the shake. */
  private pushHurt(view:RunView){
    const id=this.options.localId?.();if(!id)return;
    const hurt=hurtOn(view,id,this.hurtSeen);this.hurtSeen=hurt.last;
    const me=view.players.find(p=>p.id===id);
    if(me&&hurtShakes(hurt.amount,me.maxHp,this.options.reduced)){this.shakeBorn=this.now;this.last.shakes++;}
  }
  /** The hurt shake's camera offset now (world px at camera `zoom`), added by the scene after centring its camera. */
  shakeOffset(zoom:number,out:Pt):Pt{
    const ms=this.now-this.shakeBorn,amp=shakeAt(HURT_SHAKE,ms,this.options.reduced);
    if(!amp){out.x=0;out.y=0;return out;}
    return shakeOffset(amp/(zoom||1),ms,out);
  }

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
    this.updateBurst(now);
  }

  private updateBurst(now:number){
    const b=this.burst,g=this.burstGfx;
    const feet=b&&this.options.heroAt?.();
    const f=b&&feet?burstFrame(now-b.start,this.options.reduced,this.colors().confetti):undefined;
    this.last.burst=!!f&&f.ring.alpha>0;
    if(!f||!feet||f.ring.alpha<=0){if(b&&now-b.start>1000)this.burst=undefined;if(g?.visible)g.clear().setVisible(false);return;}
    const gfx=g??(this.burstGfx=this.scene.add.graphics().setDepth(LEVELUP_DEPTH));
    // Sized by the hero on screen, centred on its chest (three quarters of its body above the feet).
    const h=Math.max(24,this.options.heroHeight?.()??60),cx=feet.x,cy=feet.y-h*.75;
    const {amarelo,papel,breu}=this.colors();
    gfx.clear().setVisible(true);
    const r=f.ring.radius*h,w=Math.max(3,f.ring.width*h);
    gfx.lineStyle(w+3,breu,f.ring.alpha*.6).strokeCircle(cx,cy,r);
    gfx.lineStyle(w,amarelo,f.ring.alpha).strokeCircle(cx,cy,r);
    gfx.lineStyle(Math.max(1,w*.35),papel,f.ring.alpha).strokeCircle(cx,cy,r);
    const size=Math.max(5,h*.22);
    for(const c of f.confetti){
      const x=cx+c.x*h,y=cy+c.y*h,cos=Math.cos(c.rotation)*size,sin=Math.sin(c.rotation)*size*.5;
      gfx.fillStyle(c.color,f.confettiAlpha).fillTriangle(x-cos,y-sin,x+cos,y+sin,x-sin,y+cos*.6);
    }
  }
  /** Burst colours: an Amarelo Encarte ring (the choice to come) with a Papel core and a Breu outline; mixed confetti. */
  private colors(){
    return this.burstColors??=(()=>{
      const [amarelo,papel,breu,cartolina,lilas,cone]=['--c-amarelo','--c-papel','--c-breu','--c-cartolina','--c-lilas','--c-cone'].map(c=>tokenColor(c));
      return {amarelo,papel,breu,confetti:[amarelo,cartolina,lilas,cone,papel]};
    })();
  }

  private startKillcam(kind:string,id:string,at:Pt){
    this.stopKillcam();
    // Only the kill-cam camera draws these, so they go over trees and canopies there (the main camera ignores them).
    const k=enemyKind(kind),s=this.scene,feet=this.options.project(at),depth=KILLCAM_DEPTH;
    const ghost=s.add.image(feet.x,feet.y,enemyTexture(kind)).setOrigin(.5,.5).setDepth(depth);
    const puff=s.add.image(feet.x,feet.y-ENEMY_ART[k].height*.4,FX.puff).setDepth(depth+1).setVisible(false).setTint(kindStyle(kind).tint);
    const style=kindStyle(kind);
    const pop=s.add.text(feet.x,feet.y,deathLine(kind,id),{fontFamily:token('--f-cartaz'),fontSize:'28px',fontStyle:'900',color:style.fill,stroke:style.stroke,strokeThickness:8})
      .setOrigin(.5,.5).setDepth(depth+2).setVisible(false);
    // Only the kill-cam sees the copy: on the main screen the critter already went poof.
    this.scene.cameras.main.ignore([ghost,puff,pop]);
    this.killcam={kind,id,at,start:this.now,end:this.now+KILLCAM_MS,ghost,puff,pop,actor:{kind:k,art:enemyArtId(kind,k),elite:false,phase:0}};
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
    // Only the knocked-out copy, its poof and its line: the map, the camp, the trees and the horde are not drawn twice
    // (code review: the second camera stays cheap). New objects (pools growing) are caught every frame.
    const mine=new Set<Phaser.GameObjects.GameObject>([k.ghost,k.puff,k.pop]);
    for(const o of this.scene.children.list)if(!mine.has(o)&&!((o as unknown as {cameraFilter:number}).cameraFilter&cam.id))cam.ignore(o);
    this.last.killcamCamera=true;
    // The knock-out (render/killcam-rules.ts): reels, hops tilted as high as the picture allows, poof, and its line.
    const t=Math.min(1,(now-k.start)/KILLCAM_MS),art=ENEMY_ART[enemyKind(k.kind)];
    const f=killcamFrame({tv:{width:rect.width,height:rect.height},mainZoom:this.scene.cameras.main.zoom,actorScale:this.options.actorScale?.()??1,art,feet:this.options.project(k.at),t,
      reduced:this.options.reduced,pop:{width:k.pop.width,height:k.pop.height}});
    cam.setVisible(true).setZoom(f.zoom).centerOn(f.center.x,f.center.y);
    // Imported art (the same helper as the horde's critters): its idle frame at today's size, turned around its middle
    // like today's copy; without art (always, with an empty manifest) today's procedural texture is left as it was.
    const imported=applyEnemyArt(k.ghost,k.actor,false,0,0,now);
    // The reserve wears the roster accent (keys.ts fallbackTint) like the horde's; imported art its own colours.
    if(imported!==k.tinted){k.tinted=imported;const accent=imported?undefined:fallbackTint(k.kind);if(accent===undefined)k.ghost.clearTint();else k.ghost.setTint(accent);}
    const scale=f.ghost.scale*(imported?k.ghost.scaleX:1);
    if(imported||k.ghost.originY!==.5)k.ghost.setOrigin(.5,.5);
    k.ghost.setVisible(f.ghost.visible).setPosition(f.ghost.x,f.ghost.y).setRotation(f.ghost.rotation).setScale(scale);
    k.puff.setVisible(f.puff.visible).setPosition(f.center.x,f.center.y).setScale(f.puff.scale).setAlpha(f.puff.alpha);
    k.pop.setVisible(f.pop.visible).setPosition(f.pop.x,f.pop.y).setScale(f.pop.scale).setRotation(-.06);
  }

  /** Depth of the blackout and what it covers now (audit, dev probe). */
  blackoutDepth(){return this.dark.depth;}
  destroy(){this.stopKillcam();this.dark.destroy();this.burstGfx?.destroy();}
}
