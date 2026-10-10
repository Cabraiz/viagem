/**
 * Pooled render layers for the horde run: enemies, pickups, projectiles, telegraphs and comic FX.
 * Steady state creates and destroys no GameObjects; pools grow only when demand exceeds their history.
 */
import Phaser from 'phaser';
import type {RunView,EnemyView,PickupView,ProjectileView,TelegraphView} from '../sim/view.ts';
import type {SimEvent} from '../sim/types.ts';
import {ENEMY_ART,ELITE_SCALE,FX,enemyKind,enemyTexture,pickupTexture,type EnemyKind} from './keys.ts';
import {ensureHordeTextures} from './textures.ts';
import {KeyedPool,Ring} from './pool.ts';
import {squash,gemBounce,hitFlash,poof,popText,damageFloat,telegraphPulse,telegraphBlink,hashPhase,
  POP_TEXT_MS,type Scale2,type PoofFrame,type TextFrame} from './motion.ts';
import {deathLine,kindStyle,damageLabel} from './jokes.ts';
import type {Projector} from './projector.ts';
import {OUTLINE_MAX_POINTS,insetPolygon,telegraphOutline} from './telegraph-shape.ts';
import {FX_BUDGET,RecentHits,admitNumber,admitPop,barVisible,canMerge,evictionIndex,numberPriority,type EffectsProfile,type FxBudget} from './legibility.ts';

type Pt={x:number;y:number};
type Image=Phaser.GameObjects.Image;
type Text=Phaser.GameObjects.Text;
type TextStyle=Phaser.Types.GameObjects.Text.TextStyle;

export interface HordeRendererOptions{
  /** Allocation-free camera projection; the host updates projector.view on rotation, then calls refresh(). */
  projector:Projector;
  /** Screen-legibility multiplier for text, bars and markers (e.g. clamp(0.55/zoom,1,2.5) on a phone). Default 1. */
  uiScale?:()=>number;
  reduced?:boolean;
  /** 'reduced' trims numbers, pops, stars and bubbles (settings, VGM-057). Default 'full'. */
  effects?:EffectsProfile;
  /** ms per sim tick, default 50 */
  tickMs?:number;
  /** ms between authoritative pushes (the room broadcasts every 2 ticks); enemies and pickups glide over it. Default tickMs. */
  pushMs?:number;
  /** World position of a player, so hostile damage numbers can appear over them. */
  locate?:(id:string)=>Pt|undefined;
  /** Id of the local player: only damage on them is a priority number (allies' hits are plain). Omitted = every player hit is. */
  selfId?:()=>string|undefined;
}

interface EnemyActor{
  image:Image;shadow:Image;barBg:Image;barFill:Image;barKey:string;id:string;kind:EnemyKind;elite:boolean;boss:boolean;hp:number;maxHp:number;hitAt:number;
  px:number;py:number;nx:number;ny:number;x:number;y:number;
  phase:number;flashAt:number;flashing:boolean;screenX:number;flip:boolean;moving:boolean;
}
interface PickupActor{image:Image;shadow:Image;kind:string;value:number;born:number;phase:number;px:number;py:number;nx:number;ny:number;x:number;y:number}
interface ProjectileActor{image:Image;shadow:Image;x:number;y:number;vx:number;vy:number;radius:number;hostile:boolean;angle:number}
/** width: undefined = server default (D-015: cone = full aperture in radians, line = thickness). */
interface TelegraphState{shape:TelegraphView['shape'];x:number;y:number;radius:number;dx:number;dy:number;width:number|undefined;fireTick:number;start:number}
interface NumberFx{text:Text;born:number;x:number;y:number;lift:number;jitter:number;live:boolean;target:string;total:number;crit:boolean;hostile:boolean;priority:boolean;self:boolean}
interface PopFx{text:Text;born:number;x:number;y:number;lift:number;rotation:number}
interface PoofFx{image:Image;born:number;x:number;y:number;lift:number;scale:number}
interface StarFx{image:Image;born:number;x:number;y:number;lift:number;vx:number;vy:number;spin:number}
interface BubbleFx{text:Text;born:number;enemy:string;x:number;y:number;lift:number}
interface WarningFx{image:Image;born:number;x:number;y:number;atTick:number;size:number}

export const CAPS={damage:FX_BUDGET.full.numbers,pops:7,poofs:24,stars:120,bubbles:3,warnings:16} as const;
const TAU=Math.PI*2;
const FONT='system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SNAP_UNITS=3;
const BUBBLE_MS=2200,BUBBLE_GAP_MS=1950;
const STAR_MS=640;
const PROJECTILE_LIFT=18;

