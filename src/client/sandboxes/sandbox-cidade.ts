/**
 * Cidade Nevada render sandbox (cards cidade-03a/03): `?sandbox=cidade[&mapa=real][&n=300][&view=0..3][&hero=cx,cy][&cells=N]`.
 * Draws the stand-in city (render/city/sample.ts) or, with `mapa=real`, the real asset (public/maps/cidade-nevada.json,
 * decoded by the maps sector and converted by render/city/from-maps.ts) with the real city layer and a stand-in hero.
 * `n` adds that many stand-in enemies wandering around the hero, drawn at the layer's actor depth every frame, and an
 * FPS meter (`window.__cidade.fps()/worst()`) to compare with `?sandbox=horda`.
 * Tap the city to move the hero (buildings in front of it turn translucent); the round button turns the view.
 * Fake data only; nothing talks to the server.
 */
import Phaser from 'phaser';
import {decodeCityAsset} from '../../maps/index.ts';
import {CITY_PALETTE,CityLayer,OUTSIDE_CITY,PINE_TEXTURE,cityRenderAsset,groundZ,makeSampleCity,parseCityAsset,project,unproject,type CityAsset} from '../render/city/index.ts';

const params=new URLSearchParams(location.search);
const real=params.get('mapa')==='real';
const heroParam=params.get('hero');
const portrait=innerHeight>innerWidth;
const cells=Number(params.get('cells'))||(portrait?10.5:18);
const enemies=Math.max(0,Math.min(600,Number(params.get('n'))|0));
/** Hero colour: the art lane's scarf pink (palette.json "zueira.cachecol"). */
const SCARF=0xc85a7a,SKIN=0xf2d3b8;

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
(window as unknown as {__cidade:typeof meter}).__cidade=meter;

interface Wanderer {x:number;y:number;tx:number;ty:number;speed:number;image:Phaser.GameObjects.Image}

class CitySandbox extends Phaser.Scene {
  private layer?:CityLayer;
  private asset!:CityAsset;
  private hero!:Phaser.GameObjects.Graphics;
  private view=Math.max(0,Math.min(3,Number(params.get('view'))|0));
  private at={x:0,y:0};
  private horde:Wanderer[]=[];
  private rng=mulberry(7);
  private fpsLabel?:HTMLElement;
  constructor(){super('city-sandbox');}
  preload(){
    this.load.spritesheet(PINE_TEXTURE,'/art/lite/trees/arvore-nevada.webp',{frameWidth:256,frameHeight:384});
    if(real)this.load.text('cidade-real','/maps/cidade-nevada.json');
  }
  create(){
    if(real){
      const decoded=decodeCityAsset(this.cache.text.get('cidade-real'));
      if(!decoded.ok)throw new Error(`city asset: ${decoded.error}`);
      this.asset=cityRenderAsset(decoded.asset);
    }else this.asset=parseCityAsset(makeSampleCity());
    const start=heroParam?heroParam.split(',').map(Number):undefined;
    const inicio=this.asset.points.inicio;
    this.at=start?{x:start[0]*this.asset.cell,y:start[1]*this.asset.cell}:real&&inicio?{...inicio}:{x:6.5*this.asset.cell,y:3.3*this.asset.cell};
    this.cameras.main.setBackgroundColor(OUTSIDE_CITY);
    this.layer=new CityLayer(this,this.asset);
    // Stand-in hero: Breu-outlined capsule with a contact shadow (art bible: Breu 38%).
    const g=this.hero=this.add.graphics();
    g.fillStyle(CITY_PALETTE.breu,0.38).fillEllipse(0,0,40,16);
    g.fillStyle(SCARF,1).fillRoundedRect(-17,-80,34,72,14).lineStyle(2,CITY_PALETTE.breu,1).strokeRoundedRect(-17,-80,34,72,14);
    g.fillStyle(SKIN,1).fillCircle(0,-88,14).strokeCircle(0,-88,14);
    this.cameras.main.setZoom(this.scale.width/(cells*this.asset.cell*Math.hypot(42,21)*Math.SQRT2));
    this.spawnHorde();
    this.place();
    this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{
      const w=unproject(p.worldX,p.worldY,0,this.view);
      const max={x:this.asset.width*this.asset.cell,y:this.asset.height*this.asset.cell};
      this.at={x:Math.max(0,Math.min(max.x,w.x)),y:Math.max(0,Math.min(max.y,w.y))};
      this.place();
    });
    const turn=document.createElement('button');
    turn.className='cidade-turn';turn.type='button';turn.textContent='↻';turn.setAttribute('aria-label','Girar a câmera');
    turn.addEventListener('click',e=>{e.stopPropagation();this.view=(this.view+1)%4;this.place();});
    host.append(turn);// inside the sandbox root: everything else in body is hidden
    if(enemies){this.fpsLabel=document.createElement('div');this.fpsLabel.className='cidade-fps';host.append(this.fpsLabel);}
    // Warm the fade so a covering building is already translucent on the first screenshot.
    for(let i=0;i<12;i++)this.tick(16);
  }
  update(_t:number,dt:number){
    frames.push(dt);if(frames.length>240)frames.shift();
    if(this.fpsLabel&&frames.length%30===0)this.fpsLabel.textContent=`${meter.fps().toFixed(0)} fps · ${enemies} bichos`;
    this.moveHorde(dt);
    this.tick(dt);
  }
  /** Stand-in enemies: one shared Breu-ringed disc texture, wandering in a ring around the hero. */
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
      this.horde.push({x,y,tx:x,ty:y,speed:1.6+this.rng()*0.6,image:this.add.image(0,0,'cidade:bicho').setOrigin(.5,.85)});
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
  /** Hero at the layer's actor depth (city mode: no fixed SELF_DEPTH), camera centred on it. */
  private place(){
    const feet=project(this.at.x,this.at.y,groundZ(this.asset,this.at.x,this.at.y),this.view);
    this.hero.setPosition(feet.x,feet.y);
    this.cameras.main.centerOn(feet.x,feet.y-40);
  }
  private tick(dt:number){
    const cam=this.cameras.main.worldView,layer=this.layer;
    if(!layer)return;
    layer.update({camera:{x:cam.x,y:cam.y,w:cam.width,h:cam.height},view:this.view,dtMs:dt,hero:{...this.at,z:groundZ(this.asset,this.at.x,this.at.y)}});
    this.hero.setDepth(layer.actorDepth(this.at.x,this.at.y,groundZ(this.asset,this.at.x,this.at.y)));
    for(const w of this.horde){
      const z=groundZ(this.asset,w.x,w.y),p=project(w.x,w.y,z,this.view);
      w.image.setPosition(p.x,p.y).setDepth(layer.actorDepth(w.x,w.y,z));
    }
  }
}

new Phaser.Game({type:Phaser.AUTO,parent:host,backgroundColor:'#2B2542',scene:[CitySandbox],
  scale:{mode:Phaser.Scale.RESIZE,width:innerWidth,height:innerHeight},render:{antialias:true}});
