/**
 * "You in the world" (UX-voce-e-dano): the local hero's ground ring with a beak toward where they face, the sticker
 * contour on their sprite, the mini health bar and the "Você" arrow, plus a see-through copy (85%) on top of the canopy
 * for any hero standing behind a tree.
 * Colors are palette tokens (src/client/ui/tokens.css): "você" is Lilás Janela (--c-voce) plus shape, never Amarelo (that is
 * only what you tap to choose; design onda 3 §0). Every layer is hard (no glow, no blur): Breu/Lilás/Papel bands, so at
 * least one passes 3:1 on dark sea, light water, grass, sand and the horde (double-edge rule, §2.1).
 * Layers: heroes sit above the horde, pops and balloons; the hit number on a player and telegraphs go higher.
 */
import type Phaser from 'phaser';
import {token,tokenColor,whenFontsReady} from '../ui/tokens.ts';
import {ARROW_MS,HP_BAR_CSS,LOW_HP,OUTLINE_DIRS,RING_CSS,RING_UNDER,STATUS_CSS,STICKER_CSS,arrowFrame,beakPoints,clampFraction,grownBeak,hpBarStep,ringBands,ringSize,spiralPoints} from './you-rules.ts';
import {HEART_CSS,LOW_NUMBER_CSS,crackPoints,heartPoints,lowHpText,lowMarkLayout,lowMarkOn} from './low-hp-mark.ts';
import {HAZARD} from './telegraph-look.ts';
import {FramesPool,barArt,barFillWidth,markArt,markFrame} from '../art/frames-art.ts';
import {baseDisplay,variantOrigin,type VariantGeometry} from './city-outline-rules.ts';
import {HERO_DRAW_SCALE} from './draw-scale.ts';
import type {VehicleKind} from '../../contract/index.ts';

/**
 * What the markers ask of render/city-outline.ts CityOutlines: the city copy a sprite shows now, if any, and the city
 * "você" sticker baked for that copy (CITY_STICKER), once built.
 */
export interface MarkCopies {
  copyOf(key:string):{geom:VariantGeometry}|undefined;
  sticker?(copyKey:string):{key:string;geom:VariantGeometry}|undefined;
}

type Sprite=Phaser.GameObjects.Sprite;
type Pt={x:number;y:number};

/** Allies above every critter and comic effect (bubbles are at 96000)... */
export const ALLY_DEPTH=96400;
/** ...the ring, bar and arrow of the local hero above the allies... */
export const MARK_DEPTH=96450;
/** ...and the local hero on top of them; the hit number on a player (96600) and telegraphs (99000) stay above. */
export const SELF_DEPTH=96500;

export interface HeroMark {
  id:string;sprite:Sprite;self:boolean;
  /** Feet position in scene coordinates (already projected). */
  feet:Pt;
  /** A tree canopy in front covers the sprite: the sprite keeps its world depth and an 85% copy shows on top. */
  covered:boolean;
  hp:number;maxHp:number;downed:boolean;
  /** Screen-space facing (radians, 0 = right, π/2 = down) for the ring's beak. */
  facing?:number;
  /** D-036: slowed by the bêbado's burp / slipping on pigeon poop now (the scene compares slowUntil/slipUntil to the tick). */
  slow?:boolean;slip?:boolean;
  /**
   * Veículos: the vehicle ridden now and the share of the ride left (0..1; absent for the scooter, whose battery dies
   * when it wants: that is the joke), for its chip.
   */
  ride?:{kind:VehicleKind;left?:number};
}

