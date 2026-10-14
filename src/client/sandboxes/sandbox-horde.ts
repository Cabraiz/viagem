/**
 * ?sandbox=horda — fake horde over the real terrain to exercise the render layers (VGM-039).
 * Query: n (enemies, default 300), view (0..3), seed, reduced=1, fx=reduced (effects profile), hud=0,
 * camera=ilha (whole-island overview instead of the follow camera on the first player, D-019),
 * elenco=1 (D-033 cast line-up: one of each kind plus an elite, standing still around the first player, with their
 * telegraphs, the agiota's boletos and the "DEVENDO" tag; use with n=0 for a clean screenshot). D-036: the line-up
 * shows one telegraph of every kind (arroto, molotov, fogo, cocô, explosão and the boss's pancada, investida, varredura,
 * carimbo, plus one without a kind) and the first player wears the slow and slip status chips. Elenco P1: the coach
 * lecturing (phase 1, his gold ring) with two buffed critters (phase 2) beside him, the influencer posing (phase 1,
 * reflect ring, shots bouncing back) and the motoboy aiming (phase 1, headlight) with his investida line ending in an
 * explosão; above and below the cast in portrait, left and right of it in landscape.
 * aliado=1 (with elenco=1): the second player stands beside the first, so hero, ally and cast sizes compare at a glance.
 * arte=<kind>:<roster id>,… draws a roster enemy's imported art in that kind's slot (artist preview of pack 04…).
 * Exposes window.__horde for automated FPS and pooling checks.
 */
import Phaser from 'phaser';
import {TerrainField,DEFAULT_SEED} from '../../maps/index.ts';
import {TerrainRenderer} from '../terrain/renderer.ts';
import {fitIsland,FollowCamera,followZoom} from '../framing.ts';
import {projectView,viewDepth,normalizeView} from '../projection.ts';
import {obstacles,walkable,type Point} from '../../maps/index.ts';
import {treeCatalog} from '../../maps/index.ts';
import {treeUrl} from '../sprites/art-urls.ts';
import {CharacterSprites} from '../sprites/character-sprites.ts';
import {classes,ROSTER} from '../../rules/index.ts';
import {Rng} from '../../contract/index.ts';
import {SIM_HZ,type SimEvent,type PickupKind} from '../../contract/index.ts';
import type {RunView,EnemyView,PickupView,ProjectileView,TelegraphView,TelegraphKind} from '../../contract/index.ts';
import {HordeRenderer} from '../render/layers.ts';
import {YouMarkers,type HeroMark} from '../render/you.ts';
import {token} from '../ui/tokens.ts';
import {Projector} from '../render/projector.ts';
import {ENEMY_ART_ID,queueHordeArt} from '../art/horde-art.ts';
import {artPiece} from '../art/manifest.ts';
import {enemyKind} from '../render/keys.ts';
import {artReady} from '../ui/art-boot.ts';