const DAMAGE_STYLE:TextStyle={fontFamily:FONT,fontSize:'24px',fontStyle:'900',color:'#ffffff',stroke:'#2b2233',strokeThickness:5};
const CRIT_STYLE:TextStyle={fontFamily:FONT,fontSize:'32px',fontStyle:'900',color:'#ffd84a',stroke:'#3a2440',strokeThickness:6};
const HURT_STYLE:TextStyle={fontFamily:FONT,fontSize:'26px',fontStyle:'900',color:'#ff6b6b',stroke:'#2b1620',strokeThickness:5};
const BUBBLE_STYLE:TextStyle={fontFamily:FONT,fontSize:'20px',fontStyle:'700',color:'#51425e',backgroundColor:'#fff8ec',padding:{x:10,y:6},align:'center',wordWrap:{width:280}};
const popStyles=new Map<string,TextStyle>();
const popStyle=(kind:string)=>{
  const key=enemyKind(kind)===kind?kind:'generic';
  let style=popStyles.get(key);
  if(!style){const k=kindStyle(kind);style={fontFamily:FONT,fontSize:'34px',fontStyle:'900',color:k.fill,stroke:k.stroke,strokeThickness:9};popStyles.set(key,style);}
  return style;
};
/** One texture upload per change, even when the label repeats. */
const painted=new WeakMap<Text,TextStyle>();
const paint=(text:Text,style:TextStyle,label:string)=>{
  if(painted.get(text)!==style){
    painted.set(text,style);
    // Measure each style once (pixel read-back), then reuse its metrics: a 24px number reused as a 32px crit is not clipped.
    if(style.metrics)text.style.setStyle(style,false);
    else{text.setStyle(style);const m=text.style.getTextMetrics();style.metrics={ascent:m.ascent,descent:m.descent,fontSize:m.fontSize};}
    if(text.text===label){text.updateText();return;}
  }
  if(text.text!==label)text.setText(label);
};
const SHADOW_W=46,SHADOW_H=16,BAR_W=46,BAR_H=13,FILL_W=40,FILL_H=7;
/** New low-priority damage numbers per authoritative frame; the rest are dropped to keep text uploads bounded. */
export const NUMBERS_PER_PUSH=FX_BUDGET.full.numbersPerPush;
/** Telegraph outlines sit above every enemy, bar, number and bubble: danger is never hidden. */
export const TELEGRAPH_TOP_DEPTH=99000;
/** Width of the telegraph's outer (light) stroke at UI scale 1, in world px; the red core is half of it. */
export const TELEGRAPH_STROKE=8;

export class HordeRenderer{
  private scene:Phaser.Scene;
  private options:HordeRendererOptions;
  private reduced:boolean;
  private tickMs:number;
  private pushMs:number;
  private objects:Phaser.GameObjects.GameObject[]=[];
  private ground:Phaser.GameObjects.Graphics;
  private overlay:Phaser.GameObjects.Graphics;
  private top:Phaser.GameObjects.Graphics;
  private fx:FxBudget;
  /** Latest number per target, for merging hits inside DAMAGE_MERGE_MS. */
  private numberByTarget=new Map<string,NumberFx>();
  /** The most recently hit enemies: the only plain ones that keep a health bar. */
  private recentHits:RecentHits;
  private enemies:KeyedPool<EnemyActor>;
  private pickups:KeyedPool<PickupActor>;
  private projectiles:KeyedPool<ProjectileActor>;
  private telegraphs:KeyedPool<TelegraphState>;
  private numbers:Ring<NumberFx>;
  private pops:Ring<PopFx>;
  private poofs:Ring<PoofFx>;
  private stars:Ring<StarFx>;
  private bubbles:Ring<BubbleFx>;
  private warnings:Ring<WarningFx>;
  private now=0;
  private ui=1;
  private numbersThisPush=0;
  private q:Pt={x:0,y:0};
  private pushAt=0;
  private viewTick=0;
  private frac=1;
  private nowTick=0;
  private lastEventId=-1;
  private lastBubbleAt=-Infinity;
  private targetId?:string;
  private snapNext=false;
  private at:Pt={x:0,y:0};
  private pts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  private ptsIn:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  private scale2:Scale2={sx:1,sy:1};
  private poofFrame:PoofFrame={scale:0,alpha:0,done:false};
  private textFrame:TextFrame={y:0,scale:1,alpha:1,done:false};

