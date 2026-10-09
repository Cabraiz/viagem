/**
 * ?sandbox=horda — fake horde over the real terrain to exercise the render layers (VGM-039).
 * Query: n (enemies, default 300), view (0..3), seed, reduced=1, fx=reduced (effects profile), hud=0.
 * Exposes window.__horde for automated FPS and pooling checks.
 */
import Phaser from 'phaser';
import {TerrainField,DEFAULT_SEED} from './terrain/field.ts';
import {TerrainRenderer} from './terrain/renderer.ts';
import {fitIsland} from './framing.ts';
import {projectView,viewDepth,normalizeView} from './projection.ts';
import {obstacles,walkable,type Point} from './world.ts';
import {treeCatalog} from './tree-catalog.ts';
import {CharacterSprites} from './character-sprites.ts';
import {classes} from '../classes.ts';
import {Rng} from './sim/rng.ts';
import {SIM_HZ,type SimEvent,type PickupKind} from './sim/types.ts';
import type {RunView,EnemyView,PickupView,ProjectileView,TelegraphView} from './sim/view.ts';
import {HordeRenderer} from './render/layers.ts';
import {Projector} from './render/projector.ts';

type FakeEnemy=EnemyView&{speed:number;wobble:number};
type FakePickup=PickupView&{until:number};
type FakeProjectile=ProjectileView&{until:number};
const KINDS:{kind:string;weight:number;hp:number;speed:number}[]=[
  {kind:'gosma',weight:40,hp:30,speed:.9},{kind:'pernilongo',weight:30,hp:12,speed:1.7},
  {kind:'tio-pave',weight:12,hp:90,speed:.6},{kind:'fiscal',weight:18,hp:40,speed:.8},
];
const BARKS:Record<string,string[]>={
  gosma:['Me dá um abraço!','Glub glub…','Tô grudento, desculpa'],
  pernilongo:['Bzzzz no teu ouvido','Só uma picadinha','Apaga a luz!'],
  'tio-pave':['É pavê ou pa comê?','Pavê? Pa você!','Puxa meu dedo'],
  fiscal:['Cadê o alvará?','Isso aí é multa','Calçada irregular!'],
  chefe:['Reunião de condomínio AGORA!','Quem deixou o lixo aqui?'],
};
const PLAYER_COUNT=6;

