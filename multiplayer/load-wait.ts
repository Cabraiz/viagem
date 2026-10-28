/**
 * Card NEW-20261028-ORQ-exploracao-espera-carregar-e-sem-arma (auditoria 28/10 item 13): the time to explore waits for
 * the team to load. On a slow phone the match took 22 s to draw and its first frame already said "101" of the minuto de
 * Minerva. Now a run that starts waits for every human online in it to say {t:'carregou'} (its scene drew the first
 * combat frame, src/client/scene.ts), at most LOAD_WAIT_MS; meanwhile the room keeps the Minerva's end a full minute
 * ahead (sim/ninhos/ninhos.ts holdMinerva), so its clock stays full for everyone. The sim steps as usual: whoever is in
 * walks and picks crates. An older phone never says it: the cap. Wall clock (the room's `now`), not ticks.
 */
export const LOAD_WAIT_MS=20_000;

export class LoadWait {
  private waiting=new Set<string>();
  private until=0;
  /** A run starts: wait for `ids` (the humans online in it) until LOAD_WAIT_MS after `now`. */
  arm(ids:Iterable<string>,now:number){this.waiting=new Set(ids);this.until=this.waiting.size?now+LOAD_WAIT_MS:0;}
  /** {t:'carregou'} from `id` (any other time it changes nothing). */
  loaded(id:string){this.waiting.delete(id);}
  reset(){this.waiting.clear();this.until=0;}
  /** Per room tick in combat: true while someone still `present` has not loaded and the cap has not come. */
  holding(now:number,present:(id:string)=>boolean):boolean{
    if(!this.until)return false;
    for(const id of this.waiting)if(!present(id))this.waiting.delete(id);
    if(this.waiting.size&&now<this.until)return true;
    this.reset();
    return false;
  }
  /** The ids still waited for (tests, logs). */
  get pending():readonly string[]{return [...this.waiting];}
}
