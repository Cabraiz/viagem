/**
 * D-051 arsenal on screen (NEW-20261016-ORQ-armas-caixas-render): what render/layers.ts adds in the manual combat.
 *  - Crates: base `caixa-saque` (closed, then abrindo-1..6 while the local hero stands still at one) over a ring in its
 *    rarity colour, that ring filling while it opens and a burst with the rarity name when it opens ('pickup' chest event).
 *  - Items on the ground: their sticker (hud/items.ts icon) and, for a weapon, a ring in its rarity colour.
 *  - The weapon in each hero's hand (PlayerRunView.hand): its sticker at the hero's side.
 *  - Each arsenal weapon's shot ('fire' event): muzzle flash, cone, blast or slash (arsenal-rules.ts FIRE_LOOK).
 * The art loads once, the first time a view shows the manual combat (no download for the automatic weapons); until then,
 * and for any piece the manifest lacks, the old looks stay (the chest, the parcel, no hand, no flash).
 */
import type Phaser from 'phaser';
import type {PickupView,RunView,SimEvent} from '../../contract/index.ts';
import type {Projector} from './projector.ts';
import {Ring} from './pool.ts';
import {baseArtKey,baseFile,baseFrame,type BaseFrameRef} from '../art/base-art.ts';
import {token,tokenColor} from '../ui/tokens.ts';
import {CRATE_ART,CRATE_OPEN_REACH,FIRE_LOOK,RARITY_COLOR,RARITY_NAME,RARITY_TOKEN,arsenalLoads,coneSteps,crateProgress,crateRow,fxKey,iconKey,shotFrame,
  isWeaponItem,itemIcon,rarityOf,type FireLook,type Rarity} from './arsenal-rules.ts';

type Pt={x:number;y:number};
type Image=Phaser.GameObjects.Image;
/** Drawn sizes at the endless map's scale (CSS px, times the actor scale): crate width, item sticker, hand sticker. */
const CRATE_PX=64,ITEM_PX=34,HAND_PX=36;
/** Where the hand sticker sits from the hero's feet (CSS px): at the side, about hip height. */
const HAND_DX=26,HAND_DY=-30;
/**
 * Depths: rings on the ground (just over the horde's ground layer); the hand over the heroes (allies 96400, the local
 * one 96500); the shots over the hand (a flash at the barrel is beside the hero's body, under it it would not show), all
 * under the hit numbers on a player (layers.ts PLAYER_HIT_DEPTH 96600).
 */
const RING_DEPTH=-9965,HAND_DEPTH=96520,FX_DEPTH=96530,BURST_MS=900;
/** The local hero moved this far (world units) between frames: not standing still (the sim's rule is "same position"). */
const STILL_EPS=.02;
/** Points of the opening arc around a crate (a full turn). */
const PROGRESS_POINTS=40;

interface ShotFx {image:Image;born:number;x:number;y:number;angle:number;look:FireLook;frames:number;scale:number}
interface BurstFx {image:Image;label:Phaser.GameObjects.Text;born:number;x:number;y:number;rarity:Rarity}

export interface ArsenalOptions {
  projector:Projector;
  locate?:(id:string)=>Pt|undefined;
  selfId?:()=>string|undefined;
}
/** The look of a pickup the arsenal draws: texture, frame and scale over the image's own size. */
export interface ArsenalLook {key:string;frame?:string|number;k:number}

export class ArsenalFx{
  /** The current view plays the manual combat (some hero has a hand slot). */
  manual=false;
  private scene:Phaser.Scene;
  private options:ArsenalOptions;
  private queued=false;
  private rings:Phaser.GameObjects.Graphics;
  private arcs:Phaser.GameObjects.Graphics;
  private hands=new Map<string,{image:Image;icon:string;seen:number}>();
  private handOf=new Map<string,string>();
  private shots:Ring<ShotFx>;
  private bursts:Ring<BurstFx>;
  private colors:Record<Rarity,number>={...RARITY_COLOR};
  private papel=0xeeddb8;private breu=0x1e1530;
  private q:Pt={x:0,y:0};private q2:Pt={x:0,y:0};
  private pts:Pt[]=Array.from({length:PROGRESS_POINTS},()=>({x:0,y:0}));
  private frameRef:BaseFrameRef={key:'',frame:0};
  /** Local opening prediction: since when the hero stands still, and the crate (and since when) in reach. */
  private self?:Pt;private stillSince=0;private openCrate?:string;private openSince=0;
  private now=0;private body=1;private reduced=false;
  private slashes:{born:number;x:number;y:number;angle:number;size:number;ms:number}[]=[];
  private objects:Phaser.GameObjects.GameObject[]=[];