/** Deterministic stand-in for the server: enough churn to stress every layer. */
class FakeHorde {
  tick=0;private rng:Rng;private next=1;private eventId=0;
  enemies:FakeEnemy[]=[];pickups:FakePickup[]=[];projectiles:FakeProjectile[]=[];telegraphs:TelegraphView[]=[];
  players:{id:string;classId:string;x:number;y:number;attackTick:number;angle:number}[]=[];
  private events:(SimEvent&{eventId:number})[]=[];
  constructor(private field:TerrainField,private target:number,seed:number){
    this.rng=new Rng(seed);
    for(let i=0;i<PLAYER_COUNT;i++)this.players.push({id:`p${i}`,classId:classes[(i*5)%classes.length].id,x:12,y:12,attackTick:0,angle:i/PLAYER_COUNT*Math.PI*2});
    this.movePlayers();
    for(let i=0;i<target;i++)this.spawn(this.landPoint(2.5,9.5));
    const boss=this.spawn({x:12,y:8.5},'chefe');boss.hp=boss.maxHp*.62;
  }
  private emit(event:SimEvent){this.events.push({...event,eventId:++this.eventId});}
  private landPoint(min:number,max:number):Point{
    for(let i=0;i<60;i++){
      const a=this.rng.range(0,Math.PI*2),r=this.rng.range(min,max),p={x:12+Math.cos(a)*r,y:12+Math.sin(a)*r};
      if(walkable(p,this.field))return p;
    }
    return {x:12,y:15};
  }
  private spawn(p:Point,forced?:string){
    const def=forced?{kind:forced,hp:2000,speed:.35}:this.rng.weighted(KINDS,k=>k.weight);
    const elite=!forced&&this.rng.chance(.03);
    const hp=def.hp*(elite?4:1);
    const enemy:FakeEnemy={id:`e${this.next++}`,kind:def.kind,x:p.x,y:p.y,hp,maxHp:hp,elite:elite||undefined,boss:forced==='chefe'||undefined,phase:forced?1:undefined,speed:def.speed*this.rng.range(.8,1.2),wobble:this.rng.range(0,6.28)};
    this.enemies.push(enemy);return enemy;
  }
  private movePlayers(){
    for(const p of this.players){
      const t=this.tick/SIM_HZ*.25+p.angle,r=2.2+Math.sin(t*1.7)*.6;
      const q={x:12+Math.cos(t)*r,y:12.5+Math.sin(t)*r};
      if(walkable(q,this.field)){p.x=q.x;p.y=q.y;}
    }
  }
  step(){
    this.tick++;this.movePlayers();
    const dt=1/SIM_HZ;
    for(const e of this.enemies){
      let best=this.players[0],bd=Infinity;
      for(const p of this.players){const d=(p.x-e.x)**2+(p.y-e.y)**2;if(d<bd){bd=d;best=p;}}
      const d=Math.sqrt(bd);if(d<.6&&!e.boss)continue;
      const zig=e.kind==='pernilongo'?Math.sin(this.tick*.5+e.wobble)*.9:0;
      const dx=(best.x-e.x)/d,dy=(best.y-e.y)/d;
      const q={x:e.x+(dx-dy*zig)*e.speed*dt,y:e.y+(dy+dx*zig)*e.speed*dt};
      if(walkable(q,this.field)){e.x=q.x;e.y=q.y;}
    }
    // Weapons: a few hits per tick, crits now and then.
    for(let i=0;i<12&&this.enemies.length;i++){
      const e=this.rng.pick(this.enemies),crit=this.rng.chance(.12),amount=Math.round(this.rng.range(4,14)*(crit?2.5:1));
      e.hp=Math.max(0,e.hp-amount);this.emit({type:'damage',target:e.id,amount,crit,source:this.rng.pick(this.players).id});
      if(e.hp<=0)this.kill(e);
    }
    if(this.tick%10===0){const p=this.rng.pick(this.players);this.emit({type:'damage',target:p.id,amount:this.rng.int(3,9)});}
    for(const p of this.players)if(this.rng.chance(.12)){
      const a=this.rng.range(0,Math.PI*2);p.attackTick=this.tick;
      this.projectiles.push({id:`b${this.next++}`,source:'boleto',x:p.x,y:p.y,vx:Math.cos(a)*.35,vy:Math.sin(a)*.35,radius:.18,hostile:false,until:this.tick+24});
    }
    for(const e of this.enemies)if(e.kind==='fiscal'&&this.rng.chance(.008)){
      const p=this.rng.pick(this.players),d=Math.hypot(p.x-e.x,p.y-e.y)||1;
      this.projectiles.push({id:`h${this.next++}`,source:'fiscal',x:e.x,y:e.y,vx:(p.x-e.x)/d*.22,vy:(p.y-e.y)/d*.22,radius:.2,hostile:true,until:this.tick+40});
    }
    for(const b of this.projectiles){b.x+=b.vx;b.y+=b.vy;}
    this.projectiles=this.projectiles.filter(b=>b.until>this.tick);
    this.pickups=this.pickups.filter(p=>p.until>this.tick);
    this.telegraphs=this.telegraphs.filter(t=>t.fireTick>this.tick);
    const boss=this.enemies.find(e=>e.boss);
    if(boss&&this.tick%50===0){
      const shape=(['circle','line','cone'] as const)[(this.tick/50)%3],p=this.rng.pick(this.players),d=Math.hypot(p.x-boss.x,p.y-boss.y)||1;
      const t:TelegraphView={id:`t${this.next++}`,shape,x:shape==='circle'?p.x:boss.x,y:shape==='circle'?p.y:boss.y,radius:shape==='circle'?1.6:shape==='line'?7:4,dx:(p.x-boss.x)/d,dy:(p.y-boss.y)/d,width:shape==='line'?1.2:shape==='cone'?1.1:undefined,fireTick:this.tick+30};
      this.telegraphs.push(t);this.emit({type:'telegraph',telegraph:t.id});
    }
    if(this.tick%45===7&&this.enemies.length){const e=this.rng.pick(this.enemies);const lines=BARKS[e.kind]??BARKS.gosma;this.emit({type:'bark',enemy:e.id,line:this.rng.pick(lines)});}
    // Keep the horde at the target size: replacements arrive from the coast with a warning.
    // Replacements arrive at once in coastal groups of 4 (with a warning), so the horde really holds n enemies.
    while(this.target-this.liveCount()>0){
      const p=this.landPoint(8,9.8),group=Math.min(4,this.target-this.liveCount());
      for(let k=0;k<group;k++)this.spawn(this.near(p));
      if(this.rng.chance(.25))this.emit({type:'spawn-warning',x:p.x,y:p.y,atTick:this.tick+30,count:group});
    }
  }
  private near(p:Point){for(let i=0;i<10;i++){const q={x:p.x+this.rng.range(-.8,.8),y:p.y+this.rng.range(-.8,.8)};if(walkable(q,this.field))return q;}return p;}
  private liveCount(){return this.enemies.length-(this.enemies.some(e=>e.boss)?1:0);}
  private kill(e:FakeEnemy){
    this.emit({type:'kill',enemy:e.id,kind:e.kind,x:e.x,y:e.y});
    if(e.boss){e.hp=e.maxHp;return;}
    this.enemies.splice(this.enemies.indexOf(e),1);
    const roll=this.rng.next(),kind:PickupKind=e.elite?'chest':roll<.04?'heal':roll<.06?'magnet':roll<.08?'resource':'xp';
    this.pickups.push({id:`g${this.next++}`,kind,x:e.x,y:e.y,value:kind==='xp'?(this.rng.chance(.1)?25:5):1,until:this.tick+this.rng.int(80,160)});
  }
  view():RunView{
    const events=this.events;this.events=[];
    return {tick:this.tick,team:{xp:0,level:1,nextXp:5},enemies:this.enemies,pickups:this.pickups,projectiles:this.projectiles,telegraphs:this.telegraphs,structures:[],
      players:[],offers:[],events};
  }
}

