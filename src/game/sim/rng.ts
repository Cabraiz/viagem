/** Deterministic seeded RNG (mulberry32). State is a single uint32, so rooms can persist and replay it. */
export class Rng {
  state:number;
  constructor(seed:number){this.state=seed>>>0;}
  /** Uniform [0,1). */
  next():number{
    let t=this.state=(this.state+0x6d2b79f5)>>>0;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296;
  }
  range(min:number,max:number){return min+(max-min)*this.next();}
  int(min:number,maxInclusive:number){return min+Math.floor(this.next()*(maxInclusive-min+1));}
  chance(p:number){return this.next()<p;}
  pick<T>(items:readonly T[]):T{if(!items.length)throw new Error('pick from empty list');return items[Math.floor(this.next()*items.length)];}
  /** Weighted pick; weights must be >= 0 and not all zero. */
  weighted<T>(items:readonly T[],weight:(item:T)=>number):T{
    const total=items.reduce((n,i)=>n+Math.max(0,weight(i)),0);
    if(!(total>0))throw new Error('weighted pick needs positive total');
    let roll=this.next()*total;
    for(const item of items){roll-=Math.max(0,weight(item));if(roll<0)return item;}
    return items[items.length-1];
  }
  /** Independent child stream, e.g. per system, so adding draws in one system does not shift others. */
  fork(label:string){let h=this.state^0x9e3779b9;for(const c of label)h=Math.imul(h^c.charCodeAt(0),0x01000193);return new Rng(h>>>0);}
}