  constructor(scene:Phaser.Scene,options:ArsenalOptions){
    this.scene=scene;this.options=options;
    this.rings=this.track(scene.add.graphics().setDepth(RING_DEPTH).setName('arsenal-aneis'));
    this.arcs=this.track(scene.add.graphics().setDepth(FX_DEPTH).setName('arsenal-golpes'));
    const image=()=>this.track(scene.add.image(0,0,'__DEFAULT').setVisible(false).setActive(false));
    const showImage=(o:{image:Image},active:boolean)=>{o.image.setVisible(active).setActive(active);if(!active)o.image.setAlpha(1).setScale(1).setRotation(0);};
    this.shots=new Ring<ShotFx>(()=>({image:image(),born:0,x:0,y:0,angle:0,look:FIRE_LOOK.pistola,frames:1,scale:1}),showImage,24);
    this.bursts=new Ring<BurstFx>(()=>({image:image(),label:this.track(scene.add.text(0,0,'',{fontFamily:'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',fontSize:'26px',fontStyle:'900',color:'#EEDDB8',stroke:'#1E1530',strokeThickness:7})
      .setOrigin(.5,1).setDepth(FX_DEPTH+1).setVisible(false)),born:0,x:0,y:0,rarity:1}),(o,active)=>{showImage(o,active);o.label.setVisible(active);},6);
    try{
      for(const r of [1,2,3,4,5] as Rarity[]){const c=token(RARITY_TOKEN[r]);if(c)this.colors[r]=tokenColor(RARITY_TOKEN[r]);}
      this.papel=tokenColor('--c-papel');this.breu=tokenColor('--c-breu');
    }catch{/* no tokens.css (tests): the fallbacks */}
  }

  /** Per authoritative view: is this the manual combat, who holds what (and the art, the first time). */
  push(view:RunView){
    let manual=false;
    this.handOf.clear();
    for(const p of view.players){
      if(p.hand===undefined)continue;
      manual=true;
      const icon=p.spectator||p.eliminated?undefined:itemIcon(p.weapons[p.hand]?.id);
      if(icon)this.handOf.set(p.id,icon);
    }
    this.manual=manual;
    if(manual&&!this.queued)this.queueArt();
  }

  /** Per event: a damage on the local hero restarts the opening; a crate opened bursts; an arsenal weapon's shot shows. */
  event(event:SimEvent,crateAt?:Pt){
    if(!this.manual)return;
    if(event.type==='damage'&&event.target===this.options.selfId?.())this.stillSince=this.now;
    else if(event.type==='pickup'&&event.kind==='chest'&&crateAt)this.burst(crateAt,rarityOf(event.value));
    else if(event.type==='fire'){const look=FIRE_LOOK[event.weapon];if(look)this.fire(look,event.x,event.y,event.dx,event.dy);}
  }

  /**
   * The arsenal's texture for a pickup, or undefined (the renderer keeps its own): a crate's sheet in the manual combat,
   * an item's sticker. `k` scales the texture to its drawn size at body 1.
   */
  pickupLook(view:PickupView):ArsenalLook|undefined{
    if(view.kind==='chest'&&this.manual){
      const file=baseFile(CRATE_ART),ref=file&&baseFrame(CRATE_ART,'fechada',0,0,this.frameRef);
      if(!file||!ref||!this.scene.textures.exists(ref.key))return undefined;
      return {key:ref.key,frame:ref.frame,k:CRATE_PX/file.cell[0]};
    }
    if(view.kind==='item'){
      const icon=itemIcon(view.resource),key=icon&&iconKey(icon);
      if(!key||!this.scene.textures.exists(key))return undefined;
      return {key,k:ITEM_PX/Math.max(1,this.scene.textures.get(key).getSourceImage().width)};
    }
    return undefined;
  }

  /** Start of a frame: the rings and arcs are redrawn, the local hero's stillness follows its position. */
  begin(now:number,body:number,reduced:boolean){
    this.now=now;this.body=body;this.reduced=reduced;
    this.rings.clear();this.arcs.clear();
    const id=this.options.selfId?.(),p=id?this.options.locate?.(id):undefined;
    if(!p){this.self=undefined;return;}
    if(!this.self||Math.hypot(p.x-this.self.x,p.y-this.self.y)>STILL_EPS){this.stillSince=now;this.self={x:p.x,y:p.y};}
  }

