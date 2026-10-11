/**
 * Copy and timing of the zueira events on the client (VGM-053B). Pure: the HUD, the scene and the tests share it.
 * Voice (design §2.6): the joke lives in the title, the instruction stays dry; "Round" and "bichos" from the glossary.
 */
import type {HappeningKind} from '../sim/types.ts';
import type {ShameKey,ShameMoment} from '../sim/shame.ts';

/** Street banner of an event (the round banner's faixa: title + one dry line). */
export const HAPPENING_COPY:Readonly<Record<HappeningKind,{title:string;subtitle:string}>>={
  boletos:{title:'Chuva de boleto!',subtitle:'Cata, que vira XP.'},
  promo:{title:'Promoção relâmpago!',subtitle:'Coxinha grátis por 8 s.'},
  apagao:{title:'Apagão!',subtitle:'Os olhos no escuro são os bichos.'},
};

/** The kill-cam window stays this long (ms); it never takes the camera or the controls. */
export const KILLCAM_MS=2600;
/** The "FEITO" stamp hits the kill-cam caption this long after it opens (ms): the round is over. */
export const KILLCAM_STAMP_AT_MS=700;
/** Critter names for captions (singular, with article). */
export const CRITTER_NAMES:Readonly<Record<string,{one:string;the:string}>>={
  gosma:{one:'uma gosma',the:'a gosma'},pernilongo:{one:'um pernilongo',the:'o pernilongo'},
  'tio-pave':{one:'um tio do pavê',the:'o tio do pavê'},fiscal:{one:'um fiscal',the:'o fiscal'},chefe:{one:'o síndico',the:'o síndico'},
};
const critter=(kind?:string)=>CRITTER_NAMES[kind??'']??{one:'um bicho',the:'o bicho'};

/** Kill-cam caption: "Último bicho!" and who closed the round's bill (or the critter fell by itself). */
export function killcamCaption(round:number,byName?:string){
  return {title:'Último bicho!',line:byName?`${byName} fechou a conta do Round ${round}.`:`Caiu sozinho no Round ${round}.`};
}

/** "Momento mais vergonhoso": one sentence with the name, and a one-line joke (second line, optional to read). */
export function shameText(m:ShameMoment,name:string):{text:string;joke:string}{
  const the=critter(m.source),r=`no Round ${m.round}`;
  const lines:Record<ShameKey,()=>{text:string;joke:string}>={
    recaida:()=>({text:`${name} foi resgatado e caiu de novo em ${m.seconds??1} s.`,joke:'O SAMU pediu reembolso.'}),
    apagao:()=>({text:`${name} caiu no apagão ${r}.`,joke:'Disse que tropeçou no fio.'}),
    coxinha:()=>({text:`${name} caiu com uma coxinha do lado ${r}.`,joke:'Tava ali. Do ladinho.'}),
    pernilongo:()=>({text:`${name} caiu pra um pernilongo ${r}.`,joke:'Um pernilongo. Unzinho.'}),
    cedo:()=>({text:`${name} caiu no Round 1 pra ${the.one}.`,joke:'Nem esquentou o banco.'}),
    'sem-boleto':()=>({text:`${name} não pegou nenhum boleto da chuva ${r}.`,joke:'Pela primeira vez, fugiu de boleto.'}),
    'coxinha-cheia':()=>({text:`${name} comeu coxinha de vida cheia ${r}.`,joke:'Era só fome mesmo.'}),
    caiu:()=>({text:`${name} caiu pra ${the.one} ${r}.`,joke:'Acontece. Com você, mais.'}),
  };
  return (lines[m.key]??lines.caiu)();
}
