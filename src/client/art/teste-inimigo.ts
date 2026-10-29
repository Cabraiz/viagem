/**
 * TESTE (não vai para produção): `?inimigo=mendigo` troca a arte de TODOS os inimigos (horda, elites e chefe) pelo
 * mendigo do card marca-dos-inimigos: parado de frente v10 (16 quadros, só a frente) e andar walk16 nas 8 direções
 * (16 quadros por direção, uma página 4×4 por direção na ordem das linhas da horda: S, SW, W, NW, N, NE, E, SE; o SE
 * é o espelho do SW). Anda na direção do movimento e fica parado de frente quando para; as ações (golpe, piada,
 * morte) ficam sem arte. Todos ficam do tamanho padrão (0,9 do herói), sem o tamanho por papel; a elite mantém o
 * seu aumento.
 */
import type {ArtFile,ArtIndex,ArtPiece} from './manifest.ts';

const DIRS=['S','SW','W','NW','N','NE','E','SE'] as const;
const CEL:[number,number]=[192,192],PE:[number,number]=[.5,.9];
const TESTES:Readonly<Record<string,Readonly<Record<string,ArtFile>>>>={
  mendigo:{
    idle:{file:'teste-mendigo/idle.webp',cell:CEL,frames:16,directions:1,anchor:PE,fps:8,
      pages:[{file:'teste-mendigo/idle.webp',columns:4,rows:4,firstFrame:0,frameCount:16}]},
    // 16 quadros em 600 ms; no jogo o passo segue o chão (ENEMY_WALK.byGround), o fps só vale fora dele
    walk:{file:'teste-mendigo/walk-S.webp',cell:CEL,frames:16,directions:8,anchor:PE,fps:27,
      pages:DIRS.map((d,i)=>({file:`teste-mendigo/walk-${d}.webp`,columns:4,rows:4,firstFrame:i*16,frameCount:16}))},
  },
};

/** O id do teste pedido na URL (`?inimigo=<id>`), se existir. */
let lido:{search:string;id:string|undefined}|undefined;
export function testeInimigo(search=typeof location==='undefined'?'':location.search):string|undefined{
  if(lido?.search!==search){const id=new URLSearchParams(search).get('inimigo');lido={search,id:id&&TESTES[id]?id:undefined};}
  return lido.id;
}

/** Cada peça de `inimigos` passa a ter só as animações do teste (e as mesmas folhas como camada de elite). */
export function trocarInimigos(index:ArtIndex,id:string|undefined=testeInimigo()):ArtIndex{
  const t=id&&TESTES[id],g=index.groups.inimigos;
  if(!t||!g)return index;
  const pieces:Record<string,ArtPiece>=Object.create(null);
  for(const pid of Object.keys(g.pieces))pieces[pid]={kind:'animations',files:Object.fromEntries(Object.entries(t).flatMap(([a,f])=>[[a,f],[`elite/${a}`,f]]))};
  return {...index,groups:{...index.groups,inimigos:{...g,pieces}}};
}
