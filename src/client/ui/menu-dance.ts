import {artPages,artPiece,artUrl,type ArtPage} from '../art/manifest.ts';
import {startArt} from './art-boot.ts';

export interface DancePage extends ArtPage {url:string;original:string}
export interface DancePlan {cell:[number,number];frames:number;fps:number;loop:boolean;pages:DancePage[]}

/** Only the selected hero downloads its dance. Missing or malformed entries keep the portrait. */
export function menuDancePlan(id:string):DancePlan|undefined{
  const file=artPiece('menu',id)?.files.dance;
  if(!file||file.cell[0]!==768||file.cell[1]!==512||![16,32,64,128].includes(file.frames??0))return;
  const fps=file.fps===undefined?10:file.fps;
  if(typeof fps!=='number'||!Number.isFinite(fps)||fps<=0||fps>60)return;
  const pages:DancePage[]=[];
  let next=0;
  for(const page of artPages(file)){
    const original=artUrl('menu',page.file);
    if(!original||page.firstFrame!==next||page.frameCount<1||page.columns<1||page.rows<1||
      page.frameCount>page.columns*page.rows||page.columns*768>4096||page.rows*512>4096)return;
    pages.push({...page,original,url:original.replace('/art/menu/','/art/lite/menu/')});
    next+=page.frameCount;
  }
  if(next!==file.frames)return;
  return {cell:[768,512],frames:file.frames!,fps,loop:file.loop!==false,pages};
}

export const danceFrameAt=(plan:Pick<DancePlan,'frames'|'fps'|'loop'>,ms:number)=>{
  const frame=Math.max(0,Math.floor(Math.max(0,ms)*plan.fps/1000));
  return plan.loop?frame%plan.frames:Math.min(frame,plan.frames-1);
};
export function danceCell(plan:DancePlan,frame:number){
  const pageIndex=plan.pages.findIndex(p=>frame>=p.firstFrame&&frame<p.firstFrame+p.frameCount);
  if(pageIndex<0)return;
  const page=plan.pages[pageIndex],local=frame-page.firstFrame;
  return {pageIndex,x:local%page.columns*plan.cell[0],y:Math.floor(local/page.columns)*plan.cell[1]};
}