export class YouMarkers {
  private scene:Phaser.Scene;
  private reduced:boolean;
  /** Cidade Nevada: the ring and its beak get an outer Breu edge (ringBands(true)). */
  private city=false;
  private g:Phaser.GameObjects.Graphics;
  /** The ground ring and its beak: under the hero (RING_UNDER below the sprite on top), not over its legs. */
  private ring:Phaser.GameObjects.Graphics;
  private label:Phaser.GameObjects.Text;
  /** Hp number next to the low bar (low-hp-mark.ts): Papel with a Breu stroke. */
  private lowText:Phaser.GameObjects.Text;
  private ghosts=new Map<string,Sprite>();
  /** Sticker contour of the local hero: 8 Breu copies (outer) and 8 Papel copies, tint-filled, under the sprite. */
  private contour:Sprite[]=[];
  private arrowAt=-Infinity;
  private fullSince:number|undefined;
  private readonly color={voce:tokenColor('--c-voce'),breu:tokenColor('--c-breu'),papel:tokenColor('--c-papel'),cone:tokenColor('--c-cone'),cartolina:tokenColor('--c-cartolina')};
  /** Last frame, for the acceptance probe (dev) and tests of the scene wiring. */
  readonly last={ring:false,bar:false,arrow:false,low:false,lowMark:false,covered:[] as string[],ghosts:0,contour:false,sticker:false,slow:false,slip:false,ride:undefined as VehicleKind|undefined};
  /** Scratch for the slip swirl (no allocation per frame). */
  private swirl=Array.from({length:14},()=>({x:0,y:0}));
  /** Imported "Você" ring (art/frames-art.ts heroi-voce); nothing is made without the art. */
  private art:FramesPool;
  /** Owners of the imported life bar's two 9-slices (frame + fill), made only when that art is in. */
  private readonly barOwner={frame:{},fill:{}};
  /** City copies (contorno-breu): the ring, arrow and chips size from the base frame even while the copy shows. */
  private copies?:MarkCopies;
  private figure={width:0,height:0,originX:0,originY:0};
  /** City: the one sprite that shows the baked sticker in place of the 16 offset copies. */
  private stickerSprite?:Sprite;
  private stickerOrigin={x:0,y:0};

  constructor(scene:Phaser.Scene,reduced=false,copies?:MarkCopies){
    this.scene=scene;this.reduced=reduced;this.copies=copies;this.art=new FramesPool(scene);
    this.g=scene.add.graphics().setDepth(MARK_DEPTH).setName('voce');
    this.ring=scene.add.graphics().setName('voce-anel');
    this.label=scene.add.text(0,0,'Você',{fontFamily:token('--f-sistema'),fontSize:'32px',fontStyle:'800',color:token('--c-papel')}).setOrigin(.5,.5).setDepth(MARK_DEPTH+2).setVisible(false);
    const {size,stroke,raster}=LOW_NUMBER_CSS;
    this.lowText=scene.add.text(0,0,'',{fontFamily:token('--f-sistema'),fontSize:`${size*raster}px`,fontStyle:'800',color:token('--c-papel'),stroke:token('--c-breu'),strokeThickness:stroke*raster}).setOrigin(0,.5).setVisible(false);
    whenFontsReady(()=>{this.label.updateText();this.lowText.updateText();});
  }

  setReduced(reduced:boolean){this.reduced=reduced;}
  /** City mode on/off (the markers survive a world swap; the scene sets it every frame). */
  setCity(city:boolean){this.city=city;}
  /** Start of a round or the local hero back on their feet: the "Você" arrow shows for ARROW_MS. */
  showArrow(now:number){this.arrowAt=now;}