  constructor(scene:Phaser.Scene,options:HordeRendererOptions){
    this.scene=scene;this.options=options;this.reduced=!!options.reduced;this.tickMs=options.tickMs??50;this.pushMs=Math.max(1,options.pushMs??this.tickMs);
    this.fx=FX_BUDGET[options.effects??'full'];this.recentHits=new RecentHits(this.fx.bars);
    ensureHordeTextures(scene);
    this.ground=this.track(scene.add.graphics().setDepth(-9970));
    this.overlay=this.track(scene.add.graphics().setDepth(95000));
    this.top=this.track(scene.add.graphics().setDepth(TELEGRAPH_TOP_DEPTH));
    const image=(key:string)=>()=>this.track(scene.add.image(0,0,key).setVisible(false).setActive(false));
    const text=(style:TextStyle,depth:number)=>()=>this.track(scene.add.text(0,0,'',style).setOrigin(.5,1).setDepth(depth).setVisible(false).setActive(false));
    const showImage=(o:{image:Image},active:boolean)=>{
      o.image.setVisible(active).setActive(active);
      if(!active)o.image.clearTint().setAlpha(1).setScale(1).setRotation(0).setFlipX(false);
    };
    const shadow=()=>this.track(scene.add.image(0,0,FX.shadow).setDepth(-9980).setVisible(false).setActive(false));
    const bar=(key:string,depth:number)=>this.track(scene.add.image(0,0,key).setOrigin(0,0).setDepth(depth).setVisible(false).setActive(false));
    const showActor=(o:{image:Image;shadow:Image},active:boolean)=>{showImage(o,active);o.shadow.setVisible(active).setActive(active);};
    const showEnemy=(o:EnemyActor,active:boolean)=>{showActor(o,active);if(!active){o.barBg.setVisible(false);o.barFill.setVisible(false);}};
    const showText=(o:{text:Text},active:boolean)=>{o.text.setVisible(active).setActive(active);if(!active)o.text.setAlpha(1).setScale(1).setRotation(0);};
    this.enemies=new KeyedPool<EnemyActor>(()=>({image:image(enemyTexture('gosma'))(),shadow:shadow(),barBg:bar(FX.bar,95000),barFill:bar(FX.barFill,95001),barKey:FX.bar,id:'',kind:'gosma',elite:false,boss:false,hp:1,maxHp:1,hitAt:-1e9,
      px:0,py:0,nx:0,ny:0,x:0,y:0,phase:0,flashAt:-1e9,flashing:false,screenX:NaN,flip:false,moving:false}),showEnemy);
    this.pickups=new KeyedPool<PickupActor>(()=>({image:image(pickupTexture('xp'))(),shadow:shadow(),kind:'xp',value:1,born:0,phase:0,px:0,py:0,nx:0,ny:0,x:0,y:0}),showActor);
    this.projectiles=new KeyedPool<ProjectileActor>(()=>({image:image(FX.projFriendly)(),shadow:shadow(),x:0,y:0,vx:0,vy:0,radius:.2,hostile:false,angle:0}),showActor);
    this.telegraphs=new KeyedPool<TelegraphState>(()=>({shape:'circle' as TelegraphView['shape'],x:0,y:0,radius:1,dx:1,dy:0,width:undefined,fireTick:0,start:0}),()=>{});
    this.numbers=new Ring<NumberFx>(()=>({text:text(DAMAGE_STYLE,95500)(),born:0,x:0,y:0,lift:0,jitter:0,live:false,target:'',total:0,crit:false,hostile:false,priority:false,self:false}),showText,CAPS.damage);
    this.pops=new Ring(()=>({text:text(popStyle('gosma'),95800)(),born:0,x:0,y:0,lift:0,rotation:0}),showText,CAPS.pops);
    this.poofs=new Ring(()=>({image:image(FX.puff)(),born:0,x:0,y:0,lift:0,scale:1}),showImage,CAPS.poofs);
    this.stars=new Ring(()=>({image:image(FX.star)(),born:0,x:0,y:0,lift:0,vx:0,vy:0,spin:0}),showImage,CAPS.stars);
    this.bubbles=new Ring(()=>({text:text(BUBBLE_STYLE,96000)(),born:0,enemy:'',x:0,y:0,lift:0}),showText,CAPS.bubbles);
    this.warnings=new Ring(()=>({image:image(FX.warning)(),born:0,x:0,y:0,atTick:0,size:1}),showImage,CAPS.warnings);
  }

  /** Feed a new authoritative view (≈20 Hz). Processes view.events once each by eventId. */
  push(view:RunView){
    if(view.tick<this.viewTick)this.lastEventId=-1; // new run or server restart
    this.viewTick=view.tick;this.pushAt=this.now;this.numbersThisPush=0;
    // Sync first and retire after the events, so damage on a just-spawned or just-killed enemy still finds its actor.
    this.enemies.begin();
    for(let i=0;i<view.enemies.length;i++)if(view.enemies[i].hp>0)this.syncEnemy(view.enemies[i]);
    for(let i=0;i<view.events.length;i++){
      const event=view.events[i];
      if(event.eventId<=this.lastEventId)continue;
      this.lastEventId=event.eventId;this.handle(event,event.eventId);
    }
    this.enemies.end();
    this.pickups.begin();
    for(let i=0;i<view.pickups.length;i++)this.syncPickup(view.pickups[i]);
    this.pickups.end();
    this.projectiles.begin();
    for(let i=0;i<view.projectiles.length;i++)this.syncProjectile(view.projectiles[i]);
    this.projectiles.end();
    this.telegraphs.begin();
    for(let i=0;i<view.telegraphs.length;i++)this.syncTelegraph(view.telegraphs[i]);
    this.telegraphs.end();
  }

