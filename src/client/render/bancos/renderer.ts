/**
 * The run's banks in the world (card NEW-20261014-ORQ-bancos-e-veiculos):
 * - the kiosk: the imported art when the manifest has the bank's 7 ids (art.ts, card bancos-arte-render), its screen
 *   overlay by state (blue at rest, green paying, red blinking while a critter robs it, dark when empty) and the note
 *   leaving the slot (`-sacando`) while money leaves (hero or critter); else the provisional figure (figures.ts);
 * - on the ground, the area where a hero holds it (BANCO.holdR) and a ring with the saldo left;
 * - over it, a tag: the bank's short name and its saldo, "bicho sacando!" (Cone) or "SEM CÉDULAS m:ss";
 * - each withdrawal: a R$ 2 note flying out of the screen (green up for a hero, dark away for a critter) and the
 *   "RETIRE SEU DINHEIRO" beep, now and then one of the screen's lines instead (rules.ts BankTracker).
 * Bicos (card bancos-viram-bicos, etapa 2): when the manifest has the bank's shop (bico-art.ts), the pixel-art building
 * stands behind the rings instead of the kiosk, its door lit while a hero works inside.
 * Each kiosk draws at its own actor depth and fades while it covers the hero, like the chaveiro's figures. Pure
 * drawing: the scene pushes each view's banks and calls update every frame.
 */
import Phaser from 'phaser';
import type {Projector,Pt} from '../projector.ts';
import {token,tokenColor,whenFontsReady} from '../../ui/tokens.ts';
import {LIT_SHADOW,lightEnabled} from '../light.ts';
import {boxFaces,faceBounds,isoOffset,mix,M,type Face} from '../chaveiro/iso.ts';
import type {BankView,StampedEvent} from '../../../contract/index.ts';
import {BANCO,bicoSaldo} from '../../../rules/index.ts';
import {ATM_HALF,ATM_TOP,BANK_COLORS,SCREEN_AT,atmBoxes} from './figures.ts';
import {artIndex} from '../../art/manifest.ts';
import {ART_SCALE} from '../city/materials.ts';
import {BANK_NAMES,bankArt,bankSheets,sacandoFrame,sheetFrame,telaOffset,type BankArt} from './art.ts';
import {BankTracker,BEEP_MS,LINE_MS,NOTE_MS,emptySeconds,groundKeys,groundPulse,saldoShare,screenOf,type FlyingNote} from './rules.ts';
import {TriBand} from '../city/tri-band.ts';
import {BICO_PX,SHOP_IDS,bicoArt,bicoSpots,doorQuad,shopOf,type BicoArt} from './bico-art.ts';
import {bicoTag,type BicoTagLook} from '../../hud/bicos.ts';

const LIGHT=lightEnabled();
/** Tags, notes and balloons: over the figures, under the horde's bars (95000). */
const FX_DEPTH=94880;
/** The kiosks face +x (the sim gives no heading). */
const HEADING=0;
const COVER_ALPHA=.45;
/** The machine's art is at the world's scale (the importer sized it 2.6 u tall), drawn like the city's sheets; its layers share its px. */
const ART_PX=1/ART_SCALE;
/** Empty rows over the art's tallest part (sign, pig, snail), a share of the cell: the tag sits on what is drawn. */
const ART_TOP_PAD=.17;
/** The ground's frozen pieces, in the order the one Graphics drew them: hold ring, saldo ring, shadow. */
const HOLD_DEPTH=-9978,RING_DEPTH=-9977.999,SHADOW_DEPTH=-9977.998;

export interface BankRendererOptions {projector:Projector;reduced:boolean;hero?:()=>Pt|undefined;
  /** Bicos: a player's name on the shop's tag ("Você" for the local one); absent: "1 no turno". */
  nameOf?:(id:string)=>string;
  /** The room's seats (bots count): the saldo ring is whole at bicoSaldo(seats); absent: the solo's shift. */
  seats?:()=>number}

