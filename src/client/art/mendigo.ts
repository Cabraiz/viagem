/**
 * Só o mendigo no jogo (NEW-20261029-ORQ-so-o-mendigo-no-jogo, pedido do usuário 29/10): TODO inimigo comum desenha a
 * arte do mendigo; a sim não muda (papéis, vida, velocidade e ataques são os mesmos), só a arte. Ficam com a arte
 * própria os chefões (papel chefe e mini-chefe, o chefão da onda) e a aberração-saci (elite, E1). As variações do
 * mendigo entram depois, uma a uma, como peças próprias.
 * A peça: parado de frente v10 (16 quadros, só a frente) e andar walk16 nas 8 direções (16 quadros por direção, uma
 * página 4×4 por direção na ordem das linhas da horda: S, SW, W, NW, N, NE, E, SE). Sem golpe, piada nem morte: o
 * renderer cai no laço (golpe) e no poof (morte). Empurrado por um herói: shoved nas 8 direções (cai e levanta). As mesmas folhas servem de camada de elite (mesma textura, sem
 * memória a mais), para a elite ter laço. Uma peça só: a horda inteira carrega UMA arte (a textura GPU cai).
 */
import type Phaser from 'phaser';
import {WAVE_BOSS_IDS,roleOf} from '../../rules/index.ts';
import {artPiece,type ArtFile,type ArtIndex,type ArtPiece} from './manifest.ts';

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
  // Card anim-ser-empurrado: empurrado por um herói (cai sentado e levanta), 16 quadros em ~1400 ms (o mesmo do shoved16
  // dos heróis; ENEMY_ANIM_RATE ×0,7), uma vez por empurrão (horde-art.ts applyEnemyArt). E/NE/SW são W/NW/SE espelhados.
  shoved:{file:'mendigo/shoved-S.webp',cell:CEL,frames:16,directions:8,anchor:PE,fps:16.3,
    pages:DIRS.map((d,i)=>({file:`mendigo/shoved-${d}.webp`,columns:4,rows:4,firstFrame:i*16,frameCount:16}))},
};
/** O que o mendigo ainda não tem (vira o card "mendigo completo", skill personagem-animado). */
export const MENDIGO_FALTA=['attack','hit','death','elite/*'] as const;

/** Um inimigo que mantém a arte própria: os chefões, a aberração-saci e o sanfoneiro (boneco de madeira, card sanfoneiro-brinquedo-no-jogo). */
export const keepsOwnArt=(id:string)=>{
  const role=roleOf(id);
  return role==='chefe'||role==='mini-chefe'||WAVE_BOSS_IDS.includes(id)||id.includes('saci')||id==='sanfoneiro';
};
/** A arte que o jogo desenha para o inimigo de arte `id`: a própria, ou o mendigo (quando o índice tem a peça, isto é,
 * sempre que o manifest do jogo carregou; um índice montado à mão sem ela fica com as artes próprias). */
export const gameEnemyArt=(id:string)=>keepsOwnArt(id)||!artPiece('inimigos',MENDIGO)?id:MENDIGO;

/** O índice com a peça do mendigo no grupo `inimigos` (sem o grupo, nada muda). */
export function withMendigo(index:ArtIndex):ArtIndex{
  const g=index.groups.inimigos;
  if(!g)return index;
  const piece:ArtPiece={kind:'animations',files:Object.fromEntries(Object.entries(FILES).flatMap(([a,f])=>[[a,f],[`elite/${a}`,f]]))};
  return {...index,groups:{...index.groups,inimigos:{...g,pieces:{...g.pieces,[MENDIGO]:piece}}}};
}

/**
 * Arquivos que só o empurrão toca (card anim-ser-empurrado: o shoved do mendigo, 8 páginas de 768², ~19 MB de memória
 * de vídeo): fora das cargas da rodada (horde-art.ts enemyPieceLoads) e pedidos no primeiro empurrão (queueEnemyShoved).
 */
export const onPushEnemyFile=(name:string)=>/^(elite\/)?shoved$/.test(name);
interface SheetLoad {key:string;url:string;cell:[number,number]}
/** Enfileira as folhas que ainda não existem e liga o loader; true quando enfileirou alguma. */
export function queueSheets(scene:Phaser.Scene,loads:readonly SheetLoad[]):boolean{
  let queued=false;
  for(const l of loads){
    if(scene.textures.exists(l.key))continue;
    scene.load.spritesheet(l.key,l.url,{frameWidth:l.cell[0],frameHeight:l.cell[1]});queued=true;
  }
  if(queued&&!scene.load.isLoading())scene.load.start();
  return queued;
}
/** As folhas do empurrão do inimigo `id` (`loads`: enemyPieceLoads(id,'push')), uma vez por cena. Até carregarem, o
 * empurrado segue andando (o shoved cai, como qualquer folha a caminho). */
const askedPush=new WeakMap<object,Set<string>>();
export function queueEnemyShoved(scene:Phaser.Scene,id:string,loads:readonly SheetLoad[]):boolean{
  let seen=askedPush.get(scene);if(!seen){seen=new Set();askedPush.set(scene,seen);}
  if(seen.has(id)||!scene.load)return false;
  seen.add(id);
  return queueSheets(scene,loads);
}
/** horde-art.ts releaseEnemyArt: o `id` pode pedir o empurrão de novo. */
export const forgetEnemyShoved=(scene:Phaser.Scene,id:string)=>{askedPush.get(scene)?.delete(id);};
