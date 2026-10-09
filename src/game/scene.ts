import {TerrainRenderer} from './terrain/renderer.ts';
import {TerrainField,randomSeed} from './terrain/field.ts';
import Phaser from 'phaser';
import { classes } from '../classes.ts';
import {SKILL_RANGE} from './net/shared.ts';
import {fitIsland} from './framing.ts';
import {projectView,unprojectView,viewDepth,screenDirection,rotateVector,normalizeView} from './projection.ts';
import {treeCatalog,type TreeArt} from './tree-catalog.ts';
import {CharacterSprites} from './character-sprites.ts';
import { CoopClient, STEP } from './net/client.ts';
import {SPAWN,landmarks,obstacles,findPath,moveAlong,moveDirection,clearSegment,type Point,type Obstacle} from './world.ts';

export interface SceneHooks {
  classId:string;
  direction:()=>Point;
  position:(point:Point)=>void;
  discovered:(index:number)=>void;
  ready:()=>void;
  terrain?:(seed:number,signature:string)=>void;
  message:(text:string)=>void;
  visual?:(animation:string,frame:string,sheets:number)=>void;
  net?:CoopClient;
  attacking?:()=>boolean;
}
type Graphics=Phaser.GameObjects.Graphics;
const polygon=(g:Graphics,points:Point[],color:number,alpha=1)=>{
  g.fillStyle(color,alpha).fillPoints(points,true);
};
const random=(x:number,y:number)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);};

