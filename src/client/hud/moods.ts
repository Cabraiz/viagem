/**
 * Who is laughing now (rostos-kkkk). A pure, clock-injected board: the last emote of each player shows for BALLOON_MS
 * (2.2 s, the balloon's life) after it was sent; a newer one replaces it. The team strip reads it for the `rindo` face.
 */
import {BALLOON_MS,isEmoteId,type EmoteId} from '../fun/emotes.ts';

export class MoodBoard {
  readonly showMs:number;
  private readonly last=new Map<string,{id:EmoteId;at:number}>();
  constructor(showMs=BALLOON_MS){this.showMs=Number.isFinite(showMs)&&showMs>0?showMs:BALLOON_MS;}
  /** Latest wins. Bad input (empty id, unknown emote, NaN clock) is ignored; expired entries are dropped here. */
  record(playerId:string,id:EmoteId,now:number){
    if(typeof playerId!=='string'||!playerId||!isEmoteId(id)||!Number.isFinite(now))return;
    for(const [key,entry] of this.last)if(!(now>=entry.at&&now<entry.at+this.showMs))this.last.delete(key);
    this.last.set(playerId,{id,at:now});
  }
  /** The emote still showing at `now`: from the moment it was sent up to (not including) sent + 2200 ms. */
  active(playerId:string,now:number):EmoteId|undefined{
    const entry=this.last.get(playerId);
    if(!entry||!Number.isFinite(now)||now<entry.at||now>=entry.at+this.showMs)return undefined;
    return entry.id;
  }
  clear(){this.last.clear();}
}
