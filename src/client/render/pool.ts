/**
 * Object pools for the horde render layers. Pure module (no Phaser) so node tests can exercise it.
 * Steady state must not allocate: pools only grow when demand exceeds what was created before.
 */

/** Free-list pool. `reset(item,true)` runs on acquire, `reset(item,false)` on release (hide it). */
export class Pool<T>{
  private freeItems:T[]=[];
  private make:()=>T;
  private resetItem:(item:T,active:boolean)=>void;
  private total=0;
  private live=0;
  constructor(create:()=>T,reset:(item:T,active:boolean)=>void){this.make=create;this.resetItem=reset;}
  acquire():T{
    let item:T;
    if(this.freeItems.length)item=this.freeItems.pop() as T;
    else{item=this.make();this.total++;}
    this.live++;this.resetItem(item,true);return item;
  }
  release(item:T){this.live--;this.resetItem(item,false);this.freeItems.push(item);}
  get created(){return this.total;}
  get active(){return this.live;}
  get free(){return this.freeItems.length;}
}

interface KeyedEntry<T>{item:T;stamp:number}
export interface KeyedUse<T>{item:T;fresh:boolean}

/**
 * Pool keyed by entity id, reconciled once per authoritative frame:
 * `begin()`, then `use(id)` for every id present, then `end()` releases ids not used this frame.
 * The object returned by `use` is reused between calls; read it immediately.
 */
export class KeyedPool<T>{
  private pool:Pool<T>;
  private entries=new Map<string,KeyedEntry<T>>();
  private spare:KeyedEntry<T>[]=[];
  private stamp=0;
  private result:KeyedUse<T>={item:undefined as T,fresh:false};
  constructor(create:()=>T,reset:(item:T,active:boolean)=>void){this.pool=new Pool(create,reset);}
  begin(){this.stamp++;}
  use(id:string):KeyedUse<T>{
    let entry=this.entries.get(id),fresh=false;
    if(!entry){
      entry=this.spare.pop()??{item:undefined as T,stamp:0};
      entry.item=this.pool.acquire();this.entries.set(id,entry);fresh=true;
    }
    entry.stamp=this.stamp;
    this.result.item=entry.item;this.result.fresh=fresh;return this.result;
  }
  end(onRetire?:(id:string,item:T)=>void){
    for(const [id,entry] of this.entries){
      if(entry.stamp===this.stamp)continue;
      onRetire?.(id,entry.item);this.drop(id,entry);
    }
  }
  /** Releases one id right away (e.g. killed between frames). */
  release(id:string){const entry=this.entries.get(id);if(entry)this.drop(id,entry);}
  get(id:string):T|undefined{return this.entries.get(id)?.item;}
  has(id:string){return this.entries.has(id);}
  forEach(fn:(item:T,id:string)=>void){this.entries.forEach((entry,id)=>fn(entry.item,id));}
  clear(){for(const [id,entry] of this.entries)this.drop(id,entry);}
  get size(){return this.entries.size;}
  get created(){return this.pool.created;}
  get active(){return this.pool.active;}
  get free(){return this.pool.free;}
  private drop(id:string,entry:KeyedEntry<T>){
    this.entries.delete(id);this.pool.release(entry.item);entry.item=undefined as T;this.spare.push(entry);
  }
}

/**
 * Capped pool for transient effects. `spawn()` hands out a free item, or recycles the oldest live one
 * when the cap is reached, so effects never exceed `cap` objects.
 */
export class Ring<T>{
  private pool:Pool<T>;
  private live:T[]=[];
  private resetItem:(item:T,active:boolean)=>void;
  private recycledCount=0;
  readonly cap:number;
  constructor(create:()=>T,reset:(item:T,active:boolean)=>void,cap:number){
    this.pool=new Pool(create,reset);this.resetItem=reset;this.cap=Math.max(1,cap|0);
  }
  spawn():T{
    if(this.live.length<this.cap){const item=this.pool.acquire();this.live.push(item);return item;}
    const oldest=this.live[0];
    for(let i=1;i<this.live.length;i++)this.live[i-1]=this.live[i];
    this.live[this.live.length-1]=oldest;
    this.resetItem(oldest,false);this.resetItem(oldest,true);this.recycledCount++;return oldest;
  }
  /** Keeps items for which `alive` returns true and releases the rest, in place, preserving age order. */
  retain(alive:(item:T)=>boolean){
    let w=0;
    for(let r=0;r<this.live.length;r++){
      const item=this.live[r];
      if(alive(item))this.live[w++]=item;else this.pool.release(item);
    }
    this.live.length=w;
  }
  release(item:T){
    const index=this.live.indexOf(item);if(index<0)return;
    for(let i=index+1;i<this.live.length;i++)this.live[i-1]=this.live[i];
    this.live.length--;this.pool.release(item);
  }
  forEach(fn:(item:T)=>void){for(let i=0;i<this.live.length;i++)fn(this.live[i]);}
  /** Oldest first. */
  at(index:number):T|undefined{return this.live[index];}
  clear(){for(const item of this.live)this.pool.release(item);this.live.length=0;}
  get created(){return this.pool.created;}
  get active(){return this.live.length;}
  get recycled(){return this.recycledCount;}
}