export class IslandScene extends Phaser.Scene {
  private hooks:SceneHooks;
  private view=0;
  private landscape?:TerrainRenderer;
  private field!:TerrainField;
  private signs:{point:Point;graphic:Graphics;label:Phaser.GameObjects.Text}[]=[];
  private project=(p:Point)=>projectView(p,this.view,this.field);
  private depth=(p:Point)=>viewDepth(p,this.view);
  private position:Point={...SPAWN};
  private route:Point[]=[];
  private actor!:Phaser.GameObjects.Sprite;
  private sprites=new CharacterSprites(this);
  private shadow!:Phaser.GameObjects.Ellipse;
  private ring!:Phaser.GameObjects.Ellipse;
  private destination!:Graphics;
  private discovered=new Set<number>();
  private cursors?:Phaser.Types.Input.Keyboard.CursorKeys;
  private keys?:Record<string,Phaser.Input.Keyboard.Key>;
  private props: {point:Point;object:Graphics|Phaser.GameObjects.Image;tree?:TreeArt}[]=[];
  private trees:(TreeArt|undefined)[]=[];
  private treeShadows?:Graphics;
  private chooseTrees(){return obstacles.filter(o=>o.kind!=='rock').map((_o,i)=>{
    const seed=[...(this.hooks?.net?.code??'ilha')].reduce((n,c)=>n+c.charCodeAt(0),0);
    return treeCatalog.length?treeCatalog[(seed+i*3)%treeCatalog.length]:undefined;
  });}
  private stamp=0;
  private distance=0;
  private paused=false;
  private accumulator=0;
  private attackTarget?:string;
  private skillEffects?:Graphics;
  private displayed?:Point;
  private remoteActors=new Map<string,{image:Phaser.GameObjects.Sprite;label:Phaser.GameObjects.Text;ring:Phaser.GameObjects.Ellipse}>();
  private enemyActors=new Map<string,{body:Phaser.GameObjects.Ellipse;label:Phaser.GameObjects.Text}>();
  private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(hooks:SceneHooks){super('island');this.hooks=hooks;this.field=hooks.net?.terrain??new TerrainField(randomSeed());this.trees=this.chooseTrees();}
  preload(){this.load.image('terrain-soil','/art/terrain/soil-grass.webp');this.load.image('terrain-bed','/art/terrain/riverbed.webp');for(const tree of new Set(this.trees))if(tree)this.load.spritesheet(`tree:${tree.id}`,`/art/trees/${tree.id}.webp`,{frameWidth:256,frameHeight:384});this.sprites.queue(this.hooks.classId);if(this.hooks.net)for(const p of this.hooks.net.players.values())this.sprites.queue(p.classId);this.load.image('hero',`/art/portraits/${this.hooks.classId}.webp`);if(this.hooks.net)for(const c of classes)this.load.image(`class:${c.id}`,`/art/portraits/${c.id}-thumb.webp`);}
  create(){
    this.cameras.main.setBackgroundColor('#142f2d');
    this.drawGround();
    let treeIndex=0;
    for(const o of obstacles){
      const p=this.project(o),tree=o.kind==='rock'?undefined:this.trees[treeIndex++];
      if(tree&&this.textures.exists(`tree:${tree.id}`)){
        const image=this.add.image(p.x,p.y,`tree:${tree.id}`,this.view).setOrigin(.5,353/384).setScale(tree.height/tree.pixelHeight).setDepth(this.depth(o));
        image.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);this.props.push({point:o,object:image,tree});
      }else{const g=this.add.graphics({x:p.x,y:p.y});this.drawProp(g,o);g.setDepth(this.depth(o));this.props.push({point:o,object:g});}
    }
    this.drawTreeShadows();
    landmarks.forEach((l,i)=>this.drawLandmark(l,i));
    this.shadow=this.add.ellipse(0,0,42,17,0x3d756a,.2);
    this.ring=this.add.ellipse(0,0,50,23).setStrokeStyle(2,0xfff8c8,.95);
    this.actor=this.add.sprite(0,0,'hero').setOrigin(.5,.88).setDisplaySize(112,112);
    this.destination=this.add.graphics().setDepth(100000);
    this.input.on('pointerdown',(pointer:Phaser.Input.Pointer)=>{
      if(this.paused||!pointer.primaryDown)return;
      const p=this.cameras.main.getWorldPoint(pointer.x,pointer.y);
      const hit=[...this.enemyActors].filter(([id,o])=>o.body.visible&&(this.hooks.net?.enemies.get(id)?.hp??0)>0&&Math.hypot((p.x-o.body.x)/30,(p.y-o.body.y)/27)<=1).sort((a,b)=>Math.hypot(p.x-a[1].body.x,p.y-a[1].body.y)-Math.hypot(p.x-b[1].body.x,p.y-b[1].body.y))[0];
      if(hit){this.attackTarget=hit[0];this.hooks.message('Alvo priorizado. O ataque é automático ao entrar no alcance.');return;}
      this.goTo(unprojectView(p,this.view,this.field));
    });
    this.cursors=this.input.keyboard?.createCursorKeys();
    this.keys=this.input.keyboard?.addKeys('W,A,S,D') as typeof this.keys;
    this.scale.on('resize',this.fit,this);
    if(this.hooks.net)this.position={...this.hooks.net.predicted};
    this.fit();this.place();
    this.hooks.terrain?.(this.field.seed,this.field.signature);this.hooks.position(this.position);this.hooks.ready();
  }
  private fit(){
    const frame=fitIsland(this.scale.width,this.scale.height,this.view,this.field);
    this.cameras.main.setSize(this.scale.width,this.scale.height)
      .setZoom(frame.zoom).centerOn(frame.x,frame.y);
    this.landscape?.fit();
  }
  rotateCamera(turn:number){
    if(!this.actor)return this.view;
    this.view=normalizeView(this.view+turn);this.landscape?.view(this.view);
    for(const prop of this.props){const p=this.project(prop.point);prop.object.setPosition(p.x,p.y).setDepth(this.depth(prop.point));if(prop.tree)(prop.object as Phaser.GameObjects.Image).setFrame(this.view);}
    this.drawTreeShadows();
    for(const sign of this.signs){const p=this.project(sign.point),depth=this.depth(sign.point);sign.graphic.setPosition(p.x,p.y).setDepth(depth-5);sign.label.setPosition(p.x,p.y+28).setDepth(depth+2);}
    this.destination.clear();this.fit();this.place();
    return this.view;
  }
  setPaused(paused:boolean){this.paused=paused;if(paused)this.attackTarget=undefined;this.route=[];this.destination?.clear();this.input.keyboard?.resetKeys();}
  goTo(target:Point){
    if(this.paused||!this.actor)return;
    this.attackTarget=undefined;
    this.route=findPath(this.position,target,this.field);
    this.destination.clear();
    if(!this.route.length){this.hooks.message('Por aqui não dá. Tente a trilha ou um trecho livre.');return;}
    this.hooks.message('Seguindo a trilha…');
    const p=this.project(target);
    this.destination.lineStyle(2,0xfff9d2,.95).strokeEllipse(p.x,p.y,28,14);
    this.destination.fillStyle(0xfff9d2,.9).fillCircle(p.x,p.y,3);
  }
  private place(){
    const p=this.project(this.position),depth=this.depth(this.position);
    const bob=0;
    this.actor.setPosition(p.x,p.y+bob).setDepth(depth+1);
    this.shadow.setPosition(p.x,p.y).setDepth(depth-2);
    this.ring.setPosition(p.x,p.y).setDepth(depth-1);
    // Canopies soften only when they cover the hero; feet still define scene depth.
    for(const prop of this.props){const q=this.project(prop.point);const front=this.depth(prop.point)>this.depth(this.position);
      prop.object.setAlpha(front&&Math.abs(q.x-p.x)<(prop.tree?128*prop.tree.height/prop.tree.pixelHeight:58)&&q.y>p.y&&q.y-p.y<(prop.tree?.height??105)?.55:1);
    }
  }
  update(_time:number,delta:number){
    this.landscape?.update(_time,this.reduced||this.paused||document.hidden);
    if(!this.actor)return;
    const self=this.hooks.net?.players.get(this.hooks.net.id);
    this.sprites.animate(this.actor,this.hooks.classId,this.position.x,this.position.y,self?.attackTick??0,self?.hp!==0,this.view);
    this.hooks.visual?.(this.actor.anims.currentAnim?.key??'fallback',String(this.actor.frame.name),this.textures.getTextureKeys().filter(k=>k.startsWith('sprite:')).length);
    if(this.hooks.net){this.updateCoop(delta);return;}
    if(this.paused)return;
    const axis=this.hooks.direction();
    const sx=axis.x+Number(!!(this.cursors?.right.isDown||this.keys?.D.isDown))-Number(!!(this.cursors?.left.isDown||this.keys?.A.isDown));
    const sy=axis.y+Number(!!(this.cursors?.down.isDown||this.keys?.S.isDown))-Number(!!(this.cursors?.up.isDown||this.keys?.W.isDown));
    const old=this.position,seconds=Math.min(delta/1000,.1);
    if(Math.hypot(sx,sy)>.05){this.route=[];this.destination.clear();this.position=moveDirection(old,screenDirection(sx,sy,this.view),seconds,this.field);}
    else this.position=moveAlong(old,this.route,seconds,this.field);
    const moved=Math.hypot(this.position.x-old.x,this.position.y-old.y);
    this.distance+=moved;
    if(moved>0)this.place();
    if(!this.route.length)this.destination.clear();
    for(let i=0;i<landmarks.length;i++)if(!this.discovered.has(i)&&Math.hypot(this.position.x-landmarks[i].x,this.position.y-landmarks[i].y)<1.15){this.discovered.add(i);this.hooks.discovered(i);}
    this.stamp+=delta;
    if(this.stamp>100){this.stamp=0;this.hooks.position(this.position);}
  }
  private updateCoop(delta:number){
    const net=this.hooks.net!;
    const axis=this.paused?{x:0,y:0}:this.hooks.direction();
    const sx=axis.x+(this.paused?0:Number(!!(this.cursors?.right.isDown||this.keys?.D.isDown))-Number(!!(this.cursors?.left.isDown||this.keys?.A.isDown)));
    const sy=axis.y+(this.paused?0:Number(!!(this.cursors?.down.isDown||this.keys?.S.isDown))-Number(!!(this.cursors?.up.isDown||this.keys?.W.isDown)));
    if(this.paused||!net.connected||!net.players.get(net.id)?.hp||net.run?.phase!=='combat'||net.players.get(net.id)?.spectator){this.attackTarget=undefined;this.route=[];}
    if(this.attackTarget&&(net.enemies.get(this.attackTarget)?.hp??0)<=0){this.attackTarget=undefined;this.hooks.message('Alvo derrotado. O básico continua automático.');}
    this.accumulator=Math.min(this.accumulator+delta/1000,.2);
    while(this.accumulator>=STEP){
      let direction={x:0,y:0};
      if(Math.hypot(sx,sy)>.05){this.route=[];direction=screenDirection(sx,sy,this.view);}
      if(!this.paused&&Math.hypot(sx,sy)<=.05&&this.route.length){
        while(this.route.length&&Math.hypot(this.route[0].x-net.predicted.x,this.route[0].y-net.predicted.y)<.18)this.route.shift();
        if(this.route.length)direction={x:this.route[0].x-net.predicted.x,y:this.route[0].y-net.predicted.y};
      }
      net.input(direction,!this.paused&&!!this.hooks.attacking?.(),this.attackTarget);this.accumulator-=STEP;
    }
    const view=net.view(),old=this.position;
    const effects=this.skillEffects??=this.add.graphics().setDepth(90000);effects.clear();
    for(const player of view.players){
      const age=net.tick-(player.skillTick??0);
      if(!player.skillTick||age<0||age>=10||net.run?.phase!=='combat')continue;
      const radius=SKILL_RANGE*(this.reduced?1:.3+.7*age/10);
      const points=Array.from({length:25},(_,i)=>this.project({x:player.x+Math.cos(i*Math.PI/12)*radius,y:player.y+Math.sin(i*Math.PI/12)*radius}));
      effects.lineStyle(3,0xffde88,1-age/10).strokePoints(points,true);
    }
    const target=net.predicted,blend=1-Math.exp(-Math.min(delta/1000,.1)*35);
    this.displayed=!this.displayed||Math.hypot(this.displayed.x-target.x,this.displayed.y-target.y)>3?{...target}:{x:Phaser.Math.Linear(this.displayed.x,target.x,blend),y:Phaser.Math.Linear(this.displayed.y,target.y,blend)};
    this.position={...this.displayed};this.distance+=Math.hypot(old.x-this.position.x,old.y-this.position.y);this.place();
    this.actor.setAlpha(!net.players.get(net.id)?.spectator&&(net.players.get(net.id)?.hp??100)>0?1:.4);
    const ids=new Set(view.players.filter(p=>p.id!==net.id).map(p=>p.id));
    for(const [id,objects] of this.remoteActors)if(!ids.has(id)){objects.image.destroy();objects.label.destroy();objects.ring.destroy();this.remoteActors.delete(id);}
    for(const player of view.players){
      if(player.id===net.id)continue;
      let objects=this.remoteActors.get(player.id);
      if(!objects){objects={image:this.add.sprite(0,0,`class:${player.classId}`).setOrigin(.5,.88).setDisplaySize(100,100),label:this.add.text(0,0,'',{fontFamily:'system-ui',fontSize:'11px',color:'#51425e',backgroundColor:'#fff4d9',padding:{x:5,y:3}}).setOrigin(.5,0),ring:this.add.ellipse(0,0,46,20).setStrokeStyle(2,0xb7dfe3)};this.remoteActors.set(player.id,objects);}
      this.sprites.animate(objects.image,player.classId,player.x,player.y,player.attackTick??0,player.hp>0&&player.online,this.view);
      const q=this.project(player),depth=this.depth(player);
      objects.image.setPosition(q.x,q.y).setDepth(depth+1).setAlpha(!player.spectator&&player.online&&player.hp?1:.4);
      objects.ring.setPosition(q.x,q.y).setDepth(depth-1);
      objects.label.setPosition(q.x,q.y+15).setDepth(depth+2).setText(`${player.name} · ${player.spectator?'assistindo':player.hp+'♥'}${player.online?'':' · voltando'}`);
    }
    for(const enemy of view.enemies){
      let objects=this.enemyActors.get(enemy.id);
      if(!objects){objects={body:this.add.ellipse(0,0,46,33,0xcf94bc).setStrokeStyle(3,0x976c97),label:this.add.text(0,0,'',{fontFamily:'system-ui',fontSize:'10px',color:'#633c63',backgroundColor:'#fff4dc',padding:{x:4,y:2}}).setOrigin(.5,0)};this.enemyActors.set(enemy.id,objects);}
      const q=this.project(enemy),depth=this.depth(enemy);
      objects.body.setStrokeStyle(this.attackTarget===enemy.id?4:3,this.attackTarget===enemy.id?0xffef94:0x976c97);
      objects.body.setPosition(q.x,q.y-15).setDepth(depth).setVisible(enemy.hp>0);
      objects.label.setPosition(q.x,q.y+8).setDepth(depth+1).setText(`Gosma · ${enemy.hp}♥`).setVisible(enemy.hp>0);
    }
    // Horde enemies get a fresh id each spawn (VGM-042a): drop actors the server no longer sends, or they pile up as ghosts.
    if(this.enemyActors.size>view.enemies.length){
      const current=new Set(view.enemies.map(e=>e.id));
      for(const [id,objects] of this.enemyActors)if(!current.has(id)){objects.body.destroy();objects.label.destroy();this.enemyActors.delete(id);if(this.attackTarget===id)this.attackTarget=undefined;}
    }
    if(!this.route.length)this.destination.clear();
    this.stamp+=delta;if(this.stamp>100){this.stamp=0;this.hooks.position(this.position);}
  }
  private drawTreeShadows(){
    const g=this.treeShadows??=this.add.graphics().setDepth(-9990);g.clear();
    for(const prop of this.props){
      if(!prop.tree)continue;
      const radius=Math.max(.16,Math.min(.48,prop.tree.height/500));
      // Project each point onto actual terrain, including slopes and camera rotation.
      for(const [size,alpha] of [[1,.12],[.62,.2]]){
        const points=Array.from({length:16},(_,i)=>{
          const angle=i*Math.PI/8;
          return this.project({x:prop.point.x+Math.cos(angle)*radius*size,y:prop.point.y+Math.sin(angle)*radius*size});
        });
        polygon(g,points,0x213d26,alpha);
      }
    }
  }
  private drawGround(){this.landscape=new TerrainRenderer(this,this.field);this.landscape.view(this.view);}
  private drawProp(g:Graphics,o:Obstacle){
    g.fillStyle(0x558973,.15).fillEllipse(8,4,70,26);
    if(o.kind==='rock'){
      polygon(g,[{x:-27,y:0},{x:-30,y:-15},{x:-12,y:-34},{x:12,y:-32},{x:30,y:-13},{x:25,y:5}],0x839697);
      polygon(g,[{x:-30,y:-15},{x:-12,y:-34},{x:12,y:-32},{x:20,y:-18},{x:-1,y:-13}],0xc0c7ae);
      polygon(g,[{x:0,y:-13},{x:20,y:-18},{x:30,y:-13},{x:25,y:5},{x:-2,y:2}],0x9fac9f);
      g.lineStyle(2,0x668a72,.6).lineBetween(-15,-3,-8,-6);return;
    }
    if(o.kind==='palm'){
      polygon(g,[{x:-8,y:0},{x:3,y:-83},{x:13,y:-86},{x:7,y:0}],0xb29461);
      g.lineStyle(2,0x806e51,.5);for(let y=-6;y>-72;y-=10)g.lineBetween(-4,y,8,y-3);
      for(let i=0;i<7;i++){const angle=i/7*Math.PI*2;const x=Math.cos(angle)*67,y=-85+Math.sin(angle)*34;
        polygon(g,[{x:7,y:-84},{x:x*.55,y:y-17},{x,y},{x:x*.45,y:y+10}],i%2?0x529b70:0x72b97c);
        g.lineStyle(1.2,0xc4d991,.6).lineBetween(7,-84,x,y);
      }
      g.fillStyle(0xb1915c).fillCircle(0,-79,6).fillCircle(12,-77,5);return;
    }
    polygon(g,[{x:-10,y:2},{x:-7,y:-72},{x:8,y:-72},{x:12,y:1}],0x9a8060);
    g.lineStyle(3,0x755f50,.5).lineBetween(1,-3,0,-56);
    g.fillStyle(0x50866a).fillEllipse(1,-61,93,54);
    g.fillStyle(0x6ba775).fillCircle(-23,-78,31).fillCircle(23,-82,33).fillCircle(0,-98,34);
    g.fillStyle(0x91bf81).fillEllipse(-13,-107,50,25).fillEllipse(25,-88,33,19);
    g.fillStyle(0xc5d88f,.75).fillCircle(-22,-112,5).fillCircle(-5,-116,3).fillCircle(30,-94,4);
    g.fillStyle(0xe9b783).fillCircle(-31,-76,4).fillCircle(16,-105,4);
  }
  private drawLandmark(l:Point,index:number){
    const p=this.project(l),g=this.add.graphics({x:p.x,y:p.y}).setDepth(this.depth(l)-5);
    g.fillStyle(0xd5bf8f).fillEllipse(0,6,84,34);
    g.lineStyle(2,0xfff0c4,.8).strokeEllipse(0,6,87,36);
    if(index===0){
      g.fillStyle(0x826f62).fillRect(-32,-63,5,62).fillRect(27,-63,5,62);
      polygon(g,[{x:-46,y:-57},{x:-32,y:-86},{x:30,y:-86},{x:47,y:-57}],0xd88d98);
      for(let i=0;i<4;i++)polygon(g,[{x:-32+i*16,y:-86},{x:-24+i*16,y:-86},{x:-32+i*20,y:-57},{x:-44+i*20,y:-57}],0xf5dfbc);
      g.fillStyle(0xb5926e).fillRoundedRect(-32,-23,65,21,3);
      g.fillStyle(0xf0c171).fillCircle(-16,-27,7).fillCircle(0,-26,6);
      g.fillStyle(0x91b879).fillEllipse(18,-27,12,16);
    }else if(index===1){
      g.fillStyle(0xa2a9a8).fillEllipse(0,-1,71,34).fillRect(-35,-10,70,11);
      g.fillStyle(0xd8d9bd).fillEllipse(0,-11,74,36);
      g.fillStyle(0x84cfd0).fillEllipse(0,-12,55,24);
      g.fillStyle(0xb9c5b7).fillRect(-6,-48,12,38).fillEllipse(0,-46,27,12);
      g.lineStyle(2,0xe8ffff,.8).lineBetween(-5,-45,-18,-21).lineBetween(5,-45,18,-21);
      g.fillStyle(0xf7edc4).fillCircle(0,-54,7);
    }else{
      g.fillStyle(0xa99176).fillRoundedRect(-25,-22,52,15,3).fillRect(-19,-8,5,16).fillRect(17,-8,5,16);
      g.fillStyle(0x786978).fillRect(-2,-88,4,70);
      polygon(g,[{x:2,y:-88},{x:42,y:-80},{x:31,y:-67},{x:2,y:-70}],0xa28dc5);
      g.fillStyle(0xf7eac0).fillCircle(0,-91,5);
    }
    const label=this.add.text(p.x,p.y+28,landmarks[index].name,{fontFamily:'Georgia, serif',fontSize:'13px',color:'#625650',backgroundColor:'#f7edc9',padding:{x:9,y:5}}).setOrigin(.5,0).setDepth(this.depth(l)+2);
    label.setAlpha(.94);this.signs.push({point:l,graphic:g,label});
  }
}

export function createIsland(parent:HTMLElement,hooks:SceneHooks){
  const scene=new IslandScene(hooks);
  const game=new Phaser.Game({type:Phaser.WEBGL,parent,backgroundColor:'#8dcecc',
    width:parent.clientWidth,height:parent.clientHeight,scale:{mode:Phaser.Scale.RESIZE},
    antialias:true,transparent:false,autoFocus:false,
    audio:{noAudio:true},fps:{target:60,limit:60},banner:false,scene:[scene]});
  return {game,scene};
}
