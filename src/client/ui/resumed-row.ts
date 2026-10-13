/**
 * E5-checkpoint-por-round: the room restarted and the run came back at the start of its round. The match says so once,
 * as a row of the HUD's announcement slot (RunHud.queueRow: in line behind danger notices, off the hero, gone after
 * RESUMED_ROW_MS), with the room's own title and body (pt-BR, src/protocol/room.ts resumedNotice).
 */
export const RESUMED_ROW_MS=8000;
export type ResumedNews={title:string;body:string};
/**
 * `show` for each new piece of news, once: the same news again (the notice field read when the match opens, then the
 * message itself, or a second rejoin) is skipped. Returns whether it showed.
 */
export function resumedOnce(show:(news:ResumedNews)=>void){
  let last:string|undefined;
  return (news:ResumedNews|undefined)=>{
    if(!news||`${news.title}\n${news.body}`===last)return false;
    last=`${news.title}\n${news.body}`;show(news);return true;
  };
}
