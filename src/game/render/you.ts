/**
 * "You in the world" (UX-voce-e-dano): the local hero's ground ring with a beak toward where they face, the sticker
 * contour on their sprite, the mini health bar and the "Você" arrow, plus a see-through copy (85%) on top of the canopy
 * for any hero standing behind a tree.
 * Colors are palette tokens (src/ui/tokens.css): "você" is Lilás Janela (--c-voce) plus shape, never Amarelo (that is
 * only what you tap to choose; design onda 3 §0). Every layer is hard (no glow, no blur): Breu/Lilás/Papel bands, so at
 * least one passes 3:1 on dark sea, light water, grass, sand and the horde (double-edge rule, §2.1).
 * Layers: heroes sit above the horde, pops and balloons; the hit number on a player and telegraphs go higher.
 */
import Phaser from 'phaser';
import {token,tokenColor,whenFontsReady} from '../../ui/tokens.ts';
import {ARROW_MS,HP_BAR_CSS,LOW_HP,OUTLINE_DIRS,RING_CSS,STICKER_CSS,arrowFrame,beakPoints,clampFraction,hpBarStep,ringBands} from './you-rules.ts';

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
}

export class YouMarkers {
  private scene:Phaser.Scene;
  private reduced:boolean;
  private g:Phaser.GameObjects.Graphics;
  private label:Phaser.GameObjects.Text;
  private ghosts=new Map<string,Sprite>();
  /** Sticker contour of the local hero: 8 Breu copies (outer) and 8 Papel copies, tint-filled, under the sprite. */
  private contour:Sprite[]=[];
  private arrowAt=-Infinity;
  private fullSince:number|undefined;
  private readonly color={voce:tokenColor('--c-voce'),breu:tokenColor('--c-breu'),papel:tokenColor('--c-papel'),cone:tokenColor('--c-cone'),cartolina:tokenColor('--c-cartolina')};
  /** Last frame, for the acceptance probe (dev) and tests of the scene wiring. */
  readonly last={ring:false,bar:false,arrow:false,low:false,covered:[] as string[],ghosts:0,contour:false};

  constructor(scene:Phaser.Scene,reduced=false){
    this.scene=scene;this.reduced=reduced;
    this.g=scene.add.graphics().setDepth(MARK_DEPTH);
    this.label=scene.add.text(0,0,'Você',{fontFamily:token('--f-sistema'),fontSize:'32px',fontStyle:'800',color:token('--c-papel')}).setOrigin(.5,.5).setDepth(MARK_DEPTH+2).setVisible(false);
    whenFontsReady(()=>this.label.updateText());
  }

  setReduced(reduced:boolean){this.reduced=reduced;}
  /** Start of a round or the local hero back on their feet: the "Você" arrow shows for ARROW_MS. */
  showArrow(now:number){this.arrowAt=now;}

  update(now:number,zoom:number,marks:readonly HeroMark[]){
    const g=this.g,s=1/Math.max(.05,zoom),c=this.color;
    g.clear();
    this.last.ring=false;this.last.bar=false;this.last.arrow=false;this.last.low=false;this.last.covered=[];this.last.contour=false;
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
          .setScale(sprite.scaleX,sprite.scaleY).setFlipX(sprite.flipX).setDepth(mark.self?SELF_DEPTH:ALLY_DEPTH).setVisible(sprite.visible).setAlpha(.85*sprite.alpha);
        top=ghost;
      }
      if(!mark.self)continue;
      selfShown=true;
      this.drawContour(top,s);
      // Ground ring: Papel outside, Lilás body, Breu inside (hard bands), never smaller than RING_CSS on screen.
      const w=Math.max(RING_CSS.width*s,sprite.displayWidth*.8),h=Math.max(RING_CSS.height*s,w*.5),{x,y}=mark.feet;
      const bands=ringBands();
      for(const [band,color] of [[bands.papel,c.papel],[bands.voce,c.voce],[bands.breu,c.breu]] as const)
        g.lineStyle(band.width*s,color,1).strokeEllipse(x,y,w+2*band.offset*s,h+2*band.offset*s);
      // Beak toward where the hero faces: Papel edge, Lilás body.
      const angle=mark.facing??Math.PI/2,a=w/2,b=h/2;
      const outer=beakPoints(x,y,a+RING_CSS.papel*s,b+RING_CSS.papel*s,angle,(RING_CSS.beak+2)*s,(RING_CSS.beak*.6+2)*s);
      g.fillStyle(c.papel,1).fillTriangle(outer[0].x,outer[0].y,outer[1].x,outer[1].y,outer[2].x,outer[2].y);
      const inner=beakPoints(x,y,a,b,angle,RING_CSS.beak*s,RING_CSS.beak*.6*s);
      g.fillStyle(c.voce,1).fillTriangle(inner[0].x,inner[0].y,inner[1].x,inner[1].y,inner[2].x,inner[2].y);
      this.last.ring=true;
      // Mini health bar under the ring: Papel edge, Breu track, Cartolina fill (Cone when low).
      const fraction=clampFraction(mark.hp,mark.maxHp),bar=hpBarStep(fraction,this.fullSince,now,mark.downed);
      this.fullSince=bar.fullSince;
      if(bar.visible){
        const bw=HP_BAR_CSS.width*s,bh=HP_BAR_CSS.height*s,left=x-bw/2,top2=y+h/2+(RING_CSS.papel+4)*s,low=fraction<LOW_HP;
        g.fillStyle(c.papel,1).fillRect(left-s,top2-s,bw+2*s,bh+2*s);
        g.fillStyle(c.breu,1).fillRect(left,top2,bw,bh);
        if(fraction>0)g.fillStyle(low?c.cone:c.cartolina,1).fillRect(left+s,top2+s,(bw-2*s)*fraction,bh-2*s);
        this.last.bar=true;this.last.low=low;
      }
      // "Você" arrow over the head: a ficha (Breu body, Papel edge) with a tail pointing down.
      const arrow=arrowFrame(now-this.arrowAt,this.reduced);
      this.label.setVisible(arrow.visible);
      if(arrow.visible){
        const head=y-sprite.displayHeight*sprite.originY,tail=7*s,bob=arrow.bob*6*s;
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
    if(!selfShown)for(const copy of this.contour)copy.setVisible(false);
    for(const [id,ghost] of this.ghosts)if(!live.has(id))ghost.setVisible(false);
    this.last.ghosts=live.size;
  }

  /** ms left on the arrow (0 when hidden), for tests and the probe. */
  arrowLeft(now:number){return Math.max(0,ARROW_MS-(now-this.arrowAt));}

  /** Hard sticker contour (§2.4): tint-filled copies offset in 8 directions, Breu farther out, Papel inside, under `top`. */
  private drawContour(top:Sprite,s:number){
    if(!this.contour.length)for(let i=0;i<16;i++)this.contour.push(this.scene.add.sprite(0,0,top.texture.key,top.frame.name).setTintFill(i<8?this.color.breu:this.color.papel));
    const depth=top.depth;
    for(let i=0;i<16;i++){
      const copy=this.contour[i],dir=OUTLINE_DIRS[i%8],r=(i<8?STICKER_CSS.breu:STICKER_CSS.papel)*s;
      copy.setTexture(top.texture.key,top.frame.name).setOrigin(top.originX,top.originY).setScale(top.scaleX,top.scaleY).setFlipX(top.flipX)
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
  destroy(){this.g.destroy();this.label.destroy();for(const ghost of this.ghosts.values())ghost.destroy();this.ghosts.clear();for(const copy of this.contour)copy.destroy();this.contour.length=0;}
}
