/**
 * D-051 arsenal on screen (NEW-20261016-ORQ-armas-caixas-render): what render/layers.ts adds in the manual combat.
 *  - Crates: base `caixa-saque` (closed, then abrindo-1..6 while a hero stands still at one) over a ring in its
 *    rarity colour, that ring filling while it opens and a burst with the rarity name when it opens ('pickup' chest event).
 *  - Items on the ground: their sticker (hud/items.ts icon) and, for a weapon, a ring in its rarity colour.
 *  - The weapon in each hero's hand (PlayerRunView.hand): its sticker at the hero's side; none while moving the car (D-052).
 *    With full effects it casts its part of the hero's silhouette (render/silhouette.ts), so the shadow holds the weapon.
 *    A hero whose pose has a measured hand (card arma-na-mao-viciado: the viciado's M16, sprites/hand-points.ts) holds
 *    it: the sticker's grip on that hand, the barrel where the hero faces, behind the body when the hand is.
 *  - Each arsenal weapon's shot ('fire' event): muzzle flash, cone, blast or slash (arsenal-rules.ts FIRE_LOOK).
 *  - The local hero's melee swing: the aim cone on the ground (render/melee-cone.ts).
 * The art loads once, the first time a view shows the manual combat (no download for the automatic weapons); until then,
 * and for any piece the manifest lacks, the old looks stay (the chest, the parcel, no hand, no flash).
 */
import type Phaser from 'phaser';
import type {PickupView,RunView,SimEvent} from '../../contract/index.ts';
import type {Projector} from './projector.ts';
import {Ring} from './pool.ts';
import {baseArtKey,baseFile,baseFrame,type BaseFrameRef} from '../art/base-art.ts';
import {token,tokenColor} from '../ui/tokens.ts';
import {silhouetteImage} from './silhouette.ts';
import {MeleeCone,meleeCone} from './melee-cone.ts';
import {AuraRings,auraRingRadius} from './aura-ring.ts';
import {TriBand} from './city/tri-band.ts';
import {CRATE_SCALE,kitPiece,kitRarity} from '../../rules/index.ts';
import {SILHOUETTE,SILHOUETTE_ROTATION,castOffset} from './shadow-rules.ts';
import {DEFAULT_HOLD,HELD_TINT,WEAPON_HOLD,heldLook,holdPose,type HeldHand} from '../sprites/hand-points.ts';
import type {CityOutlines} from './city-outline.ts';
import {CRATE_ART,CrateOpenings,FIRE_LOOK,RARITY_COLOR,RARITY_NAME,RARITY_TOKEN,arsenalLoads,coneSteps,crateRow,fxKey,iconKey,shotFrame,
  SLASH_AHEAD,handsOnCar,isWeaponItem,itemIcon,rarityOf,type FireLook,type Rarity} from './arsenal-rules.ts';

type Pt={x:number;y:number};
type Image=Phaser.GameObjects.Image;
/** Drawn sizes at the endless map's scale (CSS px, times the actor scale): crate width (3× since coleta-3x), item sticker, hand sticker. */
const CRATE_PX=64*CRATE_SCALE,ITEM_PX=34,HAND_PX=36;
/** The crate's rarity ring (its body on the ground, rules/crate-size.ts CRATE_BODY_RADIUS) and its opening arc, at body 1 (CSS px). */
const CRATE_RING_W=58*CRATE_SCALE,CRATE_RING_H=24*CRATE_SCALE,CRATE_ARC_RX=36*CRATE_SCALE,CRATE_ARC_RY=15*CRATE_SCALE;
/** The crate's shadow width at body 1 (CSS px; render/layers.ts draws it). */
export const CRATE_SHADOW_PX=34*CRATE_SCALE;
/** Where the hand sticker sits from the hero's feet (CSS px): at the side, about hip height. */
const HAND_DX=26,HAND_DY=-30;
/**
 * Depths: rings on the ground (just over the horde's ground layer); the hand over the heroes (allies 96400, the local
 * one 96500); the shots over the hand (a flash at the barrel is beside the hero's body, under it it would not show), all
 * under the hit numbers on a player (layers.ts PLAYER_HIT_DEPTH 96600). The hand's silhouette lies with the horde's ones
 * (layers.ts -9979), under every body. The melee aim cone lies on the ground over the silhouettes and under the horde's
 * ground layer (layers.ts -9970: the telegraphs stay on top of it).
 */
