/**
 * "📸 Compartilhar" on the result (UX-resultado-revanche): a picture of the run's joke prizes, drawn on a canvas (no
 * network, no images to load, so it is ready in a few ms) and handed to the phone's share sheet; where the browser cannot
 * share files, it downloads. Pure parts (shareCard) are tested without a DOM.
 */
import type {Award} from './awards.ts';

export interface ShareCard {
  title:string;subtitle:string;
  /** One row per player, in the result's order: the name and its prizes' titles (the first is the big one). */
  rows:{name:string;me:boolean;prizes:string[]}[];
  /** The text that goes with the picture. */
  text:string;
}

/** What the picture says: the headline and each player's prizes (no prize: "Participou com garra"). */
export function shareCard(headline:{title:string;subtitle:string},players:readonly {id:string;name:string}[],awards:readonly Award[],localId:string):ShareCard{
  const rows=players.map(p=>({name:p.name.trim(),me:p.id===localId,
    prizes:awards.filter(a=>a.playerId===p.id).map(a=>a.title)}));
  for(const row of rows)if(!row.prizes.length)row.prizes.push('Participou com garra');
  const mine=rows.find(r=>r.me)?.prizes[0];
  const text=`${headline.title} ${headline.subtitle}.${mine?` Eu levei "${mine}".`:''} Bora de revanche?`;
  return {title:headline.title,subtitle:headline.subtitle,rows,text};
}

/** The picture's size: a phone story's width, as tall as its rows need (6 players fit in 1080×1350). */
export const SHARE_W=1080;
const PAD=60,HEAD=270,ROW=150,FOOT=90;
export const shareHeight=(rows:number)=>PAD+HEAD+Math.max(1,rows)*ROW+FOOT;

const INK={lilas:'#5B3F8C',papel:'#EEDDB8',claro:'#F7EEDB',amarelo:'#FFD23F',breu:'#1E1530'};

/** Draws the card; the fonts are the page's (Londrina for the headline when it is loaded, else sans-serif). */
export function drawShareCard(doc:Document,card:ShareCard,victory:boolean):HTMLCanvasElement{
  const canvas=doc.createElement('canvas');canvas.width=SHARE_W;canvas.height=shareHeight(card.rows.length);
  const g=canvas.getContext('2d');if(!g)return canvas;
  g.fillStyle=victory?INK.lilas:INK.breu;g.fillRect(0,0,canvas.width,canvas.height);
  g.textAlign='center';g.textBaseline='alphabetic';
  g.font='900 120px "Londrina Solid",sans-serif';g.lineWidth=10;g.strokeStyle=INK.breu;g.fillStyle=victory?INK.amarelo:INK.papel;
  g.strokeText(card.title,SHARE_W/2,PAD+120);g.fillText(card.title,SHARE_W/2,PAD+120);
  g.font='700 44px system-ui,sans-serif';g.fillStyle=INK.papel;g.fillText(fit(g,card.subtitle,SHARE_W-2*PAD),SHARE_W/2,PAD+190);
  let y=PAD+HEAD;
  for(const row of card.rows){
    g.fillStyle=row.me?INK.amarelo:INK.papel;roundRect(g,PAD,y,SHARE_W-2*PAD,ROW-20,22);g.fill();
    g.lineWidth=4;g.strokeStyle=INK.breu;g.stroke();
    g.textAlign='left';g.fillStyle=INK.breu;g.font='800 40px system-ui,sans-serif';
    g.fillText(fit(g,row.name+(row.me?' (eu)':''),SHARE_W-2*PAD-60),PAD+30,y+52);
    g.fillStyle=INK.lilas;g.font='900 50px "Londrina Solid",sans-serif';
    const [top,...rest]=row.prizes;
    g.fillText(fit(g,`🏆 ${top}`,SHARE_W-2*PAD-60),PAD+30,y+106);
    if(rest.length){g.font='700 30px system-ui,sans-serif';g.textAlign='right';g.fillText(fit(g,`+ ${rest.join(' · ')}`,(SHARE_W-2*PAD)/2),SHARE_W-PAD-30,y+52);}
    g.textAlign='center';y+=ROW;
  }
  g.font='700 34px system-ui,sans-serif';g.fillStyle=INK.papel;g.fillText('viagem · bora de revanche?',SHARE_W/2,canvas.height-PAD+10);
  return canvas;
}

/** Shares the picture (navigator.share with files) or downloads it; resolves with what happened. */
export async function shareResultImage(doc:Document,card:ShareCard,victory:boolean):Promise<'shared'|'downloaded'|'cancelled'|'failed'>{
  try{
    const canvas=drawShareCard(doc,card,victory);
    const blob=await new Promise<Blob|null>(done=>canvas.toBlob(done,'image/png'));
    if(!blob)return 'failed';
    const file=new File([blob],'viagem-resultado.png',{type:'image/png'});
    const nav=doc.defaultView?.navigator;
    if(nav?.canShare?.({files:[file]})){
      try{await nav.share({files:[file],title:card.title,text:card.text});return 'shared';}
      catch(e){return (e as Error)?.name==='AbortError'?'cancelled':'failed';}
    }
    const url=URL.createObjectURL(blob),link=doc.createElement('a');
    link.href=url;link.download=file.name;doc.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10_000);
    return 'downloaded';
  }catch{return 'failed';}
}

function fit(g:CanvasRenderingContext2D,text:string,width:number){
  if(g.measureText(text).width<=width)return text;
  let cut=[...text];
  while(cut.length>1&&g.measureText(cut.join('')+'…').width>width)cut.pop();
  return cut.join('')+'…';
}
function roundRect(g:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();
}
