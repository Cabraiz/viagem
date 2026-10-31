/**
 * Popup de escolha antes de jogar (NEW-20261025-ORQ-popup-escolha-trico): o layout da variação 7, com os dois botões
 * grandes como imagens. "Jogar com amigos" mostra o herói feliz com amigos inventados para a cena (não a turma do jogo,
 * pedido do usuário), "Jogar sozinho" mostra o herói triste e sozinho. Arte gerada no ChatGPT (evidence/<card>/);
 * a moldura de tricô com neve e o X ficam no CSS (escolha.css). Herói sem arte fica com os botões de texto de hoje.
 */
export const ESCOLHA_HEROIS:readonly string[]=['aposentado','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','viciado-em-bet'];

import type {MenuArtPreload} from '../preload/menu-art-preload.ts';

export type EscolhaArte={amigos:string;sozinho:string;amigosDeitado:string;sozinhoDeitado:string};

/** Celular deitado (a mesma regra do escolha.css): o bloco do sozinho é largo e usa a arte larga. */
export const DEITADO='(max-height:520px)';

/** The popup's own files (escolha.css): the knitted frame, the X, the two blocks and the bots' − and +. */
export const POPUP_FIXOS:readonly string[]=['moldura-trico','x-fechar','bloco-amigos','bloco-sozinho','bots-menos','bots-mais'].map(f=>`/art/menu/escolha/${f}.webp`);

export const escolhaArte=(classId:string):EscolhaArte|null=>ESCOLHA_HEROIS.includes(classId)
  ?{amigos:`/art/menu/escolha/${classId}-amigos.webp`,sozinho:`/art/menu/escolha/${classId}-sozinho.webp`,amigosDeitado:`/art/menu/escolha/${classId}-amigos-deitado.webp`,sozinhoDeitado:`/art/menu/escolha/${classId}-sozinho-deitado.webp`}
  :null;

/** O texto do botão fica num <span>, por cima da imagem; trocar o texto não pode apagar a imagem. */
export const rotulo=(button:HTMLElement):HTMLElement=>button.querySelector<HTMLElement>('.escolha-rotulo')??button;

/**
 * Põe (ou tira) a arte do herói nos dois botões, ao abrir o popup. Com `art` (menu-imagens-sem-buraco), a arte já veio de
 * fundo (preload/menu-art-preload.ts) ou entra a prévia borrada até a real chegar; a moldura, o X e os blocos pintam um
 * substituto liso (escolha.css, sem .arte-pronta) até os arquivos deles chegarem.
 */
export function mostrarEscolha(dialog:HTMLElement,classId:string,art?:MenuArtPreload,deitado=false):void {
  const arte=escolhaArte(classId);
  if(art){
    const pronta=POPUP_FIXOS.every(art.ready);
    dialog.classList.toggle('arte-pronta',pronta);
    if(!pronta)void art.now(POPUP_FIXOS).then(()=>dialog.classList.add('arte-pronta'));
  }
  dialog.classList.toggle('escolha-arte',!!arte);
  for(const [id,kind] of [['enter-coop','amigos'],['enter-island','sozinho']] as const){
    const button=dialog.querySelector<HTMLElement>(`#${id}`);if(!button)continue;
    let picture=button.querySelector<HTMLPictureElement>('picture.escolha-foto');
    if(!arte){picture?.remove();continue;}
    if(!picture){
      picture=document.createElement('picture');picture.className='escolha-foto';
      const img=document.createElement('img');img.className='escolha-img';img.alt='';img.decoding='async';
      picture.append(img);button.prepend(picture);
    }
    // Deitado, os dois blocos são largos e trocam para a arte larga (grupo afastado; chão lavanda de lado a lado).
    let source=picture.querySelector('source');
    if(!source){source=document.createElement('source');source.media=DEITADO;picture.prepend(source);}
    const larga=kind==='amigos'?arte.amigosDeitado:arte.sozinhoDeitado,estreita=arte[kind];
    const img=picture.querySelector('img')!,src=source;
    const put=(largaUrl:string,estreitaUrl:string)=>{
      if(src.getAttribute('srcset')!==largaUrl)src.srcset=largaUrl;
      if(img.getAttribute('src')!==estreitaUrl)img.src=estreitaUrl;
    };
    if(!art){put(larga,estreita);continue;}
    const atual=deitado?larga:estreita;
    art.progressivo(img,atual,url=>url===atual?put(larga,estreita):put(art.previa(larga)??larga,art.previa(estreita)??estreita));
  }
}