const RING_DEPTH=-9965,CONE_DEPTH=-9974,HAND_SIL_DEPTH=-9978,HAND_DEPTH=96520,FX_DEPTH=96530,BURST_MS=900;
/** A held weapon sits this much over (or, behind the body, under) its hero's sprite depth. */
const HELD_DEPTH_STEP=.02;
/** Points of the opening arc around a crate (a full turn). */
const PROGRESS_POINTS=40;
/**
 * Card Q2: the crates' and weapons' rarity rings are frozen into triangles (city/tri-band.ts), one look per kind, rarity
 * and body (to the hundredth), each pickup taking a band of its look this frame (the crate's pulse is a scale); Phaser
 * replayed 418-836 commands of rings every frame. Under the opening arc, which stays live. A look unused this long goes.
 */
const RING_BAND_DEPTH=RING_DEPTH-.001,RING_LOOK_MS=3000;

interface ShotFx {image:Image;born:number;x:number;y:number;angle:number;look:FireLook;frames:number;scale:number}
interface BurstFx {image:Image;label:Phaser.GameObjects.Text;born:number;x:number;y:number;rarity:Rarity}

export interface ArsenalOptions {
  projector:Projector;
  locate?:(id:string)=>Pt|undefined;
  /** Id of the local hero: only their melee swing lays the aim cone. */
  selfId?:()=>string|undefined;
  /** The ground point the local hero aims at (world u): the mouse on a PC; undefined on touch (the swing's direction). */
  aim?:()=>Pt|undefined;
  /** The hero's weapon hand on screen, when its pose has one measured; undefined: the sticker at the side. */
  hand?:(id:string)=>HeldHand|undefined;
  /** City mode: the held weapon wears the heroes' Breu ring (render/city-outline.ts), at its drawn size. */
  cityOutlines?:CityOutlines;
  /** The scene draws the local hero's cone itself, right after placing him (drawSelfCone): update() leaves it alone. */
  coneFromScene?:boolean;
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
  private hands=new Map<string,{image:Image;sil:Image;grip:Image;icon:string;seen:number}>();
  private handOf=new Map<string,string>();
  private shots:Ring<ShotFx>;
  private bursts:Ring<BurstFx>;
  private colors:Record<Rarity,number>={...RARITY_COLOR};
  private papel=0xeeddb8;private breu=0x1e1530;
  private q:Pt={x:0,y:0};private q2:Pt={x:0,y:0};
  private pts:Pt[]=Array.from({length:PROGRESS_POINTS},()=>({x:0,y:0}));
  private frameRef:BaseFrameRef={key:'',frame:0};
  private ringLooks=new Map<string,{bands:TriBand[];used:number;seen:number}>();
  /** Opening prediction for every hero who can open (has a hand slot, is in the run): the local one and the others. */
  private openings=new CrateOpenings();
  private canOpen=new Set<string>();
  private now=0;private body=1;private reduced=false;private silhouettes=false;
  private slashes:{born:number;x:number;y:number;angle:number;size:number;ms:number}[]=[];
  private objects:Phaser.GameObjects.GameObject[]=[];
  private cone:MeleeCone;
  /** upgrades-megabonk: the Defumador's rings, and each hero's aura radius from the last view (u). */
  private aura:AuraRings;
  private auraOf=new Map<string,number>();
  /** The local hero's melee cone for the weapon in hand (radius, half aperture), from the last view; undefined: none. */
  private selfCone?:{weapon:string;radius:number;half:number};

