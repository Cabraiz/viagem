/**
 * The match's background downloads yield to the art the opening waits for (cena-nasce-rapido): while any hold is taken
 * (the scene holds one until the city's art around the hero is in), the waiting room's preloader starts no P1/P2 file
 * (teammates, enemies, effects) and the link is the near art's. Files already in flight finish. Page-wide, tiny.
 */
let holds=0;
const waiting=new Set<()=>void>();
/** True while some hold is taken. */
export const backgroundHeld=()=>holds>0;
/** Takes a hold; the returned function lets it go (once; later calls do nothing). */
export function holdBackground():()=>void{
  holds++;
  let on=true;
  return ()=>{
    if(!on)return;
    on=false;holds--;
    if(holds===0)for(const fn of [...waiting]){try{fn();}catch{/* one listener never stops the others */}}
  };
}
/** Calls `fn` every time the last hold goes; returns the unsubscribe. */
export function onBackgroundFree(fn:()=>void):()=>void{
  waiting.add(fn);
  return ()=>{waiting.delete(fn);};
}
