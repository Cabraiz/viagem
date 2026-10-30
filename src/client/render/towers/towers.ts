/**
 * Defenses on the map (card torres-render; D-041, art pack design/proximos/08-TORRES.md): the base by phase (obra-1..3,
 * pronta, danificada, ruina) in the camera's view, the weapon turning toward its target in 8 directions at the `mount`,
 * and per calibre the muzzle flash, the shot (tracer, lobbed shell, rocket, light beam, wire spark ring), its trail,
 * the explosion and the crater left on the snow; the Gustavão's impact shakes the screen (none with reduced motion).
 * Imported art (manifest group `torres`, art/manifest.ts) when delivered; otherwise the procedural drawing below:
 * iso boxes in the city's materials with the Breu contour (D-022 double edge), scaffold poles while in obra.
 * Depth: a defense sorts at its footprint's front corner (like the city's blocks), so a figure behind any part of it is
 * drawn behind it; every effect sorts at the actor depth of its own point (a shot behind a building is covered by it).
 * Occlusion: a hero or ally behind a defense keeps visible, the defense fades like the city's props (render/city/
 * occlusion.ts propCovers + CoverFader, the same rule, pivot, figure box and timings as the buildings).
 * Every procedural texture (bases, weapons, craters, effects) is a frame of one shared atlas (tower-atlas.ts), so the
 * defenses never break the sprite batch with textures of their own.
 * Lighting card (render/light.ts): each defense casts a soft shadow away from the sun (tower-shadow.ts), baked per kind
 * × phase × view × size in a layer of its own over the ground decals and under everything standing; off with `?luz=0`
 * and in economy mode (`economy`, set by the scene).
 * Effects come from fixed pools of Images of frames baked once (craters and the wire's ring in a Layer on the ground):
 * nothing is tessellated per frame, a crater is placed once, an effect's depth is set when it spawns or crosses a
 * half-unit cell, the weapons re-scan the horde only when they fire or every RESCAN_MS (with the server's aim, never),
 * and a defense's depth and cover test run only when it, the figures or the city's columns (`depthVersion`) changed. Pure rules in tower-rules.ts. Pure drawing: the caller pushes the defenses (`push`) and the enemies
 * (`setEnemies`) and calls `update` every frame.
 */
import Phaser from 'phaser';
import {HERO_SCREEN,propCovers,type Figure} from '../city/occlusion.ts';
import {VIEW_PIVOT} from '../city/projection.ts';
import {UsableGlow} from '../usable-glow.ts';
import {CALIBRE,TOWER_LOOK,baseFrame,firedNow,towerArt,towerPhase,textureRatio,weaponSeed,type TowerKind,type TowerView} from './tower-rules.ts';
import {FX_DEPTH,VOLLEY_STAGGER_MS} from './tower-tuning.ts';
import type {Tower} from './tower-types.ts';
import {TOWER_ART_WAIT_MS,towerBaseKey,towerFireKey} from './tower-art-queue.ts';
import {TowerAim} from './tower-aim.ts';

// Corte C2: the renderer is cut along its parts (tower-base → tower-fx → tower-draw → tower-aim → here); this file keeps
// its public API, so no import from outside changes.
export type {TowerWorld,TowerRendererOptions} from './tower-types.ts';
export {SHOT_POOL,FLASH_POOL,BLAST_POOL,CRATER_POOL,FX_ART_KEY,FX_ART_URL,RESCAN_MS,type FxArtFrames} from './tower-tuning.ts';
export {TOWER_ART_WAIT_MS,towerBaseKey,towerGunKey,towerFireKey,towerLiteUrl,towerLoads,queueTowerArt,type TowerLoad} from './tower-art-queue.ts';

