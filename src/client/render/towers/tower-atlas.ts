/**
 * One shared atlas for every procedural texture of the defenses (card torres-render): bases, weapons, craters and the
 * effects are baked once into frames of a few canvas pages instead of one texture each. Interleaved with the city's
 * actors in the depth order, dozens of separate textures broke Phaser's sprite batch into many draw calls (measured:
 * 17 → 21 fps at 12 defenses + 300 critters, CPU 4×, with the tower images on one texture).
 * A frame is drawn by a scratch Graphics clipped to its cell (shelf packing, a gutter against bleeding at the edges);
 * a page is uploaded once per frame at most (`flush`), after the bakes of that frame.
 */
import Phaser from 'phaser';

/** Side of a page (px); a frame bigger than a page gets a page of its own. */
export const ATLAS_PAGE=1024;
const GUTTER=2;

export interface AtlasFrame {key:string;frame:string;w:number;h:number}
interface Page {texture:Phaser.Textures.CanvasTexture;w:number;h:number;x:number;y:number;row:number}
interface State {pages:Page[];frames:Map<string,AtlasFrame>;dirty:Set<Phaser.Textures.CanvasTexture>}

/** The atlas lives with the texture manager (one per game), so a renderer rebuilt after a scene restart reuses it. */
const states=new WeakMap<Phaser.Textures.TextureManager,State>();

export class TowerAtlas {
  private readonly s:State;
  constructor(private readonly textures:Phaser.Textures.TextureManager,private readonly prefix='torres:atlas'){
    let s=states.get(textures);
    if(!s){s={pages:[],frames:new Map(),dirty:new Set()};states.set(textures,s);}
    this.s=s;
  }
  get(name:string):AtlasFrame|undefined{return this.s.frames.get(name);}
  /**
   * The frame `name`, baked on first use: `draw(g)` draws into the scratch Graphics in the frame's own coordinates
   * (0..w × 0..h; it is cleared before and after).
   */
  frame(name:string,w:number,h:number,g:Phaser.GameObjects.Graphics,draw:(g:Phaser.GameObjects.Graphics)=>void):AtlasFrame{
    const known=this.s.frames.get(name);if(known)return known;
    w=Math.max(1,Math.ceil(w));h=Math.max(1,Math.ceil(h));
    const {page,x,y}=this.place(w,h),canvas=page.texture.getSourceImage() as HTMLCanvasElement,ctx=page.texture.getContext();
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
    g.clear();g.translateCanvas(x,y);draw(g);g.generateTexture(canvas,page.w,page.h);g.clear();
    ctx.restore();
    page.texture.add(name,0,x,y,w,h);
    this.s.dirty.add(page.texture);
    const f={key:page.texture.key,frame:name,w,h};this.s.frames.set(name,f);
    return f;
  }
  /** Uploads the pages baked into since the last call (once per frame, after the bakes). */
  flush(){if(!this.s.dirty.size)return;for(const t of this.s.dirty)t.refresh();this.s.dirty.clear();}

  private place(w:number,h:number):{page:Page;x:number;y:number}{
    const W=w+GUTTER,H=h+GUTTER;
    for(const page of this.s.pages){
      if(page.x+W>page.w){page.x=0;page.y+=page.row;page.row=0;}
      if(page.x+W<=page.w&&page.y+H<=page.h){const x=page.x,y=page.y;page.x+=W;page.row=Math.max(page.row,H);return {page,x,y};}
    }
    const size=Math.max(ATLAS_PAGE,W,H);
    let key=`${this.prefix}:${this.s.pages.length}`;
    while(this.textures.exists(key))key+='+';
    const texture=this.textures.createCanvas(key,size,size)!;
    const page:Page={texture,w:size,h:size,x:W,y:0,row:H};
    this.s.pages.push(page);
    return {page,x:0,y:0};
  }
}
