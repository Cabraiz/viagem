/**
 * Defenses on the map (card torres-render; D-041, art pack design/proximos/08-TORRES.md): the base by phase (obra-1..3,
 * pronta, danificada, ruina) in the camera's view, the weapon turning toward its target in 8 directions at the `mount`,
 * and per calibre the muzzle flash, the shot (tracer, lobbed shell, rocket, light beam, wire spark ring), its trail,
 * the explosion and the crater left on the snow; the Gustavão's impact shakes the screen (none with reduced motion).
 * Imported art (manifest group `torres`, art/manifest.ts) when delivered; otherwise the procedural drawing below:
 * iso boxes in the city's materials with the Breu contour (D-022 double edge), scaffold poles while in obra.
 * Occlusion: a hero or ally behind a defense keeps visible, the defense fades like the city's props (render/city/
 * occlusion.ts propCovers + CoverFader, the same rule and timings as the buildings).
 * Effects come from fixed pools drawn into two Graphics (craters on the ground, the rest on top): no allocation per
 * frame. Pure rules in tower-rules.ts. Pure drawing: the caller pushes the defenses (`push`) and the enemies
 * (`setEnemies`) and calls `update` every frame.
 */
import Phaser from 'phaser';
import {artIndex,groupFileUrl} from '../../art/manifest.ts';
import {CoverFader,propCovers,type Figure} from '../city/occlusion.ts';
import {MATERIALS} from '../city/palette.ts';
import type {Pt,Rect} from '../city/projection.ts';
import {tokenColor} from '../../ui/tokens.ts';
import {CALIBRE,CRATER,PHASE_HEIGHT,TOWER_KINDS,TOWER_LOOK,TURN_MS,aimIndex,baseFrame,canFire,dir8,dirVector,firedNow,flightMs,lobHeight,shakeAt,shakeOffset,
  towerArt,towerPhase,turnToward,weaponFrame,type CalibreLook,type Dir8,type TowerKind,type TowerLook,type TowerPhase,type TowerView} from './tower-rules.ts';

/** Where the defenses sit: the city's projection and depth (the sandbox and, after torres-fio, the scene). */
export interface TowerWorld {
  /** World px of a point at height z (u) over the ground at (x, y). */
  project(x:number,y:number,z:number,out:Pt):Pt;
  /** Draw depth of a point actor standing at (x, y). */
  depth(x:number,y:number):number;
  view():number;
}
export interface TowerRendererOptions {
  world:TowerWorld;
  /** prefers-reduced-motion: no screen shake. */
  reduced:boolean;
  /** Depth of the crater decals (just over the ground) and of the shots and explosions (over the actors). */
  groundDepth:number;fxDepth:number;
  /** World px per CSS px of drawn sizes (the city's CITY_VIEW_SCALE). Default 1. */
  actorScale?:number;
  /** The camera to shake (the scene's main camera). */
  camera?:Phaser.Cameras.Scene2D.Camera;
}

interface Tower {
  view:TowerView;look:TowerLook;cal:CalibreLook;phase:TowerPhase;prevFire?:number;
  base:Phaser.GameObjects.Graphics;weapon:Phaser.GameObjects.Graphics;art?:Phaser.GameObjects.Image;gun?:Phaser.GameObjects.Image;
  dir:Dir8;want:Dir8;turnMs:number;recoilUntil:number;drawnDir:number;drawnRecoil:boolean;drawnKey:string;
  rect:Rect;prop:{x:number;y:number;rect:Rect};mount:Pt;height:number;seen:number;target:number;
}
interface Shot {on:boolean;cal:CalibreLook;x0:number;y0:number;z0:number;x1:number;y1:number;born:number;ms:number;mx:number;my:number}
interface Flash {on:boolean;x:number;y:number;r:number;born:number;ms:number}
interface Blast {on:boolean;x:number;y:number;r:number;born:number;ms:number;ring:boolean}
interface Crater {on:boolean;x:number;y:number;r:number;born:number;ms:number}

export const SHOT_POOL=192,FLASH_POOL=48,BLAST_POOL=64,CRATER_POOL=40;
/** Shots per volley drawn at most (a 6-shot volley reads as a burst, not 6 parallel lines). */
const BURST_MAX=4,BURST_GAP_MS=45;
const RECOIL_MS=90;
/** The weapon's pivot stands this high over the roof (CSS px × actor scale), on a drum. */
const POST_PX=10;

