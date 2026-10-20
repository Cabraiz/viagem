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

/** The first page of a hero's dance (lite copy), by the importer's naming: main.ts preloads it before the art index. */
export const firstDancePage=(id:string)=>`/art/lite/menu/danca/${id}-p1.webp`;
/**
 * The frame to draw `ms` into the dance when only the first `loaded` frames (whole pages, in order) are decoded: the
 * dance starts with its first page and loops over what has arrived until the rest comes (danca-sem-fallback).
 */
export function playableFrame(plan:Pick<DancePlan,'frames'|'fps'|'loop'>,ms:number,loaded:number){
  const frame=danceFrameAt(plan,ms);
  return frame<loaded||loaded<=0?frame:plan.loop?frame%loaded:loaded-1;
}

/**
 * Canvas sits above the decoded portrait. danca-sem-fallback (the user, 18/10): the still portrait never shows before
 * the dance; the host wears `dance-pending` (the CSS hides the portrait: the empty podium) from the selection until the
 * dance's first page is drawn, and only a dance that fails for good (no plan, the first page lost in both copies)
 * lifts it and leaves the portrait.
 */
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
  /** Decoded pages by index (undefined: still coming or lost); `loaded` = frames of the leading run of pages. */
  private pages:(HTMLImageElement|undefined)[]=[];
  private loaded=0;
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
    this.host.classList.add('dance-pending');
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
    this.host.classList.add('dance-pending');
    const fail=()=>{if(token===this.token){this.stop();this.host.classList.remove('dance-pending');}};
    void this.ready().then(async()=>{
      if(token!==this.token)return;
      const plan=menuDancePlan(id);
      if(!plan){fail();return;}
      this.plan=plan;this.pages=plan.pages.map(()=>undefined);this.loaded=0;
      // Every page downloads at once (the first one first); the dance starts with the first and plays what has come.
      const pages=plan.pages.map(async(page,index)=>{
        let image:HTMLImageElement;
        try{image=await this.load(page.url,token,index===0);}
        catch{image=await this.load(page.original,token,index===0);}
        if(image.naturalWidth!==page.columns*768||image.naturalHeight!==page.rows*512)throw new Error('dance page dimensions');
        if(token!==this.token)return;
        this.pages[index]=image;
        let loaded=0;for(let k=0;k<plan.pages.length&&this.pages[k];k++)loaded+=plan.pages[k].frameCount;
        this.loaded=loaded;
        if(index===0)this.begin(id);
      });
      for(const page of pages)page.catch(()=>{});
      try{await pages[0];}catch{fail();return;}
      // A later page lost in both copies: the dance keeps looping over the pages before it.
      await Promise.allSettled(pages.slice(1));
    }).catch(fail);
  }
  private begin(id:string){
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=512;
    canvas.className='menu-dance';canvas.setAttribute('aria-hidden','true');canvas.dataset.danceOf=id;
    if(!canvas.getContext('2d'))throw new Error('dance canvas unavailable');
    this.canvas=canvas;this.host.append(canvas);
    this.started=performance.now();this.draw(0);
    this.host.classList.add('dancing');this.host.classList.remove('dance-pending');this.resume();
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
  private async load(url:string,token:number,first=false){
    if(token!==this.token)throw new Error('dance superseded');
    const image=new Image();image.decoding='async';image.fetchPriority=first?'high':'low';this.images.push(image);image.src=url;
    await image.decode();
    if(token!==this.token)throw new Error('dance superseded');
    return image;
  }
  private draw(frame:number){
    if(!this.canvas||!this.plan||frame===this.shown)return;
    const cell=danceCell(this.plan,frame),ctx=this.canvas.getContext('2d');
    if(!cell||!ctx)return;
    const page=this.pages[cell.pageIndex];if(!page)return;
    ctx.clearRect(0,0,768,512);ctx.drawImage(page,cell.x,cell.y,768,512,0,0,768,512);
    this.canvas.dataset.frame=String(frame);this.shown=frame;
  }
  private tick=(time:number)=>{
    this.raf=0;
    if(!this.plan||!this.canvas||!this.visible||document.hidden)return;
    this.draw(playableFrame(this.plan,time-this.started,this.loaded));this.resume();
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
    this.canvas=undefined;this.plan=undefined;this.shown=-1;this.pages=[];this.loaded=0;
    this.host.classList.remove('dancing');
    for(const image of this.images)image.src='';
    this.images=[];
  }
  destroy(){
    this.destroyed=true;this.stop();this.observer?.disconnect();this.gameObserver?.disconnect();
    document.removeEventListener('visibilitychange',this.visibility);this.reduced.removeEventListener('change',this.visibility);
  }
}