  /**
   * A crate drawn this frame at world (x,y), screen `q`: its rarity ring, the opening arc when the local hero is at it,
   * and the sheet frame to show (closed, or abrindo-n with the progress). Undefined when its sheet is not in use.
   */
  crate(id:string,x:number,y:number,value:number,q:Pt):BaseFrameRef|undefined{
    const rarity=rarityOf(value),b=this.body,color=this.colors[rarity];
    const pulse=this.reduced?1:1+.06*Math.sin(this.now*.006);
    this.rings.fillStyle(color,.22).fillEllipse(q.x,q.y,58*b*pulse,24*b*pulse);
    this.rings.lineStyle(Math.max(2,3*b),color,.95).strokeEllipse(q.x,q.y,58*b*pulse,24*b*pulse);
    let progress=0;
    const self=this.self;
    if(self&&Math.hypot(self.x-x,self.y-y)<=CRATE_OPEN_REACH){
      if(this.openCrate!==id){this.openCrate=id;this.openSince=this.now;}
      progress=crateProgress(this.now-Math.max(this.stillSince,this.openSince),value);
    }else if(this.openCrate===id)this.openCrate=undefined;
    if(progress>0){
      // The opening fills the crate's own ring (on the ground, under the hero): Breu under, the rarity colour over.
      const n=Math.max(2,Math.ceil(PROGRESS_POINTS*progress)),rx=36*b,ry=15*b,pts=this.pts;
      for(let i=0;i<n;i++){const t=-Math.PI/2+progress*Math.PI*2*i/(n-1);pts[i].x=q.x+Math.cos(t)*rx;pts[i].y=q.y+Math.sin(t)*ry;}
      this.rings.lineStyle(9*b,this.breu,.8).strokePoints(pts,false,false,n);
      this.rings.lineStyle(5*b,color,1).strokePoints(pts,false,false,n);
    }
    return baseFrame(CRATE_ART,crateRow(progress),0,0,this.frameRef);
  }

  /** An item drawn this frame at screen `q`: a weapon gets the ring of its rarity (a consumable none). */
  item(resource:string|undefined,value:number,q:Pt){
    if(!isWeaponItem(resource))return;
    const color=this.colors[rarityOf(value)],b=this.body;
    this.rings.lineStyle(Math.max(2,2.5*b),color,.95).strokeEllipse(q.x,q.y,40*b,17*b);
  }

  /** End of a frame: the hands, the shots and the bursts. */
  update(){
    const {projector}=this.options,b=this.body,now=this.now;
    for(const [id,icon] of this.handOf){
      const at=this.options.locate?.(id);if(!at)continue;
      const key=iconKey(icon);if(!this.scene.textures.exists(key))continue;
      let hand=this.hands.get(id);
      if(!hand){hand={image:this.track(this.scene.add.image(0,0,key).setDepth(HAND_DEPTH)),icon:'',seen:0};this.hands.set(id,hand);}
      if(hand.icon!==icon){hand.icon=icon;hand.image.setTexture(key);}
      const q=projector.project(at.x,at.y,this.q),w=Math.max(1,hand.image.width);
      hand.image.setPosition(q.x+HAND_DX*b,q.y+HAND_DY*b).setScale(HAND_PX*b/w).setVisible(true);
      hand.seen=now;
    }
    for(const [id,hand] of this.hands)if(hand.seen!==now||!this.handOf.has(id))hand.image.setVisible(false);
    this.shots.retain(this.drawShot);
    this.slashes=this.slashes.filter(s=>this.drawSlash(s));
    this.bursts.retain(this.drawBurst);
  }

  destroy(){
    this.shots.clear();this.bursts.clear();this.hands.clear();
    for(const o of this.objects)o.destroy();
    this.objects.length=0;
  }

