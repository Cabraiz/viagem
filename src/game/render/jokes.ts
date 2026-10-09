/**
 * Comic death pop texts and pastel palettes per enemy kind. Pure module (no Phaser).
 * Lines are picked deterministically by enemy id so every client shows the same joke.
 */
import {isEnemyKind,type EnemyKind} from './keys.ts';
import {hashPhase} from './motion.ts';

export const GENERIC_LINES:readonly string[]=['PAGO!','TCHAU!','JÁ ERA!','FOI-SE!','PARTIU!'];
export const DEATH_LINES:Record<EnemyKind,readonly string[]>={
  gosma:['SPLOFT!','GLUB!','SPLASH!','PLOC!','MELECOU!'],
  pernilongo:['XÔ!','PLAFT!','ZZZ... TÁ!','BZZT!','PEGUEI!'],
  'tio-pave':['É PAVÊ!','FUI COMÊ!','PAVÊ OU PACUMÊ?','PAVORAMA!','SOBREMESA!'],
  fiscal:['MULTADO!','CARIMBADO!','ARQUIVADO!','DEFERIDO!','PROTOCOLADO!'],
  chefe:['CONDOMÍNIO PAGO!','REUNIÃO CANCELADA!','DEMITIDO!','FÉRIAS!','PONTO BATIDO!'],
};

export interface KindStyle {
  /** Pop text fill and stroke (CSS colors). */
  fill:string;stroke:string;
  /** Pastel tint for the death poof. */
  tint:number;
}
export const GENERIC_STYLE:KindStyle={fill:'#fff8ec',stroke:'#6a4f7a',tint:0xf3e6ff};
export const KIND_STYLES:Record<EnemyKind,KindStyle>={
  gosma:{fill:'#f4ffe9',stroke:'#4f9a55',tint:0xc8f5b8},
  pernilongo:{fill:'#fff8ec',stroke:'#5f6fb0',tint:0xd6dcff},
  'tio-pave':{fill:'#fff6d8',stroke:'#a8673a',tint:0xffe2b8},
  fiscal:{fill:'#f2f8ff',stroke:'#3f6e96',tint:0xcfe6ff},
  chefe:{fill:'#fff0fb',stroke:'#8a3f9e',tint:0xf0c8ff},
};

export const deathLines=(kind:string):readonly string[]=>isEnemyKind(kind)?DEATH_LINES[kind]:GENERIC_LINES;
export function deathLine(kind:string,id:string){
  const lines=deathLines(kind);return lines[Math.floor(hashPhase(id)*lines.length)%lines.length];
}
export const kindStyle=(kind:string):KindStyle=>isEnemyKind(kind)?KIND_STYLES[kind]:GENERIC_STYLE;

export const CRIT_LABEL='CRÍTICO!';
/** Damage number text; crits get the comic "!" suffix. */
export const damageLabel=(amount:number,crit=false)=>`${Math.max(0,Math.round(amount))}${crit?'!':''}`;
