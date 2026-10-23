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
/** One of the 3 photos opened as a post: its caption, who liked it first and how many more, and when. */
export interface InstaPost {legenda:string;curtidoPor:string;curtidas:string;quando:string}
export interface InstaPerfil {
  id:string;
  /** The story's caption, caps written in the text (design lint). */
  nome:string;
  handle:string;
  /** What the hero's letreiro says (the top bar's logo, logo-<id>.webp): its alt. */
  letreiro:string;
  seguidores:string;
  seguindo:string;
  /** Broken after the full stop by a "\n" (the user, 23/10: "Sete vidas." / "Zero boletos."); insta.css pre-line. */
  bio:string;
  chips:readonly [InstaChip,InstaChip,InstaChip];
  posts:readonly [InstaPost,InstaPost,InstaPost];
}
const chips=(estilo:string,especialidade:string,status:string):InstaPerfil['chips']=>Object.freeze([
  {label:'Estilo',valor:estilo,icone:'oculos'},{label:'Especialidade',valor:especialidade,icone:'coroa'},{label:'Status',valor:status,icone:'pata'}] as const);
const posts=(curtidoPor:string,...p:[string,string,string][]):InstaPerfil['posts']=>
  Object.freeze(p.map(([legenda,curtidas,quando])=>Object.freeze({legenda,curtidoPor,curtidas,quando}))) as unknown as InstaPerfil['posts'];
/**
 * Texts of step 2 (evidence/<ID>/textos.md), in the stories' order; the posts' captions, one per grid photo in its order
 * (BUG-20261023-ORQ-instagram-letreiro-do-perfil, evidence/<ID>/textos-posts.md).
 */
export const INSTA_PERFIS:readonly InstaPerfil[]=Object.freeze([
  {id:'viciado-em-bet',nome:'VICIADO',handle:'@VICIADO',letreiro:'Viciado em Bet',seguidores:'1,2 mi',seguindo:'847',bio:'Green garantido.\nFonte: confia.',
    chips:chips('Boné da sorte','Odd impossível','Quase ganhando'),
    posts:posts('tipster_do_green',['Hoje vai. Fonte: a vuvuzela.','9.871','há 2 horas'],
      ['Faltou um gol. Sempre falta um gol.','4.302','há 5 horas'],['Comemorando o green antes do apito.','12.640','há 1 dia'])},
  {id:'clt-cansado',nome:'CLT',handle:'@CLT',letreiro:'CLT, tanque em horário comercial',seguidores:'312',seguindo:'1',bio:'Isso entra no\nbanco de horas?',
    chips:chips('Social amassada','Hora extra','Em reunião'),
    posts:posts('rh_oficial',['Reunião que podia ser um e-mail.','41','há 3 horas'],
      ['Ônibus lotado: meu cardio diário.','58','há 9 horas'],['Tudo sob controle. (Não está.)','27','há 2 dias'])},
  {id:'gato-nada-pra-comer',nome:'GATO',handle:'@GATO',letreiro:'Gato da raça Nada para comer em casa',seguidores:'12,4 mil',seguindo:'3',bio:'Sete vidas.\nZero boletos.',
    chips:chips('Roupão rosa','Miado de fome','Comeu há 5 min'),
    posts:posts('vizinho_do_sache',['Geladeira cheia. Meu pote: vazio.','3.415','há 1 hora'],
      ['Comi há 5 minutos. Faz 84 anos.','2.980','há 6 horas'],['Miei pra lua. Ela também não deu sachê.','5.112','há 1 dia'])},
  {id:'maromba',nome:'MAROMBA',handle:'@MAROMBA',letreiro:'Maromba, hoje é treino de chefe',seguidores:'88,8 mil',seguindo:'0',bio:'Seguindo ninguém.\nSó o shape.',
    chips:chips('Regata 365','Só mais uma','No pump'),
    posts:posts('creatina_pura',['Registro do bíceps. Dia 412.','7.704','há 4 horas'],
      ['O pneu não ia se puxar sozinho.','6.091','há 8 horas'],['Shake: meu único relacionamento sério.','9.338','há 3 dias'])},
  {id:'vendedor-praia',nome:'VENDEDOR',handle:'@VENDEDOR',letreiro:'Vendedor de Praia, reforço geladinho',seguidores:'47,3 mil',seguindo:'2.318',bio:'Olha a água, olha o mate!
Aceito Pix.',
    chips:chips('Chapéu de palha','Água gelada','Na areia quente'),
    posts:posts('quiosque_do_ze',['Selfie com o isopor. Gelo novinho.','2.214','há 1 hora'],
      ['Areia a 60 graus. O chinelo resiste.','3.870','há 5 horas'],['Vai uma geladinha, aventureiro?','5.402','há 1 dia'])},
]);
export const instaPerfil=(id:string):InstaPerfil|undefined=>INSTA_PERFIS.find(p=>p.id===id);

