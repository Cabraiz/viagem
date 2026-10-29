/**
 * Só o mendigo no jogo (NEW-20261029-ORQ-so-o-mendigo-no-jogo, pedido do usuário 29/10): TODO inimigo comum desenha a
 * arte do mendigo; a sim não muda (papéis, vida, velocidade e ataques são os mesmos), só a arte. Ficam com a arte
 * própria os chefões (papel chefe e mini-chefe, o chefão da onda) e a aberração-saci (elite, E1). As variações do
 * mendigo entram depois, uma a uma, como peças próprias.
 * A peça (NEW-20261029-E7-mendigo-completo): parado v10 nas 8 direções (16 quadros, uma página 4×4 por direção) e andar
 * walk16 nas 8 direções (idem), na ordem das linhas da horda (S, SW, W, NW, N, NE, E, SE); golpe (6 quadros), dano
 * (6, hurt16) e morte (8, o último caído no chão) numa folha só cada, uma linha por direção. A elite não tem folha:
 * é uma CAMADA (horde-art.ts applyEliteLayer) com a coroa dourada no capuz de cada quadro (mendigo-coroa.ts) e um aro
 * dourado; as chaves elite/<a> apontam para a folha base (o carregador pula, sem memória a mais). Uma peça só: a horda
 * inteira carrega UMA arte (a textura GPU cai).
 */
import {WAVE_BOSS_IDS,roleOf} from '../../rules/index.ts';
import {artPiece,type ArtFile,type ArtIndex,type ArtPiece} from './manifest.ts';
import {MENDIGO_COROA,MENDIGO_COROA_CELL,MENDIGO_COROA_LARG} from './mendigo-coroa.ts';

/** Id da peça no grupo `inimigos` (public/art/enemies/mendigo). */
export const MENDIGO='mendigo';
const DIRS=['S','SW','W','NW','N','NE','E','SE'] as const;
const CEL:[number,number]=[192,192],PE:[number,number]=[.5,.9];
const page=(d:string,i:number,name:string)=>({file:`mendigo/${name}-${d}.webp`,columns:4,rows:4,firstFrame:i*16,frameCount:16});
/** Uma folha com uma linha por direção (`frames` colunas × 8 linhas). */
const rows=(name:string,frames:number,fps:number):ArtFile=>({file:`mendigo/${name}.webp`,cell:CEL,frames,directions:8,anchor:PE,fps,
  pages:[{file:`mendigo/${name}.webp`,columns:frames,rows:8,firstFrame:0,frameCount:frames*8}]});
const FILES:Readonly<Record<string,ArtFile>>={
  idle:{file:'mendigo/idle-S.webp',cell:CEL,frames:16,directions:8,anchor:PE,fps:8,pages:DIRS.map((d,i)=>page(d,i,'idle'))},
  // 16 quadros em 600 ms; no jogo o passo segue o chão (ENEMY_WALK.byGround), o fps só vale fora dele
  walk:{file:'mendigo/walk-S.webp',cell:CEL,frames:16,directions:8,anchor:PE,fps:27,pages:DIRS.map((d,i)=>page(d,i,'walk'))},
  attack:rows('attack',6,10),
  hit:rows('hit',6,10),
  death:rows('death',8,10),
};
/** A coroa da elite: um quadro só, carregado como arquivo da peça (não é animação, não ganha chave elite/). */
const COROA:ArtFile={file:'mendigo/coroa.webp',cell:[40,31],frames:1,directions:1,anchor:[.5,.674]};
/** O que o mendigo ainda não tem (nada: a peça está completa). */
export const MENDIGO_FALTA=[] as const;

/** A coroa de elite de uma peça: textura (arquivo `name` da peça), pontos do topo do capuz por quadro na célula `cell`,
 * largura por direção, origem vertical (o capuz entra `originY` da altura) e quanto da textura é coroa (`fill`). */
export interface EliteCrown {name:string;cell:number;widths:readonly number[];points:Readonly<Record<string,readonly number[]>>;originY:number;fill:number}
const MENDIGO_CROWN:EliteCrown={name:'elite/coroa',cell:MENDIGO_COROA_CELL,widths:MENDIGO_COROA_LARG,points:MENDIGO_COROA,originY:.674,fill:.9};
/** A coroa de elite da arte `id` (só o mendigo tem; as outras peças têm folhas elite/ próprias). */
export const eliteCrownOf=(id:string)=>id===MENDIGO?MENDIGO_CROWN:undefined;

/** Um inimigo que mantém a arte própria: os chefões e a aberração-saci. */
export const keepsOwnArt=(id:string)=>{
  const role=roleOf(id);
  return role==='chefe'||role==='mini-chefe'||WAVE_BOSS_IDS.includes(id)||id.includes('saci');
};
/** A arte que o jogo desenha para o inimigo de arte `id`: a própria, ou o mendigo (quando o índice tem a peça, isto é,
 * sempre que o manifest do jogo carregou; um índice montado à mão sem ela fica com as artes próprias). */
export const gameEnemyArt=(id:string)=>keepsOwnArt(id)||!artPiece('inimigos',MENDIGO)?id:MENDIGO;

/** O índice com a peça do mendigo no grupo `inimigos` (sem o grupo, nada muda). */
export function withMendigo(index:ArtIndex):ArtIndex{
  const g=index.groups.inimigos;
  if(!g)return index;
  const piece:ArtPiece={kind:'animations',files:{...Object.fromEntries(Object.entries(FILES).flatMap(([a,f])=>[[a,f],[`elite/${a}`,f]])),[MENDIGO_CROWN.name]:COROA}};
  return {...index,groups:{...index.groups,inimigos:{...g,pieces:{...g.pieces,[MENDIGO]:piece}}}};
}