/** Canvas sits above the decoded portrait, which stays available if any download fails. */
export class MenuDance {
  private id='';
  private activeId='';
  private holds=0;
  private blocked=false;
  private gameOpen=false;
  private destroyed=false;
  private gameObserver?:MutationObserver;
  private token=0;
  private canvas?:HTMLCanvasElement;
  private images:HTMLImageElement[]=[];
  private plan?:DancePlan;
  private raf=0;
  private started=0;
  private shown=-1;
  private visible=true;
  private observer?:IntersectionObserver;
  private host:HTMLElement;
  private ready:()=>Promise<unknown>;
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  constructor(host:HTMLElement,ready:()=>Promise<unknown>=startArt){
    this.host=host;this.ready=ready;
    document.addEventListener('visibilitychange',this.visibility);
    this.reduced.addEventListener('change',this.visibility);
    if(typeof IntersectionObserver!=='undefined'){
      this.observer=new IntersectionObserver(entries=>{
        this.visible=entries.some(e=>e.isIntersecting);
        this.visibility();
      });
      this.observer.observe(host);
    }
    if(typeof MutationObserver!=='undefined'&&document.body){
      this.gameObserver=new MutationObserver(this.watchGame);this.watchGame();
    }
  }
  show(id:string){
    if(this.destroyed)return;
    this.id=id;if(this.blocked||this.activeId===id)return;
    this.loadSelected();
  }
  /** Release decoded pages before importing/opening the game; balanced even when opening fails. */
  hold():()=>void{
    if(this.destroyed)return ()=>{};
    this.holds++;this.syncBlocked();let on=true;
    return ()=>{if(!on)return;on=false;this.holds--;this.syncBlocked();};
  }
  private loadSelected(){
    this.stop();if(this.blocked||this.destroyed||!this.id)return;
    const id=this.activeId=this.id;
    const token=this.token;
    void this.ready().then(async()=>{
      if(token!==this.token)return;
      const plan=menuDancePlan(id);
      if(!plan)return;
      try{
        const images=await Promise.all(plan.pages.map(async page=>{
          let image:HTMLImageElement;
          try{image=await this.load(page.url,token);}
          catch{image=await this.load(page.original,token);}
          if(image.naturalWidth!==page.columns*768||image.naturalHeight!==page.rows*512)throw new Error('dance page dimensions');
          return image;
        }));
        if(token!==this.token)return;
        this.images=images;this.plan=plan;
        const canvas=document.createElement('canvas');canvas.width=768;canvas.height=512;
        canvas.className='menu-dance';canvas.setAttribute('aria-hidden','true');canvas.dataset.danceOf=id;
        if(!canvas.getContext('2d'))throw new Error('dance canvas unavailable');
        this.canvas=canvas;this.host.append(canvas);
        this.started=performance.now();this.draw(0);this.host.classList.add('dancing');this.resume();
      }catch{
        if(token===this.token)this.stop();
      }
    }).catch(()=>{});
  }
  /** Observe only body children and dialog.open: HUD/canvas changes never trigger a whole-subtree observer. */
  private watchGame=()=>{
    if(this.destroyed||!this.gameObserver)return;
    const dialogs=[...document.querySelectorAll<HTMLDialogElement>('dialog.explore-shell')];
    this.gameObserver.disconnect();this.gameObserver.observe(document.body,{childList:true});
    for(const dialog of dialogs)this.gameObserver.observe(dialog,{attributes:true,attributeFilter:['open']});
    this.gameOpen=dialogs.some(dialog=>dialog.open);this.syncBlocked();
  };
  private syncBlocked(){
    if(this.destroyed)return;
    const next=this.holds>0||this.gameOpen;if(next===this.blocked)return;
    this.blocked=next;if(next)this.stop();else this.loadSelected();
  }
  private async load(url:string,token:number){
    if(token!==this.token)throw new Error('dance superseded');
    const image=new Image();image.decoding='async';image.fetchPriority='low';this.images.push(image);image.src=url;
    await image.decode();
    if(token!==this.token)throw new Error('dance superseded');
    return image;
  }
  private draw(frame:number){
    if(!this.canvas||!this.plan||frame===this.shown)return;
    const cell=danceCell(this.plan,frame),ctx=this.canvas.getContext('2d');
    if(!cell||!ctx)return;
    ctx.clearRect(0,0,768,512);ctx.drawImage(this.images[cell.pageIndex],cell.x,cell.y,768,512,0,0,768,512);
    this.canvas.dataset.frame=String(frame);this.shown=frame;
  }
  private tick=(time:number)=>{
    this.raf=0;
    if(!this.plan||!this.canvas||!this.visible||document.hidden)return;
    this.draw(danceFrameAt(this.plan,time-this.started));this.resume();
  };
  private resume(){
    if(this.canvas&&!this.raf&&this.visible&&!document.hidden&&!this.reduced.matches)this.raf=requestAnimationFrame(this.tick);
  }
  private visibility=()=>{
    if(this.raf)cancelAnimationFrame(this.raf);
    this.raf=0;this.resume();
  };
  private stop(){
    this.token++;
    this.activeId='';
    if(this.raf)cancelAnimationFrame(this.raf);
    this.raf=0;
    if(this.canvas){this.canvas.width=this.canvas.height=0;this.canvas.remove();}
    this.canvas=undefined;this.plan=undefined;this.shown=-1;
    this.host.classList.remove('dancing');
    for(const image of this.images)image.src='';
    this.images=[];
  }
  destroy(){
    this.destroyed=true;this.stop();this.observer?.disconnect();this.gameObserver?.disconnect();
    document.removeEventListener('visibilitychange',this.visibility);this.reduced.removeEventListener('change',this.visibility);
  }
}
