/**
 * BUG-20261025-ORQ-levelup-pausa-mede-1s: the level-up pause's title box (hud/pausa.ts createPausePart) read the HUD's
 * boxes inside its 200 ms tick once a second, right after the HUD wrote, and replaced the title's text node every second;
 * on a 4× phone that forced a whole-page style and layout of 50–130 ms. Now the tick never reads the layout (but for the
 * pause's first place), the periodic check waits for the paint, and the seconds change the text node in place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PAUSE_PLACE_MS,PAUSE_TICK_MS,createPausePart,type RunPause} from '../../src/client/hud/pausa.ts';
import type {HudContext} from '../../src/client/hud/model.ts';
import type {RunView} from '../../src/contract/index.ts';

let reads=0;
class Txt {nodeType=3;nodeValue:string;constructor(v:string){this.nodeValue=v;}}
/** Just enough of an element for the part: text as one node, boxes that count their reads. */
class El {
  className='';hidden=false;lang='';kids:(El|Txt)[]=[];attrs=new Map<string,string>();
  dataset:Record<string,string>={};style:Record<string,string>={};
  classList={contains:()=>false};
  box:{x:number;y:number;width:number;height:number};
  constructor(box={x:0,y:0,width:0,height:0}){this.box=box;}
  append(...nodes:El[]){this.kids.push(...nodes);}
  setAttribute(k:string,v:string){this.attrs.set(k,v);}
  get firstChild(){return this.kids[0]??null;}
  get lastChild(){return this.kids.at(-1)??null;}
  get textContent():string{return this.kids.map(k=>k instanceof El?k.textContent:k.nodeValue).join('');}
  set textContent(v:string){this.kids=v?[new Txt(v)]:[];}
  getBoundingClientRect(){reads++;const b=this.box;return {left:b.x,top:b.y,width:b.width,height:b.height};}
  get offsetWidth(){reads++;return 160;}
  get offsetHeight(){reads++;return 52;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
}

const scene=()=>{
  const doc={createElement:()=>new El()} as unknown as Document;
  const root=new El(),offer=new El({x:20,y:500,width:350,height:300}),top=new El({x:0,y:0,width:393,height:90});
  const queued:(()=>void)[]=[];let t=0;
  const part=createPausePart(doc,{root:root as unknown as HTMLElement,offer:offer as unknown as HTMLElement,top:top as unknown as HTMLElement,
    now:()=>t,schedule:read=>queued.push(read)});
  const view={players:[{id:'p1',name:'Mateus',online:true}]} as unknown as RunView;
  const pause:RunPause={leftMs:9000,totalMs:12000,level:6,waiting:['p1']};
  const ctx={localId:'p1',pause} as unknown as HudContext;
  return {part,view,ctx,queued,offer,at:(ms:number)=>{t=ms;}};
};

test('the tick never reads the layout; the place is checked after the paint, at most every PAUSE_PLACE_MS',()=>{
  const {part,view,ctx,queued,at}=scene();
  try{
    reads=0;part.update(view,ctx);
    assert.ok(reads>0,'the pause\'s first place is measured at once (no frame at the corner)');
    const box=part.el as unknown as El;
    assert.ok(box.style.left&&box.style.top);
    // Five seconds of ticks (the room's message each second too: the same pause object, the clock counts down).
    reads=0;
    for(let ms=PAUSE_TICK_MS;ms<=5000;ms+=PAUSE_TICK_MS){at(ms);part.update(view,ctx);}
    assert.equal(reads,0,'no box read inside a tick');
    assert.ok(queued.length>=1&&queued.length<=Math.ceil(5000/PAUSE_PLACE_MS),`${queued.length} checks in 5 s`);
    for(const read of queued.splice(0))read();
    assert.ok(reads>0,'the check reads after the paint');
  }finally{part.destroy?.();}
});

test('a change that moves the title (the offer closing) is checked after the paint, once',()=>{
  const {part,view,ctx,queued,offer,at}=scene();
  try{
    part.update(view,ctx);
    reads=0;at(100);offer.hidden=true;part.update(view,ctx);at(150);part.update(view,ctx);
    assert.equal(reads,0);assert.equal(queued.length,1);
    queued.shift()!();
    assert.ok(reads>0);
  }finally{part.destroy?.();}
});

test('the seconds change the title\'s text node in place',()=>{
  const {part,view,ctx,at}=scene();
  try{
    part.update(view,ctx);
    const title=(part.el as unknown as El).kids[0]!,node=title.firstChild;
    assert.equal(title.textContent,'Escolham! 9 s');
    at(1000);part.update(view,ctx);at(2000);part.update(view,ctx);
    assert.equal(title.textContent,'Escolham! 7 s');
    assert.equal(title.firstChild,node,'same text node');
  }finally{part.destroy?.();}
});