class HordeSandboxScene extends Phaser.Scene {
  view=0;horde!:FakeHorde;layers!:HordeRenderer;
  private landscape?:TerrainRenderer;
  private sprites=new CharacterSprites(this);
  private actors:Phaser.GameObjects.Sprite[]=[];
  private props:{point:Point;image:Phaser.GameObjects.Image}[]=[];
  private accumulator=0;
  paused=false;
  reduced:boolean;
  private projector!:Projector;
  /** forced: the ?reduced=1 flag; the OS preference is followed live on top of it. */
  constructor(private field:TerrainField,private count:number,view:number,forced:boolean,private seed:number){super('horde-sandbox');this.view=normalizeView(view);this.forceReduced=forced;this.reduced=forced||matchMedia('(prefers-reduced-motion: reduce)').matches;}
  private forceReduced:boolean;
  preload(){
    this.load.image('terrain-soil','/art/terrain/soil-grass.webp');this.load.image('terrain-bed','/art/terrain/riverbed.webp');
    for(const tree of treeCatalog.slice(0,6))this.load.spritesheet(`tree:${tree.id}`,`/art/trees/${tree.id}.webp`,{frameWidth:256,frameHeight:384});
    for(let i=0;i<PLAYER_COUNT;i++)this.sprites.queue(classes[(i*5)%classes.length].id);
  }
  create(){
    this.cameras.main.setBackgroundColor('#142f2d');
    this.landscape=new TerrainRenderer(this,this.field);this.landscape.view(this.view);
    const trees=treeCatalog.slice(0,6);let i=0;
    for(const o of obstacles){
      if(o.kind==='rock'||!trees.length)continue;
      const tree=trees[i++%trees.length],p=this.project(o);
      const image=this.add.image(p.x,p.y,`tree:${tree.id}`,this.view).setOrigin(.5,353/384).setScale(tree.height/tree.pixelHeight).setDepth(this.depth(o));
      this.props.push({point:o,image});
    }
    this.horde=new FakeHorde(this.field,this.count,this.seed);
    this.projector=new Projector(this.view,this.field);
    // Whole-island framing zooms out to ~0.26 on a phone: scale text and bars back to a readable screen size.
    this.layers=new HordeRenderer(this,{projector:this.projector,uiScale:()=>Math.max(1,Math.min(2.5,.55/this.cameras.main.zoom)),reduced:this.reduced,effects:new URLSearchParams(location.search).get('fx')==='reduced'?'reduced':'full',tickMs:1000/SIM_HZ});
    const motion=matchMedia('(prefers-reduced-motion: reduce)'),onMotion=()=>{this.reduced=this.forceReduced||motion.matches;this.layers.setReduced(this.reduced);};
    motion.addEventListener('change',onMotion);
    this.events.once('shutdown',()=>{motion.removeEventListener('change',onMotion);this.scale.off('resize',this.fit,this);this.layers.destroy();});
    for(let k=0;k<PLAYER_COUNT;k++)this.actors.push(this.add.sprite(0,0,'__DEFAULT').setOrigin(.5,.88));
    this.layers.push(this.horde.view());
    this.scale.on('resize',this.fit,this);this.fit();
  }
  project(p:Point){return projectView(p,this.view,this.field);}
  depth(p:Point){return viewDepth(p,this.view);}
  fit(){
    const frame=fitIsland(this.scale.width,this.scale.height,this.view,this.field);
    this.cameras.main.setSize(this.scale.width,this.scale.height).setZoom(frame.zoom).centerOn(frame.x,frame.y);
    this.landscape?.fit();
  }
  rotate(turn:number){
    this.view=normalizeView(this.view+turn);this.landscape?.view(this.view);this.projector.view=this.view;
    for(const prop of this.props){const p=this.project(prop.point);prop.image.setPosition(p.x,p.y).setDepth(this.depth(prop.point)).setFrame(this.view);}
    this.layers.refresh();this.fit();return this.view;
  }
  update(time:number,delta:number){
    this.landscape?.update(time,this.reduced||document.hidden);
    if(!this.paused){
      this.accumulator=Math.min(this.accumulator+delta,250);
      while(this.accumulator>=1000/SIM_HZ){this.horde.step();this.layers.push(this.horde.view());this.accumulator-=1000/SIM_HZ;}
    }
    this.layers.update(time,delta);
    this.horde.players.forEach((p,k)=>{
      const actor=this.actors[k],q=this.project(p);
      this.sprites.animate(actor,p.classId,p.x,p.y,p.attackTick,true,this.view);
      actor.setPosition(q.x,q.y).setDepth(this.depth(p)+1);
    });
  }
}

