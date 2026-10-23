/**
 * The hero pick on the phone held upright as an Instagram profile (NEW-20261023-ORQ-selecao-mobile-instagram, the user
 * 23/10: "tipo um Instagram, mas você só vê as 3 primeiras imagens e não desce para ver mais"). One screen, no scroll:
 * the top bar (logo, bell, ≡), the other heroes as stories, the chosen one's profile (photo, @, followers, bio), three
 * chips, the tabs and exactly 3 photos, then SELECIONAR (main.ts keeps the button, the name step and the lock).
 * A locked hero shows his profile but never his photos: a private account. Desktop and the phone on its side keep the
 * stadium (estadio.css); this screen only exists under INSTA_QUERY (ui/insta.css).
 * Pure over strings (node tests, no DOM); main.ts mounts the HTML and wires the taps.
 */
import { STADIUM_TALL_QUERY } from './stadium.ts';

/** The phone upright: the stadium's tall layout is where the profile replaces it. */
export const INSTA_QUERY=STADIUM_TALL_QUERY;
/** The lossy copies the page loads (scripts/insta-arte.mjs, then scripts/art-lite.mjs). */
export const INSTA_ART='/art/lite/menu/insta/';

export interface InstaChip {label:'Estilo'|'Especialidade'|'Status';valor:string;icone:'oculos'|'coroa'|'pata'}
export interface InstaPerfil {
  id:string;
  /** The story's caption, caps written in the text (design lint). */
  nome:string;
  handle:string;
  seguidores:string;
  seguindo:string;
  bio:string;
  chips:readonly [InstaChip,InstaChip,InstaChip];
}
const chips=(estilo:string,especialidade:string,status:string):InstaPerfil['chips']=>Object.freeze([
  {label:'Estilo',valor:estilo,icone:'oculos'},{label:'Especialidade',valor:especialidade,icone:'coroa'},{label:'Status',valor:status,icone:'pata'}] as const);
/** Texts of step 2 (evidence/<ID>/textos.md), in the stories' order. */
export const INSTA_PERFIS:readonly InstaPerfil[]=Object.freeze([
  {id:'viciado-em-bet',nome:'VICIADO',handle:'@VICIADO',seguidores:'1,2 mi',seguindo:'847',bio:'Green garantido. Fonte: confia.',
    chips:chips('Boné da sorte','Odd impossível','Quase ganhando')},
  {id:'clt-cansado',nome:'CLT',handle:'@CLT',seguidores:'312',seguindo:'1',bio:'Isso entra no banco de horas?',
    chips:chips('Social amassada','Hora extra','Em reunião')},
  {id:'gato-nada-pra-comer',nome:'GATO',handle:'@GATO',seguidores:'12,4 mil',seguindo:'3',bio:'Sete vidas. Zero boletos.',
    chips:chips('Roupão rosa','Miado de fome','Comeu há 5 min')},
  {id:'maromba',nome:'MAROMBA',handle:'@MAROMBA',seguidores:'88,8 mil',seguindo:'0',bio:'Seguindo ninguém. Só o shape.',
    chips:chips('Regata 365','Só mais uma','No pump')},
]);
export const instaPerfil=(id:string):InstaPerfil|undefined=>INSTA_PERFIS.find(p=>p.id===id);

export const instaUrl=(file:string)=>`${INSTA_ART}${file}.webp`;
export const perfilUrl=(id:string)=>instaUrl(`perfil-${id}`);
/** The grid: exactly 3 photos for a released hero; none for a locked one (his photos never download). */
export const gradeUrls=(id:string,liberado:boolean):string[]=>liberado?[1,2,3].map(i=>instaUrl(`grade-${id}-${i}`)):[];
/** The stories: every other hero with a profile, in INSTA_PERFIS order (`ids` = the heroes this build has). */
export const storiesOf=(selectedId:string,ids:readonly string[]):InstaPerfil[]=>INSTA_PERFIS.filter(p=>p.id!==selectedId&&ids.includes(p.id));