  // ---------- inside ----------
  private queueArt(){
    this.queued=true;
    const load=this.scene.load;let any=false;
    for(const l of arsenalLoads()){
      if(this.scene.textures.exists(l.key))continue;
      if(l.strip){
        // A strip of square frames: the frame size is the image height, known once loaded.
        load.image(`${l.key}:src`,l.url);
        load.once(`filecomplete-image-${l.key}:src`,()=>this.cutStrip(`${l.key}:src`,l.key));
      }else load.image(l.key,l.url);
      any=true;
    }
    if(any&&!load.isLoading())load.start();
  }
  private cutStrip(from:string,key:string){
    const textures=this.scene.textures;
    if(textures.exists(key)||!textures.exists(from))return;
    const src=textures.get(from).getSourceImage() as HTMLImageElement,h=src.height,n=Math.max(1,Math.floor(src.width/Math.max(1,h)));
    textures.addSpriteSheet(key,src,{frameWidth:h,frameHeight:h,endFrame:n-1});
  }
  private fire(look:FireLook,x:number,y:number,dx=0,dy=0){
    const p=this.options.projector,len=Math.hypot(dx,dy),ux=len>1e-6?dx/len:1,uy=len>1e-6?dy/len:0;
    const a=p.project(x,y,this.q),ax=a.x,ay=a.y,ahead=p.project(x+ux,y+uy,this.q2),angle=Math.atan2(ahead.y-ay,ahead.x-ax);
    if(look.kind==='slash'){
      if(this.slashes.length<8)this.slashes.push({born:this.now,x:x+ux*.5,y:y+uy*.5,angle,size:look.size,ms:look.ms});
      return;
    }
    const key=look.art?fxKey(look.art):'';
    if(!key||!this.scene.textures.exists(key))return;
    const frames=Math.max(1,this.scene.textures.get(key).frameTotal-1);
    const spawn=(wx:number,wy:number,scale:number)=>{
      const s=this.shots.spawn();
      s.born=this.now;s.x=wx;s.y=wy;s.angle=angle;s.look=look;s.frames=frames;s.scale=scale;
      s.image.setTexture(key,0).setOrigin(look.kind==='muzzle'?.15:.5,look.kind==='blast'?.75:.5).setDepth(FX_DEPTH);
    };
    if(look.kind==='muzzle')spawn(x+ux*.45,y+uy*.45,1);
    else if(look.kind==='blast')spawn(x+dx,y+dy,1);
    else{const n=coneSteps(look.reach??1.5);for(let i=0;i<n;i++){const d=.5+i*((look.reach??1.5)-.5)/Math.max(1,n-1);spawn(x+ux*d,y+uy*d,.75+.35*i/Math.max(1,n-1));}}
  }
  private burst(at:Pt,rarity:Rarity){
    const ref=baseFrame(CRATE_ART,'abrindo-6',0,0,this.frameRef),b=this.bursts.spawn(),file=baseFile(CRATE_ART);
    b.born=this.now;b.x=at.x;b.y=at.y;b.rarity=rarity;
    if(ref&&file&&this.scene.textures.exists(ref.key))b.image.setTexture(ref.key,ref.frame).setOrigin(.5,.88).setDepth(FX_DEPTH);
    else b.image.setVisible(false);
    b.label.setText(`${RARITY_NAME[rarity]}!`).setColor(`#${this.colors[rarity].toString(16).padStart(6,'0')}`);
  }
  private drawShot=(s:ShotFx)=>{
    const age=this.now-s.born;if(age>=s.look.ms)return false;
    const q=this.options.projector.project(s.x,s.y,this.q),b=this.body,f=shotFrame(s.look,age,s.frames);
    if(s.image.frame.name!==String(f))s.image.setFrame(f);
    const h=Math.max(1,s.image.height),k=s.look.size*b*s.scale/h;
    s.image.setPosition(q.x,q.y-(s.look.kind==='blast'?0:22*b)).setScale(k).setRotation(s.look.kind==='blast'||s.look.kind==='cone'&&s.look.art==='fogo-pequeno'?0:s.angle)
      .setAlpha(s.look.kind==='muzzle'?1:1-.4*age/s.look.ms);
    return true;
  };
  private drawSlash(s:{born:number;x:number;y:number;angle:number;size:number;ms:number}){
    const age=this.now-s.born;if(age>=s.ms)return false;
    const q=this.options.projector.project(s.x,s.y,this.q),b=this.body,u=age/s.ms,r=s.size*b*(.7+.3*u),spread=1.1;
    const from=s.angle-spread*(1-u*.4),to=s.angle+spread*u;
    this.arcs.lineStyle(7*b,this.breu,.8*(1-u)).beginPath().arc(q.x,q.y-22*b,r,from,to,false).strokePath();
    this.arcs.lineStyle(4*b,this.papel,1-u).beginPath().arc(q.x,q.y-22*b,r,from,to,false).strokePath();
    return true;
  }
  private drawBurst=(o:BurstFx)=>{
    const age=this.now-o.born;if(age>=BURST_MS)return false;
    const q=this.options.projector.project(o.x,o.y,this.q),b=this.body,u=age/BURST_MS,file=baseFile(CRATE_ART);
    if(file&&o.image.visible)o.image.setPosition(q.x,q.y).setScale(CRATE_PX*b/file.cell[0]).setAlpha(1-u*u);
    const color=this.colors[o.rarity],r=(30+70*u)*b;
    this.arcs.lineStyle(5*b*(1-u)+1,color,1-u).strokeEllipse(q.x,q.y-10*b,r*2,r*.9);
    o.label.setPosition(q.x,q.y-(70+40*u)*b).setScale(b*(u<.15?.6+u/.15*.4:1)).setAlpha(u<.7?1:1-(u-.7)/.3);
    return true;
  };
  private track<T extends Phaser.GameObjects.GameObject>(o:T):T{this.objects.push(o);return o;}
}
/** The crate sheet's texture key (art/base-art.ts), for tests and the sandbox. */
export const crateKey=()=>baseArtKey(CRATE_ART);