export const instaUrl=(file:string)=>`${INSTA_ART}${file}.webp`;
export const perfilUrl=(id:string)=>instaUrl(`perfil-${id}`);
/** The grid: exactly 3 photos for a released hero; none for a locked one (his photos never download). */
export const gradeUrls=(id:string,liberado:boolean):string[]=>liberado?[1,2,3].map(i=>instaUrl(`grade-${id}-${i}`)):[];
/** The same photo opened as a post (scripts/insta-arte.mjs post-*: the square, 480 px); only a released hero has a grid. */
export const postUrl=(id:string,i:number)=>instaUrl(`post-${id}-${i+1}`);
/** The top bar's logo: the letreiro of the profile on screen (BUG-20261023-ORQ-instagram-letreiro-do-perfil). */
export const logoUrl=(id:string)=>instaUrl(`logo-${id}`);
/** The stories: every other hero with a profile, in INSTA_PERFIS order (`ids` = the heroes this build has). */
export const storiesOf=(selectedId:string,ids:readonly string[]):InstaPerfil[]=>INSTA_PERFIS.filter(p=>p.id!==selectedId&&ids.includes(p.id));

/**
 * The handle's size (insta.css: 64 card px of 734): the column beside the photo holds 335, 275 of them for the text
 * beside the badge; a longer handle shrinks so it never wraps nor pushes the badge out (Lilita One: ~.615 em a capital).
 */
export const handleFit=(handle:string)=>Math.min(1,275/(handle.length*.615*64));

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
  // The opened post's: back, more, comment, send and save.
  voltar:svg('<path d="M19.5 12h-15M10.5 5.5 4 12l6.5 6.5"/>'),
  mais:svg('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  comentar:svg('<path d="M20.5 11.6a8.4 8.4 0 0 1-12.3 7.4L3.5 20.5l1.6-4.5a8.4 8.4 0 1 1 15.4-4.4z"/>'),
  enviar:svg('<path d="M21 3.5 10.2 13.8M21 3.5l-6.6 17-4.2-6.7-6.7-4.2z"/>'),
  salvar:svg('<path d="M18.5 20.5 12 15.6l-6.5 4.9V4.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1z"/>'),
} as const;

/** The top bar: the letreiro of the profile on screen (logoUrl), the bell (decorative) and ≡ (the sound settings). */
// The bar is in the page from the start with no logo: main.ts renderInsta sets it, so the stadium never downloads one.
export const barraHtml=()=>`<header class="insta-barra"><img class="insta-logo" alt="" decoding="async" draggable="false"><span class="insta-acoes"><span class="insta-sino">${LINHA.sino}</span><button type="button" class="insta-menu" aria-label="Configurações" aria-haspopup="dialog">${LINHA.menu}</button></span></header>`;

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

