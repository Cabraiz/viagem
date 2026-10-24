import type Phaser from 'phaser';
import {spriteCatalog,type FigureBox} from './sprite-catalog.ts';
import {directionalSheets,directionalSheet,type DirectionalSheet} from './sprite-sheets.ts';
import {spriteUrl,originalUrl} from './art-urls.ts';
import {SpriteMotion,HurtGate,SPRITE_CLIPS,ATTACK_VISUAL_MS,FACINGS,FACING_FRAMES,FacingTracker,Facing8Tracker,WalkGate,HERO_DIRECTION_PAGE,legacyFlip,walkCycles,cycleFrame,RUN_STRIDE,type Motion,type Facing} from './sprite-motion.ts';
import type {CityOutlines} from '../render/city-outline.ts';
import {figureOffThread} from '../render/outline-jobs.ts';
import {copyX,copyY,cropOf,variantOrigin,type CellCrop,type VariantGeometry} from '../render/city-outline-rules.ts';
import {HERO_DRAW_SCALE} from '../render/draw-scale.ts';
import {movement128Figure,movementPlan,movementSheets,movementFrame,swingFrame,movementPivotX,heroRuns,runPhase,phaseStride,phaseContacts,hasPush16,pushPlan,hurtPlan,type Movement128Plan} from './movement128.ts';
import {clipFeetY,detailedFeetY,heroFeetY} from './hero-feet.ts';
import {setBareFrame} from '../render/silhouette.ts';
import {movement128Textures,movement128Visible,freeSheet,type Movement128Textures} from './movement128-textures.ts';
import {watchOrphans} from './texture-orphans.ts';
import {handPoint,type HandPoint} from './hand-points.ts';
import {HERO_DIRECTIONS,type HeroDirection} from './sprite-motion.ts';

export type {FigureBox};
/** The frame a detailed clip drew last: the sheet, its frame, origin (unmirrored), scale, mirror and facing. */
interface HandFrame {url:string;frame:number;ox:number;oy:number;scale:number;flip:boolean;direction:HeroDirection;geom?:VariantGeometry}
/** CharacterSprites.handPose: the hand point of the pose shown and how its frame sits on screen (`geom`: the city copy shown). */
export interface HandPose {point:HandPoint;ox:number;oy:number;scale:number;flip:boolean;direction:HeroDirection;geom?:VariantGeometry}
/**
 * A walk as drawn (card som-passos-fora-do-eixo): the cycles walked since it started (`since`, the scene's clock), and the
 * points of the cycle (0..1) where the sheet shown plants a foot: the run and push phase tables' (phaseContacts), else
 * pose 0 and the middle pose of a looping clip (LOOP_CONTACTS).
 */
export interface Gait {cycles:number;contacts:readonly number[];since:number}
export const LOOP_CONTACTS:readonly number[]=[0,.5];
const MOTIONS=Object.keys(SPRITE_CLIPS) as Motion[];

/** Animation key per motion (single sheet) or per motion and facing (4-direction atlas) of one texture. */
interface AnimSet {
  single?:Record<Motion,string>;
  facing?:Record<Motion,Record<Facing,string>>;
}
/** Everything about one class's sheet that does not change per frame: keys, scale, figure, animation names. */
interface Sheet extends AnimSet {
  key:string;
  cardinals?:Sheet;
  directional?:DirectionalSheet;
  /** The atlas comes from the art v2 index (sprite-sheets.ts importedSheet): a failed download falls back to today's. */
  imported?:boolean;
  scale:number;
  figure?:FigureBox;
  /** City mode (contorno-breu): the cells' figure box (cropped copies hold only it; null = whole cell). */
  crop?:CellCrop|null;
  /** City mode (contorno-breu): the animations made on the sheet's current Breu-ring copy `key` (same frames). */
  city?:AnimSet&{key:string};
}