const pool=<T>(n:number,make:()=>T):T[]=>Array.from({length:n},make);
const BRANCH_MATERIAL={T:MATERIALS.pedra,A:MATERIALS.pedra,B:MATERIALS['metal-ferrugem'],C:MATERIALS['metal-pintado']} as const;

export class TowerRenderer {
  private readonly scene:Phaser.Scene;
  private readonly o:TowerRendererOptions;
  private readonly towers=new Map<string,Tower>();
  private readonly ground:Phaser.GameObjects.Graphics;
  private readonly fx:Phaser.GameObjects.Graphics;
  private readonly shots=pool<Shot>(SHOT_POOL,()=>({on:false,cal:CALIBRE.pistola,x0:0,y0:0,z0:0,x1:0,y1:0,born:0,ms:0,mx:0,my:0}));
  private readonly flashes=pool<Flash>(FLASH_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0}));
  private readonly blasts=pool<Blast>(BLAST_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0,ring:false}));
  private readonly craters=pool<Crater>(CRATER_POOL,()=>({on:false,x:0,y:0,r:0,born:0,ms:0}));
  private cursor={shot:0,flash:0,blast:0,crater:0};
  private readonly fader=new CoverFader();
  private readonly covered=new Set<string>();
  private enemies={n:0,xs:new Float32Array(0) as ArrayLike<number>,ys:new Float32Array(0) as ArrayLike<number>,air:undefined as ArrayLike<number>|undefined};
  private shake={born:-1e9,cal:CALIBRE.pistola as CalibreLook};
  private applied={x:0,y:0};
  private readonly p:Pt={x:0,y:0};
  private readonly q:Pt={x:0,y:0};
  private readonly v:Pt={x:0,y:0};
  private readonly corners:Pt[]=pool<Pt>(8,()=>({x:0,y:0}));
  private stamp=0;
  private now=0;
  private unitPx=1;
  private readonly breu=tokenColor('--c-breu');
  private readonly papel=tokenColor('--c-papel');
  private readonly amarelo=tokenColor('--c-amarelo');
  private readonly cone=tokenColor('--c-cone');
  constructor(scene:Phaser.Scene,options:TowerRendererOptions){
    this.scene=scene;this.o=options;
    this.ground=scene.add.graphics().setDepth(options.groundDepth);
    this.fx=scene.add.graphics().setDepth(options.fxDepth);
    this.measure();
  }
  private get s(){return this.o.actorScale??1;}
  /** Size unit of the weapons and effects: world px of 1/24 u, so they keep their size against the boxes at any scale. */
  private get f(){return this.unitPx/24;}
  /** World px of 1 u along the ground (screen length of a unit step), for barrel lengths and blast ellipses. */
  private measure(){
    const w=this.o.world,a=w.project(0,0,0,{x:0,y:0}),b=w.project(1,0,0,{x:0,y:0});
    this.unitPx=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));
  }
  /** The enemies the weapons aim at (parallel arrays; `air` 1 for flyers). Kept by reference, read every frame. */
  setEnemies(n:number,xs:ArrayLike<number>,ys:ArrayLike<number>,air?:ArrayLike<number>){
    this.enemies.n=n;this.enemies.xs=xs;this.enemies.ys=ys;this.enemies.air=air;
  }
  /** A new view of the defenses at sim `tick`, received at `nowMs`: new ones appear, gone ones leave, volleys fire. */
  push(tick:number,list:readonly TowerView[],nowMs:number){
    const stamp=++this.stamp;
    for(const view of list){
      let t=this.towers.get(view.id);
      if(!t||t.view.kind!==view.kind){if(t)this.drop(t);t=this.make(view);this.towers.set(view.id,t);}
      t.view=view;t.seen=stamp;
      t.phase=towerPhase(view,tick);
      if(firedNow(t.prevFire,view,tick))this.fire(t,nowMs);
      t.prevFire=view.fireTick;
    }
    for(const t of this.towers.values())if(t.seen!==stamp){this.drop(t);this.towers.delete(t.view.id);}
  }
  /** Redraws after a camera turn. */
  refresh(){this.measure();for(const t of this.towers.values())t.drawnKey='';}
  get count(){return this.towers.size;}
  /** Live effects (for checks): shots, flashes, blasts, craters. */
  live(){
    const n=(a:{on:boolean}[])=>{let c=0;for(const x of a)if(x.on)c++;return c;};
    return {shots:n(this.shots),flashes:n(this.flashes),blasts:n(this.blasts),craters:n(this.craters),inFlight:this.shots.filter(s=>s.on).map(s=>({k:s.cal.shot,age:this.now-s.born,ms:s.ms,x0:s.x0,y0:s.y0,x1:s.x1,y1:s.y1,z:s.z0}))};
  }
  /** Every frame: aim and turn, fade covering defenses, move the effects, shake. `figures`: the hero and the allies. */
  update(nowMs:number,dtMs:number,figures:readonly Figure[]){
    this.now=nowMs;
    const view=this.o.world.view(),covered=this.covered;covered.clear();
    for(const t of this.towers.values()){
      this.aim(t,dtMs);
      this.drawTower(t,view);
      t.prop.x=t.view.x;t.prop.y=t.view.y;
      for(let i=0;i<figures.length;i++)if(propCovers(t.prop,figures[i],view)){covered.add(t.view.id);break;}
    }
    const alpha=this.fader.update(covered,dtMs);
    for(const t of this.towers.values()){
      const a=alpha.get(t.view.id)??1;
      t.base.setAlpha(a);t.weapon.setAlpha(a);t.art?.setAlpha(a);t.gun?.setAlpha(a);
    }
    this.drawEffects(nowMs);
    this.applyShake(nowMs);
  }
  destroy(){
    for(const t of this.towers.values())this.drop(t);
    this.towers.clear();this.ground.destroy();this.fx.destroy();
    const cam=this.o.camera;if(cam){cam.scrollX-=this.applied.x;cam.scrollY-=this.applied.y;}
  }

  private make(view:TowerView):Tower{
    const look=TOWER_LOOK[view.kind];
    const t:Tower={view,look,cal:CALIBRE[look.calibre],phase:'obra-1',
      base:this.scene.add.graphics(),weapon:this.scene.add.graphics(),
      dir:0,want:0,turnMs:0,recoilUntil:0,drawnDir:-1,drawnRecoil:false,drawnKey:'',
      rect:{x:0,y:0,w:0,h:0},prop:{x:0,y:0,rect:{x:0,y:0,w:0,h:0}},mount:{x:0,y:0},height:0,seen:0,target:-1};
    t.prop.rect=t.rect;
    const art=towerArt(view.kind);
    if(art?.base&&this.scene.textures.exists(towerBaseKey(view.kind)))t.art=this.scene.add.image(0,0,towerBaseKey(view.kind)).setOrigin(...(art.base.anchor??[.5,.85]));
    if(art?.idle&&this.scene.textures.exists(towerGunKey(view.kind)))t.gun=this.scene.add.image(0,0,towerGunKey(view.kind)).setOrigin(...(art.idle.anchor??[.5,.5]));
    return t;
  }
  private drop(t:Tower){t.base.destroy();t.weapon.destroy();t.art?.destroy();t.gun?.destroy();}

  private aim(t:Tower,dtMs:number){
    if(t.look.calibre==='radar'){ // the dish sweeps on its own
      if(canFire(t.phase)){t.turnMs+=dtMs;while(t.turnMs>=TURN_MS*6){t.turnMs-=TURN_MS*6;t.dir=((t.dir+1)%8) as Dir8;}}
      return;
    }
    const e=this.enemies;
    t.target=canFire(t.phase)?aimIndex(t.look,t.view.x,t.view.y,e.n,e.xs,e.ys,e.air):-1;
    if(t.target>=0){
      const w=this.o.world,a=w.project(t.view.x,t.view.y,0,this.p),b=w.project(e.xs[t.target],e.ys[t.target],0,this.q);
      t.want=dir8(b.x-a.x,b.y-a.y,t.want);
    }
    if(t.dir===t.want){t.turnMs=0;return;}
    t.turnMs+=dtMs;
    while(t.turnMs>=TURN_MS&&t.dir!==t.want){t.turnMs-=TURN_MS;t.dir=turnToward(t.dir,t.want);}
  }

  /** A volley: muzzle flash, recoil, and the shots toward the current aim (the nearest reachable enemy). */
  private fire(t:Tower,nowMs:number){
    const cal=t.cal,e=this.enemies;
    t.recoilUntil=nowMs+RECOIL_MS;
    const target=aimIndex(t.look,t.view.x,t.view.y,e.n,e.xs,e.ys,e.air);
    if(target>=0&&cal.shot!=='aura'){ // snap the weapon to the target it fired at
      const w=this.o.world,a=w.project(t.view.x,t.view.y,0,this.p),b=w.project(e.xs[target],e.ys[target],0,this.q);
      t.dir=t.want=dir8(b.x-a.x,b.y-a.y,t.dir);
    }
    this.muzzle(t);
    if(cal.flash>0)this.addFlash(this.v.x,this.v.y,cal.flash*this.f,cal.flashMs,nowMs);
    if(cal.shot==='aura'){this.addBlast(t.view.x,t.view.y,t.look.range,cal.blastMs,nowMs,true);return;}
    if(target<0||cal.shot==='none')return;
    const tx=e.xs[target],ty=e.ys[target];
    if(cal.shot==='beam'){this.addBeam(t,tx,ty,nowMs);return;}
    const n=Math.min(BURST_MAX,t.look.shots),h=t.height*PHASE_HEIGHT[t.phase];
    for(let i=0;i<n;i++){
      // Deterministic spread of a burst around the aim point (golden angle), staggered in time.
      const a=i*2.39996,r=i?.35+.15*i:0;
      const x1=tx+Math.cos(a)*r,y1=ty+Math.sin(a)*r,dist=Math.hypot(x1-t.view.x,y1-t.view.y);
      this.addShot(cal,t.view.x,t.view.y,h,x1,y1,nowMs+i*BURST_GAP_MS,flightMs(cal,dist));
    }
  }
  /** World px of the muzzle tip into this.v (mount + barrel along the weapon's direction). */
  private muzzle(t:Tower){
    const d=dirVector(t.dir,this.v),len=t.cal.barrel*this.unitPx;
    this.v.x=t.mount.x+d.x*len;this.v.y=t.mount.y+d.y*len*.5;
  }

  private next<T extends {on:boolean}>(list:T[],key:'shot'|'flash'|'blast'|'crater'):T{
    const c=this.cursor;
    for(let k=0;k<list.length;k++){const i=(c[key]+k)%list.length;if(!list[i].on){c[key]=(i+1)%list.length;return list[i];}}
    const i=c[key];c[key]=(i+1)%list.length;return list[i]; // full: the oldest slot in ring order is reused
  }
  private addShot(cal:CalibreLook,x0:number,y0:number,z0:number,x1:number,y1:number,born:number,ms:number){
    const s=this.next(this.shots,'shot');
    s.on=true;s.cal=cal;s.x0=x0;s.y0=y0;s.z0=z0;s.x1=x1;s.y1=y1;s.born=born;s.ms=ms;
  }
  private addBeam(t:Tower,x1:number,y1:number,born:number){
    const s=this.next(this.shots,'shot');
    s.on=true;s.cal=t.cal;s.x0=t.view.x;s.y0=t.view.y;s.z0=t.height;s.x1=x1;s.y1=y1;s.born=born;s.ms=t.cal.blastMs;s.mx=this.v.x;s.my=this.v.y;
  }
  private addFlash(x:number,y:number,r:number,ms:number,born:number){
    const f=this.next(this.flashes,'flash');f.on=true;f.x=x;f.y=y;f.r=r;f.ms=ms;f.born=born;
  }
  private addBlast(x:number,y:number,r:number,ms:number,born:number,ring=false){
    const b=this.next(this.blasts,'blast');b.on=true;b.x=x;b.y=y;b.r=r;b.ms=ms;b.born=born;b.ring=ring;
  }
  private addCrater(x:number,y:number,r:number,ms:number,born:number){
    const c=this.next(this.craters,'crater');c.on=true;c.x=x;c.y=y;c.r=r;c.ms=ms;c.born=born;
  }
  private impact(s:Shot,now:number){
    const c=s.cal;
    if(c.blast>0)this.addBlast(s.x1,s.y1,c.blast,c.blastMs,now);
    else this.addBlast(s.x1,s.y1,.18,110,now);
    if(c.crater){const k=CRATER[c.crater];this.addCrater(s.x1,s.y1,k.radius,k.ms,now);}
    if(c.shake>0&&(now-this.shake.born>=this.shake.cal.shakeMs||c.shake>=this.shake.cal.shake)){this.shake.born=now;this.shake.cal=c;}
  }

  private drawEffects(now:number){
    const g=this.fx,w=this.o.world,u=this.unitPx,s=this.f;
    g.clear();this.ground.clear();
    for(const c of this.craters){
      if(!c.on)continue;
      const k=(now-c.born)/c.ms;if(k>=1){c.on=false;continue;}
      const a=k<.8?1:1-(k-.8)/.2,p=w.project(c.x,c.y,0,this.p),rw=c.r*u,rh=rw*.5;
      this.ground.fillStyle(this.breu,.42*a).fillEllipse(p.x,p.y,rw*2,rh*2)
        .fillStyle(MATERIALS.pedra.escura,.55*a).fillEllipse(p.x,p.y+rh*.1,rw*1.4,rh*1.3)
        .lineStyle(Math.max(1,2*s),this.breu,.7*a).strokeEllipse(p.x,p.y,rw*2,rh*2);
    }
    for(const sh of this.shots){
      if(!sh.on||now<sh.born)continue;
      const c=sh.cal,t=sh.ms>0?(now-sh.born)/sh.ms:1;
      if(c.shot==='beam'){
        if(t>=1){sh.on=false;continue;}
        const p=w.project(sh.x1,sh.y1,0,this.p),a=(1-t)*.6,half=c.barrel*u*.9;
        // Light cone with the Breu double edge (a pale beam alone vanishes on the snow).
        g.fillStyle(this.amarelo,a).fillTriangle(sh.mx,sh.my,p.x-half,p.y,p.x+half,p.y)
          .lineStyle(Math.max(1,1.5*s),this.breu,a).strokeTriangle(sh.mx,sh.my,p.x-half,p.y,p.x+half,p.y)
          .fillStyle(this.amarelo,a*1.4).fillEllipse(p.x,p.y,half*2.4,half*1.2)
          .lineStyle(Math.max(1,1.5*s),this.breu,a).strokeEllipse(p.x,p.y,half*2.4,half*1.2);
        continue;
      }
      if(t>=1){sh.on=false;this.impact(sh,now);continue;}
      const dist=Math.hypot(sh.x1-sh.x0,sh.y1-sh.y0)||1,back=Math.min(t,c.trail/dist);
      const head=this.at(sh,t,this.p),tail=this.at(sh,t-back,this.q);
      if(c.shot==='tracer'){
        g.lineStyle(Math.max(1,4*s),this.breu,.6).lineBetween(tail.x,tail.y,head.x,head.y)
          .lineStyle(Math.max(1,2.2*s),this.amarelo,1).lineBetween(tail.x,tail.y,head.x,head.y)
          .fillStyle(this.papel,1).fillCircle(head.x,head.y,1.6*s);
      }else{
        if(c.trail>0){
          g.lineStyle(Math.max(1,4*s),this.papel,.5).lineBetween(tail.x,tail.y,head.x,head.y);
          if(c.shot==='rocket')g.fillStyle(this.papel,.45).fillCircle(tail.x,tail.y,4*s);
        }
        const r=(c.shot==='rocket'?3:c.crater==='gustavao'?9:4.5)*s;
        g.fillStyle(this.breu,1).fillCircle(head.x,head.y,r+1.5*s)
          .fillStyle(c.shot==='rocket'?this.cone:MATERIALS.pedra.clara,1).fillCircle(head.x,head.y,r);
      }
    }
    for(const b of this.blasts){
      if(!b.on)continue;
      const k=(now-b.born)/b.ms;if(k>=1){b.on=false;continue;}
      const p=w.project(b.x,b.y,0,this.p),rw=b.r*u*(.35+.65*Math.sqrt(k)),rh=rw*.5;
      if(b.ring){
        g.lineStyle(Math.max(1,3*s),this.breu,.5*(1-k)).strokeEllipse(p.x,p.y,rw*2,rh*2)
          .lineStyle(Math.max(1,1.5*s),this.papel,.9*(1-k)).strokeEllipse(p.x,p.y,rw*2,rh*2);
        continue;
      }
      const lift=rh*1.2*k;
      g.fillStyle(this.breu,.35*(1-k)).fillEllipse(p.x,p.y-lift,rw*2.1,rh*2.4)
        .fillStyle(this.cone,.85*(1-k)).fillEllipse(p.x,p.y-lift*.6,rw*1.6,rh*1.9)
        .fillStyle(this.amarelo,(1-k)).fillEllipse(p.x,p.y-lift*.4,rw*.9,rh*1.1);
    }
    for(const f of this.flashes){
      if(!f.on)continue;
      const k=(now-f.born)/f.ms;if(k>=1){f.on=false;continue;}
      const r=f.r*(1-.4*k);
      g.fillStyle(this.cone,.7*(1-k)).fillCircle(f.x,f.y,r*1.25)
        .fillStyle(this.amarelo,1-k).fillCircle(f.x,f.y,r)
        .fillStyle(this.papel,1-k).fillCircle(f.x,f.y,r*.45);
    }
  }
  /** World px of a shot at progress t (the line from the muzzle height down to the ground plus the lob). */
  private at(s:Shot,t:number,out:Pt):Pt{
    const k=Math.max(0,t);
    return this.o.world.project(s.x0+(s.x1-s.x0)*k,s.y0+(s.y1-s.y0)*k,s.z0*(1-k)+lobHeight(s.cal,k),out);
  }

  private applyShake(now:number){
    const cam=this.o.camera;if(!cam)return;
    const amp=shakeAt(this.shake.cal,now-this.shake.born,this.o.reduced),zoom=cam.zoom||1;
    const off=shakeOffset(amp/zoom,now-this.shake.born,this.q);
    cam.scrollX+=off.x-this.applied.x;cam.scrollY+=off.y-this.applied.y;
    this.applied.x=off.x;this.applied.y=off.y;
  }
  /** Current shake amplitude (CSS px), for checks. */
  shakeNow(){return shakeAt(this.shake.cal,this.now-this.shake.born,this.o.reduced);}

  // ---- the defense itself ----
  private drawTower(t:Tower,view:number){
    const w=this.o.world,v=t.view,look=t.look,phase=t.phase;
    const depth=w.depth(v.x,v.y);
    t.base.setDepth(depth);t.weapon.setDepth(depth+.001);t.art?.setDepth(depth);t.gun?.setDepth(depth+.001);
    const key=`${phase}|${view}`;
    const H=look.height*PHASE_HEIGHT[phase];
    if(t.drawnKey!==key){
      t.drawnKey=key;t.drawnDir=-1;t.height=look.height;
      const top=w.project(v.x,v.y,H,this.p);t.mount.x=top.x;t.mount.y=top.y-POST_PX*this.f;
      if(t.art)this.placeArt(t,view);
      else this.drawBase(t,H);
    }
    const recoil=this.now<t.recoilUntil;
    if(t.drawnDir!==t.dir||t.drawnRecoil!==recoil){t.drawnDir=t.dir;t.drawnRecoil=recoil;this.drawWeapon(t,recoil);}
  }
  private placeArt(t:Tower,view:number){
    const art=towerArt(t.view.kind)!,file=art.base!,img=t.art!,w=this.o.world,p=w.project(t.view.x,t.view.y,0,this.p);
    const scale=2.2*t.view.r*this.unitPx/file.cell[0];
    img.setPosition(p.x,p.y).setScale(scale).setFrame(baseFrame(t.phase,view,Math.max(1,Math.min(4,file.views??4))));
    t.base.clear();
    const b=img.getBounds();t.rect.x=b.x;t.rect.y=b.y;t.rect.w=b.width;t.rect.h=b.height;
    if(art.mount){
      const anchor=file.anchor??[.5,.85];
      t.mount.x=p.x+(art.mount[0]-anchor[0]*file.cell[0])*scale;t.mount.y=p.y+(art.mount[1]-anchor[1]*file.cell[1])*scale;
    }
  }
  /** Procedural base: an iso box of the footprint in the branch's material, by phase. */
  private drawBase(t:Tower,H:number){
    const g=t.base,v=t.view,look=t.look,phase=t.phase,s=this.s,w=this.o.world,c=this.corners;
    g.clear();
    const big=Math.max(look.footprint[0],look.footprint[1]),hx=v.r*.85*look.footprint[0]/big,hy=v.r*.85*look.footprint[1]/big;
    const ruin=phase==='ruina',hurt=phase==='danificada'||ruin,obra=phase.startsWith('obra');
    const m=ruin?MATERIALS.pedra:obra?MATERIALS.madeira:BRANCH_MATERIAL[look.branch];
    const xs=[-hx,hx,hx,-hx],ys=[-hy,-hy,hy,hy];
    for(let i=0;i<4;i++){w.project(v.x+xs[i],v.y+ys[i],0,c[i]);w.project(v.x+xs[i],v.y+ys[i],H,c[i+4]);}
    const centre=w.project(v.x,v.y,H*.5,this.q);
    const line=Math.max(1,2*s);
    if(look.calibre==='gustavao'){ // the rails under it, longer than the carriage
      for(const off of [-.55,.55]){
        const a=w.project(v.x-hx*1.25,v.y+off*hy,0,this.p),b=w.project(v.x+hx*1.25,v.y+off*hy,0,this.v);
        g.lineStyle(5*s,this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(2.5*s,MATERIALS['metal-ferrugem'].escura,1).lineBetween(a.x,a.y,b.x,b.y);
      }
    }
    // Side faces facing the camera (their bottom middle below the centre on screen), then the top.
    for(let i=0;i<4;i++){
      const j=(i+1)%4,a=c[i],b=c[j],midY=(a.y+b.y)/2,midX=(a.x+b.x)/2;
      if(midY<centre.y)continue;
      const fill=hurt||midX>centre.x?m.escura:m.clara;
      g.fillStyle(fill,1).lineStyle(line,this.breu,1);
      g.beginPath().moveTo(a.x,a.y).lineTo(b.x,b.y).lineTo(c[j+4].x,c[j+4].y).lineTo(c[i+4].x,c[i+4].y).closePath().fillPath().strokePath();
      if(phase==='danificada'){ // cracks
        const x0=a.x*.6+b.x*.4,y0=a.y*.6+b.y*.4-(a.y-c[i+4].y)*.2;
        g.lineStyle(Math.max(1,1.5*s),this.breu,1).beginPath().moveTo(x0,y0).lineTo(x0+4*s,y0-6*s).lineTo(x0-1*s,y0-11*s).lineTo(x0+5*s,y0-16*s).strokePath();
      }
    }
    g.fillStyle(ruin?MATERIALS.pedra.luz:hurt?m.clara:m.luz,1).lineStyle(line,this.breu,1);
    g.beginPath().moveTo(c[4].x,c[4].y).lineTo(c[5].x,c[5].y).lineTo(c[6].x,c[6].y).lineTo(c[7].x,c[7].y).closePath().fillPath().strokePath();
    if(ruin){ // rubble chunks
      for(let i=0;i<3;i++){const p=w.project(v.x+xs[i]*.7,v.y+ys[(i+1)%4]*.5,H,this.p);g.fillStyle(MATERIALS.pedra.clara,1).lineStyle(line,this.breu,1).fillCircle(p.x,p.y,4*s).strokeCircle(p.x,p.y,4*s);}
    }else if(!obra&&look.calibre!=='gustavao'){ // sandbag rim on the roof
      const p=w.project(v.x,v.y,H,this.p),rw=Math.min(hx,hy)*this.unitPx*.9;
      g.lineStyle(Math.max(1,5*s),this.breu,1).strokeEllipse(p.x,p.y,rw*2,rw).lineStyle(Math.max(1,3*s),this.papel,1).strokeEllipse(p.x,p.y,rw*2,rw);
    }
    if(obra){ // scaffold poles up to the finished height
      const top=look.height;
      for(let i=0;i<4;i++){
        const a=c[i],b=w.project(v.x+xs[i],v.y+ys[i],top,this.p);
        g.lineStyle(Math.max(1,3*s),this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,1.5*s),MATERIALS.madeira.luz,1).lineBetween(a.x,a.y,b.x,b.y);
      }
      const a=w.project(v.x+xs[0],v.y+ys[0],top,this.p),b=w.project(v.x+xs[2],v.y+ys[2],top,this.v);
      g.lineStyle(Math.max(1,3*s),this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,1.5*s),MATERIALS.madeira.luz,1).lineBetween(a.x,a.y,b.x,b.y);
    }
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of c){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    if(obra)minY-=(look.height-H)*this.unitPx;
    t.rect.x=minX;t.rect.y=minY;t.rect.w=maxX-minX;t.rect.h=maxY-minY;
  }
  /** Procedural weapon at the mount (turret disc + barrel toward the direction row), or the idle sheet's frame. */
  private drawWeapon(t:Tower,recoil:boolean){
    const g=t.weapon,s=this.f,cal=t.cal;
    g.clear();
    const show=canFire(t.phase)||t.phase==='obra-3';
    if(t.gun){
      const art=towerArt(t.view.kind)!,frames=Math.max(1,art.idle?.frames??1);
      t.gun.setVisible(show).setPosition(t.mount.x,t.mount.y).setScale(t.art?.scaleX??1).setFrame(weaponFrame(t.dir,0,frames));
      return;
    }
    if(!show||cal.shot==='aura')return this.drawWire(t);
    const d=dirVector(t.dir,this.v),k=recoil?-.12:0,len=cal.barrel*this.unitPx,mx=t.mount.x,my=t.mount.y;
    const x0=mx+d.x*len*k,y0=my+d.y*len*k*.5,x1=mx+d.x*len*(1+k),y1=my+d.y*len*.5*(1+k);
    const gus=t.look.calibre==='gustavao',disc=(gus?16:9)*s,thick=(gus?12:cal.blast>1?9:6)*s,post=POST_PX*s,line=Math.max(1,2*s);
    const metal=MATERIALS['metal-pintado'];
    // The mount: a short drum from the roof up to the weapon's pivot (Breu contour, light top).
    g.fillStyle(metal.escura,1).lineStyle(line,this.breu,1).fillRect(mx-disc,my,disc*2,post).strokeRect(mx-disc,my,disc*2,post)
      .fillEllipse(mx,my+post,disc*2,disc).strokeEllipse(mx,my+post,disc*2,disc)
      .fillStyle(metal.luz,1).fillEllipse(mx,my,disc*2,disc).strokeEllipse(mx,my,disc*2,disc);
    if(cal.shot==='beam'){ // the lamp: a light disc facing the target
      g.fillStyle(this.breu,1).fillCircle(x1,y1-disc*.6,disc*1.1).fillStyle(this.papel,1).fillCircle(x1,y1-disc*.6,disc*.8)
        .fillStyle(this.amarelo,1).fillCircle(x1+d.x*disc*.2,y1-disc*.6+d.y*disc*.1,disc*.45);
      return;
    }
    if(cal.shot==='none'){ // radar dish
      g.lineStyle(thick*.6+2*s,this.breu,1).lineBetween(mx,my,x1,y1-disc*1.4).fillStyle(this.breu,1).fillEllipse(x1,y1-disc*1.4,disc*2.8,disc*1.8)
        .fillStyle(this.papel,1).fillEllipse(x1,y1-disc*1.4,disc*2.3,disc*1.4);
      return;
    }
    // Barrel: Breu contour, dark metal, a light highlight, and the muzzle ring.
    g.lineStyle(thick+3*s,this.breu,1).lineBetween(x0,y0,x1,y1).lineStyle(thick,metal.escura,1).lineBetween(x0,y0,x1,y1)
      .lineStyle(Math.max(1,thick*.3),metal.luz,1).lineBetween(x0,y0-thick*.2,x1,y1-thick*.2)
      .fillStyle(this.breu,1).fillCircle(x1,y1,thick*.75);
  }
  /** C3: coils of wire around the post (no turning weapon). */
  private drawWire(t:Tower){
    if(t.cal.shot!=='aura'||!canFire(t.phase))return;
    const g=t.weapon,s=this.s,w=this.o.world,r=t.view.r*1.3;
    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2,p=w.project(t.view.x+Math.cos(a)*r,t.view.y+Math.sin(a)*r,.12,this.p);
      g.lineStyle(Math.max(1,2.5*s),this.breu,1).strokeCircle(p.x,p.y,4*s).lineStyle(Math.max(1,1.2*s),MATERIALS['metal-pintado'].luz,1).strokeCircle(p.x,p.y,4*s);
    }
  }
}

/** Texture keys of a defense's imported sheets. */
export const towerBaseKey=(kind:string)=>`art:torres:${kind}:base`;
export const towerGunKey=(kind:string)=>`art:torres:${kind}:idle`;
/** Queues the delivered tower sheets (single-page files only; the rest stays procedural). Call in preload. */
export function queueTowerArt(scene:Phaser.Scene){
  for(const kind of TOWER_KINDS as readonly TowerKind[]){
    const art=towerArt(kind);if(!art)continue;
    for(const [key,file] of [[towerBaseKey(kind),art.base],[towerGunKey(kind),art.idle]] as const){
      if(!file?.file||scene.textures.exists(key))continue;
      const group=artIndex().groups.torres;if(!group)continue;
      const url=groupFileUrl(group,file.file);
      scene.load.spritesheet(key,url,{frameWidth:file.cell[0],frameHeight:file.cell[1]});
    }
  }
}