// The chip's icon is the Codex drawing's shape in the reference's dark grey (insta.css mask), not its colours.
export const chipsHtml=(p:InstaPerfil)=>p.chips.map(c=>`<li class="insta-chip"><i class="insta-chip-icone" data-icone="${c.icone}" aria-hidden="true"></i><span><small>${c.label}</small><b>${esc(c.valor)}</b></span></li>`).join('');

/** The grid: the 3 photos, or the private account of a locked hero (no photo of his is ever requested). */
export function gradeHtml(p:InstaPerfil,liberado:boolean):string{
  const urls=gradeUrls(p.id,liberado);
  if(!urls.length)return `<div class="insta-privada">${img('icone-cadeado','insta-privada-cadeado')}<p><b>Esta conta é privada</b><span>${esc(p.nome)} chega em breve.</span></p></div>`;
  // Each photo is a button: a tap opens it as a post (ui/insta-post.ts), like Instagram.
  return urls.map((url,i)=>`<button type="button" class="insta-post-botao" data-post="${i}" aria-label="Abrir a foto ${i+1} de ${esc(p.handle)}">`+
    `<img class="insta-post" src="${url}" alt="" decoding="async" draggable="false"></button>`).join('');
}

/**
 * A grid photo opened as a post, over the profile (BUG-20261023-ORQ-instagram-letreiro-do-perfil, the user: "expande
 * igualzinho ao Instagram"): the header (back, avatar, @, badge, ⋯) and, side by side in a track, the 3 posts (the
 * square photo, curtir/comentar/enviar/salvar, "Curtido por…", the caption, when). ui/insta-post.ts opens, slides
 * and closes it.
 */
export function postTelaHtml(p:InstaPerfil):string{
  const slides=p.posts.map((post,i)=>`<article class="insta-ver-slide" aria-label="Foto ${i+1} de 3">`+
    `<div class="insta-ver-midia"><img class="insta-ver-foto" src="${postUrl(p.id,i)}" alt="Foto ${i+1} de ${esc(p.handle)}" decoding="async" draggable="false">`+
    `<span class="insta-ver-pop" aria-hidden="true">${LINHA.coracao}</span></div>`+
    `<div class="insta-ver-acoes"><button type="button" class="insta-ver-curtir" aria-label="Curtir" aria-pressed="false">${LINHA.coracao}</button>`+
    `<span>${LINHA.comentar}</span><span>${LINHA.enviar}</span><span class="insta-ver-salvar">${LINHA.salvar}</span></div>`+
    `<p class="insta-ver-curtidas">Curtido por <b>${esc(post.curtidoPor)}</b> e <b>outras ${esc(post.curtidas)} pessoas</b></p>`+
    `<p class="insta-ver-legenda"><b>${esc(p.handle)}</b> ${esc(post.legenda)}</p><p class="insta-ver-quando">${esc(post.quando)}</p></article>`).join('');
  return `<div class="insta-ver" role="dialog" aria-modal="true" aria-label="Fotos de ${esc(p.handle)}"><div class="insta-ver-veu"></div><div class="insta-ver-cartao">`+
    `<header class="insta-ver-topo"><button type="button" class="insta-ver-voltar" aria-label="Voltar">${LINHA.voltar}</button>`+
    `<img class="insta-ver-avatar" src="${perfilUrl(p.id)}" alt="" decoding="async" draggable="false"><b>${esc(p.handle)}</b>${img('icone-verificado','insta-ver-selo')}`+
    `<span class="insta-ver-mais">${LINHA.mais}</span></header>`+
    `<div class="insta-ver-janela"><div class="insta-ver-trilho">${slides}</div></div>`+
    `<div class="insta-ver-pontos" aria-hidden="true"><i></i><i></i><i></i></div></div></div>`;
}

/** The tabs: grid (active), video and liked, as in the reference; only the grid exists, the others are drawn. */
export const abasHtml=()=>`<div class="insta-abas" aria-hidden="true"><span class="insta-aba ativa">${LINHA.grade}</span><span class="insta-aba">${LINHA.video}</span><span class="insta-aba">${LINHA.coracao}</span></div>`;