  /** Every frame: interpolate and animate. */
  update(timeMs:number,_deltaMs:number){
    this.now=timeMs;
    const since=Math.max(0,timeMs-this.pushAt)/this.tickMs;
    this.frac=this.snapNext?1:Math.min(1,Math.max(0,timeMs-this.pushAt)/this.pushMs);
    this.nowTick=this.viewTick+Math.min(since,2);
    this.ui=Math.max(.5,Math.min(3,this.options.uiScale?.()??1));
    this.ground.clear();this.overlay.clear();this.top.clear();
    this.telegraphs.forEach(this.drawTelegraph);
    this.enemies.forEach(this.drawEnemy);
    this.pickups.forEach(this.drawPickup);
    this.projectiles.forEach(this.drawProjectile);
    this.warnings.retain(this.drawWarning);
    this.poofs.retain(this.drawPoof);
    this.stars.retain(this.drawStar);
    this.numbers.retain(this.drawNumber);
    this.pops.retain(this.drawPop);
    this.bubbles.retain(this.drawBubble);
    this.snapNext=false;
  }

  /** Camera rotated: options.projector now has the new view; snap everything. */
  refresh(){
    this.enemies.forEach(a=>{a.px=a.nx;a.py=a.ny;a.screenX=NaN;});
    this.pickups.forEach(a=>{a.px=a.nx;a.py=a.ny;});
    this.projectiles.forEach(this.aim);
    this.snapNext=true;this.update(this.now,0);
  }

  setTarget(enemyId?:string){this.targetId=enemyId;}
  /** Follows prefers-reduced-motion changes at runtime. */
  setReduced(reduced:boolean){this.reduced=reduced;}
  /** Effects profile at runtime (settings). Live effects above the new budget fade out on their own. */
  setEffects(profile:EffectsProfile){this.fx=FX_BUDGET[profile];this.recentHits.setCap(this.fx.bars);}
  /** New run or reconnection to a fresh server: accept event ids from the start again. */
  resetEvents(){this.lastEventId=-1;}

  stats(){
    const byLayer:Record<string,{created:number;active:number}>={
      enemies:this.count(this.enemies),pickups:this.count(this.pickups),projectiles:this.count(this.projectiles),
      damage:this.count(this.numbers),pops:this.count(this.pops),poofs:this.count(this.poofs),stars:this.count(this.stars),
      bubbles:this.count(this.bubbles),warnings:this.count(this.warnings),graphics:{created:3,active:3},
    };
    let created=0,active=0;
    for(const key in byLayer){created+=byLayer[key].created;active+=byLayer[key].active;}
    return {created,active,byLayer};
  }

  destroy(){
    this.enemies.clear();this.pickups.clear();this.projectiles.clear();this.telegraphs.clear();
    this.numberByTarget.clear();this.recentHits.clear();this.numbers.clear();this.pops.clear();this.poofs.clear();this.stars.clear();this.bubbles.clear();this.warnings.clear();
    for(const object of this.objects)object.destroy();
    this.objects.length=0;
  }

  // ---------- reconciliation ----------
  private syncEnemy(view:EnemyView){
    const used=this.enemies.use(view.id),a=used.item,kind=enemyKind(view.kind),elite=!!view.elite&&kind!=='chefe';
    if(used.fresh||a.kind!==kind||a.elite!==elite){
      a.image.setTexture(enemyTexture(kind,elite)).setOrigin(.5,ENEMY_ART[kind].originY);
      a.kind=kind;a.elite=elite;
    }
    if(used.fresh){
      a.id=view.id;a.phase=hashPhase(view.id);a.flashAt=-1e9;a.hitAt=-1e9;a.flashing=false;a.screenX=NaN;a.flip=a.phase<.5;
      a.px=a.nx=a.x=view.x;a.py=a.ny=a.y=view.y;
    }else if(Math.abs(view.x-a.nx)+Math.abs(view.y-a.ny)>SNAP_UNITS){a.px=a.x=view.x;a.py=a.y=view.y;}
    else{a.px=a.x;a.py=a.y;}
    a.moving=Math.abs(view.x-a.nx)+Math.abs(view.y-a.ny)>.002;
    a.nx=view.x;a.ny=view.y;a.hp=view.hp;a.maxHp=view.maxHp;a.boss=!!view.boss||kind==='chefe';
  }
  private syncPickup(view:PickupView){
    const used=this.pickups.use(view.id),a=used.item;
    if(used.fresh||a.kind!==view.kind){a.image.setTexture(pickupTexture(view.kind)).setOrigin(.5,.92);a.kind=view.kind;}
    if(used.fresh){a.born=this.now;a.phase=hashPhase(view.id);a.px=a.nx=a.x=view.x;a.py=a.ny=a.y=view.y;}
    else if(Math.abs(view.x-a.nx)+Math.abs(view.y-a.ny)>SNAP_UNITS){a.px=a.x=view.x;a.py=a.y=view.y;}
    else{a.px=a.x;a.py=a.y;}
    a.nx=view.x;a.ny=view.y;a.value=view.value;
  }
  private syncProjectile(view:ProjectileView){
    const used=this.projectiles.use(view.id),a=used.item;
    if(used.fresh||a.hostile!==view.hostile||a.radius!==view.radius){
      a.image.setTexture(view.hostile?FX.projHostile:FX.projFriendly).setOrigin(.5,.5);
      a.image.setScale(Math.max(.5,Math.min(3,view.radius*2*46/Math.max(1,a.image.width))));
    }
    a.x=view.x;a.y=view.y;a.vx=view.vx;a.vy=view.vy;a.radius=view.radius;a.hostile=view.hostile;
    this.aim(a);
  }
  /** Screen-space heading, recomputed only on push and camera rotation. */
  private aim=(a:ProjectileActor)=>{
    this.at.x=a.x;this.at.y=a.y;const base=this.project(this.at),bx=base.x,by=base.y;
    this.at.x=a.x+a.vx;this.at.y=a.y+a.vy;const ahead=this.project(this.at);
    a.angle=Math.atan2(ahead.y-by,ahead.x-bx);
  };
  private syncTelegraph(view:TelegraphView){
    const used=this.telegraphs.use(view.id),t=used.item;
    if(used.fresh)t.start=Math.min(this.viewTick,view.fireTick-1);
    t.shape=view.shape;t.x=view.x;t.y=view.y;t.radius=view.radius;t.fireTick=view.fireTick;
    const length=Math.hypot(view.dx??0,view.dy??0);
    t.dx=length>1e-6?(view.dx as number)/length:1;t.dy=length>1e-6?(view.dy as number)/length:0;
    t.width=view.width;
  }

