/**
 * Copy and timing of the zueira events on the client (VGM-053B). Pure: the HUD, the scene and the tests share it.
 * Voice (design §2.6): the joke lives in the title, the instruction stays dry; "Round" and "bichos" from the glossary.
 */
import type {HappeningKind} from '../../contract/index.ts';
import type {ShameKey,ShameMoment} from '../../contract/index.ts';

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
  bebado:{one:'um bêbado do boteco',the:'o bêbado'},'anao-molotov':{one:'um anão do molotov',the:'o anão do molotov'},
  pombos:{one:'um bando de pombos',the:'os pombos'},'tio-pave':{one:'um tio do pavê',the:'o tio do pavê'},
  agiota:{one:'um agiota',the:'o agiota'},chefe:{one:'o síndico',the:'o síndico'},
};
const critter=(kind?:string)=>CRITTER_NAMES[kind??'']??{one:'um bicho',the:'o bicho'};

/** Kill-cam captions (design review D5): varied, by critter when it has its own joke; never the round number (the chip
 * on top already shows the next round, M1). `{n}` is who closed the round. */
export const KILLCAM_LINES:readonly string[]=[
  '{n} passou o rodo no round.','{n} deu baixa no último boleto.','{n} bateu o ponto do round.','{n} varreu o último pra baixo do tapete.',
];
export const KILLCAM_KIND_LINES:Readonly<Record<string,readonly string[]>>={
  agiota:['{n} quitou o último agiota. Sem juros.'],'tio-pave':['O tio do pavê engasgou com a própria piada.'],
  pombos:['{n} depenou o último pombo. Cruu.'],bebado:['{n} deu PT no último bêbado.'],
  'anao-molotov':['O anão do molotov explodiu a própria cinta.'],
};
export const KILLCAM_ALONE:readonly string[]=['Caiu sozinho. Ninguém assume.','Desistiu de cansaço.'];
/**
 * Kill-cam caption: "Último bicho!" and a line that does not repeat inside the run (`used` holds the lines already shown);
 * the pick is deterministic by `seed` (the event id), so every phone shows the same one.
 */
export function killcamCaption(byName:string|undefined,kind:string,seed:number,used:ReadonlySet<string>=new Set()){
  const pool=byName?[...(KILLCAM_KIND_LINES[kind]??[]),...KILLCAM_LINES]:KILLCAM_ALONE;
  const fresh=pool.filter(l=>!used.has(l)),list=fresh.length?fresh:pool;
  const template=list[Math.abs(Math.floor(seed))%list.length];
  return {title:'Último bicho!',line:template.replace('{n}',byName??''),template};
}

/**
 * Voice rules of the moment (design review B1/D6): it is read by the whole room, so never "você" in the joke, and it
 * blames the thing (the critter, the wire, the coxinha), never the person; verbs without gender ("levantou", "caiu").
 * "Momento mais vergonhoso": the sentence with the name (the notice on top of the result), the same sentence without it
 * (the chip on that player's card, when the notice does not fit) and a one-line joke (second line, optional to read).
 */
export function shameText(m:ShameMoment,name:string):{text:string;line:string;joke:string}{
  const the=critter(m.source),r=`no Round ${m.round}`;
  const lines:Record<ShameKey,()=>{verb:string;joke:string}>={
    recaida:()=>({verb:`levantou e caiu de novo em ${m.seconds??1} s.`,joke:'O resgate pediu reembolso.'}),
    apagao:()=>({verb:`caiu no apagão ${r}.`,joke:'Disse que tropeçou no fio.'}),
    coxinha:()=>({verb:`caiu com uma coxinha do lado ${r}.`,joke:'Tava ali. Do ladinho.'}),
    pombos:()=>({verb:`caiu pra um pombo ${r}.`,joke:'Um pombo. Unzinho. Cruu.'}),
    cedo:()=>({verb:`caiu no Round 1 pra ${the.one}.`,joke:'Nem esquentou o banco.'}),
    'sem-boleto':()=>({verb:`não pegou nenhum boleto da chuva ${r}.`,joke:'Pela primeira vez, fugiu de boleto.'}),
    'coxinha-cheia':()=>({verb:`comeu coxinha de vida cheia ${r}.`,joke:'Era só fome mesmo.'}),
    caiu:()=>({verb:`caiu pra ${the.one} ${r}.`,joke:'Escorregou no chão molhado. Não tinha placa.'}),
  };
  const {verb,joke}=(lines[m.key]??lines.caiu)();
  return {text:`${name} ${verb}`,line:verb.charAt(0).toUpperCase()+verb.slice(1),joke};
}