type FakeEnemy=EnemyView&{speed:number;wobble:number};
type FakePickup=PickupView&{until:number};
type FakeProjectile=ProjectileView&{until:number};
/** `?say=ficou`: demo of the left-behind balloon right after a crate's line (cidade-07 / BUG-…-balao-ficou-pra-tras). */
const SAY_DEMO=new URLSearchParams(location.search).get('say');
/** D-033 cast (design/arte-v2.md §4); the elite (Funcionário do Mês) is any of them. */
const KINDS:{kind:string;weight:number;hp:number;speed:number}[]=[
  {kind:'bebado',weight:36,hp:30,speed:.9},{kind:'pombos',weight:26,hp:12,speed:1.7},
  {kind:'tio-pave',weight:12,hp:100,speed:.55},{kind:'agiota',weight:14,hp:40,speed:.8},{kind:'anao-molotov',weight:12,hp:36,speed:.7},
  // Elenco P1: they act now and then in the stress run too (phase 1 on a slow cycle).
  {kind:'coach',weight:4,hp:60,speed:.6},{kind:'motoboy',weight:4,hp:30,speed:1.2},{kind:'influencer',weight:4,hp:50,speed:.7},
];
const ACTS=new Set(['coach','motoboy','influencer']);
const BARKS:Record<string,string[]>={
  bebado:['Tu é meu irmão, sabia?','Hic… saideira!','Me empresta dez conto'],
  pombos:['Cruu cruu','Miolo ou morte!','Alvo na cabeça: confirmado'],
  'tio-pave':['É pavê ou pa comê?','Pavê? Pa você!','Puxa meu dedo'],
  agiota:['Venceu ontem, parceiro','Juros de 30% ao dia','Tá devendo, hein?'],
  'anao-molotov':['Segura essa, porra!','Cachaça boa pega fogo','FOGO NO PARQUINHO!'],
  chefe:['Reunião de condomínio AGORA!','Quem deixou o lixo aqui?'],
  coach:['Aula grátis. A surra é paga','Cansaço é crença limitante'],
  motoboy:['Freio é coisa de iniciante','Sinal vermelho é sugestão'],
  influencer:['Bom dia, família! Tá pago!','Shape não se faz, se posta'],
};
const PLAYER_COUNT=6;
/** ?roster=1: one new (non-legacy) P0 roster enemy per role, in roster order, for the fallback-look line-up. */
const rosterSample=()=>{const seen=new Set<string>(),out:string[]=[];for(const r of ROSTER)if(r.priority==='P0'&&!r.legacy&&r.role!=='chefe'&&!seen.has(r.role)){seen.add(r.role);out.push(r.id);}return out;};
/**
 * ?roster=arte (arte-do-roster-no-render): the new roster enemies that have imported art, in roster order, from the
 * `de`-th one (0-based), so every imported piece can be seen in pages of the line-up's slots.
 */
const rosterArt=(from:number)=>ROSTER.filter(r=>!r.legacy&&r.role!=='chefe'&&artPiece('inimigos',r.id)).map(r=>r.id).slice(Math.max(0,from));
const lineupRoster=()=>{
  const q=new URLSearchParams(location.search),mode=q.get('roster');
  return mode==='1'?rosterSample():mode==='arte'?rosterArt(Number(q.get('de'))||0):undefined;
};
/**
 * ?elenco=1 line-up: [kind, elite, screen offset x, y] of each critter's feet from the first player's feet, in world px
 * at view 0 (x right, y down), so the whole D-033 cast fits a phone in portrait and landscape.
 */
const LINEUP:[string,boolean,number,number][]=[
  ['bebado',false,-170,-120],['pombos',false,0,-135],['anao-molotov',false,170,-120],
  ['tio-pave',false,-170,40],['agiota',false,170,40],
  ['bebado',true,-255,235],['chefe',false,0,200],['agiota',true,300,228],
];
/**
 * Elenco P1 line-up, in two groups placed by the phone's orientation (P1_GROUPS): [kind, phase, screen x, y from the
 * group's anchor, group]. Group 0: the coach lecturing with a buffed bêbado and buffed pombos beside him. Group 1: the
 * motoboy aiming (his line and blast come from lineUpCharge) and the influencer posing.
 */
const P1_LINEUP:[string,number,number,number,0|1][]=[
  ['coach',1,0,0,0],['bebado',2,-110,40,0],['pombos',2,115,20,0],
  ['motoboy',1,-150,-20,1],['influencer',1,175,50,1],
];
/**
 * Landscape has little room on the sides: group 1 stacks the motoboy over the influencer (P1_CHARGE points left) and
 * the buffed pombos fly over the trees next to the coach.
 */