declare global {interface Window {__horde?:Record<string,unknown>}}

export function openHordeSandbox(){
  const params=new URLSearchParams(location.search);
  const count=Math.max(0,Math.min(1000,Number(params.get('n')??300)||0));
  const seed=Number(params.get('seed'))||DEFAULT_SEED;
  const reduced=params.get('reduced')==='1';
  const root=document.createElement('div');
  root.style.cssText='position:fixed;inset:0;z-index:10000;background:#142f2d;overflow:hidden;touch-action:none';
  const stage=document.createElement('div');stage.style.cssText='position:absolute;inset:0';
  const meter=document.createElement('div');
  meter.setAttribute('aria-live','off');
  meter.style.cssText='position:absolute;left:max(8px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));padding:6px 10px;border-radius:10px;background:#fff8ecdd;color:#51425e;font:700 12px/1.35 system-ui;pointer-events:none;white-space:pre';
  const bar=document.createElement('div');
  bar.style.cssText='position:absolute;right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));display:flex;gap:8px';
  const button=(label:string,title:string)=>{const b=document.createElement('button');b.textContent=label;b.title=title;b.setAttribute('aria-label',title);b.style.cssText='min-width:44px;min-height:44px;border:0;border-radius:12px;background:#fff8ec;color:#51425e;font:800 16px system-ui;box-shadow:0 2px 0 #b9a6c9';bar.append(b);return b;};
  const left=button('⟲','Girar câmera para a esquerda'),right=button('⟳','Girar câmera para a direita'),pause=button('❚❚','Pausar a horda');
  root.append(stage,meter,bar);document.body.append(root);
  if(params.get('hud')==='0'){meter.style.display='none';bar.style.display='none';}
  const field=new TerrainField(seed);
  const scene=new HordeSandboxScene(field,count,Number(params.get('view'))||0,reduced,seed);
  const game=new Phaser.Game({type:Phaser.WEBGL,parent:stage,backgroundColor:'#8dcecc',width:stage.clientWidth||innerWidth,height:stage.clientHeight||innerHeight,
    scale:{mode:Phaser.Scale.RESIZE},antialias:true,autoFocus:false,audio:{noAudio:true},fps:{target:60,limit:60},banner:false,scene:[scene]});
  left.onclick=()=>scene.rotate(-1);right.onclick=()=>scene.rotate(1);
  pause.onclick=()=>{scene.paused=!scene.paused;pause.textContent=scene.paused?'▶':'❚❚';pause.setAttribute('aria-label',scene.paused?'Continuar a horda':'Pausar a horda');};
  // FPS over 1 s windows; the worst window is kept so a spike is not hidden by the average.
  let frames=0,windowStart=performance.now(),fps=0,worst=Infinity;const samples:number[]=[];
  const tick=(now:number)=>{
    frames++;
    if(now-windowStart>=1000){
      fps=frames*1000/(now-windowStart);frames=0;windowStart=now;samples.push(fps);if(samples.length>60)samples.shift();
      if(samples.length>2)worst=Math.min(worst,fps);
      if(scene.layers){const s=scene.layers.stats();meter.textContent=`FPS ${fps.toFixed(0)} · pior ${Number.isFinite(worst)?worst.toFixed(0):'—'}\n${scene.horde.enemies.length} bichos · vista ${scene.view}${scene.reduced?' · movimento reduzido':''}\nobjetos ${s.active} ativos · ${s.created} criados`;}
    }
    if(root.isConnected)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__horde={
    game,scene,
    fps:()=>fps,worst:()=>worst,samples:()=>[...samples],
    stats:()=>scene.layers?.stats(),
    rotate:(turn:number)=>scene.rotate(turn),
    setPaused:(value:boolean)=>{scene.paused=value;},
    resetWorst:()=>{worst=Infinity;samples.length=0;},
    ready:()=>!!scene.layers,
  };
  return {game,scene};
}
