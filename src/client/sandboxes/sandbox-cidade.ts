/**
 * Cidade Nevada render sandbox (cards cidade-03a, cidade-04):
 * `?sandbox=cidade[&view=0..3][&hero=cx,cy][&class=id][&cells=N]`.
 * Draws the stand-in city (render/city/sample.ts) with the real city layer and the real hero sheet at its world depth,
 * framed like the game in the city (D-030): framing.ts cityZoom (rules zoomFor with the 56 px hero floor: ≈15.07 cells
 * on 844×390, ≈6.96 on 390×844) and the sheet scaled by CITY_VIEW_SCALE, so the hero draws ≈56 CSS px (≈1 cell).
 * `cells` overrides the visible width (cells along screen x) for comparisons. Rotating the phone re-fits.
 * Tap the city to move the hero (buildings in front of it turn translucent); the round button turns the view.
 * `window.__cidade` holds the numbers to check against a screenshot (zoom, hero px, visible cells, view).
 * Fake data only; nothing talks to the server and the game scene is untouched (wiring: card cidade-03).
 */
import Phaser from 'phaser';
import {CITY_PALETTE,CityLayer,OUTSIDE_CITY,PINE_TEXTURE,makeSampleCity,parseCityAsset,project,unproject,type CityAsset} from '../render/city/index.ts';
import {CharacterSprites} from '../sprites/character-sprites.ts';
import {spriteCatalog} from '../sprites/sprite-catalog.ts';
import {CITY_VIEW_SCALE,FollowCamera,cityZoom} from '../framing.ts';
import {CITY_HERO_SPEED} from '../../maps/index.ts';
import {HERO_WORLD_PX,TILE_X} from '../../contract/index.ts';

const params=new URLSearchParams(location.search);
const [startX,startY]=(params.get('hero')??'6.5,3.3').split(',').map(Number);
const cellsOverride=Number(params.get('cells'))||undefined;
const wanted=params.get('class')??'cidadao-comum';
const classId=spriteCatalog[wanted]?wanted:'cidadao-comum';

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
  private hero!:Phaser.GameObjects.Sprite;
  private shadow!:Phaser.GameObjects.Ellipse;
  private sprites=new CharacterSprites(this);
  private camera=new FollowCamera();
  private view=Math.max(0,Math.min(3,Number(params.get('view'))|0));
  private at={x:0,y:0};
  constructor(){super('city-sandbox');}
  preload(){
    this.load.spritesheet(PINE_TEXTURE,'/art/lite/trees/arvore-nevada.webp',{frameWidth:256,frameHeight:384});
    this.sprites.queue(classId);
  }
  create(){
    this.asset=parseCityAsset(makeSampleCity());
    this.at={x:startX*this.asset.cell,y:startY*this.asset.cell};
    this.cameras.main.setBackgroundColor(OUTSIDE_CITY);
    this.layer=new CityLayer(this,this.asset);
    // The game scene's city figures: the sheet and its contact shadow (Breu 38%) scaled by CITY_VIEW_SCALE.
    this.sprites.viewScale=CITY_VIEW_SCALE;
    this.camera.world={scale:CITY_VIEW_SCALE,speed:CITY_HERO_SPEED};
    this.shadow=this.add.ellipse(0,0,42,17,CITY_PALETTE.breu,.38).setScale(CITY_VIEW_SCALE);
    this.hero=this.add.sprite(0,0,'__DEFAULT');
    this.sprites.animate(this.hero,classId,this.at.x,this.at.y,0,true,this.view);
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
    turn.addEventListener('click',e=>{e.stopPropagation();this.view=(this.view+1)%4;this.place();});
    host.append(turn);// inside the sandbox root: everything else in body is hidden
    // Warm the fade so a covering building is already translucent on the first screenshot.
    for(let i=0;i<12;i++)this.tick(16);
  }
  update(_t:number,dt:number){this.sprites.animate(this.hero,classId,this.at.x,this.at.y,0,true,this.view);this.tick(dt);}
  /** The game's city zoom for this viewport (or the `cells` override), then the camera onto the hero. */
  private fit(){
    const viewport={width:this.scale.width,height:this.scale.height};
    const zoom=cellsOverride?viewport.width/(cellsOverride*this.asset.cell*TILE_X*Math.SQRT2):cityZoom(viewport);
    this.cameras.main.setSize(viewport.width,viewport.height).setZoom(zoom);
    this.place();
  }
  /** Hero at the layer's actor depth (city mode: no fixed SELF_DEPTH), camera snapped like the game's follow camera. */
  private place(){
    const feet=project(this.at.x,this.at.y,0,this.view),cam=this.cameras.main,zoom=cam.zoom;
    this.hero.setPosition(feet.x,feet.y);this.shadow.setPosition(feet.x,feet.y);
    const viewport={width:this.scale.width,height:this.scale.height};
    const c=this.camera.snap(feet,viewport,zoom);
    cam.centerOn(c.x,c.y);
    (window as unknown as {__cidade:unknown}).__cidade={zoom,view:this.view,classId,scale:CITY_VIEW_SCALE,
      heroPx:HERO_WORLD_PX*CITY_VIEW_SCALE*zoom,visibleCells:viewport.width/zoom/(TILE_X*Math.SQRT2)/this.asset.cell,
      viewport,orientation:viewport.width>viewport.height?'landscape':'portrait'};
  }
  private tick(dt:number){
    const cam=this.cameras.main.worldView;
    this.layer?.update({camera:{x:cam.x,y:cam.y,w:cam.width,h:cam.height},view:this.view,dtMs:dt,hero:{...this.at,z:0}});
    if(this.layer){const d=this.layer.actorDepth(this.at.x,this.at.y);this.hero.setDepth(d);this.shadow.setDepth(d-1);}
  }
}

new Phaser.Game({type:Phaser.AUTO,parent:host,backgroundColor:'#2B2542',scene:[CitySandbox],
  scale:{mode:Phaser.Scale.RESIZE,width:innerWidth,height:innerHeight},render:{antialias:true}});
