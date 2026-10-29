/**
 * TESTE (não vai para produção): `?inimigo=mendigo` troca a arte de TODOS os inimigos (horda, elites e chefe) pelo
 * parado de frente do mendigo (16 quadros, card marca-dos-inimigos v8). Só existe o parado de frente: o inimigo
 * desliza parado quando anda, toda direção mostra a frente e as ações (golpe, piada, morte) ficam sem arte.
 * Todos ficam do tamanho padrão (0,9 do herói), sem o tamanho por papel; a elite mantém o seu aumento.
 */
import type {ArtFile,ArtIndex,ArtPiece} from './manifest.ts';

const TESTES:Readonly<Record<string,ArtFile>>={
  mendigo:{file:'teste-mendigo/idle.webp',cell:[192,192],frames:16,directions:1,anchor:[.5,.9],fps:8,
    pages:[{file:'teste-mendigo/idle.webp',columns:4,rows:4,firstFrame:0,frameCount:16}]},
};

/** O id do teste pedido na URL (`?inimigo=<id>`), se existir. */
let lido:{search:string;id:string|undefined}|undefined;
export function testeInimigo(search=typeof location==='undefined'?'':location.search):string|undefined{
  if(lido?.search!==search){const id=new URLSearchParams(search).get('inimigo');lido={search,id:id&&TESTES[id]?id:undefined};}
  return lido.id;
}

/** Cada peça de `inimigos` passa a ter só o parado do teste (e a mesma folha como camada de elite). */
export function trocarInimigos(index:ArtIndex,id:string|undefined=testeInimigo()):ArtIndex{
  const file=id&&TESTES[id],g=index.groups.inimigos;
  if(!file||!g)return index;
  const pieces:Record<string,ArtPiece>=Object.create(null);
  for(const pid of Object.keys(g.pieces))pieces[pid]={kind:'animations',files:{idle:file,'elite/idle':file}};
  return {...index,groups:{...index.groups,inimigos:{...g,pieces}}};
}
