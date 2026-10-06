import Phaser from 'phaser';
import { classes } from '../classes.ts';
import { CoopClient, STEP } from './net/client.ts';
import {SPAWN,landmarks,obstacles,isLand,project,unproject,findPath,moveAlong,moveDirection,type Point,type Obstacle} from './world.ts';

export interface SceneHooks {
  classId:string;
  direction:()=>Point;
  position:(point:Point)=>void;
  discovered:(index:number)=>void;
  ready:()=>void;
  message:(text:string)=>void;
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
  private position:Point={...SPAWN};
  private route:Point[]=[];
  private actor!:Phaser.GameObjects.Image;
  private shadow!:Phaser.GameObjects.Ellipse;
  private ring!:Phaser.GameObjects.Ellipse;
  private destination!:Graphics;
  private discovered=new Set<number>();
  private cursors?:Phaser.Types.Input.Keyboard.CursorKeys;
  private keys?:Record<string,Phaser.Input.Keyboard.Key>;
  private props: {point:Point;object:Graphics}[]=[];
  private stamp=0;
  private distance=0;
  private paused=false;
  private accumulator=0;
  private displayed?:Point;
  private remoteActors=new Map<string,{image:Phaser.GameObjects.Image;label:Phaser.GameObjects.Text;ring:Phaser.GameObjects.Ellipse}>();
  private enemyActors=new Map<string,{body:Phaser.GameObjects.Ellipse;label:Phaser.GameObjects.Text}>();
  private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(hooks:SceneHooks){super('island');this.hooks=hooks;}
  preload(){this.load.image('hero',`/art/portraits/${this.hooks.classId}.webp`);if(this.hooks.net)for(const c of classes)this.load.image(`class:${c.id}`,`/art/portraits/${c.id}-thumb.webp`);}
  create(){
    this.cameras.main.setBackgroundColor('#8dcecc');
    this.drawGround();
    for(const o of obstacles){const p=project(o),g=this.add.graphics({x:p.x,y:p.y});this.drawProp(g,o);g.setDepth((o.x+o.y)*100);this.props.push({point:o,object:g});}
    landmarks.forEach((l,i)=>this.drawLandmark(l,i));
    this.shadow=this.add.ellipse(0,0,42,17,0x3d756a,.2);
    this.ring=this.add.ellipse(0,0,50,23).setStrokeStyle(2,0xfff8c8,.95);
    this.actor=this.add.image(0,0,'hero').setOrigin(.5,.88).setDisplaySize(112,112);
    this.destination=this.add.graphics().setDepth(100000);
    this.input.on('pointerdown',(pointer:Phaser.Input.Pointer)=>{
      const p=this.cameras.main.getWorldPoint(pointer.x,pointer.y);
      this.goTo(unproject(p));
    });
    this.cursors=this.input.keyboard?.createCursorKeys();
    this.keys=this.input.keyboard?.addKeys('W,A,S,D') as typeof this.keys;
    this.scale.on('resize',this.fit,this);
    if(this.hooks.net)this.position={...this.hooks.net.predicted};
    this.fit();this.place();
    const p=project(this.position);this.cameras.main.centerOn(p.x,p.y-25);
    this.hooks.position(this.position);this.hooks.ready();
  }
  private fit(){
    const p=project(this.position);
    this.cameras.main.setSize(this.scale.width,this.scale.height)
      .setZoom(this.scale.width<620? .94 : 1.16).centerOn(p.x,p.y-25);
  }
  setPaused(paused:boolean){this.paused=paused;this.route=[];this.destination?.clear();this.input.keyboard?.resetKeys();}
  goTo(target:Point){
    if(this.paused||!this.actor)return;
    this.route=findPath(this.position,target);
    this.destination.clear();
    if(!this.route.length){this.hooks.message('Por aqui não dá. Tente a trilha ou um trecho livre.');return;}
    this.hooks.message('Seguindo a trilha…');
    const p=project(target);
    this.destination.lineStyle(2,0xfff9d2,.95).strokeEllipse(p.x,p.y,28,14);
    this.destination.fillStyle(0xfff9d2,.9).fillCircle(p.x,p.y,3);
  }
  private place(){
    const p=project(this.position),depth=(this.position.x+this.position.y)*100;
    const bob=this.reduced?0:Math.sin(this.distance*10)*1.5;
    this.actor.setPosition(p.x,p.y+bob).setDepth(depth+1);
    this.shadow.setPosition(p.x,p.y).setDepth(depth-2);
    this.ring.setPosition(p.x,p.y).setDepth(depth-1);
    // Canopies soften only when they cover the hero; feet still define scene depth.
    for(const prop of this.props){const q=project(prop.point);const front=prop.point.x+prop.point.y>this.position.x+this.position.y;
      prop.object.setAlpha(front&&Math.abs(q.x-p.x)<58&&q.y>p.y&&q.y-p.y<105?.55:1);
    }
  }
  update(_time:number,delta:number){
    if(!this.actor)return;
    if(this.hooks.net){this.updateCoop(delta);return;}
    if(this.paused)return;
    const axis=this.hooks.direction();
    const sx=axis.x+Number(!!(this.cursors?.right.isDown||this.keys?.D.isDown))-Number(!!(this.cursors?.left.isDown||this.keys?.A.isDown));
    const sy=axis.y+Number(!!(this.cursors?.down.isDown||this.keys?.S.isDown))-Number(!!(this.cursors?.up.isDown||this.keys?.W.isDown));
    const old=this.position,seconds=Math.min(delta/1000,.1);
    if(Math.hypot(sx,sy)>.05){this.route=[];this.destination.clear();this.position=moveDirection(old,{x:sx/2+sy,y:sy-sx/2},seconds);}
    else this.position=moveAlong(old,this.route,seconds);
    const moved=Math.hypot(this.position.x-old.x,this.position.y-old.y);
    this.distance+=moved;
    if(moved>0){this.place();const p=project(this.position);const camera=this.cameras.main;
      const t=1-Math.exp(-seconds*8);camera.centerOn(Phaser.Math.Linear(camera.midPoint.x,p.x,t),Phaser.Math.Linear(camera.midPoint.y,p.y-25,t));
    }
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
    this.accumulator=Math.min(this.accumulator+delta/1000,.2);
    while(this.accumulator>=STEP){
      let direction={x:0,y:0};
      if(Math.hypot(sx,sy)>.05){this.route=[];direction={x:sx/2+sy,y:sy-sx/2};}
      else if(!this.paused&&this.route.length){
        while(this.route.length&&Math.hypot(this.route[0].x-net.predicted.x,this.route[0].y-net.predicted.y)<.18)this.route.shift();
        if(this.route.length)direction={x:this.route[0].x-net.predicted.x,y:this.route[0].y-net.predicted.y};
      }
      net.input(direction,!this.paused&&!!this.hooks.attacking?.());this.accumulator-=STEP;
    }
    const view=net.view(),old=this.position;
    const target=net.predicted,blend=1-Math.exp(-Math.min(delta/1000,.1)*35);
    this.displayed=!this.displayed||Math.hypot(this.displayed.x-target.x,this.displayed.y-target.y)>3?{...target}:{x:Phaser.Math.Linear(this.displayed.x,target.x,blend),y:Phaser.Math.Linear(this.displayed.y,target.y,blend)};
    this.position={...this.displayed};this.distance+=Math.hypot(old.x-this.position.x,old.y-this.position.y);this.place();
    const p=project(this.position),camera=this.cameras.main,t=1-Math.exp(-Math.min(delta/1000,.1)*9);
    camera.centerOn(Phaser.Math.Linear(camera.midPoint.x,p.x,t),Phaser.Math.Linear(camera.midPoint.y,p.y-25,t));
    this.actor.setAlpha((net.players.get(net.id)?.hp??100)>0?1:.4);
    const ids=new Set(view.players.filter(p=>p.id!==net.id).map(p=>p.id));
    for(const [id,objects] of this.remoteActors)if(!ids.has(id)){objects.image.destroy();objects.label.destroy();objects.ring.destroy();this.remoteActors.delete(id);}
    for(const player of view.players){
      if(player.id===net.id)continue;
      let objects=this.remoteActors.get(player.id);
      if(!objects){objects={image:this.add.image(0,0,`class:${player.classId}`).setOrigin(.5,.88).setDisplaySize(100,100),label:this.add.text(0,0,'',{fontFamily:'system-ui',fontSize:'11px',color:'#51425e',backgroundColor:'#fff4d9',padding:{x:5,y:3}}).setOrigin(.5,0),ring:this.add.ellipse(0,0,46,20).setStrokeStyle(2,0xb7dfe3)};this.remoteActors.set(player.id,objects);}
      const q=project(player),depth=(player.x+player.y)*100;
      objects.image.setPosition(q.x,q.y).setDepth(depth+1).setAlpha(player.online&&player.hp?1:.4);
      objects.ring.setPosition(q.x,q.y).setDepth(depth-1);
      objects.label.setPosition(q.x,q.y+15).setDepth(depth+2).setText(`${player.name} · ${player.hp}♥${player.online?'':' · voltando'}`);
    }
    for(const enemy of view.enemies){
      let objects=this.enemyActors.get(enemy.id);
      if(!objects){objects={body:this.add.ellipse(0,0,46,33,0xcf94bc).setStrokeStyle(3,0x976c97),label:this.add.text(0,0,'',{fontFamily:'system-ui',fontSize:'10px',color:'#633c63',backgroundColor:'#fff4dc',padding:{x:4,y:2}}).setOrigin(.5,0)};this.enemyActors.set(enemy.id,objects);}
      const q=project(enemy),depth=(enemy.x+enemy.y)*100;
      objects.body.setPosition(q.x,q.y-15).setDepth(depth).setVisible(enemy.hp>0);
      objects.label.setPosition(q.x,q.y+8).setDepth(depth+1).setText(`Gosma · ${enemy.hp}♥`).setVisible(enemy.hp>0);
    }
    if(!this.route.length)this.destination.clear();
    this.stamp+=delta;if(this.stamp>100){this.stamp=0;this.hooks.position(this.position);}
  }
  private drawGround(){
    const g=this.add.graphics().setDepth(-10000);
    const center=project({x:12,y:12});
    g.fillStyle(0xb1e7d7,.6).fillEllipse(center.x,center.y+40,1290,710);
    g.fillStyle(0xe6f4d7,.5).fillEllipse(center.x,center.y+30,1230,660);
    const tiles:Point[]=[];for(let y=1;y<24;y++)for(let x=1;x<24;x++)if(isLand({x:x+.5,y:y+.5}))tiles.push({x,y});
    tiles.sort((a,b)=>a.x+a.y-b.x-b.y);
    for(const t of tiles){
      const corners=[{x:t.x,y:t.y},{x:t.x+1,y:t.y},{x:t.x+1,y:t.y+1},{x:t.x,y:t.y+1}].map(project);
      for(const [a,b,n] of [[1,2,{x:t.x+1.5,y:t.y+.5}],[2,3,{x:t.x+.5,y:t.y+1.5}]] as const){
        if(!isLand(n))polygon(g,[corners[a],corners[b],{x:corners[b].x,y:corners[b].y+30},{x:corners[a].x,y:corners[a].y+30}],a===1?0xbdb17f:0xd2bd84);
      }
      const beach=!isLand({x:t.x+.5,y:t.y+.5},1.8);
      const colors=beach?[0xf1dda6,0xf2dfa9,0xefdaa1]:[0xc4d894,0xc7da96,0xc2d593,0xc8d997];
      polygon(g,corners,colors[Math.floor(random(t.x,t.y)*colors.length)]);
    }
    // Wide connected sand paths climb the same height field as the hero.
    const segments=[[SPAWN,landmarks[0]],[landmarks[0],landmarks[1]],[landmarks[0],landmarks[2]],[landmarks[2],landmarks[1]]];
    for(const [a,b] of segments){const n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)*8),v={x:b.x-a.x,y:b.y-a.y},len=Math.hypot(v.x,v.y);
      for(let i=0;i<n;i++){const from={x:a.x+v.x*i/n,y:a.y+v.y*i/n},to={x:a.x+v.x*(i+1)/n,y:a.y+v.y*(i+1)/n};
        const offset={x:-v.y/len*.42,y:v.x/len*.42};
        polygon(g,[{x:from.x+offset.x,y:from.y+offset.y},{x:to.x+offset.x,y:to.y+offset.y},{x:to.x-offset.x,y:to.y-offset.y},{x:from.x-offset.x,y:from.y-offset.y}].map(project),0xf0daa0);
      }
    }
    for(let i=0;i<560;i++){
      const p={x:2+random(i,4)*20,y:2+random(i,8)*20};if(!isLand(p,1.7))continue;
      if(segments.some(([a,b])=>{const v={x:b.x-a.x,y:b.y-a.y},t=Phaser.Math.Clamp(((p.x-a.x)*v.x+(p.y-a.y)*v.y)/(v.x*v.x+v.y*v.y),0,1);return Math.hypot(p.x-a.x-v.x*t,p.y-a.y-v.y*t)<.62;}))continue;
      const q=project(p);g.lineStyle(1.2,0x749b64,.48).lineBetween(q.x-3,q.y+1,q.x-5,q.y-4).lineBetween(q.x,q.y,q.x+2,q.y-5);
      if(i%7===0){g.fillStyle(i%2?0xf8e8a7:0xf4b5a4).fillCircle(q.x,q.y-5,2.6);g.fillStyle(0xfff5cf).fillCircle(q.x,q.y-5,1);}
    }
    // Terrain details are created once, with no per-frame allocations for scenery.
    for(let i=0;i<70;i++){const p={x:random(i,92)*30-3,y:random(i,71)*30-3};if(isLand(p,-1.4))continue;const q=project(p);g.lineStyle(2,0xe3f7e5,.42).lineBetween(q.x,q.y,q.x+15+random(i,61)*22,q.y);}
    // Bake static geometry once instead of replaying thousands of drawing commands every frame.
    const terrain=this.add.renderTexture(-1280,-160,2560,1440).setOrigin(0,0).setDepth(-10000);
    terrain.draw(g,1280,160);g.destroy();
  }
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
    const p=project(l),g=this.add.graphics({x:p.x,y:p.y}).setDepth((l.x+l.y)*100-5);
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
    const label=this.add.text(p.x,p.y+28,landmarks[index].name,{fontFamily:'Georgia, serif',fontSize:'13px',color:'#625650',backgroundColor:'#f7edc9',padding:{x:9,y:5}}).setOrigin(.5,0).setDepth((l.x+l.y)*100+2);
    label.setAlpha(.94);
  }
}

export function createIsland(parent:HTMLElement,hooks:SceneHooks){
  const scene=new IslandScene(hooks);
  const game=new Phaser.Game({type:Phaser.AUTO,parent,backgroundColor:'#8dcecc',
    width:parent.clientWidth,height:parent.clientHeight,scale:{mode:Phaser.Scale.RESIZE},
    antialias:true,transparent:false,autoFocus:false,
    audio:{noAudio:true},fps:{target:60,limit:60},banner:false,scene:[scene]});
  return {game,scene};
}
