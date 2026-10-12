/**
 * Dev-only preview of the city layer (card cidade-03a), served by Vite at /src/client/render/city/preview.html.
 * Not part of the build and not wired into the game (code freeze); the wiring card replaces it with a sandbox hook.
 * Query: ?view=0..3 &hero=cx,cy (cells, default in front of the plaza) &cells=N (visible width in cells).
 */
import Phaser from 'phaser';
import {parseCityAsset,type CityAsset} from './asset.ts';
import {CityLayer,PINE_TEXTURE} from './city-layer.ts';
import {OUTSIDE_CITY,CITY_PALETTE} from './palette.ts';
import {depth,project} from './projection.ts';

const params=new URLSearchParams(location.search);
const view=Math.max(0,Math.min(3,Number(params.get('view')??0)|0));
const [hx,hy]=(params.get('hero')??'6.5,3.3').split(',').map(Number);
const portrait=innerHeight>innerWidth;
const cells=Number(params.get('cells')??(portrait?10.5:18));

class CityPreview extends Phaser.Scene {
  private layer?:CityLayer;
  private asset?:CityAsset;
  private hero?:Phaser.GameObjects.Graphics;
  constructor(){super('city-preview');}
  preload(){
    this.load.json('city','/tests/client/fixtures/cidade-mini.json');
    this.load.spritesheet(PINE_TEXTURE,'/art/lite/trees/arvore-nevada.webp',{frameWidth:256,frameHeight:384});
  }
  create(){
    const asset=this.asset=parseCityAsset(this.cache.json.get('city'));
    this.cameras.main.setBackgroundColor(OUTSIDE_CITY);
    this.layer=new CityLayer(this,asset);
    // Stand-in hero: Breu-outlined capsule with a contact shadow, at its world depth (as city mode requires).
    const x=hx*asset.cell,y=hy*asset.cell,feet=project(x,y,0,view);
    const g=this.hero=this.add.graphics({x:feet.x,y:feet.y}).setDepth(depth(x,y,view));
    g.fillStyle(CITY_PALETTE.breu,0.38).fillEllipse(0,0,40,16);
    g.fillStyle(0xc85a7a,1).fillRoundedRect(-17,-80,34,72,14).lineStyle(2,CITY_PALETTE.breu,1).strokeRoundedRect(-17,-80,34,72,14);
    g.fillStyle(0xf2d3b8,1).fillCircle(0,-88,14).strokeCircle(0,-88,14);
    const zoom=this.scale.width/(cells*asset.cell*Math.hypot(42,21)*Math.SQRT2);
    this.cameras.main.setZoom(zoom).centerOn(feet.x,feet.y-40);
    // Warm the fade: a few frames so a covering building is already translucent in the screenshot.
    for(let i=0;i<12;i++)this.tick(16);
  }
  update(_t:number,dt:number){this.tick(dt);}
  private tick(dt:number){
    if(!this.layer||!this.asset)return;
    const cam=this.cameras.main.worldView;
    this.layer.update({camera:{x:cam.x,y:cam.y,w:cam.width,h:cam.height},view,dtMs:dt,
      hero:{x:hx*this.asset.cell,y:hy*this.asset.cell,z:0}});
  }
}

new Phaser.Game({type:Phaser.AUTO,parent:'city',backgroundColor:'#2B2542',scene:[CityPreview],
  scale:{mode:Phaser.Scale.RESIZE,width:innerWidth,height:innerHeight},render:{antialias:true}});
