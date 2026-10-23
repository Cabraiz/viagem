/**
 * Usable glow, Phaser side (card NEW-20261023-ORQ-contorno-usavel-wc3; rules in usable-glow-rules.ts): the Warcraft 3
 * style gold outline around everything the player can use, and around the player's shot.
 *
 * Per frame: begin(), then mark(id, sprite, k) for every glowing sprite shown this frame (k = world px per CSS px), then
 * end(), which hides the copies of what was not marked and pools them for the next new id (POOL_MAX). Each glow is a ring of
 * tint-filled copies of the sprite (same texture and frame, so they batch with it), offset in 8 directions per band,
 * just under the sprite. Nothing is built at load and nothing is allocated once a glow's copies exist.
 */
import type Phaser from 'phaser';
import {GLOW_BANDS,GLOW_BREU,OUTLINE_DIRS,copiesOf,copySlot,glowAlpha,type GlowBand} from './usable-glow-rules.ts';

type Img=Phaser.GameObjects.Image|Phaser.GameObjects.Sprite;
interface Glow {copies:Phaser.GameObjects.Image[];bands:readonly GlowBand[];seen:number;shown:boolean}
/**
 * Glows kept hidden for reuse per band set: a glow not marked in a frame goes back to the pool at once and the next new
 * id takes it, so a stream of shots (a new id each) never creates GameObjects once the pool is warm.
 */
export const POOL_MAX=48;
/** Phaser's crop rectangle of a cropped image (frame px). */
interface Crop {x:number;y:number;width:number;height:number}
/** `?brilho=0`: no glow at all (the before/after FPS measure on one build, scripts/perf-andar.mjs --query brilho=0). */
const OFF=typeof location!=='undefined'&&new URLSearchParams(location.search).get('brilho')==='0';

export class UsableGlow {
  private glows=new Map<string,Glow>();
  private pool=new Map<readonly GlowBand[],Glow[]>();
  /** GameObjects created since the start (tests: a warm pool creates none). */
  created=0;
  private frame=0;
  private alpha=1;
  private slot={band:0,dir:0};
  private scene:Phaser.Scene;
  /** prefers-reduced-motion: the gold stays steady (the owner updates it at runtime). */
  reduced:boolean;
  constructor(scene:Phaser.Scene,reduced:boolean){this.scene=scene;this.reduced=reduced;}

  /** Start of a frame at renderer time `now` (ms): the pulse for every glow marked in it. */
  begin(now:number){this.frame++;this.alpha=glowAlpha(now,this.reduced);}
  /**
   * `src` glows this frame: its copies follow its texture, frame, origin, scale, flip, rotation and visibility, `css`
   * px out per band, `k` world px per CSS px. Hidden or alpha-0 sprites get no glow. `under`: the depth the copies sit
   * under (default the sprite's own): the pieces of one wall pass the lowest piece's, so each piece covers its
   * neighbours' glow and only the wall's outer edge shows gold (no seams between pieces).
   */
  mark(id:string,src:Img,k:number,bands:readonly GlowBand[]=GLOW_BANDS,under=src.depth){
    if(OFF)return;
    let g=this.glows.get(id);
    if(!g||g.bands!==bands){
      if(g)this.free(g);
      g=this.pool.get(bands)?.pop()??{copies:[],bands,seen:0,shown:false};this.glows.set(id,g);
    }
    g.seen=this.frame;
    const on=src.visible&&src.alpha>0&&src.texture.key!=='__DEFAULT'&&k>0;
    if(!on){if(g.shown)this.hide(g);return;}
    const n=copiesOf(bands),slot=this.slot;
    while(g.copies.length<n){
      const band=bands[copySlot(bands,g.copies.length,slot).band];
      g.copies.push(this.scene.add.image(0,0,src.texture.key,src.frame.name).setTintFill(band.color).setName('brilho-usavel'));this.created++;
    }
    const key=src.texture.key,frame=src.frame.name,depth=under,crop=src.isCropped?(src as unknown as {_crop:Crop})._crop:undefined;
    for(let i=0;i<n;i++){
      copySlot(bands,i,slot);
      const c=g.copies[i],band=bands[slot.band],dir=OUTLINE_DIRS[slot.dir],r=band.css*k;
      if(c.texture.key!==key)c.setTexture(key,frame);else if(c.frame.name!==frame)c.setFrame(frame);
      // Gold pulses; the outer Breu band stays solid so the contrast never drops on the snow.
      const a=src.alpha*(band.color===GLOW_BREU?1:this.alpha);
      c.setOrigin(src.originX,src.originY).setScale(src.scaleX,src.scaleY).setFlip(src.flipX,src.flipY).setRotation(src.rotation)
        .setPosition(src.x+dir.x*r,src.y+dir.y*r).setDepth(depth+band.depth).setAlpha(a).setVisible(true);
      // A cropped sprite (the junk wall's halves, muralha.ts) glows around the part it shows, not its whole frame.
      if(crop)c.setCrop(crop.x,crop.y,crop.width,crop.height);else if(c.isCropped)c.setCrop();
    }
    g.shown=true;
  }
  /** End of the frame: glows not marked in it are hidden and go back to the pool (past POOL_MAX, destroyed). */
  end(){
    for(const [id,g] of this.glows){
      if(g.seen===this.frame)continue;
      this.glows.delete(id);this.free(g);
    }
  }
  /** Glows in use, how many are shown, copies alive (pool included) and pooled glows (dev probes, tests). */
  stats(){
    let shown=0,copies=0,pooled=0;
    for(const g of this.glows.values()){copies+=g.copies.length;if(g.shown)shown++;}
    for(const list of this.pool.values())for(const g of list){pooled++;copies+=g.copies.length;}
    return {glows:this.glows.size,shown,copies,pooled};
  }
  destroy(){
    for(const g of this.glows.values())for(const c of g.copies)c.destroy();this.glows.clear();
    for(const list of this.pool.values())for(const g of list)for(const c of g.copies)c.destroy();this.pool.clear();
  }
  private free(g:Glow){
    if(g.shown)this.hide(g);
    let list=this.pool.get(g.bands);
    if(!list){list=[];this.pool.set(g.bands,list);}
    if(list.length<POOL_MAX)list.push(g);else for(const c of g.copies)c.destroy();
  }
  private hide(g:Glow){for(const c of g.copies)c.setVisible(false);g.shown=false;}
}

/** The gold outline of a wall made of pieces (muralha.ts): every piece under the lowest one, so only the wall's edge shows. */
export function glowPieces(glow:UsableGlow,id:string,pieces:readonly Img[],k:number){
  let under=Infinity;for(const i of pieces)if(i.visible&&i.depth<under)under=i.depth;
  for(let n=0;n<pieces.length;n++)glow.mark(`${id}:${n}`,pieces[n],k,undefined,under);
}