  constructor(scene:Phaser.Scene,options:ArsenalOptions){
    this.scene=scene;this.options=options;
    this.rings=this.track(scene.add.graphics().setDepth(RING_DEPTH).setName('arsenal-aneis'));
    this.arcs=this.track(scene.add.graphics().setDepth(FX_DEPTH).setName('arsenal-golpes'));
    this.cone=new MeleeCone(scene,options.projector,CONE_DEPTH);this.track(this.cone.object);
    this.aura=new AuraRings(scene,options.projector,CONE_DEPTH-.5);
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

  /**
   * The local hero's cone this frame, at the hero as drawn (`at`, world u) and just under its shadow (`shadow` depth):
   * called by the scene after it placed him, so the cone follows his depth step by step and never covers him.
   */
  drawSelfCone(at:Pt,shadow:number){
    const alive=this.cone.alpha(this.now)>0;
    this.cone.draw(this.now,this.body,alive?at:undefined,alive?this.options.aim?.():undefined,shadow);
  }

  /** Per authoritative view: is this the manual combat, who holds what (and the art, the first time). */
  push(view:RunView){
    let manual=false;
    this.handOf.clear();this.canOpen.clear();this.selfCone=undefined;this.auraOf.clear();
    const car=view.objective?.car,me=this.options.selfId?.();
    for(const p of view.players){
      const aura=p.spectator||p.eliminated||p.downed?0:auraRingRadius(p);
      if(aura>0)this.auraOf.set(p.id,aura);
      if(p.hand===undefined)continue;
      manual=true;
      if(!p.spectator&&!p.eliminated&&!p.downed)this.canOpen.add(p.id);
      const icon=p.spectator||p.eliminated||handsOnCar(car,p.id)?undefined:itemIcon(p.weapons[p.hand]?.id);
      if(icon)this.handOf.set(p.id,icon);
      if(p.id===me){const weapon=p.weapons[p.hand]?.id,cone=weapon&&meleeCone(weapon,p,p.classId);if(cone)this.selfCone={weapon,...cone};}
    }
    this.manual=manual;
    if(manual&&!this.queued)this.queueArt();
  }

  /** Per event: a damage on a hero restarts its opening; a crate opened bursts; an arsenal weapon's shot shows. */
  event(event:SimEvent,crateAt?:Pt){
    if(!this.manual)return;
    if(event.type==='damage')this.openings.hurt(event.target,this.now);
    else if(event.type==='pickup'&&event.kind==='chest'&&crateAt)this.burst(crateAt,rarityOf(event.value));
    else if(event.type==='fire'){
      const look=FIRE_LOOK[event.weapon];if(look)this.fire(look,event.x,event.y,event.dx,event.dy);
      const cone=this.selfCone;
      if(cone&&cone.weapon===event.weapon&&event.player===this.options.selfId?.())this.cone.swing(this.now,cone.radius,cone.half,event.dx??0,event.dy??0);
    }
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

  /** Start of a frame: the rings and arcs are redrawn, each hero's stillness follows its position. */
  begin(now:number,body:number,reduced:boolean,silhouettes=false){
    this.now=now;this.body=body;this.reduced=reduced;this.silhouettes=silhouettes;
    this.rings.clear();this.arcs.clear();
    for(const [key,look] of this.ringLooks){
      for(const band of look.bands)band.setVisible(false);
      look.used=0;
      if(now-look.seen>RING_LOOK_MS){for(const band of look.bands)band.destroy();this.ringLooks.delete(key);}
    }
    this.openings.begin(now,this.canOpen,id=>this.options.locate?.(id));
    const rings:{x:number;y:number;r:number}[]=[];
    for(const [id,r] of this.auraOf){const at=this.options.locate?.(id);if(at)rings.push({x:at.x,y:at.y,r});}
    this.aura.draw(rings,now,body,reduced);
  }

  /**
   * A crate drawn this frame at world (x,y), screen `q`: its rarity ring, the opening arc when a hero is at it (the most
   * advanced one, when several are),
   * and the sheet frame to show (closed, or abrindo-n with the progress). Undefined when its sheet is not in use.
   */
  crate(id:string,x:number,y:number,value:number,q:Pt):BaseFrameRef|undefined{
    const rarity=rarityOf(value),b=this.body,color=this.colors[rarity];
    const pulse=this.reduced?1:1+.06*Math.sin(this.now*.006);
    this.ringBand(`c|${color}|${Math.round(b*100)}`,g=>{
      g.fillStyle(color,.22).fillEllipse(0,0,CRATE_RING_W*b,CRATE_RING_H*b);
      g.lineStyle(Math.max(2,3*b),color,.95).strokeEllipse(0,0,CRATE_RING_W*b,CRATE_RING_H*b);
    },q).setScale(pulse);
    const progress=this.openings.progress(id,x,y,value);
    if(progress>0){
      // The opening fills the crate's own ring (on the ground, under the hero): Breu under, the rarity colour over.
      const n=Math.max(2,Math.ceil(PROGRESS_POINTS*progress)),rx=CRATE_ARC_RX*b,ry=CRATE_ARC_RY*b,pts=this.pts;
      for(let i=0;i<n;i++){const t=-Math.PI/2+progress*Math.PI*2*i/(n-1);pts[i].x=q.x+Math.cos(t)*rx;pts[i].y=q.y+Math.sin(t)*ry;}
      this.rings.lineStyle(9*b,this.breu,.8).strokePoints(pts,false,false,n);
      this.rings.lineStyle(5*b,color,1).strokePoints(pts,false,false,n);
    }
    return baseFrame(CRATE_ART,crateRow(progress),0,0,this.frameRef);
  }

  /** An item drawn this frame at screen `q`: a weapon gets the ring of its rarity, a kit de torre its tier's (a consumable none). */
  item(resource:string|undefined,value:number,q:Pt){
    const kit=kitPiece(resource);
    if(!kit&&!isWeaponItem(resource))return;
    const color=this.colors[kit?kitRarity(kit):rarityOf(value)],b=this.body;
    this.ringBand(`i|${color}|${Math.round(b*100)}`,g=>{g.lineStyle(Math.max(2,2.5*b),color,.95).strokeEllipse(0,0,40*b,17*b);},q);
  }
  /** A band of the ring look `key` (drawn by `draw` at the origin the first time) shown at `q` this frame. */
  private ringBand(key:string,draw:(g:Phaser.GameObjects.Graphics)=>void,q:Pt):TriBand{
    let look=this.ringLooks.get(key);
    if(!look){look={bands:[],used:0,seen:this.now};this.ringLooks.set(key,look);}
    look.seen=this.now;
    let band=look.bands[look.used];
    if(!band){band=TriBand.make(this.scene,draw).setDepth(RING_BAND_DEPTH);look.bands.push(band);}
    look.used++;
    return band.setPosition(q.x,q.y).setScale(1).setVisible(true);
  }

  /** End of a frame: the hands, the shots and the bursts. */
  update(){
    const {projector}=this.options,b=this.body,now=this.now;
    for(const [id,icon] of this.handOf){
      const at=this.options.locate?.(id);if(!at)continue;
      const key=iconKey(icon);if(!this.scene.textures.exists(key))continue;
      let hand=this.hands.get(id);
      if(!hand){
        hand={image:this.track(this.scene.add.image(0,0,key).setDepth(HAND_DEPTH)),sil:this.track(silhouetteImage(this.scene,key,HAND_SIL_DEPTH)),
          grip:this.track(this.scene.add.image(0,0,'__DEFAULT').setVisible(false).setActive(false)),icon:'',seen:0};
        this.hands.set(id,hand);
      }
      if(hand.icon!==icon){hand.icon=icon;hand.sil.setTexture(key);}
      const q=projector.project(at.x,at.y,this.q),w=Math.max(1,this.scene.textures.getFrame(key)?.width??1),held=this.options.hand?.(id);
      let dx=HAND_DX*b,dy=HAND_DY*b,k=HAND_PX*b/w,rotation=0,flipX=false,flipY=false,ox=.5,oy=.5,depth=HAND_DEPTH;
      if(held){
        const hold=WEAPON_HOLD[icon]??DEFAULT_HOLD,pose=holdPose(hold,held.aim);
        dx=held.x-q.x;dy=held.y-q.y;k=hold.px*b/w;rotation=pose.rotation;flipX=pose.flipX;flipY=pose.flipY;ox=pose.ox;oy=pose.oy;
        depth=held.depth+(held.behind?-HELD_DEPTH_STEP:HELD_DEPTH_STEP);
      }
      hand.image.setPosition(q.x+dx,q.y+dy).setRotation(rotation).setFlip(flipX,flipY).setDepth(depth).setVisible(true);
      // Held (card arma-na-mao): the matte copy in the figure's light and, in the city, the heroes' ring; the side
      // sticker keeps the icon as it was.
      const look=held?this.heldTexture(key):key,outlines=held?this.options.cityOutlines:undefined;
      if(!outlines?.show(hand.image,outlines.variant(look,k),look,undefined,ox,oy,k,k)){
        if(hand.image.texture.key!==look)hand.image.setTexture(look);
        hand.image.setOrigin(ox,oy).setScale(k);
      }
      if(held)hand.image.setTint(held.behind?HELD_TINT.behind:HELD_TINT.front);else hand.image.clearTint();
      this.grip(hand.grip,held,depth);
      if(this.silhouettes){
        const o=castOffset(dx,dy,this.q2);
        hand.sil.setPosition(q.x+o.x,q.y+o.y).setOrigin(ox,oy).setFlip(flipX,flipY).setScale(k,-k*SILHOUETTE.flatten).setRotation(SILHOUETTE_ROTATION-rotation).setVisible(true).setActive(true);
      }else if(hand.sil.visible)hand.sil.setVisible(false).setActive(false);
      hand.seen=now;
    }
    for(const [id,hand] of this.hands)if(hand.seen!==now||!this.handOf.has(id)){hand.image.setVisible(false);hand.sil.setVisible(false).setActive(false);hand.grip.setVisible(false).setActive(false);}
    if(!this.options.coneFromScene){
      const me=this.options.selfId?.(),hero=me!==undefined&&this.cone.alpha(now)>0?this.options.locate?.(me):undefined;
      this.cone.draw(now,b,hero,hero?this.options.aim?.():undefined);
    }
    this.shots.retain(this.drawShot);
    this.slashes=this.slashes.filter(s=>this.drawSlash(s));
    this.bursts.retain(this.drawBurst);
  }

  destroy(){
    this.aura.destroy();
    this.shots.clear();this.bursts.clear();this.hands.clear();
    for(const look of this.ringLooks.values())for(const band of look.bands)band.destroy();
    this.ringLooks.clear();
    for(const o of this.objects)o.destroy();
    this.objects.length=0;
  }

  // ---------- inside ----------
  /**
   * The fingers over the handle (HandPatch): the hero's own frame cropped to the hand, just over the weapon. None when
   * the hand is behind the body (the body already covers the weapon) or the pose has no hand.
   */
  private grip(image:Image,held:HeldHand|undefined,depth:number){
    const p=held?.patch;
    if(!p||!this.scene.textures.exists(p.key)){if(image.visible)image.setVisible(false).setActive(false);return;}
    if(image.texture.key!==p.key||image.frame.name!==String(p.frame))image.setTexture(p.key,p.frame);
    image.setPosition(p.x,p.y).setOrigin(p.ox,p.oy).setScale(p.sx,p.sy).setFlipX(p.flip).setCrop(...p.crop)
      .setDepth(depth+HELD_DEPTH_STEP/2).setVisible(true).setActive(true);
  }
  /** The held look of an icon texture (hand-points.ts heldLook), baked once into `<key>:mao`; the icon until it can be. */
  private heldTexture(key:string){
    const textures=this.scene.textures,held=`${key}:mao`;
    if(textures.exists(held))return held;
    const src=textures.get(key).getSourceImage() as HTMLImageElement|HTMLCanvasElement;
    const tex=src.width>0&&src.height>0?textures.createCanvas(held,src.width,src.height):null;
    if(!tex)return key;
    const c=tex.getContext(),data=(c.drawImage(src,0,0),c.getImageData(0,0,src.width,src.height));
    heldLook(data.data);c.putImageData(data,0,0);tex.refresh();
    return held;
  }
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
      if(this.slashes.length<8)this.slashes.push({born:this.now,x:x+ux*SLASH_AHEAD,y:y+uy*SLASH_AHEAD,angle,size:look.size,ms:look.ms});
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
