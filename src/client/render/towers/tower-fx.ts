/**
 * The defenses' effects (moved from towers.ts, corte C2): the pooled shots, flashes, blasts and craters, their impact,
 * drawing them every frame, and the screen shake.
 */
import Phaser from 'phaser';
import type {Pt} from '../city/projection.ts';
import {CRATER,lobHeight,shakeAt,shakeOffset} from './tower-rules.ts';
import {BIG_BLAST,BLAST_BIG_GROUND,BLAST_BIG_H,BLAST_GROUND,BLAST_H,BLAST_R,CONE_H,CONE_W,CRATER_BIG_FROM,CRATER_BIG_TEX,CRATER_TEX,FLASH_LONG_H,FLASH_LONG_W,FLASH_TEX,FX,FX_DEPTH,
  HEAD_TEX,RING_W,SHOCK_MS,SHOCK_R,SMOKE_TINT,SMOKY_BLAST,BLAST_SMOKE,SPARK_TEX,SPOT_H,SPOT_W,STREAK_LINE,STREAK_W} from './tower-tuning.ts';
import type {BlastLook,Crater,Img,Shot,Tower} from './tower-types.ts';
import {TowerRendererBase} from './tower-base.ts';

export abstract class TowerFx extends TowerRendererBase {

  protected next<T extends {on:boolean}>(list:T[],key:'shot'|'flash'|'blast'|'crater'):T{
    const c=this.cursor;
    for(let k=0;k<list.length;k++){const i=(c[key]+k)%list.length;if(!list[i].on){c[key]=(i+1)%list.length;return list[i];}}
    const i=c[key];c[key]=(i+1)%list.length;return list[i]; // full: the oldest slot in ring order is reused
  }
  /** A pooled shot slot: whatever the slot drew before (a rocket's smoke, a beam's cone) is hidden first. */
  protected slot():Shot{const s=this.next(this.shots,'shot');this.hideShot(s);s.cell=-1;return s;}
  protected addShot(t:Tower,x0:number,y0:number,z0:number,x1:number,y1:number,born:number,ms:number,ox:number,oy:number){
    const s=this.slot();
    s.on=true;s.cal=t.cal;s.x0=x0;s.y0=y0;s.z0=z0;s.x1=x1;s.y1=y1;s.born=born;s.ms=ms;s.ox=ox;s.oy=oy;s.d0=t.depth;s.src=t;
  }
  protected addBeam(t:Tower,x1:number,y1:number,born:number,mx:number,my:number){
    const s=this.slot();
    s.on=true;s.cal=t.cal;s.x0=t.view.x;s.y0=t.view.y;s.z0=t.height;s.x1=x1;s.y1=y1;s.born=born;s.ms=t.cal.blastMs;s.mx=mx;s.my=my;s.ox=0;s.oy=0;s.d0=t.depth;s.src=t;
  }
  /** A flash (or the smoke under it) at world px (x, y), sorted `lift` over the defense `t` that fired. */
  protected addFlash(t:Tower,x:number,y:number,r:number,ms:number,born:number,lift:number,smoke=false){
    const f=this.next(this.flashes,'flash');f.on=true;f.x=x;f.y=y;f.r=r;f.ms=ms;f.born=born;f.src=t;f.lift=lift;f.depth=t.depth+lift;f.smoke=smoke;f.long=false;f.rot=0;
    if(f.img)f.img.setDepth(f.depth);
    return f;
  }
  protected addBlast(x:number,y:number,r:number,ms:number,born:number,ring=false,tint=0,look:BlastLook='fogo',smokeMs=0){
    const b=this.next(this.blasts,'blast');b.on=true;b.x=x;b.y=y;b.r=r;b.ms=ms;b.born=born;b.tint=tint;b.look=look;b.smokeMs=smokeMs;
    if(b.img&&b.ring!==ring){b.img.destroy();this.fxImages.splice(this.fxImages.indexOf(b.img),1);b.img=undefined;} // the ring lives on the ground
    b.ring=ring;b.depth=ring?0:this.fxDepth(x,y)+FX_DEPTH.blast;
    if(b.img&&!ring)b.img.setDepth(b.depth);
    b.smoke?.setVisible(false).setDepth(b.depth-FX_DEPTH.flash);
  }
  protected addCrater(x:number,y:number,r:number,ms:number,born:number){
    const c=this.next(this.craters,'crater');c.on=true;c.x=x;c.y=y;c.r=r;c.ms=ms;c.born=born;
    this.placeCrater(c,this.craterImages[this.craters.indexOf(c)]);
  }
  /** A crater decal is placed once (and again after a camera turn); only its last fifth fades. */
  protected placeCrater(c:Crater,img:Phaser.GameObjects.Image){
    const p=this.o.world.project(c.x,c.y,0,this.p),big=c.r>=CRATER_BIG_FROM,f=big?this.craterFrames.big:this.craterFrames.small;
    this.setFrame(img,f).setVisible(true).setPosition(p.x,p.y).setScale(c.r*this.unitPx*2/(big?CRATER_BIG_TEX:CRATER_TEX)).setAlpha(1);
  }
  protected impact(s:Shot,now:number){
    const c=s.cal;
    if(c.blast>=BIG_BLAST){
      this.addBlast(s.x1,s.y1,c.blast,c.blastMs,now,false,0,'fogo-g',c.blastMs*BLAST_SMOKE*1.5);
      this.addBlast(s.x1,s.y1,c.blast*SHOCK_R,c.blastMs*SHOCK_MS,now,true);
    }else if(c.blast>0)this.addBlast(s.x1,s.y1,c.blast,c.blastMs,now,false,0,'fogo',c.blast>=SMOKY_BLAST?c.blastMs*BLAST_SMOKE:0);
    else this.addBlast(s.x1,s.y1,.18,110,now,false,0,'faisca');
    if(c.crater){const k=CRATER[c.crater];this.addCrater(s.x1,s.y1,k.radius,k.ms,now);}
    if(c.shake>0&&(now-this.shake.born>=this.shake.cal.shakeMs||c.shake>=this.shake.cal.shake)){this.shake.born=now;this.shake.cal=c;}
  }