export class CharacterSprites {
  /**
   * World px multiplier on every sheet's 96 px figure: framing.ts CITY_VIEW_SCALE in the city, so the hero draws ≈56 CSS
   * px (≈1 cell) under the city zoom (D-030); 1 on the island and the endless map. The next animate() applies a change.
   * animate() draws it × HERO_DRAW_SCALE on top (render/draw-scale.ts: the heroes 20% smaller, the camera unchanged).
   */
  viewScale=1;
  private requested=new Set<string>();
  private sheets=new Map<string,Sheet>();
  /** Fallback boxes measured from the texture (only a sheet the catalog does not measure; see measure()). */
  private measured=new Map<string,FigureBox|null>();
  /** Pages the pixel worker is measuring (key → this request). */
  private measuring=new Map<string,object>();
  /** Classes whose imported v2 atlas failed to download: they keep today's sheet for the session. */
  private failed=new Set<string>();
  private cardinalOriginal=new Set<string>();
  private cardinalFailed=new Set<string>();
  private watching=false;
  private sheet(id:string):Sheet{
    let sheet=this.sheets.get(id);
    if(!sheet){
      const today=directionalSheets.get(id),directional=this.failed.has(id)?today:directionalSheet(id),catalog=spriteCatalog[id];
      sheet={key:directional?`sprite:${id}:dir4`:`sprite:${id}`,directional,imported:!!directional&&directional!==today,scale:96/(directional?.height??catalog?.height??96),figure:directional?directional.figure:catalog?.figure};
      const card=directional?.cardinals;
      if(card&&!this.cardinalFailed.has(id)){
        const url=this.cardinalOriginal.has(id)?originalUrl(card.url)??card.url:card.url;
        sheet.cardinals={key:`sprite:${id}:dir4c`,directional:{url,height:directional.height,figure:card.figure},
          imported:true,scale:sheet.scale,figure:card.figure};
      }
      this.sheets.set(id,sheet);
    }
    return sheet;
  }
  /**
   * Where the figure really is in its frame (alpha > 20), all animation frames (and facings) together, so the hero's
   * screen box is the character and not the frame's empty margin (UX-zonas-tela audit, follow camera). The importer
   * measures it into the catalog, so no pixels are read during a match.
   */
  private pageFigure(sheet:Sheet):FigureBox|undefined{return sheet.figure??this.measured.get(sheet.key)??undefined;}
  figure(id:string):FigureBox|undefined{
    const sheet=this.sheet(id),a=this.pageFigure(sheet),b=sheet.cardinals&&this.pageFigure(sheet.cardinals);
    let result=a&&b?{left:Math.min(a.left,b.left),right:Math.max(a.right,b.right),top:Math.min(a.top,b.top),bottom:Math.max(a.bottom,b.bottom)}:a??b;
    const detailed=movement128Figure(id);
    if(detailed)result=result?{left:Math.min(result.left,detailed.left),right:Math.max(result.right,detailed.right),top:Math.min(result.top,detailed.top),bottom:Math.max(result.bottom,detailed.bottom)}:detailed;
    return result;
  }
  /**
   * figure(id) in the px of the frame `sprite` shows now: the same box, or mapped onto the padded, resampled cell when
   * the sprite shows its city copy (contorno-breu), so frame size × origin × scale still give the figure's world box.
   */
  figureIn(sprite:Phaser.GameObjects.Sprite,id:string):FigureBox|undefined{
    const f=this.states.get(sprite)?.stream?.figure??this.figure(id),copy=f&&this.city?.copyOf(sprite.texture.key);
    if(!f||!copy)return f;
    const g=copy.geom;
    return {left:copyX(g,f.left),right:copyX(g,f.right),top:copyY(g,f.top),bottom:copyY(g,f.bottom)};
  }
  /**
   * Fallback for a sheet without a catalog box: reads the pixels once, when the file arrives (load event, not the
   * frame loop). A 4-direction atlas is 1152×2304 (≈ 2.7 M pixels, ~270 ms on a 4× phone), hence the catalog; the
   * pixel worker reads it when there is one (the 8-direction `dir4c` atlases come without a box: card pior-quadro-2s).
   */
  private measure(id:string){
    const root=this.sheet(id);
    for(const sheet of [root,...(root.cardinals?[root.cardinals]:[])])this.measurePage(sheet);
  }
  private measurePage(sheet:Sheet){
    if(sheet.figure||this.measured.has(sheet.key)||this.measuring.has(sheet.key)||!this.scene.textures.exists(sheet.key))return;
    let box:FigureBox|null=null;
    try{
      const image=this.scene.textures.get(sheet.key).getSourceImage() as CanvasImageSource&{width:number;height:number};
      const off=figureOffThread(image,192);
      if(off){
        const token={};this.measuring.set(sheet.key,token);
        // A page forgotten meanwhile (failed download, rejectPage) drops the late box.
        void off.then(b=>{if(this.measuring.get(sheet.key)!==token)return;this.measuring.delete(sheet.key);this.measured.set(sheet.key,b);});
        return;
      }
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(ctx){
        ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let left=192,top=192,right=-1,bottom=-1;
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]>20){
          const fx=x%192,fy=y%192;if(fx<left)left=fx;if(fx>right)right=fx;if(fy<top)top=fy;if(fy>bottom)bottom=fy;
        }
        if(right>=left)box={left,top,right:right+1,bottom:bottom+1};
      }
    }catch{box=null;}
    this.measured.set(sheet.key,box);
  }
  private states=new WeakMap<Phaser.GameObjects.Sprite,{motion:SpriteMotion;hurt:HurtGate;walk:WalkGate;facing:FacingTracker;eight:Facing8Tracker;x:number;y:number;shown?:Motion;side?:string;swingShown?:number;phaseMotion?:Motion;phaseStarted?:number;cycles:number;gait?:Gait;stream?:Movement128Plan;hand?:HandFrame}>();
  private detailed?:Movement128Textures<Phaser.GameObjects.Sprite>;
  private detailedPreloads=new Map<string,Movement128Plan>();
  private preloadCleanup=false;
  /**
   * `city`: the scene's screen-scale Breu outlines (card contorno-breu, render/city-outline.ts). In city mode every
   * sheet draws its Breu-ring copy with the same frames and animations; omitted or outside the city, the sheet itself.
   */
  private scene:Phaser.Scene;
  private city?:CityOutlines;
  constructor(scene:Phaser.Scene,city?:CityOutlines){this.scene=scene;this.city=city;}
  /** Each class's feet line for its detailed clips (hero-feet.ts heroFeetY: idle + the walks; M16's 5 drawn of each). */
  private feet=new Map<string,number|undefined>();
  private feetY(id:string){
    if(!this.feet.has(id))this.feet.set(id,heroFeetY([...movementSheets(id,'idle'),...movementSheets(id,'walk')]));
    return this.feet.get(id);
  }
  queue(id:string){
    const idle=movementSheets(id,'idle');
    if(idle.length){for(const plan of idle)this.queueDetailed(plan);return;}
    this.queueLegacy(id);
  }
  /**
   * This player's own walk in the 8 directions (card preload-heroi-primeiro), loaded with the scene's preload so the
   * match opens with them as Phaser textures and the first step adopts one (Movement128Textures `available`) instead of
   * sliding in the resting pose while a 1536×768 clip downloads and decodes. Own hero only: 8 sheets (~38 MB of GPU),
   * outside the shared LRU until a step adopts them; the ones never walked are freed with the scene.
   */
  queueOwnWalk(id:string){
    for(const plan of movementSheets(id,'walk'))this.queueDetailed(plan);
    // The flinch (animacao-receber-dano): 5 small sheets, there for the first hit.
    const seen=new Set<string>();
    for(const d of HERO_DIRECTIONS){const plan=hurtPlan(id,d);if(plan&&!seen.has(plan.key)){seen.add(plan.key);this.queueDetailed(plan);}}
  }
  private queueDetailed(plan:Movement128Plan){
    const cache=this.detailed??=movement128Textures(this.scene,this.city);
    if(this.scene.textures.exists(plan.key)||cache.status(plan.key)||this.requested.has(plan.key))return;
    this.requested.add(plan.key);this.detailedPreloads.set(plan.key,plan);
    this.scene.load.spritesheet(plan.key,plan.url,{frameWidth:96,frameHeight:96,endFrame:plan.frameCount-1});
    if(!this.preloadCleanup){
      this.preloadCleanup=true;
      const cleanup=()=>{
        for(const key of this.detailedPreloads.keys())if(!cache.status(key)&&this.scene.textures.exists(key)){
          const image=this.scene.textures.get(key).getSourceImage() as HTMLImageElement|ImageBitmap;
          this.scene.textures.remove(key);freeSheet(image);
        }
        for(const key of this.detailedPreloads.keys())this.requested.delete(key);
        this.detailedPreloads.clear();this.detailed=undefined;this.preloadCleanup=false;
        this.scene.events.off('shutdown',cleanup);this.scene.events.off('destroy',cleanup);
      };
      this.scene.events.once('shutdown',cleanup);this.scene.events.once('destroy',cleanup);
    }
  }
  private queueLegacy(id:string){
    if(!spriteCatalog[id])return;
    const root=this.sheet(id);
    for(const sheet of [root,...(root.cardinals?[root.cardinals]:[])])this.queuePage(id,sheet);
  }
  private queuePage(id:string,sheet:Sheet){
    const {key,directional}=sheet;
    if(this.requested.has(key))return;
    this.requested.add(key);
    if(this.scene.textures.exists(key)){this.measure(id);return;}
    // The figure box is read when the sheet arrives (loading time), never in the middle of a frame (review onda 4).
    this.scene.load.once(`filecomplete-spritesheet-${key}`,()=>this.measure(id));
    this.scene.load.once('complete',()=>{
      // Image decoding failures (for example an HTML 200 fallback) do not emit
      // Phaser's loaderror. A completed request without a texture failed too.
      if(sheet.imported&&this.requested.has(key)&&!this.scene.textures.exists(key))this.rejectPage(key);
      this.measure(id);
    });
    if(sheet.imported)this.watchErrors();
    this.scene.load.spritesheet(key,directional?.url??spriteUrl(id),{frameWidth:192,frameHeight:192});
  }
  /** An imported atlas that fails (missing in a deploy, bad cache) is forgotten: the next animate() asks today's sheet. */
  private watchErrors(){
    if(this.watching)return;
    this.watching=true;
    // Phaser.Loader.Events.FILE_LOAD_ERROR ('loaderror'; Phaser is imported as a type only here).
    this.scene.load.on('loaderror',(file:Phaser.Loader.File)=>this.rejectPage(file.key));
  }
  private rejectPage(key:string){
    for(const [id,sheet] of this.sheets){
      if(sheet.cardinals?.key===key){
        // Old installs have the lossless cardinals but no lite copy yet. Retry
        // that original once; a broken original keeps the working diagonals.
        if(!this.cardinalOriginal.has(id)&&originalUrl(sheet.cardinals.directional!.url))this.cardinalOriginal.add(id);
        else this.cardinalFailed.add(id);
        this.sheets.delete(id);this.requested.delete(key);this.measured.delete(key);this.measuring.delete(key);
        break;
      }
      if(sheet.imported&&key===sheet.key){
        this.failed.add(id);this.sheets.delete(id);this.requested.delete(sheet.key);this.measured.delete(sheet.key);this.measuring.delete(sheet.key);
        break;
      }
    }
  }
  /**
   * Creates the class's animations once and keeps their keys (no string building or lookups per frame), on the sheet
   * or on its city copy `texture` (same frame numbers; the copy's animations go with it, render/city-outline.ts drop).
   */
  private animations(sheet:Sheet,texture=sheet.key,into:AnimSet=sheet){
    const make=(name:Motion,key:string,offset:number)=>{
      const clip=SPRITE_CLIPS[name];
      if(!this.scene.anims.exists(key))this.scene.anims.create({key,frames:this.scene.anims.generateFrameNumbers(texture,{frames:clip.frames.map(f=>f+offset)}),frameRate:clip.frameRate,repeat:clip.repeat});
      return key;
    };
    if(sheet.directional){
      const all={} as Record<Motion,Record<Facing,string>>;
      for(const name of MOTIONS){all[name]={} as Record<Facing,string>;FACINGS.forEach((f,i)=>{all[name][f]=make(name,`${texture}:${name}:${f}`,i*FACING_FRAMES);});}
      into.facing=all;
    }else{
      const all={} as Record<Motion,string>;
      for(const name of MOTIONS)all[name]=make(name,`${texture}:${name}`,0);
      into.single=all;
    }
  }
  /**
   * The weapon hand of the pose `sprite` shows (card arma-na-mao-viciado): the measured point of its M16 frame
   * (hand-points.ts) and how that frame is drawn. Undefined for a clip without measured hands (the legacy sheets, R06,
   * a class not measured yet): render/arsenal-fx.ts then keeps the weapon sticker at the hero's side.
   */
  /** The walk `sprite` shows this frame (footsteps.ts steps on its contacts); undefined while it does not walk. */
  gait(sprite:Phaser.GameObjects.Sprite):Gait|undefined{return this.states.get(sprite)?.gait;}
  handPose(sprite:Phaser.GameObjects.Sprite):HandPose|undefined{
    const h=this.states.get(sprite)?.hand,point=h&&handPoint(h.url,h.frame);
    return h&&point?{point,ox:h.ox,oy:h.oy,scale:h.scale,flip:h.flip,direction:h.direction,...(h.geom?{geom:h.geom}:{})}:undefined;
  }
  /**
   * `intent` (local hero only): the world direction the hero is sent to walk this step (joystick or route), so its
   * drawing never turns on a reconciliation snap; remote figures leave it out and turn by their displacement.
   * `push` (card empurrar-uno): the world direction to the Uno while this hero pushes it (ObjectiveView.car.movers, not
   * the rope): a class with a push16 faces it and plays the push by the ground walked (its pose held while the car is
   * stuck); the others keep their walk.
   * `hp` (card animacao-receber-dano): the hero's hit points; a drop while it rests plays its hurt16 flinch (HurtGate).
   */
  animate(sprite:Phaser.GameObjects.Sprite,id:string,x:number,y:number,attackTick=0,alive=true,view=0,intent?:{x:number;y:number},push?:{x:number;y:number},hp?:number,
    /** Where the body looks instead of the stick (world): the phone's aim stick while it fires (tiro-na-direcao-mobile). */
    look?:{x:number;y:number}){
    watchOrphans(this.scene);
    const root=this.sheet(id);
    let state=this.states.get(sprite);
    if(!state){state={motion:new SpriteMotion(),hurt:new HurtGate(),walk:new WalkGate(),facing:new FacingTracker(),eight:new Facing8Tracker(),x,y,cycles:0};this.states.set(sprite,state);}
    const dx=x-state.x,dy=y-state.y,moving=state.walk.update(this.scene.time.now,Math.hypot(dx,dy)>.001,intent);
    const motion=state.motion.update(this.scene.time.now,moving,attackTick,alive);
    if(state.phaseMotion!==motion||state.phaseStarted===undefined||this.scene.time.now<state.phaseStarted){state.phaseMotion=motion;state.phaseStarted=this.scene.time.now;state.cycles=0;}
    // Each hit restarts the swing from its first frame (ataque-1s), even when the last one was still showing.
    const swing=state.motion.swing,newSwing=motion==='attack'&&state.swingShown!==swing.start;
    if(motion==='attack')state.phaseStarted=swing.start;
    state.x=x;state.y=y;
    const pushing=!!push&&alive&&motion!=='attack'&&hasPush16(id),face=pushing?push:look??intent;
    const legacyFacing=state.facing.update(dx,dy,view,face),direction=state.eight.update(dx,dy,view,face);
    const seen=movement128Visible(sprite,this.scene);
    // A hit while resting flinches (its first and last poses are the rest's); the rest then starts over from its pose 0.
    const hurt=state.hurt.update(this.scene.time.now,hp,alive&&motion==='idle'&&!pushing),flinch=hurt!==undefined&&seen?hurtPlan(id,direction):undefined;
    if(flinch)state.phaseStarted=this.scene.time.now;
    const detailed=alive&&seen?flinch??(pushing?pushPlan(id,direction):movementPlan(id,motion,direction)):undefined;
    // The walk follows the ground walked (passo-sem-deslizar), every sheet alike: each draws its figure 96 px tall × the
    // view scale × HERO_DRAW_SCALE (detailed 96/height, legacy sheet.scale), and the cycle runs on while a clip loads.
    // A class that runs (run16, HERO_GAIT) keeps its foot locked (passo-3x-mais-lento): at its phase table's stride when
    // the clip has one, else RUN_STRIDE.
    if(motion==='walk'){
      const figurePx=96*this.viewScale*HERO_DRAW_SCALE,phase=detailed?.phase;
      state.cycles+=phase?walkCycles(dx,dy,view,figurePx,phaseStride(phase),1):heroRuns(id)?walkCycles(dx,dy,view,figurePx,RUN_STRIDE,1):walkCycles(dx,dy,view,figurePx);
      state.gait={cycles:state.cycles,contacts:phase?phaseContacts(phase):LOOP_CONTACTS,since:state.phaseStarted!};
    }else state.gait=undefined;
    if(detailed){
      const cache=this.detailed??=movement128Textures(this.scene,this.city);
      if(cache.request(sprite,detailed)){
        const scale=96/detailed.height*this.viewScale*HERO_DRAW_SCALE;
        // The walk by the ground walked, attack and rest by the clock. A run with a phase table picks its pose by the
        // ground and shifts the sprite back by the planted foot's travel within the pose: the foot stays on its spot.
        // The push likewise (empurrar-uno): its pose by the ground walked, held while the car does not move.
        const run=(motion==='walk'||pushing)&&detailed.phase?runPhase(detailed.phase,state.cycles):undefined;
        const frame=run?run.frame:motion==='walk'&&detailed.loop?cycleFrame(state.cycles,detailed.frameCount):
          flinch?swingFrame(detailed,hurt!):motion==='attack'?swingFrame(detailed,(this.scene.time.now-swing.start)/swing.ms):movementFrame(detailed,direction,this.scene.time.now-state.phaseStarted);
        const copy=this.city?.variant(detailed.key,scale,cropOf(detailed.figure,96,96));
        const key=copy?.key??detailed.key;
        if(!state.stream||sprite.anims.isPlaying)sprite.anims.stop();
        if(sprite.texture.key!==key)sprite.setTexture(key,frame);else if(Number(sprite.frame.name)!==frame)sprite.setFrame(frame);
        // The feet (BUG sombra/silhueta 20/10): the clip's anchor (0.875) sits under the art's feet (0.66–0.79 of the
        // cell), so the hero floated over its ring, its contact shadow and its silhouette; its figure's bottom is the feet.
        // M16's E/NE/SE are W/NW/SW mirrored: Phaser flips inside the frame's box (city copy included, its crop is
        // symmetric), so the body's pivot column goes to 1 − x and the figure stays on the same world point.
        // The run's foot shift moves the origin the other way (in the unmirrored cell; the flip below mirrors it too).
        const flip=!!detailed.flip,ax=movementPivotX(detailed)-(run?run.shift[0]/96:0),ay=(clipFeetY(detailed.original)??this.feetY(id)??detailedFeetY(detailed))-(run?run.shift[1]/96:0);
        const origin=copy?variantOrigin(copy.geom,ax,ay):{x:ax,y:ay};
        if(flip)origin.x=1-origin.x;
        sprite.setOrigin(origin.x,origin.y).setScale(copy?scale*copy.geom.kx:scale,copy?scale*copy.geom.ky:scale).setFlipX(flip).setFlipY(false);
        setBareFrame(sprite,copy?{key:detailed.key,ox:flip?1-ax:ax,oy:ay,sx:scale,sy:scale}:undefined);
        // Both hands on the Uno (empurrar-uno): the weapon is put away at the hero's side (arsenal-fx), measured or not.
        state.hand=pushing?undefined:{url:detailed.original,frame,ox:ax,oy:ay,scale,flip,direction,...(copy?{geom:copy.geom}:{})};
        state.stream=detailed;state.shown=motion;state.side=direction;state.swingShown=motion==='attack'?swing.start:state.swingShown;cache.bind(sprite,detailed.key);return;
      }
      // A pending rest, turn or attack keeps the last oblique pose and its lease; a failed/missing clip uses legacy.
      if(cache.status(detailed.key)!=='failed'){
        sprite.anims.stop();state.shown=motion;state.side=direction;return;
      }
    }
    if(!this.scene.textures.exists(root.key)||(root.cardinals&&!this.scene.textures.exists(root.cardinals.key))){
      // Off camera the legacy sheets (~0.8–1 MB a class) are not worth asking for (card heroi-fora-da-tela-sem-folha-
      // legada: −2.8 s on a cold opening with 2 bots): hold the last pose and its lease; the clip comes back on camera.
      if(!seen&&sprite.visible!==false&&sprite.active!==false&&sprite.alpha!==0){sprite.anims.stop();return;}
      this.queueLegacy(id);if(!this.scene.load.isLoading()&&this.scene.load.list.size)this.scene.load.start();
      if(!this.scene.textures.exists(root.key))return;
    }
    const eight=!!root.cardinals&&this.scene.textures.exists(root.cardinals.key),page=HERO_DIRECTION_PAGE[direction];
    const sheet=eight&&page.page==='dir4c'?root.cardinals!:root;
    const facing=eight?FACINGS[page.block]:legacyFacing,side=eight?direction:legacyFacing;
    if(!sheet.single&&!sheet.facing)this.animations(sheet);
    // × HERO_DRAW_SCALE: heroes draw 20% under the 96 px reference figure (the camera still frames the reference).
    const scale=sheet.scale*this.viewScale*HERO_DRAW_SCALE;
    // City mode (contorno-breu): the sheet's Breu-ring copy at screen scale, shown with the inverse scale and the
    // padded origin so the figure keeps its size and feet; its animations are made once per copy.
    if(this.city&&sheet.crop===undefined)sheet.crop=cropOf(this.pageFigure(sheet),192,192)??null;
    const copy=this.city?.variant(sheet.key,scale,sheet.crop??undefined);
    if(copy&&sheet.city?.key!==copy.key){const set:AnimSet&{key:string}={key:copy.key};this.animations(sheet,copy.key,set);sheet.city=set;}
    const key=copy?copy.key:sheet.key,sx=copy?scale*copy.geom.kx:scale,sy=copy?scale*copy.geom.ky:scale,anims:AnimSet=copy&&sheet.city?sheet.city:sheet;
    setBareFrame(sprite,copy?{key:sheet.key,ox:.5,oy:.88,sx:scale,sy:scale}:undefined);
    if(sprite.texture.key!==key){
      sprite.setTexture(key,0);
      if(copy){const o=variantOrigin(copy.geom,.5,.88);sprite.setOrigin(o.x,o.y);}else sprite.setOrigin(.5,.88);
      sprite.setScale(sx,sy);
      // A 4-direction atlas draws its left side itself: no mirror (single sheets keep the flip they had).
      if(sheet.directional)sprite.setFlipX(false);
    }else if(sprite.scaleX!==sx||sprite.scaleY!==sy)sprite.setScale(sx,sy);
    if(anims.facing){
      // Remote allies come here with their interpolated positions, so their facing follows the interpolated velocity.
      // A turn in the middle of a clip keeps its progress: the walk cycle or the swing goes on in the new drawing.
      const turning=state.shown===motion&&state.side!==side&&!newSwing;
      const progress=turning?sprite.anims.getProgress():0;
      sprite.play(anims.facing[motion][facing],!newSwing);
      if(turning)sprite.anims.setProgress(progress);
      state.shown=motion;state.side=side;
    }else{
      sprite.setFlipX(legacyFlip(sprite.flipX,dx,dy,view));
      sprite.play(anims.single![motion],!newSwing);
    }
    // A swing squeezed into a faster weapon's period plays its clip that much faster (ataque-1s).
    sprite.anims.timeScale=motion==='attack'?ATTACK_VISUAL_MS/swing.ms:1;
    if(motion==='attack')state.swingShown=swing.start;
    // The legacy walk too follows the ground walked: its 6 frames by the cycle, the clip held (passo-sem-deslizar).
    if(motion==='walk'&&alive){
      sprite.anims.pause();sprite.anims.setProgress(cycleFrame(state.cycles,SPRITE_CLIPS.walk.frames.length)/(SPRITE_CLIPS.walk.frames.length-1));
    }else if(!alive)sprite.anims.pause();else sprite.anims.resume();
    // Switch to the legacy sheet first, then release the detailed atlas and its derived city copies safely.
    state.hand=undefined;
    if(state.stream||this.detailed){state.stream=undefined;if(detailed)this.detailed?.unbind(sprite);else this.detailed?.release(sprite);}
  }
}