/**
 * The handle's size: the reference's @GATO is 72 card px (of 734) and the column beside the photo holds ~335; a longer
 * handle shrinks so it never wraps (Lilita One averages ~0.62 em per capital).
 */
export const handleFit=(handle:string)=>Math.min(1,335/(handle.length*.62*72));

const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
const img=(file:string,cls:string,alt='')=>`<img class="${cls}" src="${instaUrl(file)}" alt="${esc(alt)}"${alt?'':' aria-hidden="true"'} decoding="async" draggable="false">`;
// The reference's thin line icons (bell, ≡ and the tabs); the chips, the badge and the lock are the Codex art.
const svg=(body:string)=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const LINHA={
  sino:svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  menu:svg('<path d="M4 6.5h16M4 12h16M4 17.5h16"/>'),
  grade:svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16"/>'),
  video:svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/>'),
  coracao:svg('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
} as const;

/** The top bar: the game's logo, the bell (decorative) and ≡ (the sound settings, like the stadium's gear). */
export const barraHtml=()=>`<header class="insta-barra">${img('logo','insta-logo','Viciado em Bet')}<span class="insta-acoes"><span class="insta-sino">${LINHA.sino}</span><button type="button" class="insta-menu" aria-label="Configurações" aria-haspopup="dialog">${LINHA.menu}</button></span></header>`;

/** One story: the face in the gradient ring, the name under it; a locked hero gets the lock over his face. */
export function storyHtml(p:InstaPerfil,liberado:boolean):string{
  return `<button type="button" class="insta-story" data-hero="${p.id}"${liberado?'':' data-bloqueado'} aria-label="${esc(p.nome)}${liberado?'':' (em breve)'}">`+
    `<span class="insta-anel"><img class="insta-rosto" src="${perfilUrl(p.id)}" alt="" decoding="async" draggable="false">${liberado?'':img('icone-cadeado','insta-cadeado')}</span>`+
    `<span class="insta-story-nome">${esc(p.nome)}</span></button>`;
}

/** The profile: photo with the badge, @handle with the badge, followers | following, the bio. */
export function perfilHtml(p:InstaPerfil):string{
  return `<div class="insta-foto"><span class="insta-anel"><img class="insta-rosto" src="${perfilUrl(p.id)}" alt="" decoding="async" draggable="false"></span>${img('icone-verificado','insta-selo-foto')}</div>`+
    `<div class="insta-info"><p class="insta-arroba" style="--arroba-fit:${handleFit(p.handle).toFixed(3)}"><span>${esc(p.handle)}</span>${img('icone-verificado','insta-selo','verificado')}</p>`+
    `<div class="insta-numeros"><p><strong>${esc(p.seguidores)}</strong><span>seguidores</span></p><p><strong>${esc(p.seguindo)}</strong><span>seguindo</span></p></div>`+
    `<p class="insta-bio">${esc(p.bio)}</p></div>`;
}

export const chipsHtml=(p:InstaPerfil)=>p.chips.map(c=>`<li class="insta-chip">${img(`icone-${c.icone}`,'insta-chip-icone')}<span><small>${c.label}</small><b>${esc(c.valor)}</b></span></li>`).join('');

/** The grid: the 3 photos, or the private account of a locked hero (no photo of his is ever requested). */
export function gradeHtml(p:InstaPerfil,liberado:boolean):string{
  const urls=gradeUrls(p.id,liberado);
  if(!urls.length)return `<div class="insta-privada">${img('icone-cadeado','insta-privada-cadeado')}<p><b>Esta conta é privada</b><span>${esc(p.nome)} chega em breve.</span></p></div>`;
  return urls.map((url,i)=>`<img class="insta-post" src="${url}" alt="Foto ${i+1} de ${esc(p.handle)}" decoding="async" draggable="false">`).join('');
}

/** The tabs: grid (active), video and liked, as in the reference; only the grid exists, the others are drawn. */
export const abasHtml=()=>`<div class="insta-abas" aria-hidden="true"><span class="insta-aba ativa">${LINHA.grade}</span><span class="insta-aba">${LINHA.video}</span><span class="insta-aba">${LINHA.coracao}</span></div>`;