  // ---------- events ----------
  private handle(event:SimEvent,eventId:number){
    switch(event.type){
      case 'damage':{
        const enemy=this.enemies.get(event.target);
        if(enemy){
          enemy.flashAt=this.now;enemy.hitAt=this.now;if(!enemy.elite&&!enemy.boss)this.recentHits.hit(event.target);
          const crit=!!event.crit;
          this.spawnNumber(event.target,enemy.x,enemy.y,this.barLift(enemy)*.72,event.amount,crit,false,false,numberPriority(crit,false,enemy.elite,enemy.boss),eventId);
        }else{
          const p=this.options.locate?.(event.target);
          if(p){
            const self=!this.options.selfId||this.options.selfId()===event.target;
            this.spawnNumber(event.target,p.x,p.y,92,event.amount,false,true,self,numberPriority(false,self,false,false),eventId);
          }
        }
        break;
      }
      case 'kill':this.recentHits.delete(event.enemy);this.spawnDeath(event.kind,event.enemy,event.x,event.y);break;
      case 'spawn-warning':{
        const w=this.warnings.spawn();
        w.born=this.now;w.x=event.x;w.y=event.y;w.atTick=event.atTick;w.size=1+Math.min(.5,event.count*.04);
        w.image.setTint(0xff5a5a);break;
      }
      case 'bark':this.spawnBubble(event.enemy,event.line);break;
      case 'boss-phase':{const boss=this.enemies.get(event.enemy);if(boss)boss.flashAt=this.now;break;}
    }
  }
  private spawnNumber(target:string,x:number,y:number,lift:number,amount:number,crit:boolean,hostile:boolean,self:boolean,priority:boolean,eventId:number){
    // Hits on the same target within DAMAGE_MERGE_MS add up into the number already flying.
    const merged=this.numberByTarget.get(target);
    if(canMerge(merged,target,this.now)){
      const fx=merged as NumberFx;
      fx.total+=amount;fx.crit||=crit;fx.priority||=priority;fx.x=x;fx.y=y;
      this.paintNumber(fx);return;
    }
    const admission=admitNumber(this.numbers.active,this.fx.numbers,this.numbersThisPush,this.fx.numbersPerPush,priority);
    if(admission==='drop')return;
    if(!priority)this.numbersThisPush++;
    // Full screen: a priority number replaces the oldest plain one first, and damage on the local player goes last.
    if(admission==='recycle'){const victim=this.numbers.at(evictionIndex(this.numbers.active,this.numberAt));if(victim)this.retireNumber(victim,true);}
    const fx=this.numbers.spawn();
    if(fx.live)this.retireNumber(fx,false);
    fx.live=true;fx.target=target;fx.total=amount;fx.crit=crit;fx.hostile=hostile;fx.self=self;fx.priority=priority;
    fx.born=this.now;fx.x=x;fx.y=y;fx.lift=lift;fx.jitter=(eventId*37%29)-14;
    this.numberByTarget.set(target,fx);
    this.paintNumber(fx);
  }
  private numberAt=(i:number)=>this.numbers.at(i);
  /** Drops a number from the merge map (and from the ring when `release`). */
  private retireNumber(fx:NumberFx,release:boolean){
    fx.live=false;
    if(this.numberByTarget.get(fx.target)===fx)this.numberByTarget.delete(fx.target);
    if(release)this.numbers.release(fx);
  }
  private paintNumber(fx:NumberFx){
    paint(fx.text,fx.hostile?HURT_STYLE:fx.crit?CRIT_STYLE:DAMAGE_STYLE,fx.hostile?`-${damageLabel(fx.total)}`:damageLabel(fx.total,fx.crit));
  }
  private spawnDeath(kind:string,id:string,x:number,y:number){
    const k=enemyKind(kind),phase=hashPhase(id),lift=ENEMY_ART[k].height*.35;
    const puff=this.poofs.spawn();
    puff.born=this.now;puff.x=x;puff.y=y;puff.lift=lift;puff.scale=k==='chefe'?2.4:1;
    puff.image.setTint(kindStyle(kind).tint);
    const starCount=this.fx.starsPerKill;
    for(let i=0;i<starCount;i++){
      const star=this.stars.spawn(),angle=(i/starCount+phase)*TAU,speed=170+60*((i*7+phase*10)%3)/3;
      star.born=this.now;star.x=x;star.y=y;star.lift=lift;
      star.vx=Math.cos(angle)*speed;star.vy=Math.sin(angle)*speed*.8-90;star.spin=(i%2?1:-1)*(4+phase*4);
      star.image.setTint(i%2?0xfff1a8:kindStyle(kind).tint);
    }
    // The death joke of a boss or an elite always shows (recycling the oldest pop); plain kills respect the budget.
    if(!admitPop(this.pops.active,this.fx.pops,k==='chefe'||!!this.enemies.get(id)?.elite))return;
    const pop=this.pops.spawn();
    pop.born=this.now;pop.x=x;pop.y=y;pop.lift=lift+ENEMY_ART[k].height*.45;pop.rotation=(phase-.5)*.36;
    paint(pop.text,popStyle(kind),deathLine(kind,id));
  }
  private spawnBubble(enemy:string,line:string){
    if(this.now-this.lastBubbleAt<BUBBLE_GAP_MS)return;
    while(this.bubbles.active>=this.fx.bubbles){const oldest=this.bubbles.at(0);if(!oldest)break;this.bubbles.release(oldest);}
    const actor=this.enemies.get(enemy);
    const b=this.bubbles.spawn();
    this.lastBubbleAt=this.now;
    b.born=this.now;b.enemy=enemy;b.x=actor?.x??NaN;b.y=actor?.y??NaN;b.lift=actor?this.barLift(actor)+16:110;
    paint(b.text,BUBBLE_STYLE,line);
  }