  update(now:number,zoom:number,marks:readonly HeroMark[]){
    const g=this.g,s=1/Math.max(.05,zoom),c=this.color;
    g.clear();this.ring.clear();this.art.begin();
    this.last.ring=false;this.last.bar=false;this.last.arrow=false;this.last.low=false;this.last.lowMark=false;this.last.covered=[];this.last.contour=false;this.last.sticker=false;this.last.slow=false;this.last.slip=false;this.last.ride=undefined;
    this.lowText.setVisible(false);
    const live=new Set<string>();
    let selfShown=false;
    for(const mark of marks){
      const sprite=mark.sprite;
      // The sprite on top: the real one, or its 85% copy over the canopy. The sticker contour follows whichever it is.
      let top:Sprite=sprite;
      if(mark.covered){
        live.add(mark.id);this.last.covered.push(mark.id);
        const ghost=this.ghost(mark.id,sprite);
        ghost.setTexture(sprite.texture.key,sprite.frame.name).setOrigin(sprite.originX,sprite.originY).setPosition(sprite.x,sprite.y)
          .setScale(sprite.scaleX,sprite.scaleY).setFlipX(sprite.flipX).setRotation(sprite.rotation).setDepth(mark.self?SELF_DEPTH:ALLY_DEPTH).setVisible(sprite.visible).setAlpha(.85*sprite.alpha);
        top=ghost;
      }
      if(!mark.self)continue;
      selfShown=true;
      this.drawContour(top,s);
      // Ground ring: Papel outside, Lilás body, Breu inside (hard bands), RING_SCALE of the old size, under the hero;
      // its size (not its bands nor beak) and the bar follow the hero's draw scale (HERO_DRAW_SCALE).
      const fig=this.figureOf(sprite);
      const {w,h}=ringSize(fig.width,s,HERO_DRAW_SCALE),{x,y}=mark.feet,r=this.ring,ringDepth=top.depth-RING_UNDER;
      r.setDepth(ringDepth).setVisible(top.visible);
      // The bar, arrow and chips stay over the ring and its beak wherever the hero's depth is (island: just under SELF_DEPTH).
      const over=Math.max(MARK_DEPTH,ringDepth+.05);g.setDepth(over);
      const bands=ringBands(this.city),art=markArt('you');
      const angle=mark.facing??Math.PI/2,a=w/2,b=h/2;
      // City: a Breu band outside the Papel, and a Breu beak grown by the same edge, under everything else (only Breu
      // passes 3:1 on every city ground). With the imported ring, the band hugs its outer width (Papel included) too.
      if(bands.outer){
        r.lineStyle(bands.outer.width*s,c.breu,1).strokeEllipse(x,y,w+2*bands.outer.offset*s,h+2*bands.outer.offset*s);
        const grown=grownBeak(RING_CSS.beak+2,RING_CSS.beak*.6+2,bands.outer.width),edge=beakPoints(x,y,a+RING_CSS.papel*s,b+RING_CSS.papel*s,angle,grown.length*s,grown.half*s);
        r.fillStyle(c.breu,1).fillTriangle(edge[0].x,edge[0].y,edge[1].x,edge[1].y,edge[2].x,edge[2].y);
      }
      // Imported ring at the ring's outer width (Papel band included), just under the code beak.
      if(!(art&&this.art.mark('you',art,ringDepth-.01,markFrame(art,now,this.reduced),x,y,w+bands.papel.width*s)))
        for(const [band,color] of [[bands.papel,c.papel],[bands.voce,c.voce],[bands.breu,c.breu]] as const)
          r.lineStyle(band.width*s,color,1).strokeEllipse(x,y,w+2*band.offset*s,h+2*band.offset*s);
      // Beak toward where the hero faces: Papel edge, Lilás body.
      const outer=beakPoints(x,y,a+RING_CSS.papel*s,b+RING_CSS.papel*s,angle,(RING_CSS.beak+2)*s,(RING_CSS.beak*.6+2)*s);
      r.fillStyle(c.papel,1).fillTriangle(outer[0].x,outer[0].y,outer[1].x,outer[1].y,outer[2].x,outer[2].y);
      const inner=beakPoints(x,y,a,b,angle,RING_CSS.beak*s,RING_CSS.beak*.6*s);
      r.fillStyle(c.voce,1).fillTriangle(inner[0].x,inner[0].y,inner[1].x,inner[1].y,inner[2].x,inner[2].y);
      this.last.ring=true;
      // Mini health bar under the ring: Papel edge, Breu track, Cartolina fill (Cone when low).
      const fraction=clampFraction(mark.hp,mark.maxHp),bar=hpBarStep(fraction,this.fullSince,now,mark.downed);
      this.fullSince=bar.fullSince;
      if(bar.visible){
        const bw=HP_BAR_CSS.width*s*HERO_DRAW_SCALE,bh=HP_BAR_CSS.height*s*HERO_DRAW_SCALE,left=x-bw/2,top2=y+h/2+(RING_CSS.papel+4)*s,low=fraction<LOW_HP;
        // Imported frame + fill (the critters' normal pair, same rules as theirs): the frame over today's Papel edge box,
        // the fill over the track, stretched to the hp share and tinted as today. Missing either piece: today's bar.
        const art=barArt(false);
        if(art&&this.art.ready(art.frame)&&this.art.ready(art.fill)){
          this.art.slice(this.barOwner.frame,art.frame,over+.01,left-s,top2-s,bw+2*s,bh+2*s,s);
          const fw=barFillWidth(bw,fraction,(art.fill.left+art.fill.right)*s);
          if(fw>0)this.art.slice(this.barOwner.fill,art.fill,over+.02,left,top2,fw,bh,s)?.setTint(low?c.cone:c.cartolina);
        }else{
          g.fillStyle(c.papel,1).fillRect(left-s,top2-s,bw+2*s,bh+2*s);
          g.fillStyle(c.breu,1).fillRect(left,top2,bw,bh);
          if(fraction>0)g.fillStyle(low?c.cone:c.cartolina,1).fillRect(left+s,top2+s,(bw-2*s)*fraction,bh-2*s);
        }
        this.last.bar=true;this.last.low=low;
        // Low by shape too (acessibilidade): a cracked heart at the bar's left, the hp number at its right.
        if(lowMarkOn(true,fraction,mark.downed)){
          const at=lowMarkLayout(left,top2,bw,bh,s),heart=heartPoints(at.heart.x,at.heart.y,at.heart.width);
          g.lineStyle(2*HEART_CSS.edge*s,c.breu,1).strokePoints(heart,true).fillStyle(c.cone,1).fillPoints(heart,true);
          g.lineStyle(HEART_CSS.crack*s,c.breu,1).strokePoints(crackPoints(at.heart.x,at.heart.y,at.heart.width),false);
          const label=lowHpText(mark.hp);if(this.lowText.text!==label)this.lowText.setText(label);
          this.lowText.setScale(s/LOW_NUMBER_CSS.raster).setPosition(at.number.x,at.number.y).setDepth(over+.03).setVisible(top.visible);
          this.last.lowMark=true;
        }
      }
      if(mark.slow||mark.slip||mark.ride)this.drawStatus(mark,now,s);
      // "Você" arrow over the head: a ficha (Breu body, Papel edge) with a tail pointing down.
      const arrow=arrowFrame(now-this.arrowAt,this.reduced);
      this.label.setVisible(arrow.visible);
      if(arrow.visible){
        const head=y-fig.height*fig.originY,tail=7*s,bob=arrow.bob*6*s;
        const lw=this.label.width*.5*s,lh=this.label.height*.5*s,bw=lw+14*s,bh=lh+4*s;
        const cy=head-tail-bh/2-6*s-bob;
        this.label.setScale(.5*s).setPosition(x,cy);
        g.fillStyle(c.papel,1).fillRoundedRect(x-bw/2-2*s,cy-bh/2-2*s,bw+4*s,bh+4*s,8*s);
        g.fillTriangle(x-tail-2*s,cy+bh/2,x+tail+2*s,cy+bh/2,x,cy+bh/2+tail+3*s);
        g.fillStyle(c.breu,1).fillRoundedRect(x-bw/2,cy-bh/2,bw,bh,6*s);
        g.fillTriangle(x-tail,cy+bh/2-s,x+tail,cy+bh/2-s,x,cy+bh/2+tail);
        this.last.arrow=true;
      }
    }
    if(!selfShown){for(const copy of this.contour)copy.setVisible(false);this.stickerSprite?.setVisible(false);}
    for(const [id,ghost] of this.ghosts)if(!live.has(id))ghost.setVisible(false);
    this.last.ghosts=live.size;
  }

