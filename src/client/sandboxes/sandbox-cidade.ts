/**
 * Cidade Nevada render sandbox (cards cidade-03a, cidade-04, cidade-03, barricadas-cliente):
 * `?sandbox=cidade[&mapa=real][&n=300][&view=0..3][&hero=cx,cy][&class=id][&cells=N][&base=1[&fase=prepare|wave]]`.
 *
 * Query params:
 *  - `mapa=real`: the real asset instead of the stand-in city.
 *  - `n=N` (0..600): stand-in enemies wandering around the hero.
 *  - `view=0..3`: camera view (quarter turns); the round button turns it too.
 *  - `hero=cx,cy`: hero start in cells.
 *  - `class=id`: the hero's class sheet (default cidadao-comum).
 *  - `cells=N`: visible width in cells instead of the game's city zoom.
 *  - `base=1`: mounts the game's StonewardsRenderer (render/stonewards.ts) with fake, fixed views around the plaza
 *    (asset point `praca`; else the hero start), in a compact layout that fits a 390×844 screen (not the real mouth
 *    positions): the wall at the centre (70% life), the 4 barricades at 2.2 u — N whole (inteira, 100%), L damaged
 *    (avariada, 50%), S about to fall (quase-caindo, 20%: low bar) and O broken (quebrada, 0 = down) —, a chinelo tower,
 *    2 gather nodes (coco ×2 being gathered, pedra) and 1 loot crate (`caixa-0`). Without `hero`, the hero stands just
 *    south of the wall. Deterministic: one view pushed once, no clock in it (no hit flash, no pops).
 *  - `fase=prepare|wave` (with base=1, default prepare): the intermission shows the camp ring and the nodes; the wave
 *    hides them (wall, barricades and tower stay).
 * The imported `base` art is used when /art/manifest.json has it (art/base-art.ts); otherwise the Graphics fallback.
 * Draws the stand-in city (render/city/sample.ts) or, with `mapa=real`, the real asset (public/maps/cidade-nevada.json,
 * decoded by the maps sector and converted by render/city/from-maps.ts) with the real city layer and the real hero
 * sheet at its actor depth, framed like the game in the city (D-030): framing.ts cityZoom (rules zoomFor with the 56 px
 * hero floor: ≈15.07 cells on 844×390, ≈6.96 on 390×844) and the sheet scaled by CITY_VIEW_SCALE, so the hero draws
 * ≈56 CSS px (≈1 cell). `cells` overrides the visible width (cells along screen x) for comparisons. Rotating re-fits.
 * `n` adds that many stand-in enemies wandering around the hero, drawn at the layer's actor depth every frame.
 * Tap the city to move the hero (any piece in front of it turns see-through); the round button turns the view.
 * `window.__cidade` holds the numbers to check against a screenshot (zoom, hero px, visible cells, view) and the FPS
 * meter (`fps()`, `worst()`, `samples()`) to compare with `?sandbox=horda`.
 * `tele=1` (with `mapa=real`; card cidade-contorno-breu): the game's own city-mode drawing around the hero, through the
 * same code as the scene: HordeRenderer (city on) with a circle, a line and a cone telegraph, two critters and an XP
 * gem on their Breu 38% shadows; the "você" ring (YouMarkers), a plain and a caído map ficha (MapLabel) and the
 * destination mark (city-edge-rules.ts). One static view is pushed: nothing animates but the dash drift (none with
 * prefers-reduced-motion) and the hero's idle sheet.
 * Imported art (card ligar-arte-v2): the city's buildings, rubble, props and fountain from `/art/manifest.json`
 * (render/city/art-plan.ts); `arte=0` draws without it, `altura=a|b` picks the building scale (a: 1 storey ≈ 2.4 u on
 * 2×2-cell lots, b: as delivered).
 * `relevo=0` draws the flat ground (no relief shader); `relevo=morros` (with `mapa=real`) adds stand-in snow hills to the
 * real map (render/city/relevo/preview.ts) to judge the relief shader before the real height field lands.
 * Fake data only; nothing talks to the server.
 */