  // ---------- per-frame drawing (pre-bound, allocation-light) ----------
  private drawEnemy=(a:EnemyActor)=>{
    const f=this.frac,now=this.now,art=ENEMY_ART[a.kind],size=a.elite?ELITE_SCALE:1;
    a.x=a.px+(a.nx-a.px)*f;a.y=a.py+(a.ny-a.py)*f;
    this.at.x=a.x;this.at.y=a.y;
    const q=this.project(this.at),depth=this.depth(this.at);
    let lift=art.hover*size,dx=0;
    if(a.kind==='pernilongo'&&!this.reduced){
      lift+=Math.sin(now*.011+a.phase*TAU)*6;
      dx=(Math.abs(((now*.004+a.phase*4)%2+2)%2-1)-.5)*10; // zig-zag buzz
    }
    if(!Number.isNaN(a.screenX)&&Math.abs(q.x-a.screenX)>.2)a.flip=q.x<a.screenX;
    a.screenX=q.x;
    const s=squash(now,a.phase,a.moving,this.reduced,this.scale2);
    let sx=s.sx,sy=s.sy,rotation=0;
    if(a.boss&&!this.reduced){const w=Math.sin(now*.0032+a.phase*TAU);sx*=1+.035*w;sy*=1-.03*w;rotation=w*.035;}
    a.image.setPosition(q.x+dx,q.y-lift).setDepth(depth+1).setScale(sx,sy).setRotation(rotation).setFlipX(a.flip);
    const flashing=hitFlash(now-a.flashAt);
    if(flashing!==a.flashing){a.flashing=flashing;if(flashing)a.image.setTintFill(0xffffff);else a.image.clearTint();}
    const shadow=art.width*size*(a.kind==='pernilongo'?.45:.66);
    a.shadow.setPosition(q.x,q.y).setScale(shadow/SHADOW_W,shadow*.42/SHADOW_H);
    // Bars only where they matter: recently hit, elite, boss or the tapped target.
    if(barVisible(a,now,a.id===this.targetId,this.recentHits.has(a.id)))this.drawBar(q.x,q.y-this.barLift(a),a);
    else if(a.barBg.visible){a.barBg.setVisible(false);a.barFill.setVisible(false);}
    if(a.id===this.targetId)this.drawRing(q.x,q.y,art.width*size*.8);
  };
  private barLift(a:EnemyActor){return ENEMY_ART[a.kind].bar*(a.elite?ELITE_SCALE:1);}
  /** Two pooled images per enemy (frame + cropped tinted fill): no Graphics triangulation per frame. */
  private drawBar(x:number,y:number,a:EnemyActor){
    const ratio=Math.max(0,Math.min(1,a.hp/Math.max(1,a.maxHp))),u=a.elite&&!a.boss?Math.sqrt(this.ui):1; // bars stay proportional to the body, or they hide the horde
    const w=(a.boss?170:a.elite?54:40)*u,h=(a.boss?13:7)*u,border=3*u;
    const fill=a.boss?0xb48cff:ratio>.5?0x8fe39a:ratio>.25?0xffd36e:0xff8080;
    const key=a.elite&&!a.boss?FX.barElite:FX.bar;
    if(a.barKey!==key){a.barKey=key;a.barBg.setTexture(key);}
    // The frame texture's 3px border stretches with it, so the fill is placed inside the stretched border.
    const sx=(w+2*border)/BAR_W,sy=(h+2*border)/BAR_H,left=x-w/2-border,top=y-border;
    a.barBg.setVisible(true).setPosition(left,top).setScale(sx,sy);
    a.barFill.setVisible(ratio>0).setPosition(left+3*sx,top+3*sy).setScale(sx,sy).setCrop(0,0,FILL_W*ratio,FILL_H).setTint(fill);
  }
  private drawRing(x:number,y:number,width:number){
    const pulse=this.reduced?1:1+.06*Math.sin(this.now*.008);
    this.ground.lineStyle(5,0x2b2233,.45).strokeEllipse(x,y,width*pulse+4,width*.46*pulse+2);
    this.ground.lineStyle(3,0xffef94,.95).strokeEllipse(x,y,width*pulse,width*.46*pulse);
  }
  private drawPickup=(a:PickupActor)=>{
    const f=this.frac,now=this.now,reduced=this.reduced;
    a.x=a.px+(a.nx-a.px)*f;a.y=a.py+(a.ny-a.py)*f;
    this.at.x=a.x;this.at.y=a.y;
    const q=this.project(this.at),depth=this.depth(this.at);
    let y=0,scale=1,rotation=0;
    if(a.kind==='xp'){y=gemBounce(now-a.born,reduced);scale=1+Math.min(.7,Math.log2(Math.max(1,a.value))*.14);}
    else if(!reduced){
      if(a.kind==='chest'){scale=1+.07*Math.sin(now*.007+a.phase*TAU);rotation=Math.sin(now*.013+a.phase)*.04;}
      else if(a.kind==='heal')rotation=Math.sin(now*.005+a.phase*TAU)*.2;
      else y=-2.5*(1-Math.cos(now*.004+a.phase*TAU));
    }
    a.image.setPosition(q.x,q.y+y).setDepth(depth+1).setScale(scale).setRotation(rotation);
    const shadow=(a.kind==='chest'?34:18)*scale*(1+y/60);
    a.shadow.setPosition(q.x,q.y).setScale(shadow/SHADOW_W,shadow*.42/SHADOW_H);
  };
  private drawProjectile=(a:ProjectileActor)=>{
    const lead=Math.min(2,Math.max(0,(this.now-this.pushAt)/this.tickMs));
    this.at.x=a.x+a.vx*lead;this.at.y=a.y+a.vy*lead;
    const q=this.project(this.at),depth=this.depth(this.at);
    a.image.setPosition(q.x,q.y-PROJECTILE_LIFT).setDepth(depth+2).setRotation(a.angle);
    a.shadow.setPosition(q.x,q.y).setScale(a.radius*60/SHADOW_W,a.radius*24/SHADOW_H);
  };
  private drawTelegraph=(t:TelegraphState)=>{
    const g=this.ground,u=telegraphPulse(this.nowTick,t.fireTick,this.reduced,t.start),blink=telegraphBlink(this.now,u,this.reduced);
    let n=this.outline(t,1);
    g.fillStyle(0xff4d4d,.14+.16*u).fillPoints(this.pts,true,true,n);
    n=this.outline(t,Math.max(.06,u));
    g.fillStyle(0xff8a3d,.22+.33*u).fillPoints(this.pts,true,true,n);
    // Outline and a light wash go on the top layer so the zone stays readable through the horde, numbers and pops.
    // Line widths follow the UI scale: at whole-island zoom (~0.26) a fixed 8px world line is ~2px on the phone.
    // The stroke is drawn inset by half its width so its outer edge sits on the real zone, never outside it (D-015).
    n=this.outline(t,1);
    const top=this.top,w=this.ui;
    top.fillStyle(0xff4d4d,.08+.1*u).fillPoints(this.pts,true,true,n);
    const half=insetPolygon(this.pts,n,TELEGRAPH_STROKE/2*w,this.ptsIn);
    top.lineStyle(2*half,0xfff1e0,.35+.6*blink).strokePoints(this.ptsIn,true,true,n);
    top.lineStyle(half,0xff3b3b,.75+.25*u).strokePoints(this.ptsIn,true,true,n);
  };
  /** Projects the telegraph outline (grown by k) into the scratch points; returns the point count. Same zone the server damages. */
  private outline(t:TelegraphState,k:number){return telegraphOutline(t,k,this.putWorld);}
  private putWorld=(i:number,x:number,y:number)=>{const q=this.options.projector.project(x,y,this.q),p=this.pts[i];p.x=q.x;p.y=q.y;};
  private place(object:Image|Text,x:number,y:number,lift:number,ox=0){
    this.at.x=x;this.at.y=y;const q=this.project(this.at);
    object.setPosition(q.x+ox,q.y-lift);return q;
  }
  private drawWarning=(w:WarningFx)=>{
    if(this.nowTick>=w.atTick||this.now-w.born>8000)return false;
    this.at.x=w.x;this.at.y=w.y;
    const q=this.project(this.at),pulse=this.reduced?1:1+.16*Math.sin((this.now-w.born)*.012);
    w.image.setPosition(q.x,q.y-26).setDepth(this.depth(this.at)+2).setScale(w.size*pulse*this.ui)
      .setAlpha(this.reduced?.9:.65+.35*Math.abs(Math.sin((this.now-w.born)*.006)));
    this.ground.lineStyle(4,0xff5a5a,.5).strokeEllipse(q.x,q.y,64*w.size*pulse,28*w.size*pulse);
    return true;
  };
  private drawPoof=(p:PoofFx)=>{
    const age=this.now-p.born,frame=poof(age,this.poofFrame);
    if(frame.done)return false;
    this.place(p.image,p.x,p.y,p.lift);
    this.at.x=p.x;this.at.y=p.y;
    p.image.setDepth(this.depth(this.at)+3).setScale((this.reduced?1.2:frame.scale)*p.scale).setAlpha(frame.alpha)
      .setRotation(this.reduced?0:age*.002);
    return true;
  };
  private drawStar=(s:StarFx)=>{
    const age=this.now-s.born;if(age>=STAR_MS)return false;
    const t=age/1000,k=age/STAR_MS;
    let ox:number,oy:number;
    if(this.reduced){ox=s.vx*.12;oy=s.vy*.12;}
    else{ox=s.vx*t;oy=s.vy*t+420*t*t;}
    this.place(s.image,s.x,s.y,s.lift-oy,ox);
    this.at.x=s.x;this.at.y=s.y;
    s.image.setDepth(this.depth(this.at)+4).setScale(.95-.5*k).setAlpha(1-k*k).setRotation(this.reduced?0:s.spin*t);
    return true;
  };
  private drawNumber=(n:NumberFx)=>{
    const frame=damageFloat(this.now-n.born,this.textFrame);
    if(frame.done){this.retireNumber(n,false);return false;}
    this.place(n.text,n.x,n.y,n.lift-frame.y,n.jitter);
    n.text.setScale((this.reduced?1:frame.scale)*this.ui).setAlpha(frame.alpha);
    return true;
  };
  private drawPop=(p:PopFx)=>{
    const age=this.now-p.born;if(age>=POP_TEXT_MS)return false;
    const frame=popText(age,this.reduced,this.textFrame);
    this.place(p.text,p.x,p.y,p.lift-frame.y);
    p.text.setScale(frame.scale*(1+(this.ui-1)*.6)).setAlpha(frame.alpha).setRotation(p.rotation);
    return true;
  };
  private drawBubble=(b:BubbleFx)=>{
    const age=this.now-b.born;if(age>=BUBBLE_MS)return false;
    const enemy=this.enemies.get(b.enemy);
    if(enemy){b.x=enemy.x;b.y=enemy.y;b.lift=this.barLift(enemy)+18;}
    if(Number.isNaN(b.x)){b.text.setVisible(false);return true;}
    const q=this.place(b.text,b.x,b.y,b.lift);
    const alpha=age<120?age/120:age>BUBBLE_MS-250?(BUBBLE_MS-age)/250:1;
    b.text.setVisible(true).setAlpha(alpha).setScale((this.reduced||age>=160?1:.7+.3*age/160)*this.ui);
    const t=8*this.ui;
    this.overlay.fillStyle(0xfff8ec,alpha).fillTriangle(q.x-t,q.y-b.lift-1,q.x+t,q.y-b.lift-1,q.x,q.y-b.lift+t*1.25);
    return true;
  };

  private project(p:Pt){return this.options.projector.project(p.x,p.y,this.q);}
  private depth(p:Pt){return this.options.projector.depth(p.x,p.y);}
  private count(pool:{created:number;active:number}){return {created:pool.created,active:pool.active};}
  private track<T extends Phaser.GameObjects.GameObject>(object:T):T{this.objects.push(object);return object;}
}