export class TowerRenderer extends TowerAim {
  /** Economy mode (scene.setEconomy): the cast shadows hide (and come back baked as they were). */
  get economy(){return this.economyOn;}
  set economy(on:boolean){
    if(on===this.economyOn)return;
    this.economyOn=on;
    const view=this.o.world.view();
    for(const t of this.towers.values())this.placeShadow(t,view);
    this.atlas.flush();
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
      if(!t||t.view.kind!==view.kind){if(t)this.drop(t);t=this.make(view);this.towers.set(view.id,t);this.coverDirty=true;}
      t.view=view;t.seen=stamp;
      t.phase=view.phase??towerPhase(view,tick);
      if(view.aim!==undefined&&view.aim!==t.aimFor)this.aimAt(t,view.aim);
      if(firedNow(t.prevFire,view,tick)){
        this.fire(t,nowMs);
        for(let k=1;k<(view.volleys??1);k++)(t.queued??=[]).push(nowMs+k*VOLLEY_STAGGER_MS);
      }
      t.prevFire=view.fireTick;
    }
    for(const t of this.towers.values())if(t.seen!==stamp){this.drop(t);this.towers.delete(t.view.id);this.coverDirty=true;}
  }
  /** Another world (a map switch): no defense and no effect of the old one stays. */
  reset(){
    for(const t of this.towers.values())this.drop(t);
    this.towers.clear();this.coverDirty=true;this.fader.reset();
    for(const sh of this.shots){sh.on=false;this.hideShot(sh);}
    for(const f of this.flashes){f.on=false;f.img?.setVisible(false);}
    for(const b of this.blasts){b.on=false;b.img?.setVisible(false);b.smoke?.setVisible(false);}
    for(let i=0;i<this.craters.length;i++){this.craters[i].on=false;this.craterImages[i].setVisible(false);}
    this.shake.born=-1e9;
  }
  /**
   * After a camera turn or a depth re-base: the defenses are re-placed and re-sorted now (not on their next frame), the
   * server aims re-turned, the craters re-placed, the effects re-sorted.
   */
  refresh(){
    this.measure();
    const view=this.o.world.view();
    for(const t of this.towers.values()){t.drawnPhase='';t.aimFor=NaN;if(t.view.aim!==undefined)this.aimAt(t,t.view.aim);this.drawTower(t,view);}
    for(let i=0;i<this.craters.length;i++)if(this.craters[i].on)this.placeCrater(this.craters[i],this.craterImages[i]);
    this.redepth();
  }
  /** The world's depths moved (chunks loaded or dropped, a re-base): every defense and live effect is sorted again. */
  redepth(){
    for(const t of this.towers.values())this.sortTower(t);
    const live=(t:Tower|undefined):t is Tower=>!!t&&this.towers.get(t.view.id)===t;
    for(const b of this.blasts)if(b.on&&!b.ring){b.depth=this.fxDepth(b.x,b.y)+FX_DEPTH.blast;b.img?.setDepth(b.depth);b.smoke?.setDepth(b.depth-FX_DEPTH.flash);}
    // A muzzle flash, its smoke and a beam's cone sort with the defense that fired them (a gone one's keep their depth).
    for(const f of this.flashes)if(f.on&&live(f.src)){f.depth=f.src.depth+f.lift;f.img?.setDepth(f.depth);}
    for(const sh of this.shots)if(sh.on){sh.cell=-1;if(live(sh.src))sh.d0=sh.src.depth;}
    this.coverDirty=true;
  }
  get count(){return this.towers.size;}
  /** Live effects (for checks): shots, flashes, blasts, craters. */
  live(){
    const n=(a:{on:boolean}[])=>{let c=0;for(const x of a)if(x.on)c++;return c;};
    return {shots:n(this.shots),flashes:n(this.flashes),blasts:n(this.blasts),rings:this.blasts.filter(b=>b.on&&b.ring).length,craters:n(this.craters),inFlight:this.shots.filter(s=>s.on).map(s=>({k:s.cal.shot,age:this.now-s.born,ms:s.ms,x0:s.x0,y0:s.y0,x1:s.x1,y1:s.y1,z:s.z0}))};
  }
  /** Every frame: aim and turn, fade covering defenses, move the effects, shake. `figures`: the hero and the allies. */
  update(nowMs:number,dtMs:number,figures:readonly Figure[]){
    this.now=nowMs;
    const glow=this.glow??=new UsableGlow(this.scene,this.o.reduced),k=1/Math.max(.05,this.o.camera?.zoom||this.scene.cameras.main.zoom||1);
    glow.begin(nowMs);
    const version=this.o.depthVersion?.()??0;
    if(version!==this.depthSeen){this.depthSeen=version;this.redepth();}
    const view=this.o.world.view(),covered=this.covered;
    for(const t of this.towers.values()){
      while(t.queued?.length&&t.queued[0]<=nowMs){t.queued.shift();this.fire(t,nowMs);}
      this.aim(t,dtMs);
      this.drawTower(t,view);
    }
    const s=this.s,box=this.figureBox;
    if(box.scale!==s){box.scale=s;box.w=HERO_SCREEN.w*s;box.h=HERO_SCREEN.h*s;this.coverDirty=true;}
    if(this.figuresMoved(figures)||this.coverDirty){
      this.coverDirty=false;
      for(const t of this.towers.values()){
        t.covers=false;
        for(let i=0;i<figures.length;i++)if(propCovers(t.prop,figures[i],view,VIEW_PIVOT,box)){t.covers=true;break;}
      }
    }
    covered.clear();
    for(const t of this.towers.values())if(t.covers)covered.add(t.view.id);
    const alpha=this.fader.update(covered,dtMs);
    for(const t of this.towers.values()){
      const a=alpha.get(t.view.id)??1;
      if(a!==t.alpha){t.alpha=a;t.base.setAlpha(a);t.weapon.setAlpha(a);}
      // contorno-usavel-wc3: a defense (and its obra) can be built on and upgraded: the Warcraft 3 gold outline.
      if(this.outline)glow.mark(t.view.id,t.base,k);
    }
    glow.end();
    this.drawEffects(nowMs);
    this.atlas.flush();
    this.applyShake(nowMs);
    if(this.labHidden)this.hideAll(this.labHidden);
  }
  /**
   * Lab only (the sandbox's FPS bench): draw nothing while everything still runs, so drawn and hidden frames can be
   * compared on one page under the same load.
   */
  labHidden='';
  /** contorno-usavel-wc3: the gold outline of the defenses (render/usable-glow.ts), made on the first update. */
  private glow?:UsableGlow;
  private hideAll(what:string){
    const all=what==='all';
    if(all||what.includes('crateras'))this.ground.setVisible(false);
    if(all||what.includes('efeitos'))for(const i of this.fxImages)i.setVisible(false);
    if(all||what.includes('bases'))for(const t of this.towers.values()){t.base.setVisible(false);t.weapon.setVisible(false);t.rail?.setVisible(false);}
  }
  /** Lab only: what is drawn now, per kind — images shown and their area in world px² (× zoom² for screen px). */
  labStats(){
    const out:Record<string,{n:number;area:number}>={};
    const add=(k:string,i:Phaser.GameObjects.Image|undefined)=>{if(!i||!i.visible||i.alpha<=0)return;const o=out[k]??={n:0,area:0};o.n++;o.area+=Math.abs(i.displayWidth*i.displayHeight);};
    for(const t of this.towers.values()){add('bases',t.base);add('armas',t.weapon);add('trilho',t.rail);}
    for(const i of this.craterImages)add('crateras',i);
    for(const i of this.fxImages)add('efeitos',i);
    return out;
  }
  /** Lab only: shows again what hideAll hid (effects come back as they are drawn, a defense is redrawn whole). */
  labShow(){
    this.ground.setVisible(true);
    for(const t of this.towers.values()){t.base.setVisible(true);t.drawnPhase='';t.drawnView=-1;t.drawnDir=-1;}
  }
  /** The figures moved since the last cover test (and remembers where they are). */
  private figuresMoved(figures:readonly Figure[]):boolean{
    const last=this.lastFigures;let moved=last.length!==figures.length*3;
    if(moved)last.length=figures.length*3;
    for(let i=0;i<figures.length;i++){
      const f=figures[i],j=i*3;
      if(last[j]!==f.x||last[j+1]!==f.y||last[j+2]!==f.z){moved=true;last[j]=f.x;last[j+1]=f.y;last[j+2]=f.z;}
    }
    return moved;
  }
  /** barricada-tocar-no-mapa: the kit de torre's ghost, its own art (the ready row) translucent and tinted. */
  private ghostImg?:Phaser.GameObjects.Image;
  /**
   * The ghost of a kit de torre at world (x,y) (its footprint's centre), tinted `color`; null hides it. False when its
   * art is not loaded (it is asked for; the caller draws the box meanwhile).
   */
  setGhost(g:{kind:TowerKind;x:number;y:number;color:number}|null):boolean{
    const art=g?towerArt(g.kind):undefined,file=art?.base;
    if(!g||!file||!this.scene.textures.exists(towerBaseKey(g.kind))){
      this.ghostImg?.setVisible(false);
      if(g&&file)this.o.needArt?.(g.kind);
      return false;
    }
    const img=this.ghostImg??=this.scene.add.image(0,0,'__DEFAULT').setName('torre-fantasma');
    const p=this.o.world.project(g.x,g.y,0,this.p),anchor=file.anchor??[.5,.85],view=this.o.world.view();
    img.setTexture(towerBaseKey(g.kind)).setOrigin(anchor[0],anchor[1]).setPosition(p.x,p.y).setScale(this.kindScale(g.kind)/textureRatio(file))
      .setFrame(baseFrame('pronta',view,Math.max(1,Math.min(4,file.views??4)),Array.isArray(file.rows)?file.rows:undefined))
      .setAlpha(.72).setTint(g.color).setDepth(1e6+1).setVisible(true);
    return true;
  }
  destroy(){
    this.ghostImg?.destroy();this.ghostImg=undefined;
    for(const t of this.towers.values())this.drop(t);
    this.towers.clear();this.glow?.destroy();this.bake.destroy();this.ground.destroy();this.shade.destroy();
    for(const img of this.fxImages)img.destroy();this.fxImages.length=0;
    const cam=this.o.camera;if(cam){cam.scrollX-=this.applied.x;cam.scrollY-=this.applied.y;}
  }

  private make(view:TowerView):Tower{
    const look=TOWER_LOOK[view.kind];
    const t:Tower={view,look,cal:CALIBRE[look.calibre],phase:'obra-1',
      base:this.scene.add.image(0,0,'__DEFAULT'),weapon:this.scene.add.image(0,0,'__DEFAULT'),art:false,artWait:false,hideUntil:0,scanAt:0,alpha:1,covers:false,
      dir:0,want:0,turnMs:0,recoilUntil:0,drawnDir:-1,drawnRecoil:false,drawnPhase:'',drawnView:-1,fireAt:-1e9,seedMs:weaponSeed(view.id),drawnPose:-1,
      rect:{x:0,y:0,w:0,h:0},prop:{x:0,y:0,rect:{x:0,y:0,w:0,h:0}},mount:{x:0,y:0},height:0,seen:0,target:-1,depth:0,aimFor:NaN};
    t.prop.rect=t.rect;
    const art=towerArt(view.kind);
    t.art=!!art?.base&&this.scene.textures.exists(towerBaseKey(view.kind));
    t.artWait=!!art?.base&&!t.art;
    if(t.artWait){t.hideUntil=this.now+TOWER_ART_WAIT_MS;this.o.needArt?.(view.kind);}
    // The fire sheet streams only for the kinds standing in the match (towerLoads: not in the opening's queue).
    else if(art?.fire&&!this.scene.textures.exists(towerFireKey(view.kind)))this.o.needArt?.(view.kind);
    return t;
  }
  private drop(t:Tower){t.base.destroy();t.weapon.destroy();t.rail?.destroy();t.shadow?.destroy();}
}