const P1_LANDSCAPE:Record<string,readonly [number,number]>={motoboy:[110,-150],influencer:[40,150],pombos:[70,-150]};
/** Anchors (screen offsets from the first player) of the two P1 groups: above/below in portrait, left/right in landscape. */
const P1_GROUPS={portrait:[[0,-470],[0,465]],landscape:[[-500,-60],[540,-40]]} as const;
/** The motoboy's charge, in screen directions: towards screen right in portrait, back at the cast in landscape. */
const P1_CHARGE={portrait:[1,0],landscape:[-1,0]} as const;
const fromScreen=(origin:Point,sx:number,sy:number):Point=>({x:origin.x+(sx/42+sy/21)/2,y:origin.y+(sy/21-sx/42)/2});
/** World direction of a screen direction (view 0), as a unit vector. */
const screenDir=(sx:number,sy:number)=>{const x=(sx/42+sy/21)/2,y=(sy/21-sx/42)/2,l=Math.hypot(x,y)||1;return {dx:x/l,dy:y/l};};
/**
 * D-036 line-up danger, one of each kind: [kind, shape, screen x, y from the first player (world px, view 0), radius,
 * width, screen aim x, y (lines and cones), fire delay in ticks]. Undefined kind = an old server's generic telegraph.
 */
const DANGER:[TelegraphKind|undefined,TelegraphView['shape'],number,number,number,number|undefined,number,number,number][]=[
  // The cast's hazards at their server sizes (sim/enemies/catalog.ts: BURP, MOLOTOV, POOP).
  ['arroto','cone',-170,-120,2.5,Math.PI/2,1,.7,70],
  ['coco','circle',-60,-250,.5,undefined,0,0,90],
  ['molotov','circle',115,-250,.9,undefined,0,0,60],
  ['fogo','circle',265,-45,.75,undefined,0,0,80],
  ['explosao','circle',-225,110,1.6,undefined,0,0,50],
  // The Síndico's moves (charge and sweep from his feet), smaller than in the fight so the set fits a phone both ways.
  ['investida','line',25,200,3,1.4,1,-.05,65],
  ['varredura','cone',-25,200,2,1.2,-1,-.05,85],
  ['carimbo','circle',-265,-255,.85,undefined,0,0,70],
  ['pancada','circle',270,-245,.85,undefined,0,0,75],
  [undefined,'circle',265,110,.6,undefined,0,0,95],
];

