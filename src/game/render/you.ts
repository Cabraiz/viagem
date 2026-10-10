/**
 * "You in the world" (UX-voce-e-dano): the local hero's ground ring, light contour, mini health bar and the
 * "Você" arrow, plus a see-through copy (85%) on top of the canopy for any hero standing behind a tree.
 * Colors are palette tokens (src/ui/tokens.css): Amarelo Encarte marks "you" (the same mark as the "Você" ring in
 * the team strip and on the result), Breu edges it on every ground (double-edge rule), Cartolina/Cone fill the bar.
 * Layers: heroes sit above the horde, numbers, pops and balloons; only telegraphs (TELEGRAPH_TOP_DEPTH) go higher.
 */
import Phaser from 'phaser';
import {token,tokenColor,whenFontsReady} from '../../ui/tokens.ts';
import {ARROW_MS,HP_BAR_CSS,LOW_HP,RING_CSS,arrowFrame,clampFraction,hpBarStep} from './you-rules.ts';

type Sprite=Phaser.GameObjects.Sprite;
type Pt={x:number;y:number};

/** Allies above every critter and comic effect (bubbles are at 96000)... */
export const ALLY_DEPTH=96400;
/** ...the ring, bar and arrow of the local hero above the allies... */
export const MARK_DEPTH=96450;
/** ...and the local hero on top of them; telegraphs (99000) stay above everything. */
export const SELF_DEPTH=96500;

export interface HeroMark {
  id:string;sprite:Sprite;self:boolean;
  /** Feet position in scene coordinates (already projected). */
  feet:Pt;
  /** A tree canopy in front covers the sprite: the sprite keeps its world depth and an 85% copy shows on top. */
  covered:boolean;
  hp:number;maxHp:number;downed:boolean;
}

export class YouMarkers {
  private scene:Phaser.Scene;
  private reduced:boolean;
  private g:Phaser.GameObjects.Graphics;
  private label:Phaser.GameObjects.Text;
  private ghosts=new Map<string,Sprite>();
  private arrowAt=-Infinity;
  private fullSince:number|undefined;
  private readonly color={amarelo:tokenColor('--c-amarelo'),breu:tokenColor('--c-breu'),papel:tokenColor('--c-papel'),cone:tokenColor('--c-cone'),cartolina:tokenColor('--c-cartolina')};
  /** Last frame, for the acceptance probe (dev) and tests of the scene wiring. */
  readonly last={ring:false,bar:false,arrow:false,low:false,covered:[] as string[],ghosts:0};

  constructor(scene:Phaser.Scene,reduced=false){
    this.scene=scene;this.reduced=reduced;
    this.g=scene.add.graphics().setDepth(MARK_DEPTH);
    this.label=scene.add.text(0,0,'Você',{fontFamily:token('--f-sistema'),fontSize:'32px',fontStyle:'800',color:token('--c-papel')}).setOrigin(.5,.5).setDepth(MARK_DEPTH+2).setVisible(false);
    whenFontsReady(()=>this.label.updateText());
  }

  setReduced(reduced:boolean){this.reduced=reduced;}
  /** Start of a round or the local hero back on their feet: the "Você" arrow bobs for ARROW_MS. */
  showArrow(now:number){this.arrowAt=now;}

  /** A light Amarelo contour around the local hero (WebGL pre-FX; canvas renderers simply skip it). */
  outline(sprite:Sprite){
    const fx=sprite.preFX;
    if(!fx)return false;
    fx.setPadding(8);fx.addGlow(this.color.amarelo,3,0,false);
    return true;
  }

  update(now:number,zoom:number,marks:readonly HeroMark[]){
    const g=this.g,s=1/Math.max(.05,zoom),c=this.color;
    g.clear();
    this.last.ring=false;this.last.bar=false;this.last.arrow=false;this.last.low=false;this.last.covered=[];
    const live=new Set<string>();
    for(const mark of marks){
      const sprite=mark.sprite;
      if(mark.covered){
        live.add(mark.id);this.last.covered.push(mark.id);
        const ghost=this.ghost(mark.id,sprite);
        ghost.setTexture(sprite.texture.key,sprite.frame.name).setOrigin(sprite.originX,sprite.originY).setPosition(sprite.x,sprite.y)
          .setScale(sprite.scaleX,sprite.scaleY).setFlipX(sprite.flipX).setDepth(mark.self?SELF_DEPTH:ALLY_DEPTH).setVisible(sprite.visible).setAlpha(.85*sprite.alpha);
      }
      if(!mark.self)continue;
      // Ground ring: Breu edge, Amarelo body, never smaller than RING_CSS on screen.
      const w=Math.max(RING_CSS.width*s,sprite.displayWidth*.62),h=Math.max(RING_CSS.height*s,w*.45),{x,y}=mark.feet;
      g.lineStyle((RING_CSS.stroke+2*RING_CSS.edge)*s,c.breu,1).strokeEllipse(x,y,w,h);
      g.lineStyle(RING_CSS.stroke*s,c.amarelo,1).strokeEllipse(x,y,w,h);
      this.last.ring=true;
      // Mini health bar under the ring: Papel edge, Breu track, Cartolina fill (Cone when low).
      const fraction=clampFraction(mark.hp,mark.maxHp),bar=hpBarStep(fraction,this.fullSince,now,mark.downed);
      this.fullSince=bar.fullSince;
      if(bar.visible){
        const bw=HP_BAR_CSS.width*s,bh=HP_BAR_CSS.height*s,left=x-bw/2,top=y+h/2+4*s,low=fraction<LOW_HP;
        g.fillStyle(c.papel,1).fillRect(left-s,top-s,bw+2*s,bh+2*s);
        g.fillStyle(c.breu,1).fillRect(left,top,bw,bh);
        if(fraction>0)g.fillStyle(low?c.cone:c.cartolina,1).fillRect(left+s,top+s,(bw-2*s)*fraction,bh-2*s);
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
    for(const [id,ghost] of this.ghosts)if(!live.has(id))ghost.setVisible(false);
    this.last.ghosts=live.size;
  }

  /** ms left on the arrow (0 when hidden), for tests and the probe. */
  arrowLeft(now:number){return Math.max(0,ARROW_MS-(now-this.arrowAt));}

  private ghost(id:string,sprite:Sprite){
    let ghost=this.ghosts.get(id);
    if(!ghost){ghost=this.scene.add.sprite(0,0,sprite.texture.key,sprite.frame.name);this.ghosts.set(id,ghost);}
    return ghost;
  }
  forget(id:string){this.ghosts.get(id)?.destroy();this.ghosts.delete(id);}
  destroy(){this.g.destroy();this.label.destroy();for(const ghost of this.ghosts.values())ghost.destroy();this.ghosts.clear();}
}