  /**
   * D-036 status chips to the right of the head, stacked down: a green burp cloud while slowed, a brown swirl while
   * slipping. Papel disc with a Breu edge (reads on sea, sand, grass and the horde); they bob unless motion is reduced.
   */
  private drawStatus(mark:HeroMark,now:number,s:number){
    const g=this.g,fig=this.figureOf(mark.sprite),R=STATUS_CSS.radius*s,e=STATUS_CSS.edge*s;
    const head=mark.feet.y-fig.height*fig.originY,x=mark.feet.x+Math.max(fig.width*.3,18*s)+R;
    let y=head+R+4*s;
    const bob=this.reduced?0:Math.sin(now*.006)*1.5*s;
    if(mark.slow){
      const cy=y+bob;
      g.fillStyle(this.color.breu,1).fillCircle(x,cy,R+e).fillStyle(this.color.papel,1).fillCircle(x,cy,R);
      // Burp cloud: three puffs with an olive edge, and a bubble.
      g.fillStyle(HAZARD.gasDark,1).fillCircle(x-4*s,cy+1.5*s,5.2*s).fillCircle(x+3.5*s,cy+1.5*s,5.2*s).fillCircle(x,cy-2.5*s,5.8*s);
      g.fillStyle(HAZARD.gas,1).fillCircle(x-4*s,cy+1.5*s,4*s).fillCircle(x+3.5*s,cy+1.5*s,4*s).fillCircle(x,cy-2.5*s,4.6*s);
      g.fillStyle(HAZARD.gasLight,1).fillCircle(x-1.5*s,cy-4*s,1.8*s);
      g.lineStyle(1.4*s,HAZARD.gasDark,1).strokeCircle(x+6*s,cy-6.5*s,1.8*s);
      this.last.slow=true;y+=2*(R+e)+STATUS_CSS.gap*s;
    }
    if(mark.slip){
      const cy=y-bob,rot=this.reduced?0:now*.008;
      g.fillStyle(this.color.breu,1).fillCircle(x,cy,R+e).fillStyle(this.color.papel,1).fillCircle(x,cy,R);
      // Poop swirl: a brown spiral with a darker edge, a white drop at its heart.
      const n=spiralPoints(x,cy,R*.78,2.1,rot,this.swirl);
      g.lineStyle(4.2*s,HAZARD.poopDark,1).strokePoints(this.swirl,false,false,n);
      g.lineStyle(2.4*s,HAZARD.poop,1).strokePoints(this.swirl,false,false,n);
      g.fillStyle(HAZARD.poopWhite,1).fillCircle(x,cy,1.8*s);
      this.last.slip=true;y+=2*(R+e)+STATUS_CSS.gap*s;
    }
    // Veículos (provisional): the vehicle's glyph, and around it the share of the ride left in Cartolina.
    if(mark.ride){
      const cy=y+bob,{kind,left}=mark.ride,breu=this.color.breu;
      g.fillStyle(breu,1).fillCircle(x,cy,R+e).fillStyle(this.color.papel,1).fillCircle(x,cy,R);
      if(left!==undefined&&left>0){
        g.lineStyle(2.4*s,this.color.cartolina,1).beginPath().arc(x,cy,R+e*.5,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,left),false).strokePath();
      }
      if(kind==='patinete'){
        g.fillStyle(0x3fbf6a,1).fillRect(x-6*s,cy+2*s,11*s,2.4*s);
        g.lineStyle(1.8*s,breu,1).lineBetween(x+4*s,cy+2*s,x+2.5*s,cy-6*s).lineBetween(x-.5*s,cy-6.5*s,x+5*s,cy-6*s);
        g.fillStyle(breu,1).fillCircle(x-5*s,cy+5.5*s,2*s).fillCircle(x+4.5*s,cy+5.5*s,2*s);
      }else if(kind==='carrinho'){
        g.fillStyle(0xc8d0d8,1).fillTriangle(x-7*s,cy-4*s,x+7*s,cy-4*s,x+5*s,cy+3*s).fillTriangle(x-7*s,cy-4*s,x+5*s,cy+3*s,x-5*s,cy+3*s);
        g.lineStyle(1.4*s,breu,1).strokeRect(x-6*s,cy-4*s,12*s,7*s);
        g.fillStyle(0x9fd25a,1).fillCircle(x+1*s,cy-5*s,2.6*s);
        g.fillStyle(breu,1).fillCircle(x-4*s,cy+5.5*s,1.6*s).fillEllipse(x+4*s,cy+5.5*s,4*s,2*s);
      }else{
        g.fillStyle(0xd9a07a,1).fillCircle(x-5*s,cy+1*s,3.4*s).fillCircle(x+5*s,cy+1*s,3.4*s).fillCircle(x,cy-4*s,3*s);
        g.fillStyle(0xd2483c,1).fillRect(x-3*s,cy-1*s,6*s,6*s);
        g.fillStyle(0xf2c84b,1).fillRect(x-3*s,cy-6*s,6*s,1.4*s);
      }
      this.last.ride=kind;
    }
  }

  /**
   * The sprite's drawn size and origin as its BASE frame gives them: a city copy (padded, cropped, resampled) is mapped
   * back (city-outline-rules.ts baseDisplay), so the markers keep their size and place whether the copy is built or not.
   */
  private figureOf(sprite:Sprite){
    const f=this.figure,copy=this.copies?.copyOf(sprite.texture.key);
    if(copy)return baseDisplay(copy.geom,sprite.originX,sprite.originY,sprite.scaleX,sprite.scaleY,f);
    f.width=sprite.displayWidth;f.height=sprite.displayHeight;f.originX=sprite.originX;f.originY=sprite.originY;
    return f;
  }

  /** ms left on the arrow (0 when hidden), for tests and the probe. */
  arrowLeft(now:number){return Math.max(0,ARROW_MS-(now-this.arrowAt));}

  /**
   * Hard sticker contour (§2.4): tint-filled copies offset in 8 directions, Breu farther out, Papel inside, under `top`.
   * City (contorno-breu): where `top` shows its city copy and the sticker is built, ONE sprite with the bands baked as
   * true distances (CITY_STICKER: Papel 2, then a solid Breu 2 CSS px outermost), placed from the base frame like the
   * ring (figureOf), so it hugs the figure exactly; the offset copies only before it is built and off the city.
   */
  private drawContour(top:Sprite,s:number){
    const sticker=this.city&&this.copies?.copyOf(top.texture.key)?this.copies.sticker?.(top.texture.key):undefined;
    if(sticker){
      for(const copy of this.contour)copy.setVisible(false);
      const fig=this.figureOf(top),g=sticker.geom,o=variantOrigin(g,fig.originX,fig.originY,this.stickerOrigin);
      const sx=fig.width/g.cellW*g.kx*(top.scaleX<0?-1:1),sy=fig.height/g.cellH*g.ky*(top.scaleY<0?-1:1);
      const sp=this.stickerSprite??=this.scene.add.sprite(0,0,sticker.key,top.frame.name);
      if(sp.texture.key!==sticker.key)sp.setTexture(sticker.key,top.frame.name);
      else if(sp.frame.name!==top.frame.name)sp.setFrame(top.frame.name);
      sp.setOrigin(o.x,o.y).setScale(sx,sy).setFlipX(top.flipX).setRotation(top.rotation).setPosition(top.x,top.y)
        .setDepth(top.depth-.2).setAlpha(top.alpha).setVisible(top.visible);
      this.last.contour=top.visible;this.last.sticker=top.visible;
      return;
    }
    this.stickerSprite?.setVisible(false);
    if(!this.contour.length)for(let i=0;i<16;i++)this.contour.push(this.scene.add.sprite(0,0,top.texture.key,top.frame.name).setTintFill(i<8?this.color.breu:this.color.papel));
    const depth=top.depth;
    for(let i=0;i<16;i++){
      const copy=this.contour[i],dir=OUTLINE_DIRS[i%8],r=(i<8?STICKER_CSS.breu:STICKER_CSS.papel)*s;
      copy.setTexture(top.texture.key,top.frame.name).setOrigin(top.originX,top.originY).setScale(top.scaleX,top.scaleY).setFlipX(top.flipX).setRotation(top.rotation)
        .setPosition(top.x+dir.x*r,top.y+dir.y*r).setDepth(depth-(i<8?.2:.1)).setAlpha(top.alpha).setVisible(top.visible);
    }
    this.last.contour=top.visible;
  }

  private ghost(id:string,sprite:Sprite){
    let ghost=this.ghosts.get(id);
    if(!ghost){ghost=this.scene.add.sprite(0,0,sprite.texture.key,sprite.frame.name);this.ghosts.set(id,ghost);}
    return ghost;
  }
  forget(id:string){this.ghosts.get(id)?.destroy();this.ghosts.delete(id);}
  destroy(){this.art.destroy();this.g.destroy();this.ring.destroy();this.label.destroy();this.lowText.destroy();for(const ghost of this.ghosts.values())ghost.destroy();this.ghosts.clear();for(const copy of this.contour)copy.destroy();this.contour.length=0;this.stickerSprite?.destroy();this.stickerSprite=undefined;}
}
