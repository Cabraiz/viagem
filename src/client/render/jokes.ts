/**
 * Comic death pop texts and pastel palettes per enemy kind. Pure module (no Phaser).
 * Lines are picked deterministically by enemy id so every client shows the same joke.
 */
import {isEnemyKind,type EnemyKind} from './keys.ts';
import {entryLines,fallbackAccent,isRosterId} from '../../rules/index.ts';
import {hashPhase} from './motion.ts';

export const GENERIC_LINES:readonly string[]=['PAGO!','VIROU SAUDADE!','JÁ ERA!','FOI-SE!','PARTIU!'];
export const DEATH_LINES:Record<EnemyKind,readonly string[]>={
  bebado:['HIC... PLOFT!','FECHOU A CONTA!','ABRAÇOU O POSTE!','APAGOU NA MESA!','ZZZ... RONC!'],
  'anao-molotov':['CABUM!','PEGOU FOGO, BICHO!','CACHAÇA FLAMBADA!','FLAMBOU A BARBA!','EXPLODIU A CINTA!'],
  pombos:['CRUU!','PENA PRA TODO LADO!','VOOU... PRO CHÃO!','PRU-PRU... PLAFT!','FIM DO MIOLO!'],
  'tio-pave':['MORREU RINDO!','ENGASGOU NA PIADA!','PAVÊ OU PA COMÊ?','TIO NO GELO!','SOBREMESA!'],
  agiota:['NOME LIMPO!','JUROS ZERADOS!','CALOTE!','QUITADO, PORRA!','VIROU PAPEL!'],
  chefe:['CONDOMÍNIO PAGO!','ATA ENCERRADA!','DESPEJADO!','ASSEMBLEIA CANCELADA!','SÍNDICO DEPOSTO!'],
  // Elenco P1 (humor-reviewed).
  coach:['CHUVA DE POST-IT!','PALESTRA ENCERRADA!','SAIU DA ZONA DE VIDA!','CASE DE FRACASSO!','FEEDBACK RECEBIDO!','TROPEÇOU NO SLOGAN!'],
  motoboy:['PEDIDO ESPALHADO!','CHOVEU FEIJÃO!','MARMITADA!','SAIU PRA ENTREGA!','FREIOU NO POSTE!','BIIII... PLAFT!'],
  influencer:['PANTURRILHA FOI!','SHAPE DESMONTOU!','CÃIBRA AO VIVO!','STORY ENCERRADO!','UNFOLLOW ETERNO!','TÁ PAGO... AI!'],
};
/**
 * Death pops of the enemies in the game (rules/inimigos-liberados.ts, plus the sanfoneiro, held until his rule lands),
 * by roster id: they win over the roster's single pop and the role's pops. The mendigo is the schemer of his gag (the
 * hug with interest), never the joke of being poor.
 */
export const ELENCO_POPS:Readonly<Record<string,readonly string[]>>={
  mendigo:['ABRAÇO COM JUROS!','TROCO NÃO DEVOLVIDO!','O CARRINHO FUGIU!','VIROU SUCATA BOA!','CADÊ MEU TROCADO?!'],
  'aberracao-saci':['SÓ SOBROU O CACHIMBO!','REDEMOINHO DESLIGOU!','CAIU DE UMA PERNA SÓ!','NÓ NA PRÓPRIA PERNA!','PULOU PRO FOLCLORE!'],
  sanfoneiro:['FOLE FURADO!','FIM DO ARRASTA-PÉ!','ANARRIÊ PRO CHÃO!','DESAFINOU DE VEZ!','FOM-FOM... PLOFT!'],
};
const elencoPops=(kind:string)=>Object.hasOwn(ELENCO_POPS,kind)?ELENCO_POPS[kind]:undefined;

export interface KindStyle {
  /** Pop text fill and stroke (CSS colors). */
  fill:string;stroke:string;
  /** Pastel tint for the death poof. */
  tint:number;
}
export const GENERIC_STYLE:KindStyle={fill:'#fff8ec',stroke:'#6a4f7a',tint:0xf3e6ff};
export const KIND_STYLES:Record<EnemyKind,KindStyle>={
  bebado:{fill:'#fff4d6',stroke:'#3f7a3a',tint:0xf6dc9a},
  'anao-molotov':{fill:'#fff1d0',stroke:'#b23a1c',tint:0xffc28a},
  pombos:{fill:'#f4f4f8',stroke:'#5b5f75',tint:0xd8dbe6},
  'tio-pave':{fill:'#fff6d8',stroke:'#a8673a',tint:0xffe2b8},
  agiota:{fill:'#fff8dc',stroke:'#2e2a33',tint:0xf0dc8a},
  chefe:{fill:'#fff0fb',stroke:'#8a3f9e',tint:0xf0c8ff},
  // Elenco P1: the coach's suit blue, the motoboy's bag green, the influencer's tank-top pink.
  coach:{fill:'#f2f6ff',stroke:'#1f4aa8',tint:0xc8d8ff},
  motoboy:{fill:'#f6ffe6',stroke:'#3f6a18',tint:0xd4f0a8},
  influencer:{fill:'#fff0f7',stroke:'#b0246a',tint:0xffc4e0},
};
/** Pop and poof style of the ELENCO_POPS cast: the mendigo's coat brown, the saci's cap red, the sanfoneiro's leather tan. */
export const ELENCO_STYLES:Readonly<Record<string,KindStyle>>={
  mendigo:{fill:'#fff6e6',stroke:'#5a4122',tint:0xe6d2b0},
  'aberracao-saci':{fill:'#fff1ee',stroke:'#a3221c',tint:0xffc0b8},
  sanfoneiro:{fill:'#fff6e0',stroke:'#8a5a1c',tint:0xf2d6a6},
};
const elencoStyle=(kind:string)=>Object.hasOwn(ELENCO_STYLES,kind)?ELENCO_STYLES[kind]:undefined;

