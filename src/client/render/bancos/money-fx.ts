/**
 * The banks' flying money (card bico-sem-limite-pix-voando), apart from renderer.ts: the notes out of a bank's screen
 * (green up for a hero, darker away for a critter) and the PIX swarm around each hero on a shift with its "+R$ 5" pops
 * (pix.ts). Every one is a pooled sprite of the ChatGPT painting (PIX_KEY), none drawn in code. Per frame the bank
 * renderer calls begin, note for each flying note, then end (the swarm, the unused sprites hidden).
 */
import type Phaser from 'phaser';
import type {Projector,Pt} from '../projector.ts';
import type {BankView} from '../../../contract/index.ts';
import {BICO} from '../../../rules/index.ts';
import {NOTE_MS,type BankTracker,type FlyingNote} from './rules.ts';
import {PIX_FRAME,PIX_KEY,PIX_LABEL_KEY,PIX_LABEL_URL,PIX_URL,POP_POOL,PixSwarm,bitFrame,bitPose,popPose,type BitPose} from './pix.ts';

/** Screen width (CSS px at zoom 1) of one frame of the money painting: a bank's note, a PIX bit, the "+R$ 5" label. */
const NOTE_PX=22,BIT_PX=20,LABEL_PX=56;

export interface MoneyFxOptions {projector:Projector;reduced:boolean;
  /** A player's foot in the world (the local one predicted): the PIX fly around who is on a shift; absent: no PIX. */
  playerAt?:(id:string)=>Pt|undefined}

export class MoneyFx {
  private scene:Phaser.Scene;
  private options:MoneyFxOptions;
  private depth:number;
  /** A critter's note: the painting tinted toward Breu. */
  private stolen:number;
  /** The flying money (the banks' notes, the PIX bits): pooled sprites, the ones past `used` hidden each frame. */
  private money:Phaser.GameObjects.Image[]=[];
  private used=0;
  /** The PIX around the heroes on a shift, and the "+R$ 5" pops (made on the first one, then reused). */
  private swarm=new PixSwarm();
  private pops:Phaser.GameObjects.Image[]=[];
  /** Reused every frame: who is on a shift now, a bit's pose and a projected foot. */
  private workers:string[]=[];
  private pose:BitPose={dx:0,dy:0,tilt:0,alpha:0,scale:1};
  private q:Pt={x:0,y:0};

  constructor(scene:Phaser.Scene,options:MoneyFxOptions,depth:number,stolen:number){
    this.scene=scene;this.options=options;this.depth=depth;this.stolen=stolen;
  }

  /** Queues the painting's two textures (nothing flies until they are in); true when one was queued. */
  queue():boolean{
    const s=this.scene;let queued=false;
    if(!s.textures.exists(PIX_KEY)){s.load.spritesheet(PIX_KEY,PIX_URL,{frameWidth:PIX_FRAME,frameHeight:PIX_FRAME});queued=true;}
    if(!s.textures.exists(PIX_LABEL_KEY)){s.load.image(PIX_LABEL_KEY,PIX_LABEL_URL);queued=true;}
    return queued;
  }
  /** A new view: every note a bank paid pops a "+R$ 5" over its workers. */
  cash(st:BankTracker,now:number){
    if(!this.options.playerAt)return;
    for(const p of st.paid){
      const workers=st.banks.find(b=>b.id===p.bank)?.workers;
      if(workers?.length)this.swarm.cash(now,workers,Math.min(POP_POOL,p.count),BICO.nota,this.options.reduced);
    }
  }
  /** A frame starts: every money sprite is free again. */
  begin(){this.used=0;}
  /** A frame ends: the PIX swarm, then the sprites nobody took hidden. */
  end(banks:readonly BankView[],now:number,k:number){
    this.drawPix(banks,now,k);
    for(let i=this.used;i<this.money.length;i++)this.money[i].setVisible(false);
  }
  /** Where note `n` of bank `b` is in its flight (0..1), or -1: not flying, or a hero's note the PIX around them say already. */
  noteAt(n:FlyingNote,b:BankView,now:number):number{
    const t=(now-n.born)/NOTE_MS;if(t<0||t>=1)return -1;
    const at=this.options.playerAt;
    return n.by==='hero'&&at&&b.workers?.some(id=>at(id))?-1:t;
  }
  /** Note `n` at `t` of its flight from the bank's screen point `start`. */
  note(n:FlyingNote,t:number,start:Pt,now:number,k:number){
    const hero=n.by==='hero';
    const dx=(hero?(n.slot-1)*14:28+n.slot*10)*k*t,dy=(hero?-70*t:-24*t+50*t*t)*k;
    const a=t>.7?(1-t)/.3:1,tilt=this.options.reduced?0:Math.sin(now*.02+n.slot)*.25;
    const im=this.sprite(0);if(!im)return;
    im.setPosition(start.x+dx,start.y+dy).setRotation(tilt).setScale(NOTE_PX*k/PIX_FRAME).setAlpha(a);
    if(hero)im.clearTint();else im.setTint(this.stolen);
  }
  destroy(){
    for(const im of this.money)im.destroy();this.money=[];
    for(const im of this.pops)im.destroy();this.pops=[];
  }

  /** The next pooled money sprite of this frame, on `frame` of the painting (made the first time), or none before it is in. */
  private sprite(frame:number):Phaser.GameObjects.Image|undefined{
    if(!this.scene.textures.exists(PIX_KEY))return undefined;
    let im=this.money[this.used];
    if(!im){im=this.scene.add.image(0,0,PIX_KEY,frame).setDepth(this.depth).setName('pix-voando');this.money.push(im);}
    this.used++;
    return im.setFrame(frame).setVisible(true);
  }
  /**
   * The PIX swarm (pix.ts): notes and PIX diamonds of the painting spiralling up around each hero on a shift, and the
   * "+R$ 5" label popping over them (a pool of POP_POOL images). Nothing without `playerAt` or before the painting is in.
   */
  private drawPix(banks:readonly BankView[],now:number,k:number){
    const at=this.options.playerAt;if(!at)return;
    const ws=this.workers;ws.length=0;
    for(const b of banks)if(b.workers)for(const id of b.workers)ws.push(id);
    const sw=this.swarm,proj=this.options.projector,o=this.pose;
    sw.step(now,ws,this.options.reduced);
    for(const bit of sw.bits){
      if(!bit||!bitPose(bit,now,o))continue;
      const w=at(bit.worker);if(!w)continue;
      const im=this.sprite(bitFrame(bit));if(!im)break;
      const f=proj.project(w.x,w.y,this.q);
      im.setPosition(f.x+o.dx*k,f.y+o.dy*k).setRotation(o.tilt).setScale(o.scale*k*BIT_PX/PIX_FRAME).setAlpha(o.alpha).clearTint();
    }
    const label=this.scene.textures.exists(PIX_LABEL_KEY);
    for(let i=0;i<sw.pops.length;i++){
      const pop=sw.pops[i],pose=pop&&popPose(pop,now,this.options.reduced),w=pop&&pose&&at(pop.worker);
      let im=this.pops[i];
      if(!label||!pop||!pose||!w){im?.setVisible(false);continue;}
      if(!im){im=this.scene.add.image(0,0,PIX_LABEL_KEY).setOrigin(.5,1).setDepth(this.depth+3).setName('pix-mais5');this.pops[i]=im;}
      const f=proj.project(w.x,w.y,this.q);
      im.setPosition(f.x+pose.dx*k,f.y+pose.dy*k).setScale(LABEL_PX*k/im.width).setAlpha(pose.alpha).setVisible(true);
    }
  }
}