import Phaser from 'phaser';
import {previewHills} from '../render/city/relevo/preview.ts';
import {CITY_PALETTE,CityLayer,OUTSIDE_CITY,PINE_TEXTURE,buildCityArtPlan,cityArtOptions,cityRenderAsset,groundZ,makeSampleCity,parseCityAsset,project,queueCityArt,unproject,type CityArtPlan,type CityAsset} from '../render/city/index.ts';
import {artIndex,loadArtManifest} from '../art/manifest.ts';
import {CharacterSprites} from '../sprites/character-sprites.ts';
import {spriteCatalog} from '../sprites/sprite-catalog.ts';
import {CITY_VIEW_SCALE,FollowCamera,cityZoom,hordeUiScale} from '../framing.ts';
import {CITY_HERO_SPEED,CityTerrain,decodeCityAsset,type TerrainField} from '../../maps/index.ts';
import {HERO_WORLD_PX,SIM_HZ,TILE_X,type NodeView,type RunView,type StructureView} from '../../contract/index.ts';
import {TOWER_SECONDS} from '../../rules/index.ts';
import {HordeRenderer} from '../render/layers.ts';
import {Projector} from '../render/projector.ts';
import {StonewardsRenderer} from '../render/stonewards.ts';
import {YouMarkers} from '../render/you.ts';
import {MapLabel} from '../render/map-labels.ts';
import {destinationMark} from '../render/city-edge-rules.ts';
import {CityOutlines} from '../render/city-outline.ts';
import {cityGroundLuminance} from '../render/city-outline-rules.ts';
import {ENEMY_KINDS,PICKUP_KINDS} from '../render/keys.ts';
import {tokenColor} from '../ui/tokens.ts';
import {queueBaseArt} from '../art/base-art.ts';

const params=new URLSearchParams(location.search);
const real=params.get('mapa')==='real';
const heroParam=params.get('hero');
const cellsOverride=Number(params.get('cells'))||undefined;
const wanted=params.get('class')??'cidadao-comum';
const classId=spriteCatalog[wanted]?wanted:'cidadao-comum';
const enemies=Math.max(0,Math.min(600,Number(params.get('n'))|0));
const base=params.get('base')==='1';
const basePhase:'prepare'|'wave'=params.get('fase')==='wave'?'wave':'prepare';
/** Distance (u) of the showcase barricades from the wall: compact, so all four fit a 390×844 screen. */
const BASE_R=2.2;
/** Where the hero stands without `hero`, from the wall (u): just south of it, in front of the camera. */
const BASE_HERO={x:.6,y:1.2};
const tele=real&&params.get('tele')==='1';
/**
 * Card contorno-breu: the city's screen-scale Breu outlines (render/city-outline.ts) on the hero and, with tele=1, on
 * the horde; `contorno=0` draws without them (before/after). `elenco=1` (with tele=1) adds one critter of every kind,
 * an elite and every pickup in a ring around the hero, to see them on the ground under the hero (`hero=cx,cy`).
 */
const outlinesOn=params.get('contorno')!=='0';
const cast=tele&&params.get('elenco')==='1';
const reducedMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

const style=document.createElement('style');
style.textContent=`html,body{margin:0;height:100%;overflow:hidden;background:#2B2542}body>:not(#cidade){display:none!important}
#cidade{position:fixed;inset:0;z-index:5}
.cidade-turn{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:6;
width:56px;height:56px;border-radius:50%;border:2px solid #1E1530;background:#EEDDB8;color:#1E1530;font:700 26px system-ui;
box-shadow:0 3px 0 #1E153066}
.cidade-fps{position:fixed;left:max(8px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));z-index:6;
padding:2px 8px;border-radius:8px;background:#1E1530cc;color:#EEDDB8;font:700 13px system-ui}`;
document.head.append(style);
const host=document.createElement('div');host.id='cidade';document.body.append(host);

/** Deterministic small PRNG for the stand-in horde (no Math.random: same run every reload). */
function mulberry(seed:number){return ()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}

/** Frame times of the last seconds, for the FPS meter and scripted measurements. */
const frames:number[]=[];
const meter={fps:()=>frames.length?1000/(frames.reduce((s,f)=>s+f,0)/frames.length):0,
  worst:()=>frames.length?1000/Math.max(...frames):0,samples:()=>frames.length};

interface Wanderer {x:number;y:number;tx:number;ty:number;speed:number;image:Phaser.GameObjects.Image}