/** Deterministic stand-in for the server: enough churn to stress every layer. */
class FakeHorde {
  tick=0;private rng:Rng;private next=1;private eventId=0;
  enemies:FakeEnemy[]=[];pickups:FakePickup[]=[];projectiles:FakeProjectile[]=[];telegraphs:TelegraphView[]=[];
  players:{id:string;classId:string;x:number;y:number;attackTick:number;angle:number}[]=[];
  private events:(SimEvent&{eventId:number})[]=[];
  /** Elenco P1 line-up: the motoboy (his charge starts at his spawn) and the influencer (who bounces shots back). */
  private moto?:FakeEnemy;private motoHome?:Point;private posing?:FakeEnemy;
  constructor(private field:TerrainField,private target:number,seed:number,readonly lineup=false,private portrait=true){
    this.rng=new Rng(seed);
    for(let i=0;i<PLAYER_COUNT;i++)this.players.push({id:`p${i}`,classId:classes[(i*5)%classes.length].id,x:12,y:12,attackTick:0,angle:i/PLAYER_COUNT*Math.PI*2});
    this.movePlayers();
    if(lineup)this.lineUp();
    for(let i=0;i<target;i++)this.spawn(this.landPoint(2.5,9.5));
    if(!lineup){const boss=this.spawn({x:12,y:8.5},'chefe');boss.hp=boss.maxHp*.62;}
  }
  /** D-033 cast line-up: still critters around the first player; the other players wait off screen. */
  private lineUp(){
    const me=this.players[0];me.x=12;me.y=12.5;
    this.players.forEach((p,i)=>{if(i){p.x=me.x+14+i;p.y=me.y-14-i;}});
    // `aliado=1`: the second player stands beside the hero (hero, ally and the cast side by side, for size checks).
    if(new URLSearchParams(location.search).get('aliado')==='1'){const p=fromScreen(me,-95,15);this.players[1].x=p.x;this.players[1].y=p.y;}
    // `roster=1` (papeis-de-inimigo): the same slots filled with new P0 roster enemies of different roles, drawn with
    // their role's fallback look until their art exists.
    // `roster=arte`: the slots show the imported roster pieces instead (empty manifest: today's cast).
    const found=lineupRoster(),roster=found?.length?found:undefined;
    for(const [i,[slotKind,elite,sx,sy]] of LINEUP.entries()){
      const kind=roster&&slotKind!=='chefe'?roster[i%roster.length]:slotKind;
      const e=this.spawn(fromScreen(me,sx,sy),kind);
      e.speed=0;e.elite=elite||undefined;e.boss=kind==='chefe'||undefined;e.phase=kind==='chefe'?1:undefined;e.hp=e.maxHp*(elite?.7:1);
    }
    const groups=this.portrait?P1_GROUPS.portrait:P1_GROUPS.landscape;
    // `roster=arte`: each acting P1 slot shows an imported roster enemy drawn on that kind (a kamikaze aiming as the
    // motoboy, a suporte lecturing as the coach, a refletor posing as the influencer), when one exists.
    const acting=new URLSearchParams(location.search).get('roster')==='arte';
    for(const [slot,phase,x,y,g] of P1_LINEUP){
      const kind=(acting&&phase===1&&ROSTER.find(r=>!r.legacy&&enemyKind(r.id)===slot&&r.role!=='invocador'&&artPiece('inimigos',r.id))?.id)||slot;
      const [sx,sy]=(!this.portrait&&P1_LANDSCAPE[slot])||[x,y];
      const [ax,ay]=groups[g],e=this.spawn(fromScreen(me,ax+sx,ay+sy),kind);
      e.speed=0;e.phase=phase;
      if(slot==='motoboy'){this.moto=e;this.motoHome={x:e.x,y:e.y};}
      if(slot==='influencer')this.posing=e;
    }
  }
  /**
   * The motoboy's charge (Elenco P1): the investida line from his spot (P1_CHARGE), then the explosão at its end; he
   * creeps along the line while it fills (so he faces it) and goes back when it fires.
   */
  private lineUpCharge(){
    const moto=this.moto,home=this.motoHome;if(!moto||!home)return;
    const [cx,cy]=this.portrait?P1_CHARGE.portrait:P1_CHARGE.landscape,dir=screenDir(cx,cy),length=3;
    if(!this.telegraphs.some(t=>t.id.startsWith('m:'))){
      moto.x=home.x;moto.y=home.y;
      const line:TelegraphView={id:`m:${this.next++}`,shape:'line',kind:'investida',x:home.x,y:home.y,radius:length,dx:dir.dx,dy:dir.dy,width:1.2,fireTick:this.tick+88};
      const blast:TelegraphView={id:`m:${this.next++}`,shape:'circle',kind:'explosao',x:home.x+dir.dx*length,y:home.y+dir.dy*length,radius:1.6,dx:1,dy:0,fireTick:this.tick+90};
      this.telegraphs.push(line,blast);this.emit({type:'telegraph',telegraph:line.id});this.emit({type:'telegraph',telegraph:blast.id});
    }else{moto.x+=dir.dx*.004;moto.y+=dir.dy*.004;}
    const pose=this.posing,me=this.players[0];
    if(pose&&this.tick%25===3){
      // A shot bounced off the pose: a hostile projectile flying back at the hero.
      const d=Math.hypot(me.x-pose.x,me.y-pose.y)||1;
      this.projectiles.push({id:`r${this.next++}`,source:'reflexo',x:pose.x,y:pose.y,vx:(me.x-pose.x)/d*.14*SIM_HZ,vy:(me.y-pose.y)/d*.14*SIM_HZ,radius:.2,hostile:true,until:this.tick+Math.floor(d/.14)});
    }
  }
  private lined(kind:string){return this.enemies.find(e=>e.kind===kind&&!e.elite);}
  /**
   * Line-up danger (D-036): one telegraph of every kind, each one coming back as soon as it fires (staggered delays,
   * so a screenshot catches them at different fill-ups): the burp cone, the molotov's target, fire, poop, explosion,
   * the boss's slam, charge, sweep and stamp, and one with no kind.
   */
  private lineUpDanger(){
    const me=this.players[0];
    for(let i=0;i<DANGER.length;i++){
      const id=`d${i}`;if(this.telegraphs.some(t=>t.id.startsWith(`${id}:`)))continue;
      const [kind,shape,sx,sy,radius,width,ax,ay,ticks]=DANGER[i],p=fromScreen(me,sx,sy),dir=screenDir(ax||1,ay);
      const v:TelegraphView={id:`${id}:${this.next++}`,shape,x:p.x,y:p.y,radius,dx:dir.dx,dy:dir.dy,width,fireTick:this.tick+ticks,...(kind?{kind}:{})};
      this.telegraphs.push(v);this.emit({type:'telegraph',telegraph:v.id});
    }
    const agiota=this.lined('agiota');
    if(agiota&&this.tick%20===0){
      const d=Math.hypot(me.x-agiota.x,me.y-agiota.y)||1;
      this.projectiles.push({id:`h${this.next++}`,source:'boleto-juros',x:agiota.x,y:agiota.y,vx:(me.x-agiota.x)/d*.12*SIM_HZ,vy:(me.y-agiota.y)/d*.12*SIM_HZ,radius:.22,hostile:true,until:this.tick+Math.floor(d/.12)});
    }
    if(SAY_DEMO==='ficou'){
      // BUG-…-balao-ficou-pra-tras: a crate's line, then the left-behind line 0.5 s later (inside the 2 s gap).
      if(this.tick%100===20)this.emit({type:'say',source:me.id,key:'no-coco',line:'Caixa limpa. Nem o rato quis.'});
      if(this.tick%100===30){this.emit({type:'say',source:me.id,key:'ficou-pra-tras',line:'Ficou pra trás no rolê. Boa sorte!'});(window as {__ficouAt?:number}).__ficouAt=this.tick;}
    }else if(this.tick%30===1)this.emit({type:'say',source:me.id,key:'devendo',line:'Tá devendo!'});
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
    this.tick++;
    if(this.lineup){
      this.lineUpDanger();this.lineUpCharge();
      for(const b of this.projectiles){b.x+=b.vx/SIM_HZ;b.y+=b.vy/SIM_HZ;} // vx/vy in units per second, like the sim and the wire
      this.projectiles=this.projectiles.filter(b=>b.until>this.tick);
      this.telegraphs=this.telegraphs.filter(t=>t.fireTick>this.tick);
      if(this.tick%45===7&&this.enemies.length){const e=this.rng.pick(this.enemies);this.emit({type:'bark',enemy:e.id,line:this.rng.pick(BARKS[e.kind]??BARKS.bebado)});}
      return;
    }
    this.movePlayers();
    const dt=1/SIM_HZ;
    for(const e of this.enemies){
      let best=this.players[0],bd=Infinity;
      for(const p of this.players){const d=(p.x-e.x)**2+(p.y-e.y)**2;if(d<bd){bd=d;best=p;}}
      const d=Math.sqrt(bd);if(d<.6&&!e.boss)continue;
      const zig=e.kind==='pombos'?Math.sin(this.tick*.5+e.wobble)*.9:0;
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
      this.projectiles.push({id:`b${this.next++}`,source:'boleto',x:p.x,y:p.y,vx:Math.cos(a)*.35*SIM_HZ,vy:Math.sin(a)*.35*SIM_HZ,radius:.18,hostile:false,until:this.tick+24});
    }
    for(const e of this.enemies)if(e.kind==='agiota'&&this.rng.chance(.008)){
      const p=this.rng.pick(this.players),d=Math.hypot(p.x-e.x,p.y-e.y)||1;
      this.projectiles.push({id:`h${this.next++}`,source:'boleto-juros',x:e.x,y:e.y,vx:(p.x-e.x)/d*.22*SIM_HZ,vy:(p.y-e.y)/d*.22*SIM_HZ,radius:.2,hostile:true,until:this.tick+40});
    }
    for(const e of this.enemies)if(ACTS.has(e.kind))e.phase=Math.sin(this.tick*.03+e.wobble)>.4?1:undefined;
    for(const b of this.projectiles){b.x+=b.vx/SIM_HZ;b.y+=b.vy/SIM_HZ;} // vx/vy in units per second, like the sim and the wire
    this.projectiles=this.projectiles.filter(b=>b.until>this.tick);
    this.pickups=this.pickups.filter(p=>p.until>this.tick);
    this.telegraphs=this.telegraphs.filter(t=>t.fireTick>this.tick);
    const boss=this.enemies.find(e=>e.boss);
    if(boss&&this.tick%50===0){
      const shape=(['circle','line','cone'] as const)[(this.tick/50)%3],p=this.rng.pick(this.players),d=Math.hypot(p.x-boss.x,p.y-boss.y)||1;
      const t:TelegraphView={id:`t${this.next++}`,shape,x:shape==='circle'?p.x:boss.x,y:shape==='circle'?p.y:boss.y,radius:shape==='circle'?1.6:shape==='line'?7:4,dx:(p.x-boss.x)/d,dy:(p.y-boss.y)/d,width:shape==='line'?1.2:shape==='cone'?1.1:undefined,fireTick:this.tick+30};
      this.telegraphs.push(t);this.emit({type:'telegraph',telegraph:t.id});
    }
    if(this.tick%45===7&&this.enemies.length){const e=this.rng.pick(this.enemies);const lines=BARKS[e.kind]??BARKS.bebado;this.emit({type:'bark',enemy:e.id,line:this.rng.pick(lines)});}
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
  /** ?elenco=1: the first player's "você" marks with both D-036 status chips (slowed by a burp, slipping on poop). */
  private you?:YouMarkers;
  private youMark?:HeroMark;private youMarks:HeroMark[]=[];
  /** Follow camera on the first fake player (the game camera); `overview` keeps the old whole-island framing. */
  follow=new FollowCamera();
  overview=new URLSearchParams(location.search).get('camera')==='ilha';
  /** forced: the ?reduced=1 flag; the OS preference is followed live on top of it. */
  constructor(private field:TerrainField,private count:number,view:number,forced:boolean,private seed:number){super('horde-sandbox');this.view=normalizeView(view);this.forceReduced=forced;this.reduced=forced||matchMedia('(prefers-reduced-motion: reduce)').matches;}
  private forceReduced:boolean;
  preload(){
    this.load.image('terrain-soil','/art/terrain/soil-grass.webp');this.load.image('terrain-bed','/art/terrain/riverbed.webp');
    // Imported art v2 (scripts/import-art-v2.mjs) previews here too; without a manifest the procedural art stays.
    queueHordeArt(this);
    for(const tree of treeCatalog.slice(0,6))this.load.spritesheet(`tree:${tree.id}`,treeUrl(tree.id),{frameWidth:256,frameHeight:384});
    for(let i=0;i<PLAYER_COUNT;i++)this.sprites.queue(classes[(i*5)%classes.length].id);
  }
  create(){
    this.cameras.main.setBackgroundColor(token('--cena-mar'));
    this.landscape=new TerrainRenderer(this,this.field);this.landscape.view(this.view);
    const trees=treeCatalog.slice(0,6);let i=0;
    for(const o of obstacles){
      if(o.kind==='rock'||!trees.length)continue;
      const tree=trees[i++%trees.length],p=this.project(o);
      const image=this.add.image(p.x,p.y,`tree:${tree.id}`,this.view).setOrigin(.5,353/384).setScale(tree.height/tree.pixelHeight).setDepth(this.depth(o));
      this.props.push({point:o,image});
    }
    const lineup=new URLSearchParams(location.search).get('elenco')==='1';
    this.horde=new FakeHorde(this.field,this.count,this.seed,lineup,this.scale.height>=this.scale.width);
    this.projector=new Projector(this.view,this.field);
    // The whole-island overview zooms out to ~0.26 on a phone: scale text and bars back to a readable screen size.
    this.layers=new HordeRenderer(this,{projector:this.projector,uiScale:()=>Math.max(1,Math.min(2.5,.55/this.cameras.main.zoom)),reduced:this.reduced,effects:new URLSearchParams(location.search).get('fx')==='reduced'?'reduced':'full',tickMs:1000/SIM_HZ,
      // The line-up shows the "DEVENDO" tag over the first player: balloons need to find players (the horde run leaves it off).
      locate:lineup?(id:string)=>this.horde.players.find(p=>p.id===id):undefined});
    // `apagao=1` (art-d item 5): the critters show their blackout eyes (imported `olhos-escuro` when it is in); the dark
    // rectangle itself belongs to the zueira layer of the game, not drawn here.
    if(new URLSearchParams(location.search).get('apagao')==='1')this.layers.setBlackout(.8);
    const motion=matchMedia('(prefers-reduced-motion: reduce)'),onMotion=()=>{this.reduced=this.forceReduced||motion.matches;this.layers.setReduced(this.reduced);this.you?.setReduced(this.reduced);};
    motion.addEventListener('change',onMotion);
    this.events.once('shutdown',()=>{motion.removeEventListener('change',onMotion);this.scale.off('resize',this.fit,this);this.layers.destroy();this.you?.destroy();});
    for(let k=0;k<PLAYER_COUNT;k++)this.actors.push(this.add.sprite(0,0,'__DEFAULT').setOrigin(.5,.88));
    if(lineup){
      this.you=new YouMarkers(this,this.reduced);
      this.youMark={id:'p0',sprite:this.actors[0],self:true,feet:{x:0,y:0},covered:false,hp:70,maxHp:100,downed:false,slow:true,slip:true};
    }
    this.layers.push(this.horde.view());
    this.scale.on('resize',this.fit,this);this.fit();
  }
  project(p:Point){return projectView(p,this.view,this.field);}
  depth(p:Point){return viewDepth(p,this.view);}
  fit(){
    if(this.overview){
      const frame=fitIsland(this.scale.width,this.scale.height,this.view,this.field);
      this.cameras.main.setSize(this.scale.width,this.scale.height).setZoom(frame.zoom).centerOn(frame.x,frame.y);
      this.landscape?.fit();return;
    }
    const viewport={width:this.scale.width,height:this.scale.height},zoom=followZoom(viewport);
    const c=this.follow.snap(this.project(this.horde.players[0]),viewport,zoom);
    this.cameras.main.setSize(viewport.width,viewport.height).setZoom(zoom).centerOn(c.x,c.y);
    this.landscape?.fit(.2);
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
    if(this.you&&this.youMark){
      const feet=this.project(this.horde.players[0]);this.youMark.feet.x=feet.x;this.youMark.feet.y=feet.y;
      this.actors[0].setDepth(96500);this.youMarks[0]=this.youMark;this.you.update(time,this.cameras.main.zoom,this.youMarks);
    }
    if(!this.overview){
      const viewport={width:this.scale.width,height:this.scale.height};
      const c=this.follow.step(this.project(this.horde.players[0]),delta/1000,viewport,this.cameras.main.zoom);
      this.cameras.main.centerOn(c.x,c.y);
      if(this.landscape&&!this.landscape.covers())this.landscape.fit(.2);
    }
  }
}

declare global {interface Window {__horde?:Record<string,unknown>}}

export async function openHordeSandbox(){
  await artReady();
  const params=new URLSearchParams(location.search);
  // ?arte=bebado:dono-do-boteco,anao-molotov:espetinho-suspeito — preview of roster art (pack 04…) in a current kind's
  // slot, until the roster art is wired in the render. Sandbox only: the game never reads this.
  for(const pair of (params.get('arte')??'').split(',')){const [kind,id]=pair.split(':');if(kind&&id&&Object.hasOwn(ENEMY_ART_ID,kind))(ENEMY_ART_ID as Record<string,string>)[kind]=id;}
  const count=Math.max(0,Math.min(1000,Number(params.get('n')??300)||0));
  const seed=Number(params.get('seed'))||DEFAULT_SEED;
  const reduced=params.get('reduced')==='1';
  const root=document.createElement('div');
  root.style.cssText=`position:fixed;inset:0;z-index:10000;background:${token('--cena-mar')};overflow:hidden;touch-action:none`;
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
  pause.onclick=()=>{scene.paused=!scene.paused;pause.textContent=scene.paused?'Seguir':'❚❚';pause.setAttribute('aria-label',scene.paused?'Continuar a horda':'Pausar a horda');};
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
