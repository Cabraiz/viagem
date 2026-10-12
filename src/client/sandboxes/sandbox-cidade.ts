/**
 * Cidade Nevada render sandbox (card cidade-03a): `?sandbox=cidade[&view=0..3][&hero=cx,cy][&cells=N]`.
 * Draws the stand-in city (render/city/sample.ts) with the real city layer and a stand-in hero at its world depth.
 * Tap the city to move the hero (buildings in front of it turn translucent); the round button turns the view.
 * Fake data only; nothing talks to the server and the game scene is untouched (wiring: card cidade-03).
 */
import Phaser from 'phaser';
import {CITY_PALETTE,CityLayer,OUTSIDE_CITY,PINE_TEXTURE,makeSampleCity,parseCityAsset,project,unproject,type CityAsset} from '../render/city/index.ts';

const params=new URLSearchParams(location.search);
const [startX,startY]=(params.get('hero')??'6.5,3.3').split(',').map(Number);
const portrait=innerHeight>innerWidth;
const cells=Number(params.get('cells'))||(portrait?10.5:18);
/** Hero colour: the art lane's scarf pink (palette.json "zueira.cachecol"). */
const SCARF=0xc85a7a,SKIN=0xf2d3b8;

const style=document.createElement('style');
style.textContent=`html,body{margin:0;height:100%;overflow:hidden;background:#2B2542}body>:not(#cidade){display:none!important}
#cidade{position:fixed;inset:0;z-index:5}
.cidade-turn{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:6;
width:56px;height:56px;border-radius:50%;border:2px solid #1E1530;background:#EEDDB8;color:#1E1530;font:700 26px system-ui;
box-shadow:0 3px 0 #1E153066}`;
document.head.append(style);
const host=document.createElement('div');host.id='cidade';document.body.append(host);

class CitySandbox extends Phaser.Scene {
  private layer?:CityLayer;
  private asset!:CityAsset;
  private hero!:Phaser.GameObjects.Graphics;
  private view=Math.max(0,Math.min(3,Number(params.get('view'))|0));
  private at={x:0,y:0};
  constructor(){super('city-sandbox');}
  preload(){this.load.spritesheet(PINE_TEXTURE,'/art/lite/trees/arvore-nevada.webp',{frameWidth:256,frameHeight:384});}
  create(){
    this.asset=parseCityAsset(makeSampleCity());
    this.at={x:startX*this.asset.cell,y:startY*this.asset.cell};
    this.cameras.main.setBackgroundColor(OUTSIDE_CITY);
    this.layer=new CityLayer(this,this.asset);
    // Stand-in hero: Breu-outlined capsule with a contact shadow (art bible: Breu 38%).
    const g=this.hero=this.add.graphics();
    g.fillStyle(CITY_PALETTE.breu,0.38).fillEllipse(0,0,40,16);
    g.fillStyle(SCARF,1).fillRoundedRect(-17,-80,34,72,14).lineStyle(2,CITY_PALETTE.breu,1).strokeRoundedRect(-17,-80,34,72,14);
    g.fillStyle(SKIN,1).fillCircle(0,-88,14).strokeCircle(0,-88,14);
    this.cameras.main.setZoom(this.scale.width/(cells*this.asset.cell*Math.hypot(42,21)*Math.SQRT2));
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
    // Warm the fade so a covering building is already translucent on the first screenshot.
    for(let i=0;i<12;i++)this.tick(16);
  }
  update(_t:number,dt:number){this.tick(dt);}
  /** Hero at the layer's actor depth (city mode: no fixed SELF_DEPTH), camera centred on it. */
  private place(){
    const feet=project(this.at.x,this.at.y,0,this.view);
    this.hero.setPosition(feet.x,feet.y);
    this.cameras.main.centerOn(feet.x,feet.y-40);
  }
  private tick(dt:number){
    const cam=this.cameras.main.worldView;
    this.layer?.update({camera:{x:cam.x,y:cam.y,w:cam.width,h:cam.height},view:this.view,dtMs:dt,hero:{...this.at,z:0}});
    if(this.layer)this.hero.setDepth(this.layer.actorDepth(this.at.x,this.at.y));
  }
}

new Phaser.Game({type:Phaser.AUTO,parent:host,backgroundColor:'#2B2542',scene:[CitySandbox],
  scale:{mode:Phaser.Scale.RESIZE,width:innerWidth,height:innerHeight},render:{antialias:true}});