class CitySandbox extends Phaser.Scene {
  private layer?:CityLayer;
  private asset!:CityAsset;
  private hero!:Phaser.GameObjects.Sprite;
  private shadow!:Phaser.GameObjects.Ellipse;
  private outlines=new CityOutlines(this,{active:()=>outlinesOn,zoom:()=>this.cameras.main.zoom,
    groundLuminance:(x,y)=>this.asset?cityGroundLuminance(this.asset,x,y):undefined});
  private sprites=new CharacterSprites(this,this.outlines);
  private camera=new FollowCamera();
  private view=Math.max(0,Math.min(3,Number(params.get('view'))|0));
  private at={x:0,y:0};
  private horde:Wanderer[]=[];
  private rng=mulberry(7);
  private fpsLabel?:HTMLElement;
  private stone?:StonewardsRenderer;
  private projector?:Projector;
  /** tele=1: the game's city-mode renderers. */
  private lab?:{horde:HordeRenderer;projector:Projector;you:YouMarkers;labels:MapLabel[];destination:Phaser.GameObjects.Graphics};
  private decoded?:CityTerrain;
  constructor(){super('city-sandbox');}
  private art?:CityArtPlan;
  preload(){
    this.load.spritesheet(PINE_TEXTURE,'/art/lite/trees/arvore-nevada.webp',{frameWidth:256,frameHeight:384});
    this.art=buildCityArtPlan(artIndex(),cityArtOptions(location.search));
    queueCityArt(this,this.art);
    this.sprites.queue(classId);
    if(real)this.load.text('cidade-real','/maps/cidade-nevada.json');
    if(base)queueBaseArt(this); // the manifest is loaded before the game starts (see the bottom of this file)
  }
  create(){
    if(real){
      const decoded=decodeCityAsset(this.cache.text.get('cidade-real'));
      if(!decoded.ok)throw new Error(`city asset: ${decoded.error}`);
      this.asset=cityRenderAsset(decoded.asset);
      if(params.get('relevo')==='morros')this.asset=previewHills(this.asset);
      if(tele)this.decoded=new CityTerrain(decoded.asset,'sandbox');
    }else this.asset=parseCityAsset(makeSampleCity());
    const start=heroParam?heroParam.split(',').map(Number):undefined,inicio=this.asset.points.inicio;
    this.at=start?{x:start[0]*this.asset.cell,y:start[1]*this.asset.cell}:real&&inicio?{...inicio}:{x:6.5*this.asset.cell,y:3.3*this.asset.cell};
    const centre=base?this.asset.points.praca??{...this.at}:undefined;
    if(centre&&!start)this.at={x:centre.x+BASE_HERO.x,y:centre.y+BASE_HERO.y};
    this.cameras.main.setBackgroundColor(OUTSIDE_CITY);
    this.layer=new CityLayer(this,this.asset,{art:this.art});
    this.layer.setActorScale(CITY_VIEW_SCALE);
    // The game scene's city figures: the sheet and its contact shadow (Breu 38%) scaled by CITY_VIEW_SCALE.
    this.sprites.viewScale=CITY_VIEW_SCALE;
    this.camera.world={scale:CITY_VIEW_SCALE,speed:CITY_HERO_SPEED};
    this.shadow=this.add.ellipse(0,0,42,17,CITY_PALETTE.breu,.38).setScale(CITY_VIEW_SCALE);
    this.hero=this.add.sprite(0,0,'__DEFAULT');
    this.sprites.animate(this.hero,classId,this.at.x,this.at.y,0,true,this.view);
    this.spawnHorde();
    if(centre)this.mountBase(centre);
    if(tele)this.buildLab();
    this.fit();
    this.scale.on('resize',()=>{this.fit();});
    this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{
      const w=unproject(p.worldX,p.worldY,0,this.view);
      const max={x:this.asset.width*this.asset.cell,y:this.asset.height*this.asset.cell};
      this.at={x:Math.max(0,Math.min(max.x,w.x)),y:Math.max(0,Math.min(max.y,w.y))};
      this.place();
    });
    const turn=document.createElement('button');
    turn.className='cidade-turn';turn.type='button';turn.textContent='↻';turn.setAttribute('aria-label','Girar a câmera');
    turn.addEventListener('click',e=>{e.stopPropagation();this.view=(this.view+1)%4;this.place();if(this.projector){this.projector.view=this.view;this.stone?.refresh();}});
    host.append(turn);// inside the sandbox root: everything else in body is hidden
    if(enemies){this.fpsLabel=document.createElement('div');this.fpsLabel.className='cidade-fps';host.append(this.fpsLabel);}
    // Warm the fade so a covering building is already translucent on the first screenshot.
    for(let i=0;i<12;i++)this.tick(16);
  }
  update(_t:number,dt:number){
    frames.push(dt);if(frames.length>240)frames.shift();
    if(this.fpsLabel&&frames.length%30===0)this.fpsLabel.textContent=`${meter.fps().toFixed(0)} fps · ${enemies} bichos`;
    this.sprites.animate(this.hero,classId,this.at.x,this.at.y,0,true,this.view);
    this.moveHorde(dt);
    this.tick(dt);
    this.stone?.update(_t);
    this.drawLab(_t,dt);
  }
  /**
   * `base=1`: the game's Stonewards renderer on a projector equal to the city layer's (same rotation pivot, the
   * city's ground height in px, the layer's actor depth), fed one fixed RunView around `c` (see the header).
   */
  private mountBase(c:{x:number;y:number}){
    const asset=this.asset,layer=this.layer;
    // World px per unit of city height, from the city projection itself (no second constant).
    const heightPx=project(0,0,0,0).y-project(0,0,1,0).y;
    const ground={height:(x:number,y:number)=>groundZ(asset,x,y)*heightPx} as unknown as TerrainField;
    const projector=new Projector(this.view,ground);
    projector.depthOverride=(x,y)=>layer?layer.actorDepth(x,y,groundZ(asset,x,y)):0;
    this.projector=projector;
    this.stone=new StonewardsRenderer(this,{projector,reduced:false,hero:()=>this.at,actorScale:()=>CITY_VIEW_SCALE});
    const at=(dx:number,dy:number)=>({x:+(c.x+dx).toFixed(3),y:+(c.y+dy).toFixed(3)});
    const tick=1000,R=BASE_R;
    const structures:StructureView[]=[
      {id:'s1',kind:'muralha',...at(0,0),hp:420,maxHp:600},
      {id:'s2',kind:'barricada',...at(0,-R),hp:300,maxHp:300},
      {id:'s3',kind:'barricada',...at(R,0),hp:150,maxHp:300},
      {id:'s4',kind:'barricada',...at(0,R),hp:60,maxHp:300},
      {id:'s5',kind:'barricada',...at(-R,0),hp:0,maxHp:300},
      {id:'s6',kind:'torre-chinelo',...at(-1.5,1.1),hp:80,maxHp:80,untilTick:tick+Math.round(TOWER_SECONDS*SIM_HZ*.6)},
    ];
    const nodes:NodeView[]=[
      {id:'n1',kind:'coco',...at(1.4,-1.3),remaining:3,capacity:4,value:2,progress:.5},
      {id:'n2',kind:'pedra',...at(-1.5,-1.2),remaining:2,capacity:4,value:1,progress:0},
      {id:'caixa-0',kind:'pedra',...at(1.9,.9),remaining:1,capacity:1,value:6,progress:0},
    ];
    const view:RunView={tick,team:{xp:0,level:1,nextXp:10},round:{index:1,total:10,phase:basePhase,phaseEndsTick:tick+600,remaining:0},
      enemies:[],pickups:[],projectiles:[],telegraphs:[],structures,nodes:basePhase==='prepare'?nodes:[],camp:{coco:4,pedra:4},
      players:[],offers:[],events:[]};
    this.stone.push(view);
  }
  /** tele=1: renderers of the game in city mode, fed one static view around the hero (world units). */
  private buildLab(){
    if(!this.decoded)return;
    const projector=new Projector(this.view,this.decoded);
    projector.depthOverride=(x,y)=>this.layer?this.layer.actorDepth(x,y):0;
    const horde=new HordeRenderer(this,{projector,uiScale:()=>hordeUiScale(this.cameras.main.zoom,CITY_VIEW_SCALE),actorScale:()=>CITY_VIEW_SCALE,
      reduced:reducedMotion,city:()=>true,cityOutlines:this.outlines});
    const {x,y}=this.at,tick=100;
    const view:RunView={tick,team:{xp:0,level:1,nextXp:5},structures:[],players:[],offers:[],events:[],projectiles:[],
      telegraphs:[
        {id:'t-circle',shape:'circle',x:x+2.2,y:y-1.6,radius:1.15,fireTick:tick+30},
        {id:'t-line',shape:'line',x:x-1.2,y:y+1.4,radius:3.2,dx:-1,dy:.35,width:.9,fireTick:tick+12},
        {id:'t-cone',shape:'cone',x:x+.9,y:y+1.1,radius:2.4,dx:.45,dy:1,width:1.1,fireTick:tick+3},
      ],
      enemies:[{id:'e1',kind:'bebado',x:x-1.6,y:y-1.2,hp:5,maxHp:5},{id:'e2',kind:'agiota',x:x+1.5,y:y-.2,hp:5,maxHp:5}],
      pickups:[{id:'g1',kind:'xp',x:x-.7,y:y-2.1,value:5}]};
    horde.push(cast?withCast(view,x,y):view);
    const you=new YouMarkers(this,reducedMotion,this.outlines);you.setCity(true);you.showArrow(-1e9);
    const labels=[new MapLabel(this,'Concursei').setCity(true),new MapLabel(this,'Tia, 18 s').setCity(true).setSos(true)];
    const destination=this.add.graphics().setDepth(100000);
    this.lab={horde,projector,you,labels,destination};
    this.markDestination();
  }
  /** The destination mark of scene.ts goTo, a little ahead of the hero. */
  private markDestination(){
    const lab=this.lab;if(!lab)return;
    const p=lab.projector.project(this.at.x-2.6,this.at.y-.4,{x:0,y:0});
    const m=destinationMark(CITY_VIEW_SCALE,1/Math.max(.05,this.cameras.main.zoom),true),breu=tokenColor('--c-breu'),papel=tokenColor('--c-papel');
    lab.destination.clear().lineStyle(m.breu,breu,m.breuAlpha).strokeEllipse(p.x,p.y,m.width,m.height).lineStyle(m.papel,papel,1).strokeEllipse(p.x,p.y,m.width,m.height)
      .fillStyle(breu,m.breuAlpha).fillCircle(p.x,p.y,m.dotBreu).fillStyle(papel,1).fillCircle(p.x,p.y,m.dotPapel);
  }
  private drawLab(time:number,dt:number){
    const lab=this.lab;if(!lab)return;
    lab.projector.view=this.view;
    lab.horde.update(time,dt);
    const feet={x:this.hero.x,y:this.hero.y},zoom=this.cameras.main.zoom;
    lab.you.update(time,zoom,[{id:'self',sprite:this.hero,self:true,feet,covered:false,hp:1,maxHp:1,downed:false,facing:Math.PI/2}]);
    // Two fichas as the scene anchors an ally's (15 px under the feet × the actor scale), beside the hero.
    const q=lab.projector.project(this.at.x+3.5,this.at.y+.5,{x:0,y:0}),r=lab.projector.project(this.at.x-3.5,this.at.y-1,{x:0,y:0});
    lab.labels[0].anchor(q.x,q.y+15*CITY_VIEW_SCALE,96401).draw(zoom,true);
    lab.labels[1].anchor(r.x,r.y+15*CITY_VIEW_SCALE,96401).draw(zoom,true);
  }
  /** The game's city zoom for this viewport (or the `cells` override), then the camera onto the hero. */
  private fit(){
    const viewport={width:this.scale.width,height:this.scale.height};
    const zoom=cellsOverride?viewport.width/(cellsOverride*this.asset.cell*TILE_X*Math.SQRT2):cityZoom(viewport);
    this.cameras.main.setSize(viewport.width,viewport.height).setZoom(zoom);
    this.place();
  }
  /** Stand-in enemies: one shared Breu-ringed disc texture, scaled like the city figures, wandering around the hero. */
  private spawnHorde(){
    if(!enemies)return;
    if(!this.textures.exists('cidade:bicho')){
      const t=this.make.graphics({x:0,y:0},false);
      t.fillStyle(CITY_PALETTE.breu,0.38).fillEllipse(24,44,30,10);
      t.fillStyle(0x7fae5a,1).fillCircle(24,26,15).lineStyle(2,CITY_PALETTE.breu,1).strokeCircle(24,26,15);
      t.generateTexture('cidade:bicho',48,52);t.destroy();
    }
    for(let i=0;i<enemies;i++){
      const a=this.rng()*Math.PI*2,r=2+this.rng()*9;
      const x=this.at.x+Math.cos(a)*r,y=this.at.y+Math.sin(a)*r;
      this.horde.push({x,y,tx:x,ty:y,speed:1.6+this.rng()*0.6,image:this.add.image(0,0,'cidade:bicho').setOrigin(.5,.85).setScale(CITY_VIEW_SCALE)});
    }
  }
  private moveHorde(dt:number){
    const s=Math.min(0.05,dt/1000);
    for(const w of this.horde){
      const dx=w.tx-w.x,dy=w.ty-w.y,d=Math.hypot(dx,dy);
      if(d<0.2){const a=this.rng()*Math.PI*2,r=1.5+this.rng()*8;w.tx=this.at.x+Math.cos(a)*r;w.ty=this.at.y+Math.sin(a)*r;continue;}
      w.x+=dx/d*w.speed*s;w.y+=dy/d*w.speed*s;
    }
  }
  /** Hero at the layer's actor depth (city mode: no fixed SELF_DEPTH), camera snapped like the game's follow camera. */
  private place(){
    const feet=project(this.at.x,this.at.y,groundZ(this.asset,this.at.x,this.at.y),this.view),cam=this.cameras.main,zoom=cam.zoom;
    this.hero.setPosition(feet.x,feet.y);this.shadow.setPosition(feet.x,feet.y);
    const viewport={width:this.scale.width,height:this.scale.height};
    const c=this.camera.snap(feet,viewport,zoom);
    cam.centerOn(c.x,c.y);
    if(this.lab){this.lab.horde.refresh();this.markDestination();}
    (window as unknown as {__cidade:unknown}).__cidade={...meter,outlines:()=>this.outlines.stats(),relief:()=>this.layer?.reliefStats(),zoom,view:this.view,classId,scale:CITY_VIEW_SCALE,base:base?basePhase:false,
      heroPx:HERO_WORLD_PX*CITY_VIEW_SCALE*zoom,visibleCells:viewport.width/zoom/(TILE_X*Math.SQRT2)/this.asset.cell,
      viewport,orientation:viewport.width>viewport.height?'landscape':'portrait'};
  }
  private tick(dt:number){
    const cam=this.cameras.main.worldView,layer=this.layer;
    if(!layer)return;
    const z=groundZ(this.asset,this.at.x,this.at.y);
    layer.update({camera:{x:cam.x,y:cam.y,w:cam.width,h:cam.height},view:this.view,dtMs:dt,hero:{...this.at,z}});
    const d=layer.actorDepth(this.at.x,this.at.y,z);this.hero.setDepth(d);this.shadow.setDepth(d-1);
    for(const w of this.horde){
      const wz=groundZ(this.asset,w.x,w.y),p=project(w.x,w.y,wz,this.view);
      w.image.setPosition(p.x,p.y).setDepth(layer.actorDepth(w.x,w.y,wz));
    }
  }
}

