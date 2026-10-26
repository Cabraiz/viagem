/**
 * Popup de escolha antes de jogar (NEW-20261025-ORQ-popup-escolha-trico): o layout da variação 7, com os dois botões
 * grandes como imagens. "Jogar com amigos" mostra o herói feliz com amigos inventados para a cena (não a turma do jogo,
 * pedido do usuário), "Jogar sozinho" mostra o herói triste e sozinho. Arte gerada no ChatGPT (evidence/<card>/);
 * a moldura de tricô com neve e o X ficam no CSS (escolha.css). Herói sem arte fica com os botões de texto de hoje.
 */
export const ESCOLHA_HEROIS:readonly string[]=['aposentado','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','viciado-em-bet'];

export type EscolhaArte={amigos:string;sozinho:string;sozinhoDeitado:string};

/** Celular deitado (a mesma regra do escolha.css): o bloco do sozinho é largo e usa a arte larga. */
export const DEITADO='(max-height:520px)';

export const escolhaArte=(classId:string):EscolhaArte|null=>ESCOLHA_HEROIS.includes(classId)
  ?{amigos:`/art/menu/escolha/${classId}-amigos.webp`,sozinho:`/art/menu/escolha/${classId}-sozinho.webp`,sozinhoDeitado:`/art/menu/escolha/${classId}-sozinho-deitado.webp`}
  :null;

/** O texto do botão fica num <span>, por cima da imagem; trocar o texto não pode apagar a imagem. */
export const rotulo=(button:HTMLElement):HTMLElement=>button.querySelector<HTMLElement>('.escolha-rotulo')??button;

/** Põe (ou tira) a arte do herói nos dois botões. Só chamado ao abrir o popup: as imagens só baixam nessa hora. */
export function mostrarEscolha(dialog:HTMLElement,classId:string):void {
  const arte=escolhaArte(classId);
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
    // Deitado, o "Jogar sozinho" troca para a arte larga (o chão lavanda vai de lado a lado do bloco).
    let source=picture.querySelector('source');
    if(kind==='sozinho'){
      if(!source){source=document.createElement('source');source.media=DEITADO;picture.prepend(source);}
      if(source.getAttribute('srcset')!==arte.sozinhoDeitado)source.srcset=arte.sozinhoDeitado;
    } else source?.remove();
    const img=picture.querySelector('img')!;
    if(img.getAttribute('src')!==arte[kind])img.src=arte[kind];
  }
}