/** Death pops of a kind: the nine's own, the active cast's (ELENCO_POPS), a roster entry's pop (P0) or its role's pops, else GENERIC_LINES. */
export const deathLines=(kind:string):readonly string[]=>isEnemyKind(kind)?DEATH_LINES[kind]:elencoPops(kind)??entryLines(kind)?.pops??GENERIC_LINES;
export function deathLine(kind:string,id:string){
  const lines=deathLines(kind);return lines[Math.floor(hashPhase(id)*lines.length)%lines.length];
}
/**
 * Death jokes stay but are rare (inimigos-sem-frases-anim-lenta): about 1 kill in 10 is drawn for one, by the enemy's
 * id (every client draws the same), and at most one shows every DEATH_POP_GAP_MS on screen. The chefe's always shows.
 */
export const DEATH_POP_CHANCE=.1,DEATH_POP_GAP_MS=4000;
export function deathPopAllowed(id:string,now:number,lastAt:number,boss=false){
  if(boss)return true;
  return now-lastAt>=DEATH_POP_GAP_MS&&hashPhase(`${id}#pop`)<DEATH_POP_CHANCE;
}
const ROSTER_STYLES=new Map<string,KindStyle>();
const css=(n:number)=>`#${n.toString(16).padStart(6,'0')}`;
/** Pop and poof style of a roster entry: the generic paper fill, its accent darkened as the stroke and lightened as the tint. */
function rosterStyle(kind:string,accent:number):KindStyle{
  let style=ROSTER_STYLES.get(kind);
  if(!style){
    const ch=(shift:number,f:(v:number)=>number)=>Math.max(0,Math.min(255,Math.round(f((accent>>shift)&255))))<<shift;
    const dark=(v:number)=>v*.55,light=(v:number)=>v+(255-v)*.7;
    style={fill:GENERIC_STYLE.fill,stroke:css(ch(16,dark)|ch(8,dark)|ch(0,dark)),tint:ch(16,light)|ch(8,light)|ch(0,light)};
    ROSTER_STYLES.set(kind,style);
  }
  return style;
}
export const kindStyle=(kind:string):KindStyle=>{
  if(isEnemyKind(kind))return KIND_STYLES[kind];
  const own=elencoStyle(kind);if(own)return own;
  const accent=fallbackAccent(kind);
  return accent===undefined?GENERIC_STYLE:rosterStyle(kind,accent);
};
/** Cache key of a kind's pop text style: the kind itself when it has its own style, else 'generic'. */
export const styleKey=(kind:string)=>isEnemyKind(kind)||elencoStyle(kind)||isRosterId(kind)?kind:'generic';

export const CRIT_LABEL='CRÍTICO!';
/** Damage number text; crits get the comic "!" suffix. */
export const damageLabel=(amount:number,crit=false)=>`${Math.max(0,Math.round(amount))}${crit?'!':''}`;

/** D-013: at most one line per source (here: per caster) every ~2 s, whatever the cooldowns and refunds do. */
export const SKILL_BUBBLE_GAP_MS=2000;
/** Second line of the dice skill (Odd Impossível): what the dice said. */
export const DICE_LINE={flop:'Deu ruim.',hit:'Acertou!',miracle:'Milagre!'} as const;
/** Balloon text of a skill cast (E7-skill-hud-wiring): the kit line, plus the dice on a second line. */
export const skillBubbleLine=(e:{line:string;outcome?:keyof typeof DICE_LINE})=>e.outcome?`${e.line}\n${DICE_LINE[e.outcome]}`:e.line;

/** `say` keys that show a short red status tag over the player instead of the line (D-033: the agiota's boleto). */
export const SAY_TAGS:Readonly<Record<string,string>>={devendo:'DEVENDO'};
export const sayTag=(key:string|undefined):string|undefined=>key!==undefined&&Object.hasOwn(SAY_TAGS,key)?SAY_TAGS[key]:undefined;
/**
 * `say` keys whose line must not be swallowed by the 2 s per-player gap (D-013), shown as a normal balloon (not a
 * status tag): the city's "ficou pra trás no rolê" at the wave start (cidade-07) often lands right after a crate's line.
 */
export const SAY_PRIORITY:ReadonlySet<string>=new Set(['ficou-pra-tras']);
export const sayPriority=(key:string|undefined)=>key!==undefined&&SAY_PRIORITY.has(key);
/** The per-player balloon gate (D-013): a status tag or a priority line always shows; anything else waits SKILL_BUBBLE_GAP_MS. */
export const bubbleAllowed=(nowMs:number,lastMs:number,o:{tag?:boolean;priority?:boolean}={})=>!!o.tag||!!o.priority||nowMs-lastMs>=SKILL_BUBBLE_GAP_MS;
