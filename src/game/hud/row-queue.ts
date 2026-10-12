/**
 * The line of the shell's quiet rows for the announcement slot (VGM-048 review: "uma vaga só"). Pure (no DOM), so node
 * pins it down: one row on screen at a time, only while the slot is free (no notice, kill-cam or coach hint); a notice
 * that comes takes the slot back and the row returns after it with the time it had left; a row leaves after its time.
 */
export class RowQueue<T> {
  private line:{item:T;ms:number}[]=[];
  private on?:{item:T;left:number;at:number};
  /** The row on screen, if any. */
  get shown():T|undefined{return this.on?.item;}
  get waiting():number{return this.line.length;}
  /** In line for `ms` on screen (a row already in line or on screen starts over at the back). */
  queue(item:T,ms:number){this.drop(item);this.line.push({item,ms});}
  /** Out of the line and off the screen. */
  drop(item:T){this.line=this.line.filter(r=>r.item!==item);if(this.on?.item===item)this.on=undefined;}
  /**
   * The slot at `now`: `busy` when a notice, the kill-cam or the coach's hint holds it (or the HUD is away).
   * Returns the row to show (if one just got the slot) and the rows to hide.
   */
  turn(now:number,busy:boolean):{show?:T;hide:T[]}{
    const hide:T[]=[];const on=this.on;
    if(on){
      on.left-=Math.max(0,now-on.at);on.at=now;
      if(on.left<=0){hide.push(on.item);this.on=undefined;}
      else if(busy){hide.push(on.item);this.on=undefined;this.line.unshift({item:on.item,ms:on.left});}
    }
    let show:T|undefined;
    if(!this.on&&!busy&&this.line.length){const next=this.line.shift()!;this.on={item:next.item,left:next.ms,at:now};show=next.item;}
    return {show,hide};
  }
}
