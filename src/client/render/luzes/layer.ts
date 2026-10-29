/**
 * Muitas luzes (card NEW-20261029-ORQ-muitas-luzes), the Phaser half: the halos of rules.ts as additive images of one
 * atlas. CityLive owns it and calls attach/detach with its decor pieces, so the lights follow the city's chunk
 * culling; per frame only the `budget` lit pieces nearest the camera centre draw (the others fade out and hide).
 *
 * Cost: every halo is a frame of one texture with the ADD blend, so the blooms over the fog (one depth) are one batch;
 * the small points sit with their piece (they hide behind what stands before it) and cost a blend switch each.
 */
import Phaser from 'phaser';
import {cellPoint,onCamera,type ArtView,type CellFrame,type Rect} from '../city/live/rules.ts';
import {LUZES_ATLAS,LUZES_DEPTH,luzLevel,luzSpots,pickGroups,stepFade,type LuzSpot} from './rules.ts';

/** Small points draw just above their piece (CityLive's HALO_DEPTH). */
const POINT_DEPTH=.4;
/** The pick of the nearest pieces is redone this often (ms), not every frame. */
const PICK_MS=200;

interface Halo {spot:LuzSpot;img?:Phaser.GameObjects.Image;x:number;y:number;w:number;h:number}
interface Group {key:string;halos:Halo[];rect:Rect;depth:number;fade:number;level:number;picked:boolean;shown:boolean}

export interface LuzesOptions {
  /** Halo groups drawn at once (rules.luzesBudget). */
  budget:number;
  /** prefers-reduced-motion or Leve: halos hold steady. */
  reduced:boolean;
}

export class LuzesLayer {
  private readonly groups=new Map<string,Group>();
  private ready:boolean;
  private nextPick=0;
  private sprites=0;

  private readonly scene:Phaser.Scene;
  private options:LuzesOptions;

  constructor(scene:Phaser.Scene,options:LuzesOptions,onReady?:()=>void){
    this.scene=scene;this.options=options;
    const key=LUZES_ATLAS.key;
    this.ready=scene.textures.exists(key);
    if(this.ready)return;
    scene.load.once(`filecomplete-spritesheet-${key}`,()=>{this.ready=true;onReady?.();});
    scene.load.spritesheet(key,LUZES_ATLAS.url,{frameWidth:LUZES_ATLAS.frame,frameHeight:LUZES_ATLAS.frame});
    if(!scene.load.isLoading())scene.load.start();
  }

  get loaded(){return this.ready;}

  /** Halos of a decor piece whose base was just placed: `f` = where its art cell draws, `depth` = the base's depth. */
  attach(key:string,id:string,view:ArtView,cell:readonly [number,number],f:CellFrame,depth:number){
    this.detach(key);
    const spots=luzSpots(id,view,cell,key);
    if(!spots.length)return;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    const halos=spots.map(spot=>{
      const p=cellPoint(f,[spot.at[0]*cell[0],spot.at[1]*cell[1]]),w=spot.size[0]*f.scale,h=spot.size[1]*f.scale,r=Math.max(w,h)/2;
      x0=Math.min(x0,p.x-r);y0=Math.min(y0,p.y-r);x1=Math.max(x1,p.x+r);y1=Math.max(y1,p.y+r);
      return {spot,x:p.x,y:p.y,w,h};
    });
    this.groups.set(key,{key,halos,rect:{x:x0,y:y0,w:x1-x0,h:y1-y0},depth,fade:0,level:1,picked:false,shown:false});
    this.nextPick=0;
  }

  detach(key:string){
    const g=this.groups.get(key);
    if(!g)return;
    for(const h of g.halos)if(h.img){h.img.destroy();this.sprites--;}
    this.groups.delete(key);
  }

  /** The broken lamp's own level (CityLive steps its flicker): its bloom follows it. */
  setLevel(key:string,level:number){const g=this.groups.get(key);if(g)g.level=level;}
  setOptions(o:Partial<LuzesOptions>){this.options={...this.options,...o};this.nextPick=0;}

  update(camera:Rect,nowMs:number,dtMs:number){
    if(!this.ready)return;
    if(nowMs>=this.nextPick){
      this.nextPick=nowMs+PICK_MS;
      const seen=[...this.groups.values()].filter(g=>onCamera(g.rect,camera));
      const pick=pickGroups(seen.map(g=>({key:g.key,x:g.rect.x+g.rect.w/2,y:g.rect.y+g.rect.h/2})),camera.x+camera.w/2,camera.y+camera.h/2,this.options.budget);
      for(const g of this.groups.values())g.picked=pick.has(g.key);
    }
    const reduced=this.options.reduced;
    for(const g of this.groups.values()){
      // Held still: a group at full fade sets its alpha once and then costs nothing per frame.
      const fade=reduced?(g.picked?1:0):stepFade(g.fade,g.picked?1:0,dtMs);
      if(fade===0&&g.fade===0&&!g.shown)continue;
      if(reduced&&fade===g.fade&&g.shown===(fade>0))continue;
      g.fade=fade;
      const on=fade>0;
      for(const h of g.halos){
        if(on&&!h.img)h.img=this.make(h,g.depth);
        if(!h.img)continue;
        h.img.setVisible(on);
        if(on)h.img.setAlpha(h.spot.alpha*fade*luzLevel(h.spot.flicker,nowMs,`${g.key}:${h.x|0}`,reduced,g.level));
      }
      g.shown=on;
    }
  }

  /** Counts for tests, the ?perf overlay and the card's phone cost note. */
  stats(){
    let shown=0,halos=0;
    for(const g of this.groups.values()){halos+=g.halos.length;if(g.shown)shown+=g.halos.length;}
    return {groups:this.groups.size,halos,shown,sprites:this.sprites,budget:this.options.budget};
  }

  destroy(){for(const k of [...this.groups.keys()])this.detach(k);}

  private make(h:Halo,depth:number){
    const s=h.spot,o=s.origin??[.5,.5];
    this.sprites++;
    return this.scene.add.image(h.x,h.y,LUZES_ATLAS.key,s.frame)
      .setOrigin(s.flipX?1-o[0]:o[0],o[1]).setDisplaySize(h.w,h.h).setFlipX(!!s.flipX).setRotation(s.angle??0)
      .setTint(s.tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(s.over?LUZES_DEPTH:depth+POINT_DEPTH);
  }
}
