/**
 * Só o mendigo no jogo (NEW-20261029-ORQ-so-o-mendigo-no-jogo, pedido do usuário 29/10): TODO inimigo comum desenha a
 * arte do mendigo; a sim não muda (papéis, vida, velocidade e ataques são os mesmos), só a arte. Ficam com a arte
 * própria os chefões (papel chefe e mini-chefe, o chefão da onda) e a aberração-saci (elite, E1). As variações do
 * mendigo entram depois, uma a uma, como peças próprias.
 * A peça: parado de frente v10 (16 quadros, só a frente) e andar walk16 nas 8 direções (16 quadros por direção, uma
 * página 4×4 por direção na ordem das linhas da horda: S, SW, W, NW, N, NE, E, SE). Sem golpe, piada nem morte: o
 * renderer cai no laço (golpe) e no poof (morte). As mesmas folhas servem de camada de elite (mesma textura, sem
 * memória a mais), para a elite ter laço. Uma peça só: a horda inteira carrega UMA arte (a textura GPU cai).
 */
import {WAVE_BOSS_IDS,roleOf} from '../../rules/index.ts';
import type {ArtFile,ArtIndex,ArtPiece} from './manifest.ts';

/** Id da peça no grupo `inimigos` (public/art/enemies/mendigo). */
export const MENDIGO='mendigo';
const DIRS=['S','SW','W','NW','N','NE','E','SE'] as const;
const CEL:[number,number]=[192,192],PE:[number,number]=[.5,.9];
const FILES:Readonly<Record<string,ArtFile>>={
  idle:{file:'mendigo/idle.webp',cell:CEL,frames:16,directions:1,anchor:PE,fps:8,
    pages:[{file:'mendigo/idle.webp',columns:4,rows:4,firstFrame:0,frameCount:16}]},
  // 16 quadros em 600 ms; no jogo o passo segue o chão (ENEMY_WALK.byGround), o fps só vale fora dele
  walk:{file:'mendigo/walk-S.webp',cell:CEL,frames:16,directions:8,anchor:PE,fps:27,
    pages:DIRS.map((d,i)=>({file:`mendigo/walk-${d}.webp`,columns:4,rows:4,firstFrame:i*16,frameCount:16}))},
};
/** O que o mendigo ainda não tem (vira o card "mendigo completo", skill personagem-animado). */
export const MENDIGO_FALTA=['attack','hit','death','elite/*'] as const;

/** Um inimigo que mantém a arte própria: os chefões e a aberração-saci. */
export const keepsOwnArt=(id:string)=>{
  const role=roleOf(id);
  return role==='chefe'||role==='mini-chefe'||WAVE_BOSS_IDS.includes(id)||id.includes('saci');
};
/** A arte que o jogo desenha para o inimigo de arte `id`: a própria, ou o mendigo. */
export const gameEnemyArt=(id:string)=>keepsOwnArt(id)?id:MENDIGO;

/** O índice com a peça do mendigo no grupo `inimigos` (sem o grupo, nada muda). */
export function withMendigo(index:ArtIndex):ArtIndex{
  const g=index.groups.inimigos;
  if(!g)return index;
  const piece:ArtPiece={kind:'animations',files:Object.fromEntries(Object.entries(FILES).flatMap(([a,f])=>[[a,f],[`elite/${a}`,f]]))};
  return {...index,groups:{...index.groups,inimigos:{...g,pieces:{...g.pieces,[MENDIGO]:piece}}}};
}