  protected drawEffects(now:number){
    const w=this.o.world,u=this.unitPx,s=this.f;
    for(let i=0;i<this.craters.length;i++){
      const c=this.craters[i];if(!c.on)continue;
      const k=(now-c.born)/c.ms,img=this.craterImages[i];
      if(k>=1){c.on=false;img.setVisible(false);continue;}
      if(k>=.8)img.setAlpha(1-(k-.8)/.2);
    }
    for(const sh of this.shots){
      if(!sh.on)continue;
      if(now<sh.born){this.hideShot(sh);continue;}
      const c=sh.cal,t=sh.ms>0?(now-sh.born)/sh.ms:1;
      if(c.shot==='beam'){
        if(t>=1){sh.on=false;this.hideShot(sh);continue;}
        const p=w.project(sh.x1,sh.y1,0,this.p),a=(1-t)*.6,half=c.barrel*u*.9;
        // Light cone with the Breu double edge (a pale beam alone vanishes on the snow), and its spot.
        const dx=p.x-sh.mx,dy=p.y-sh.my;
        // The cone sorts with its lamp, the spot at the lit ground: both set once per beam.
        const fresh=sh.cell<0;if(fresh){sh.cell=0;sh.dz=this.fxDepth(sh.x1,sh.y1)+FX_DEPTH.shot;}
        sh.trail=this.fxImage(sh.trail,FX.cone,sh.d0+FX_DEPTH.beam,fresh,0,.5).setPosition(sh.mx,sh.my).setRotation(Math.atan2(dy,dx))
          .setScale(Math.max(1,Math.hypot(dx,dy))/CONE_W,half*2/CONE_H).setAlpha(a);
        sh.head=this.fxImage(sh.head,FX.spot,sh.dz,fresh).setPosition(p.x,p.y).setScale(half*2.4/SPOT_W,half*1.2/SPOT_H).setAlpha(Math.min(1,a*1.4));
        continue;
      }
      if(t>=1){sh.on=false;this.hideShot(sh);this.impact(sh,now);continue;}
      const dist=Math.hypot(sh.x1-sh.x0,sh.y1-sh.y0)||1,back=Math.min(t,c.trail/dist);
      const head=this.at(sh,t,this.p),tail=this.at(sh,t-back,this.q);
      const dx=head.x-tail.x,dy=head.y-tail.y,len=Math.hypot(dx,dy),rot=Math.atan2(dy,dx),thick=Math.max(1,4*s)/STREAK_LINE;
      // Depth at the head's ground point, taken again only when it crosses a half-unit cell (the first moments at the
      // barrel keep the defense's own depth, so a shot never pops in front of the tower that fires it).
      const k=Math.max(0,t),gx=sh.x0+(sh.x1-sh.x0)*k,gy=sh.y0+(sh.y1-sh.y0)*k,cell=((gx*2)|0)*65536+((gy*2)|0)+1e9;
      const moved=cell!==sh.cell;
      if(moved){sh.cell=cell;sh.dz=Math.max(this.fxDepth(gx,gy),k<.2?sh.d0:-Infinity)+FX_DEPTH.shot;}
      const d=sh.dz;
      if(c.shot==='tracer'){
        sh.trail=this.fxImage(sh.trail,c.core==='branco'?FX.tracerBranco:c.core==='vermelho'?FX.tracerVermelho:FX.tracer,d,moved,0,.5).setPosition(tail.x,tail.y).setRotation(rot).setScale(Math.max(1,len)/STREAK_W,thick).setAlpha(1);
        sh.head=this.fxImage(sh.head,FX.headPapel,d,moved).setPosition(head.x,head.y).setScale(3.2*s/HEAD_TEX).setAlpha(1);
        continue;
      }
      if(c.trail>0&&len>.5){
        sh.trail=this.fxImage(sh.trail,FX.smoke,d,moved,0,.5).setPosition(tail.x,tail.y).setRotation(rot).setScale(len/STREAK_W,thick).setAlpha(.5);
        if(c.shot==='rocket')sh.puff=this.fxImage(sh.puff,FX.puff,d,moved).setPosition(tail.x,tail.y).setScale(8*s/HEAD_TEX).setAlpha(.45);
      }else{sh.trail?.setVisible(false);sh.puff?.setVisible(false);}
      const r=(c.shot==='rocket'?3:c.crater==='gustavao'?9:4.5)*s;
      sh.head=this.fxImage(sh.head,c.shot==='rocket'?FX.headRocket:FX.headShell,d,moved).setPosition(head.x,head.y).setRotation(rot).setScale((r+1.5*s)*2/HEAD_TEX).setAlpha(1);
    }
    for(const b of this.blasts){
      if(!b.on)continue;
      const age=now-b.born,k=age/b.ms;
      if(k>=1&&age>=b.smokeMs){b.on=false;b.img?.setVisible(false);b.smoke?.setVisible(false);continue;}
      const p=w.project(b.x,b.y,0,this.p);
      if(b.smokeMs>0){ // the smoke column: grows and rises from the fireball's top, thins out (under the fireball)
        const ks=age/b.smokeMs,r=b.r*u*(.45+.55*ks);
        if(ks<1){
          const fresh=!b.smoke;
          b.smoke=this.fxImage(b.smoke,FX.puff,b.depth-FX_DEPTH.flash,fresh).setPosition(p.x,p.y-b.r*u*(.25+.9*ks)).setScale(r*2/HEAD_TEX,r*1.5/HEAD_TEX)
            .setAlpha(.5*Math.min(1,ks*6)*(1-ks)).setTint(SMOKE_TINT);
        }else b.smoke?.setVisible(false);
      }
      if(k>=1){b.img?.setVisible(false);continue;}
      const rw=b.r*u*(.35+.65*Math.sqrt(k));
      if(b.ring){ // the wire's spark ring lies on the snow: in the ground layer
        if(!b.img){const fr=this.atlas.get(FX.ring)!;b.img=this.scene.make.image({x:0,y:0,key:fr.key,frame:fr.frame},false);this.ground.add(b.img);}
        b.img.setVisible(true).setPosition(p.x,p.y).setScale(rw*2/(RING_W-8)).setAlpha(1-k);
        if(b.tint)b.img.setTint(b.tint);else if(b.img.isTinted)b.img.clearTint();
        continue;
      }
      if(b.look==='faisca'){ // a bullet's hit: a small star turned per point, a hair over the snow
        b.img=this.fxImage(b.img,FX.spark,b.depth,false).setPosition(p.x,p.y-rw*.4).setScale(rw*2.2/SPARK_TEX).setRotation((b.x*7+b.y*13)%Math.PI).setAlpha(1-k);
        continue;
      }
      // The fireball rises as it fades (the baked one is drawn at half its rise).
      const big=b.look==='fogo-g';
      b.img=this.fxImage(b.img,big?FX.blastBig:FX.blast,b.depth,false,.5,big?BLAST_BIG_GROUND/BLAST_BIG_H:BLAST_GROUND/BLAST_H).setPosition(p.x,p.y-rw*.3*(k-.5))
        .setScale(rw/BLAST_R).setAlpha(1-k);
    }
    for(const f of this.flashes){
      if(!f.on)continue;
      const k=(now-f.born)/f.ms;if(k>=1){f.on=false;f.img?.setVisible(false);continue;}
      if(f.smoke){ // under the flash, growing as it rises one radius and a half, grey
        f.img=this.fxImage(f.img,FX.puff,f.depth,false).setPosition(f.x,f.y-f.r*1.5*k).setScale(f.r*(1+1.4*k)*2/HEAD_TEX).setAlpha(.55*(1-k)).setTint(SMOKE_TINT);
        continue;
      }
      if(f.long)f.img=this.fxImage(f.img,FX.flashLong,f.depth,false,.12,.5).setPosition(f.x,f.y).setRotation(f.rot)
        .setScale(f.r*(1-.3*k)*3.2/FLASH_LONG_W,f.r*(1-.5*k)*1.6/FLASH_LONG_H).setAlpha(1-k);
      else f.img=this.fxImage(f.img,FX.flash,f.depth,false).setPosition(f.x,f.y).setScale(f.r*(1-.4*k)*2.5/FLASH_TEX).setAlpha(1-k);
      if(f.img.isTinted)f.img.clearTint();
    }
  }
  /** An effect's depth at its ground point (the world's effectDepth, else the actor depth). */
  protected fxDepth(x:number,y:number){const w=this.o.world;return w.effectDepth?w.effectDepth(x,y):w.depth(x,y);}
  protected hideShot(sh:Shot){sh.trail?.setVisible(false);sh.head?.setVisible(false);sh.puff?.setVisible(false);}
  /**
   * A pooled effect image showing `name`, visible, in the scene's display list (made on first use). `depth` is set when
   * `set` (spawned, or moved to another cell) or the image is new; else it keeps the one it has (no re-sort per frame).
   */
  protected fxImage(img:Img,name:string,depth:number,set:boolean,ox=.5,oy=.5):Phaser.GameObjects.Image{
    const f=this.atlas.get(name)!;
    if(!img){img=this.scene.add.image(0,0,f.key,f.frame);this.fxImages.push(img);set=true;}
    if(set)img.setDepth(depth);
    if(img.frame.name!==f.frame||img.texture.key!==f.key)img.setTexture(f.key,f.frame);
    if(img.originX!==ox||img.originY!==oy)img.setOrigin(ox,oy);
    if(img.rotation!==0&&ox!==0)img.setRotation(0);
    return img.visible?img:img.setVisible(true);
  }
  /** World px of a shot at progress t (the line from the roof down to the ground plus the lob, from the barrel tip). */
  protected at(s:Shot,t:number,out:Pt):Pt{
    const k=Math.max(0,t);
    this.o.world.project(s.x0+(s.x1-s.x0)*k,s.y0+(s.y1-s.y0)*k,s.z0*(1-k)+lobHeight(s.cal,k),out);
    out.x+=s.ox*(1-k);out.y+=s.oy*(1-k);
    return out;
  }

  protected applyShake(now:number){
    const cam=this.o.camera;if(!cam)return;
    const amp=shakeAt(this.shake.cal,now-this.shake.born,this.o.reduced),zoom=cam.zoom||1;
    const off=shakeOffset(amp/zoom,now-this.shake.born,this.q);
    cam.scrollX+=off.x-this.applied.x;cam.scrollY+=off.y-this.applied.y;
    this.applied.x=off.x;this.applied.y=off.y;
  }
  /** The shake's camera offset now (world px at camera `zoom`), for a scene that centres its camera itself. */
  shakeOffset(zoom:number,out:Pt):Pt{
    const ms=this.now-this.shake.born,amp=shakeAt(this.shake.cal,ms,this.o.reduced);
    return shakeOffset(amp/(zoom||1),ms,out);
  }
  /** Current shake amplitude (CSS px), for checks. */
  shakeNow(){return shakeAt(this.shake.cal,this.now-this.shake.born,this.o.reduced);}
}