interface BankDraw {figure:Phaser.GameObjects.Graphics;tag:Phaser.GameObjects.Text;balloon:Phaser.GameObjects.Text;tagText:string;tagLook:string;
  /** What the figure was last drawn for (look, view, zoom, spot): the Graphics keeps its commands until this changes. */
  figKey:string;
  /**
   * The ground (card Q2): hold ring, saldo ring and shadow, each frozen into triangles (city/tri-band.ts) at the bank and
   * re-frozen only when its groundKeys key changes; Phaser replayed ~190 commands per bank every frame for the same
   * drawing.
   */
  ground:{hold?:TriBand;ring?:TriBand;shadow?:TriBand;keys:{hold:string;ring:string;shadow:string}};
  /** The imported art (kiosk, screen, slot), made when its textures are in. */
  art?:{body:Phaser.GameObjects.Image;tela:Phaser.GameObjects.Image;saque:Phaser.GameObjects.Image};
  /** The bico's shop (bico-art.ts) and its lit door, made when its texture is in. */
  bico?:{body:Phaser.GameObjects.Image;door:Phaser.GameObjects.Graphics;doorKey:string}}

export class BankRenderer {
  private scene:Phaser.Scene;
  private options:BankRendererOptions;
  private fx:Phaser.GameObjects.Graphics;
  private draws=new Map<string,BankDraw>();
  private state=new BankTracker();
  private now=0;
  private q:Pt={x:0,y:0};
  private pts=[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}];
  /** Reused every frame (no allocation per frame): the banks in view. */
  private live=new Set<string>();
  /** The ATM's faces per name, screen look and view (boxFaces is pure). */
  private faces=new Map<string,readonly Face[]>();
  private readonly c={breu:0,papel:0,cone:0,cartolina:0,lilas:0,dim:0};
  /** Each bank's imported art (undefined: the provisional figure) and whether its textures are in. */
  private arts=new Map<string,BankArt|undefined>();
  private artIn=new Set<string>();
  /** Each bank's shop (undefined: the kiosk) and whether its texture is in (filtered nearest, it is pixel art). */
  private bicos=new Map<string,BicoArt|undefined>();
  private bicoIn=new Set<string>();

  constructor(scene:Phaser.Scene,options:BankRendererOptions){
    this.scene=scene;this.options=options;
    this.fx=scene.add.graphics().setDepth(FX_DEPTH);
    const c=this.c;
    c.breu=tokenColor('--c-breu');c.papel=tokenColor('--c-papel');c.cone=tokenColor('--c-cone');
    c.cartolina=tokenColor('--c-cartolina');c.lilas=tokenColor('--c-lilas');c.dim=mix(c.papel,c.breu,.55);
    // The fonts came: the tag and the balloon take their style again on the next frame (the balloon by its text).
    whenFontsReady(()=>{for(const d of this.draws.values()){d.tagLook='';d.balloon.setText('');}});
    this.queueArt();
  }

  /** The banks' sheets from the manifest, loaded now (only the city has banks); a failed one keeps the figure. */
  private queueArt(){
    const index=artIndex();
    for(const name of BANK_NAMES)this.arts.set(name,bankArt(index,name));
    for(const id of SHOP_IDS)this.bicos.set(id,bicoArt(index,id));
    let queued=false;
    for(const art of this.bicos.values())if(art&&!this.scene.textures.exists(art.key)){this.scene.load.image(art.key,art.url);queued=true;}
    for(const s of bankSheets(index))if(!this.scene.textures.exists(s.key)){
      this.scene.load.spritesheet(s.key,s.url,{frameWidth:s.cell[0],frameHeight:s.cell[1]});queued=true;
    }
    if(queued&&!this.scene.load.isLoading())this.scene.load.start();
  }
  /** The bank's art once all its textures are in. */
  private artOf(name:string):BankArt|undefined{
    const art=this.arts.get(name);if(!art)return undefined;
    if(this.artIn.has(name))return art;
    const t=this.scene.textures;
    if(!t.exists(art.body.key)||!t.exists(art.sacando.key)||!Object.values(art.tela).every(s=>t.exists(s.key)))return undefined;
    this.artIn.add(name);return art;
  }

  /** The shop of the bank's gig now (BankView.bico) once its texture is in. */
  private bicoOf(b:Pick<BankView,'bico'>):BicoArt|undefined{
    const id=shopOf(b.bico),art=this.bicos.get(id);if(!art)return undefined;
    if(this.bicoIn.has(id))return art;
    if(!this.scene.textures.exists(art.key))return undefined;
    this.scene.textures.get(art.key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.bicoIn.add(id);return art;
  }

  /** A new view: the run's banks (undefined or empty hides them) at the server tick. */
  /** `events`: the room's view events (bank-cash); the sandbox's fake banks have none (the saldo's drop stands in). */
  push(banks:readonly BankView[]|undefined,tick:number,events?:readonly StampedEvent[]){this.state.push(banks,tick,this.now,events);}

  /** After a view turn or a depth re-base. */
  refresh(){this.update(this.now);}

  update(time:number){
    this.now=time;
    const st=this.state;st.settle(time);
    this.fx.clear();
    const k=1/Math.max(.05,this.scene.cameras.main.zoom),reduced=this.options.reduced,proj=this.options.projector;
    const live=this.live;live.clear();
    for(const b of st.banks){
      live.add(b.id);
      const d=this.drawOf(b.id);
      const screen=screenOf(b,st.tick,time,reduced);
      const bico=this.bicoOf(b);
      this.drawGround(b,d,k,!bico);
      const depth=proj.depth(b.x,b.y),art=this.artOf(b.name);
      if(bico)this.drawBico(b,d,bico);
      else if(art)this.drawArt(b,d,art,screen.look,depth);
      else{
        d.figure.setDepth(depth);
        const faces=this.facesOf(b.name,screen.look,proj.view),p=proj.project(b.x,b.y,this.q);
        const key=`${screen.look}|${proj.view}|${k}|${p.x}|${p.y}`;
        if(d.figKey!==key){d.figKey=key;d.figure.clear();this.drawFaces(d.figure,b.x,b.y,faces,k);}
        d.figure.setAlpha(this.covers(b.x,b.y,faces,depth)?COVER_ALPHA:1);
      }
      this.drawTag(b,d,k);
      this.drawBalloon(b,d,k);
    }
    for(const n of st.notes)this.drawNote(n,k);
    for(const [id,d] of this.draws)if(!live.has(id)){this.destroyDraw(d);this.draws.delete(id);}
  }

  /** The imported kiosk at its foot, the screen overlay in `look` on it and, while money leaves, the slot's note. */
  private drawArt(b:BankView,d:BankDraw,art:BankArt,look:keyof BankArt['tela'],depth:number){
    const proj=this.options.projector,view=proj.view,p=proj.project(b.x,b.y,this.q),s=ART_PX;
    if(!d.art){
      const sc=this.scene;
      d.art={body:sc.add.image(0,0,art.body.key,0),tela:sc.add.image(0,0,art.tela.azul.key,0).setOrigin(0,0),saque:sc.add.image(0,0,art.sacando.key,0).setOrigin(0,0)};
      d.figure.clear();d.figKey='';
    }
    const a=d.art,o=telaOffset(art,view),tela=art.tela[look];
    a.body.setTexture(art.body.key,sheetFrame(art.body,view)).setOrigin(art.anchor[0],art.anchor[1]).setScale(s).setPosition(p.x,p.y).setDepth(depth);
    a.tela.setTexture(tela.key,sheetFrame(tela,view)).setScale(s).setPosition(p.x+o.x*s,p.y+o.y*s).setDepth(depth+.01);
    const paying=b.state==='sacando'||b.state==='bicho';
    a.saque.setVisible(paying);
    if(paying)a.saque.setFrame(sheetFrame(art.sacando,view,sacandoFrame(art.sacando,this.now,this.options.reduced))).setScale(s).setPosition(p.x+o.x*s,p.y+o.y*s).setDepth(depth+.02);
    const alpha=this.artCovers(a.body,depth)?COVER_ALPHA:1;
    a.body.setAlpha(alpha);a.tela.setAlpha(alpha);a.saque.setAlpha(alpha);
  }
  /** The shop behind the rings, door to the camera; its door glows (Cartolina, breathing) while a hero works inside. */
  private drawBico(b:BankView,d:BankDraw,art:BicoArt){
    const proj=this.options.projector,spots=bicoSpots(b.x,b.y,proj.view),p=proj.project(spots.door.x,spots.door.y,this.q);
    if(!d.bico){
      const sc=this.scene;
      d.bico={body:sc.add.image(0,0,art.key),door:sc.add.graphics().setBlendMode(Phaser.BlendModes.ADD),doorKey:''};
      d.figure.clear();d.figKey='';
      // The kiosk's art may have come first: the shop takes its place.
      if(d.art){d.art.body.destroy();d.art.tela.destroy();d.art.saque.destroy();d.art=undefined;}
    }
    const depth=proj.depth(spots.middle.x,spots.middle.y),bd=d.bico;
    // The shop opened with another gig: its front changes.
    if(bd.body.texture.key!==art.key)bd.body.setTexture(art.key);
    bd.body.setOrigin(art.anchor[0],art.anchor[1]).setScale(BICO_PX).setPosition(p.x,p.y).setDepth(depth);
    const working=b.state==='sacando';
    if(bd.doorKey!==`${art.id}|${working}`){
      bd.doorKey=`${art.id}|${working}`;bd.door.clear();
      if(working)bd.door.fillStyle(this.c.cartolina,1).fillPoints(doorQuad(art),true);
    }
    const breath=this.options.reduced?.55:.45+.2*Math.sin(this.now*.006);
    bd.door.setVisible(working).setPosition(p.x,p.y).setDepth(depth+.01).setAlpha(breath);
    const alpha=this.artCovers(bd.body,depth)?COVER_ALPHA:1;
    bd.body.setAlpha(alpha);
  }
  private artCovers(body:Phaser.GameObjects.Image,depth:number){
    const hero=this.options.hero?.();if(!hero)return false;
    if(this.options.projector.depth(hero.x,hero.y)>=depth)return false;
    const h=this.options.projector.project(hero.x,hero.y,{x:0,y:0}),r=body.getBounds();
    return h.x>r.left&&h.x<r.right&&h.y-30>r.top&&h.y-10<r.bottom;
  }
  /** The top of what stands at the bank, screen px (the art's drawn top, else the figure's sign). */
  private topAt(b:BankView,fwd:number,left:number):Pt{
    const bico=this.bicoOf(b);
    if(bico){
      const proj=this.options.projector,s=bicoSpots(b.x,b.y,proj.view),p=proj.project(s.door.x,s.door.y,this.q);
      return {x:p.x,y:p.y-bico.anchor[1]*bico.cell[1]*BICO_PX+4};
    }
    const art=this.artOf(b.name);
    if(!art)return this.at(b.x,b.y,fwd,left,ATM_TOP+.15*M);
    const p=this.options.projector.project(b.x,b.y,this.q),s=ART_PX;
    return {x:p.x,y:p.y-(art.anchor[1]-ART_TOP_PAD)*art.body.cell[1]*s};
  }
  /** Where the notes leave from: the screen overlay's middle with the art, else the figure's screen. */
  private screenAt(b:BankView):Pt{
    const bico=this.bicoOf(b);
    if(bico){
      const proj=this.options.projector,s=bicoSpots(b.x,b.y,proj.view),p=proj.project(s.door.x,s.door.y,this.q),q=doorQuad(bico);
      return {x:p.x+(q[0].x+q[2].x)/2,y:p.y+(q[0].y+q[2].y)/2};
    }
    const art=this.artOf(b.name);
    if(!art)return this.at(b.x,b.y,SCREEN_AT.fwd,SCREEN_AT.left,SCREEN_AT.z);
    const proj=this.options.projector,p=proj.project(b.x,b.y,this.q),s=ART_PX,o=telaOffset(art,proj.view);
    return {x:p.x+(o.x+art.tela.azul.cell[0]/2)*s,y:p.y+(o.y+art.tela.azul.cell[1]/2)*s};
  }
  private destroyDraw(d:BankDraw){
    d.figure.destroy();d.tag.destroy();d.balloon.destroy();
    const g=d.ground;g.hold?.destroy();g.ring?.destroy();g.shadow?.destroy();
    if(d.art){d.art.body.destroy();d.art.tela.destroy();d.art.saque.destroy();}
    if(d.bico){d.bico.body.destroy();d.bico.door.destroy();}
  }

  destroy(){
    this.fx.destroy();
    for(const d of this.draws.values())this.destroyDraw(d);
    this.draws.clear();
  }

  private tagStyle(look:BicoTagLook){
    // Bicos: a shift on is "a favor" (Cartolina, the interaction colour of the ring and the button).
    return {fontFamily:token('--f-sistema'),fontSize:'13px',fontStyle:'bold',padding:{x:6,y:2},align:'center',
      color:look==='bicho'||look==='turno'?token('--c-breu'):token('--c-papel'),
      backgroundColor:look==='bicho'?token('--c-cone'):look==='turno'?token('--c-cartolina'):look==='vazio'?token('--c-breu'):this.ficha()};
  }
  /**
   * --c-ficha (Breu at 88 %) as rgba: the token is a color-mix(), which a canvas fillStyle may not take (the tag's body
   * would go transparent).
   */
  private ficha(){const c=this.c.breu;return `rgba(${c>>16&255},${c>>8&255},${c&255},0.88)`;}
  private balloonStyle(beep:boolean){
    return {fontFamily:beep?token('--f-cartaz'):token('--f-sistema'),fontSize:beep?'15px':'13px',padding:{x:7,y:3},
      color:token('--c-breu'),backgroundColor:beep?token('--c-cone'):token('--c-papel'),align:'center',wordWrap:{width:200}};
  }
  private drawOf(id:string):BankDraw{
    let d=this.draws.get(id);
    if(!d){
      const s=this.scene;
      d={figure:s.add.graphics(),
        tag:s.add.text(0,0,'',this.tagStyle('normal')).setOrigin(.5,1).setDepth(FX_DEPTH+1),
        balloon:s.add.text(0,0,'',this.balloonStyle(false)).setOrigin(.5,1).setDepth(FX_DEPTH+2).setVisible(false),
        tagText:'',tagLook:'',figKey:'',ground:{keys:{hold:'',ring:'',shadow:''}}};
      this.draws.set(id,d);
    }
    return d;
  }
  private facesOf(name:BankView['name'],look:string,view:number):readonly Face[]{
    const key=`${name}|${look}|${view}`;let faces=this.faces.get(key);
    if(!faces){faces=boxFaces(atmBoxes(name,look as Parameters<typeof atmBoxes>[1]),HEADING,view);this.faces.set(key,faces);}
    return faces;
  }
  /** Screen point of the bank plus a local offset (forward, left, up in units). */
  private at(x:number,y:number,fwd:number,left:number,z:number):Pt{
    const p=this.options.projector.project(x,y,this.q),o=isoOffset(fwd,left,z,this.options.projector.view);
    return {x:p.x+o.x,y:p.y+o.y};
  }
  /**
   * The ground: a thin ring where a hero holds it (holdR), the saldo ring around the slab (Cartolina; Cone while a
   * critter robs it; an empty ring when it has no notes; breathing while a hero is paid) and the kiosk's shadow. Each
   * piece is drawn once in the bank's local space and frozen (TriBand); per frame it only moves and the saldo ring scales.
   */
  private drawGround(b:BankView,d:BankDraw,k:number,shadow=true){
    const full=bicoSaldo(this.options.seats?.()??1),g=d.ground,keys=groundKeys(b,k,this.options.projector.view,full),p=this.options.projector.project(b.x,b.y,this.q),c=this.c;
    if(g.keys.hold!==keys.hold||!g.hold){
      g.keys.hold=keys.hold;g.hold?.destroy();
      const hold=BANCO.holdR*42,paying=b.state==='sacando';
      g.hold=TriBand.make(this.scene,gr=>{gr.lineStyle(2*k,paying?c.cartolina:c.papel,paying?.75:.35).strokeEllipse(0,0,hold*2,hold);}).setDepth(HOLD_DEPTH);
    }
    if(g.keys.ring!==keys.ring||!g.ring){
      g.keys.ring=keys.ring;g.ring?.destroy();
      const r=1.25*M*42,share=saldoShare(b,full),color=b.state==='bicho'?c.cone:c.cartolina;
      g.ring=TriBand.make(this.scene,gr=>{
        gr.lineStyle(7*k,c.breu,.55).strokeEllipse(0,0,r*2,r);
        if(share<=0)return;
        const n=Math.max(2,Math.ceil(48*share)),pts:Pt[]=[];
        for(let i=0;i<=n;i++){const a=-Math.PI/2+share*Math.PI*2*i/n;pts.push({x:Math.cos(a)*r,y:Math.sin(a)*r*.5});}
        gr.lineStyle(4*k,color,1).strokePoints(pts,false,false,n+1);
      }).setDepth(RING_DEPTH);
    }
    if(g.keys.shadow!==keys.shadow||!g.shadow){
      g.keys.shadow=keys.shadow;g.shadow?.destroy();
      const v=this.options.projector.view,corners:Pt[]=[];
      for(let i=0;i<4;i++){
        const o=isoOffset(i===0||i===3?ATM_HALF.l:-ATM_HALF.l,i<2?ATM_HALF.w:-ATM_HALF.w,0,v);
        corners.push({x:8+o.x*1.15,y:3+o.y*1.15});
      }
      g.shadow=TriBand.make(this.scene,gr=>{gr.fillStyle(LIGHT?LIT_SHADOW.color:c.breu,LIGHT?LIT_SHADOW.alpha:.25).fillPoints(corners,true);}).setDepth(SHADOW_DEPTH);
    }
    // The shop's art has its own contact shadow on its own snow; the kiosk's would be a dark slab in front of the door.
    g.hold.setPosition(p.x,p.y);g.shadow.setPosition(p.x,p.y).setVisible(shadow);
    g.ring.setPosition(p.x,p.y).setScale(groundPulse(b,this.now,this.options.reduced));
  }
  private drawFaces(g:Phaser.GameObjects.Graphics,x:number,y:number,faces:readonly Face[],k:number){
    const p=this.options.projector.project(x,y,this.q),pts=this.pts;
    for(const f of faces){
      for(let i=0;i<4;i++){pts[i].x=p.x+f.pts[i].x;pts[i].y=p.y+f.pts[i].y;}
      g.fillStyle(f.color,f.alpha).fillPoints(pts,true);
      if(f.line)g.lineStyle(1.2*k,this.c.breu,.9).strokePoints(pts,true);
    }
  }
  private covers(x:number,y:number,faces:readonly Face[],depth:number){
    const hero=this.options.hero?.();if(!hero||!faces.length)return false;
    if(this.options.projector.depth(hero.x,hero.y)>=depth)return false;
    const p=this.options.projector.project(x,y,this.q),h=this.options.projector.project(hero.x,hero.y,{x:0,y:0}),b=faceBounds(faces);
    return h.x>p.x+b.x0&&h.x<p.x+b.x1&&h.y-30>p.y+b.y0&&h.y-10<p.y+b.y1;
  }
  /** The tag over the shop (hud/bicos.ts bicoTag): its gig and saldo, who is on the shift, the robbery, the closed sign. */
  private drawTag(b:BankView,d:BankDraw,k:number){
    const nameOf=this.options.nameOf;
    const {look,text}=bicoTag(b,emptySeconds(b,this.state.tick),id=>nameOf?.(id)??'1');
    if(d.tagLook!==look){d.tagLook=look;d.tag.setStyle(this.tagStyle(look));}
    if(d.tagText!==text){d.tagText=text;d.tag.setText(text);}
    const p=this.topAt(b,-.2*M,.5*M);
    d.tag.setPosition(p.x,p.y).setScale(k);
  }
  /** The beep or the screen's line over the tag, while it lasts. */
  private drawBalloon(b:BankView,d:BankDraw,k:number){
    const balloon=this.state.balloons.find(x=>x.bank===b.id);
    if(!balloon){d.balloon.setVisible(false);return;}
    const t=(this.now-balloon.born)/(balloon.beep?BEEP_MS:LINE_MS);
    if(d.balloon.text!==balloon.text){d.balloon.setText(balloon.text);d.balloon.setStyle(this.balloonStyle(balloon.beep));}
    const p=this.topAt(b,0,0),lift=(this.options.reduced?0:6*Math.min(1,t*4))*k;
    d.balloon.setPosition(p.x,p.y-(d.tag.displayHeight+6*k)-lift).setScale(k).setAlpha(t>.8?Math.max(0,(1-t)*5):1).setVisible(true);
  }
  /** A R$ 2 note out of the screen: up and fading for a hero, away and down, darker, for a critter. */
  private drawNote(n:FlyingNote,k:number){
    const b=this.state.banks.find(x=>x.id===n.bank);if(!b)return;
    const t=(this.now-n.born)/NOTE_MS;if(t<0||t>=1)return;
    const start=this.screenAt(b),hero=n.by==='hero',reduced=this.options.reduced;
    const dx=(hero?(n.slot-1)*14:28+n.slot*10)*k*t,dy=(hero?-70*t:-24*t+50*t*t)*k;
    const x=start.x+dx,y=start.y+dy,w=20*k,h=11*k,a=t>.7?(1-t)/.3:1,tilt=reduced?0:Math.sin(this.now*.02+n.slot)*.25;
    const g=this.fx,cos=Math.cos(tilt),sin=Math.sin(tilt);
    const corner=(u:number,v:number)=>({x:x+u*cos-v*sin,y:y+u*sin+v*cos});
    const quad=[corner(-w/2,-h/2),corner(w/2,-h/2),corner(w/2,h/2),corner(-w/2,h/2)];
    g.fillStyle(hero?BANK_COLORS.note:mix(BANK_COLORS.note,this.c.breu,.45),a).fillPoints(quad,true);
    g.lineStyle(1.4*k,this.c.breu,a).strokePoints(quad,true);
    // the "2" in the middle: two strokes are enough at this size
    g.fillStyle(this.c.breu,a).fillCircle(x,y,2.6*k);
  }
}