const start=()=>new Phaser.Game({type:Phaser.AUTO,parent:host,backgroundColor:'#2B2542',scene:[CitySandbox],
  scale:{mode:Phaser.Scale.RESIZE,width:innerWidth,height:innerHeight},render:{antialias:true}});
// The art manifest first (as the game does at boot): the city art (unless arte=0) and, with base=1, the base art.
if(base||params.get('arte')!=='0')void loadArtManifest().then(start);else start();

/** elenco=1: one critter of every kind (and an elite bêbado) and every pickup on a ring around (x, y), world units. */
function withCast(view:RunView,x:number,y:number):RunView{
  const kinds=[...ENEMY_KINDS.filter(k=>k!=='chefe'),'bebado'],n=kinds.length+PICKUP_KINDS.length;
  const at=(i:number,r:number)=>({x:x+Math.cos(i/n*Math.PI*2)*r,y:y+Math.sin(i/n*Math.PI*2)*r});
  return {...view,
    enemies:[...view.enemies,...kinds.map((kind,i)=>({id:`c${i}`,kind,elite:i===kinds.length-1,...at(i,2.6),hp:5,maxHp:5}))],
    pickups:[...view.pickups,...PICKUP_KINDS.map((kind,i)=>({id:`p${i}`,kind,...at(kinds.length+i,1.7),value:kind==='xp'?5:1}))]};
}
