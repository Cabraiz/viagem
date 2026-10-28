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
  {id:'gato-nada-pra-comer',nome:'GATITO',handle:'@GATITO',letreiro:'Gatito da raça Nada para comer em casa',seguidores:'12,4 mil',seguindo:'3',bio:'Sete vidas.\nZero boletos.',
    chips:chips('Roupão rosa','Miado de fome','Comeu há 5 min'),
    posts:posts('vizinho_do_sache',['Geladeira cheia. Meu pote: vazio.','3.415','há 1 hora'],
      ['Comi há 5 minutos. Faz 84 anos.','2.980','há 6 horas'],['Miei pra lua. Ela também não deu sachê.','5.112','há 1 dia'])},
  {id:'maromba',nome:'MAROMBA',handle:'@MAROMBA',letreiro:'Maromba, hoje é treino de chefe',seguidores:'88,8 mil',seguindo:'0',bio:'Seguindo ninguém.\nSó o shape.',
    chips:chips('Regata 365','Só mais uma','No pump'),
    posts:posts('creatina_pura',['Registro do bíceps. Dia 412.','7.704','há 4 horas'],
      ['O pneu não ia se puxar sozinho.','6.091','há 8 horas'],['Shake: meu único relacionamento sério.','9.338','há 3 dias'])},
  {id:'vendedor-praia',nome:'VENDEDOR',handle:'@VENDEDOR',letreiro:'Vendedor de Praia, reforço geladinho',seguidores:'47,3 mil',seguindo:'2.318',bio:'Olha a água, olha o mate!\nAceito Pix.',
    chips:chips('Chapéu de palha','Água gelada','Na areia quente'),
    posts:posts('quiosque_do_ze',['Selfie com o isopor. Gelo novinho.','2.214','há 1 hora'],
      ['Areia a 60 graus. O chinelo resiste.','3.870','há 5 horas'],['Vai uma geladinha, aventureiro?','5.402','há 1 dia'])},
  {id:'aposentado',nome:'APOSENTADO',handle:'@APOSENTADO',letreiro:'Aposentado, experiência não falta',seguidores:'3.104',seguindo:'12',bio:'No meu tempo\no boss era maior.',
    chips:chips('Colete de pesca','Vara no torno','Contando história'),
    posts:posts('neto_favorito',['Consertei a vara. Ficou melhor que nova.','312','há 2 horas'],
      ['O peixe era DESSE tamanho. Juro.','487','há 6 horas'],['Puxando o chefe do lago. Ele resistiu.','655','há 1 dia'])},
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
/** The rings row: every hero with a profile, in INSTA_PERFIS order (`ids` = the heroes this build has). The chosen one
 *  stays in it, marked (BUG-20261024-ORQ-aneis-herois-carrossel-infinito): a pick never reshuffles the row under the finger. */
export const aneisOf=(ids:readonly string[]):InstaPerfil[]=>INSTA_PERFIS.filter(p=>ids.includes(p.id));

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
  fechar:svg('<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>'),
  salvar:svg('<path d="M18.5 20.5 12 15.6l-6.5 4.9V4.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1z"/>'),
} as const;

/** The top bar: the letreiro of the profile on screen (logoUrl), the bell (decorative) and ≡ (the sound settings). */
// The bar is in the page from the start with no logo: main.ts renderInsta sets it, so the stadium never downloads one.
export const barraHtml=()=>`<header class="insta-barra"><img class="insta-logo" alt="" decoding="async" draggable="false"><span class="insta-acoes"><span class="insta-sino">${LINHA.sino}</span><button type="button" class="insta-menu" aria-label="Configurações" aria-haspopup="dialog">${LINHA.menu}</button></span></header>`;

/** One story: the face in the gradient ring, the name under it; a locked hero gets the lock over his face. A `copia` is
 *  the endless row's second set (ui/insta-aneis.ts): tappable, but hidden from screen readers and out of the tab order. */
export function storyHtml(p:InstaPerfil,liberado:boolean,copia=false):string{
  return `<button type="button" class="insta-story" data-hero="${p.id}"${liberado?'':' data-bloqueado'}${copia?' aria-hidden="true" tabindex="-1"':''} aria-label="${esc(p.nome)}${liberado?'':' (em breve)'}">`+
    `<span class="insta-anel"><img class="insta-rosto" src="${perfilUrl(p.id)}" alt="" decoding="async" draggable="false">${liberado?'':img('icone-cadeado','insta-cadeado')}</span>`+
    `<span class="insta-story-nome">${esc(p.nome)}</span></button>`;
}
/** The rings row's track: the rings, then (`loop`: more than fit) the same rings again for the endless row. */
export const aneisHtml=(perfis:readonly InstaPerfil[],liberado:(id:string)=>boolean,loop:boolean)=>
  `<div class="insta-aneis-trilho">${perfis.map(p=>storyHtml(p,liberado(p.id))).join('')}${loop?perfis.map(p=>storyHtml(p,liberado(p.id),true)).join(''):''}</div>`;

/**
 * The profile: photo with the badge, @handle with the badge, followers | following, the bio. A released hero's photo is
 * a button that opens his stories (ui/insta-stories.ts); `visto` greys its ring once they were watched, as Instagram.
 */
export function perfilHtml(p:InstaPerfil,liberado=true,visto=false):string{
  const abre=liberado&&storiesDe(p.id).length>0;
  const foto=abre?`<button type="button" class="insta-foto insta-foto-botao"${visto?' data-visto':''} aria-label="Ver os stories de ${esc(p.handle)}" aria-haspopup="dialog">`:'<div class="insta-foto">';
  return `${foto}<span class="insta-anel"><img class="insta-rosto" src="${perfilUrl(p.id)}" alt="" decoding="async" draggable="false"></span>${img('icone-verificado','insta-selo-foto')}${abre?'</button>':'</div>'}`+
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

/** The colours of Instagram's text picker (tokens.css --insta-st-*). */
export type StoryCor='branco'|'preto'|'azul'|'verde'|'amarelo'|'laranja'|'vermelho'|'rosa'|'roxo';
/** Instagram's letters, as OFL equivalents (tokens.css --f-insta-*): Classic, Modern, Strong and Typewriter. */
export type StoryFonte='classica'|'moderna'|'forte'|'maquina';
/**
 * How a text sits on the picture, as Instagram's "A" button: a band of colour behind each line ('faixa'), the bare
 * letters with a soft shadow ('sombra'), or one box behind the whole block ('caixa').
 */
export type StoryJeito='faixa'|'sombra'|'caixa';
/** Where a layer sits: its centre at x,y % of the story, turned `giro` degrees, `tam` times the base letter. */
interface StoryLugar {x:number;y:number;giro?:number;tam?:number}
/** A text (its lines broken by hand, as typed on Instagram) or one of Instagram's stickers. */
export type StoryCamada=StoryLugar&(
  |{tipo:'texto';fonte:StoryFonte;jeito:StoryJeito;cor:StoryCor;fundo?:StoryCor;alinhar?:'esquerda';linhas:readonly string[]}
  |{tipo:'enquete';pergunta:string;a:string;b:string}
  |{tipo:'pergunta';pergunta:string}
  |{tipo:'hashtag';tag:string;cor:StoryCor}
  |{tipo:'curtidas';n:number});
/** One story: its picture is story-<hero>-<k>.webp; when it was posted (the bar's "2 h") and what is written over it. */
export interface InstaStory {quando:string;camadas:readonly StoryCamada[]}
/** Every word over a story, in its layers' order: the picture's alt. */
export const textoDe=(s:InstaStory)=>s.camadas.map(c=>c.tipo==='texto'?c.linhas.join(' '):c.tipo==='enquete'?`${c.pergunta} ${c.a} ou ${c.b}`:
  c.tipo==='pergunta'?c.pergunta:c.tipo==='hashtag'?c.tag:`${c.n} curtidas`).join(' ');
/**
 * The stories (NEW-20261023-ORQ-insta-stories-4-herois): the 3-4 pictures chosen of each hero's 8 (evidence/<ID>/README.md,
 * scripts/insta-stories.mjs), in the order they play, the oldest first. What is written over each one is written here,
 * not drawn: BUG-20261024-ORQ-stories-texto-estilo-instagram (the user 24/10, "copiar ... fonte, cor, jeito, opções")
 * gives each its own look, as Instagram's (evidence/<ID>/ref-*.jpg), placed off the faces; fixed, never drawn by lot.
 */
export const INSTA_STORIES:Readonly<Record<string,readonly InstaStory[]>>=Object.freeze({
  'viciado-em-bet':[
    {quando:'5 h',camadas:[
      {tipo:'texto',fonte:'forte',jeito:'faixa',cor:'branco',fundo:'verde',linhas:['GREEN!','EU AVISEI.'],x:66,y:24,giro:-6,tam:1.9},
      {tipo:'hashtag',tag:'#TÔRICO',cor:'verde',x:68,y:84,giro:4}]},
    {quando:'4 h',camadas:[
      {tipo:'texto',fonte:'classica',jeito:'faixa',cor:'branco',fundo:'roxo',linhas:['Bilionário','até o próximo jogo.'],x:50,y:72},
      {tipo:'curtidas',n:1,x:80,y:61}]},
    {quando:'2 h',camadas:[
      {tipo:'texto',fonte:'maquina',jeito:'caixa',cor:'preto',fundo:'branco',alinhar:'esquerda',linhas:['Red.','Faltou um gol.','De novo.'],x:66,y:56},
      {tipo:'hashtag',tag:'#ÚLTIMAVEZ',cor:'vermelho',x:38,y:76,giro:-5}]},
    {quando:'20 min',camadas:[
      {tipo:'enquete',pergunta:'4H DA MANHÃ. SÓ MAIS UMA?',a:'Só mais uma',b:'Só mais duas',x:50,y:74}]},
  ],
  'clt-cansado':[
    {quando:'12 h',camadas:[
      {tipo:'texto',fonte:'moderna',jeito:'sombra',cor:'branco',linhas:['Cardio diário:','ônibus das 6h.'],x:50,y:16},
      {tipo:'hashtag',tag:'#VIDADECLT',cor:'azul',x:32,y:82,giro:-5}]},
    {quando:'7 h',camadas:[
      {tipo:'texto',fonte:'classica',jeito:'faixa',cor:'preto',fundo:'amarelo',linhas:['Fila do micro-ondas:','40 min.'],x:50,y:16},
      {tipo:'texto',fonte:'classica',jeito:'faixa',cor:'branco',fundo:'rosa',linhas:['Almoço: 5.'],x:60,y:25,giro:3,tam:1.15}]},
    {quando:'3 h',camadas:[
      {tipo:'texto',fonte:'classica',jeito:'sombra',cor:'branco',linhas:['17h59.','Ele chegou','com mais papel.'],x:50,y:62,tam:1.1},
      {tipo:'pergunta',pergunta:'Me dá uma desculpa pra ir embora',x:50,y:82}]},
    {quando:'1 h',camadas:[
      {tipo:'texto',fonte:'maquina',jeito:'caixa',cor:'preto',fundo:'branco',alinhar:'esquerda',linhas:['Só vou responder','um e-mail.'],x:38,y:17},
      {tipo:'curtidas',n:3,x:22,y:58}]},
  ],
  'gato-nada-pra-comer':[
    {quando:'9 h',camadas:[
      {tipo:'texto',fonte:'forte',jeito:'faixa',cor:'preto',fundo:'branco',linhas:['NÃO TEM','NADA','PRA COMER.'],x:50,y:42,giro:-4,tam:2},
      {tipo:'hashtag',tag:'#PASSANDOFOME',cor:'laranja',x:62,y:82,giro:3}]},
    {quando:'6 h',camadas:[
      {tipo:'enquete',pergunta:'POTE VAZIO. DENUNCIO?',a:'Denuncia!',b:'Enche o pote',x:50,y:73}]},
    {quando:'2 h',camadas:[
      {tipo:'texto',fonte:'classica',jeito:'faixa',cor:'branco',fundo:'azul',linhas:['O jantar','passou na janela.'],x:50,y:80}]},
    {quando:'15 min',camadas:[
      {tipo:'texto',fonte:'classica',jeito:'sombra',cor:'branco',linhas:['3h da manhã.','Ainda com fome.'],x:50,y:18,tam:1.1},
      {tipo:'pergunta',pergunta:'Quem tem sachê?',x:50,y:79}]},
  ],
  'maromba':[
    {quando:'8 h',camadas:[
      {tipo:'texto',fonte:'forte',jeito:'faixa',cor:'branco',fundo:'laranja',linhas:['DIA DE BRAÇO.'],x:48,y:66,giro:-4,tam:1.7},
      {tipo:'texto',fonte:'forte',jeito:'faixa',cor:'amarelo',fundo:'preto',linhas:['TODO DIA É.'],x:54,y:74,giro:-4,tam:1.4}]},
    {quando:'5 h',camadas:[
      {tipo:'texto',fonte:'maquina',jeito:'caixa',cor:'preto',fundo:'branco',alinhar:'esquerda',linhas:['Frango,','batata-doce','e foco.'],x:30,y:19},
      {tipo:'curtidas',n:21,x:78,y:84}]},
    {quando:'2 h',camadas:[
      {tipo:'enquete',pergunta:'ELEVADOR TAMBÉM É ACADEMIA?',a:'Óbvio',b:'Claro que sim',x:50,y:75}]},
    {quando:'30 min',camadas:[
      {tipo:'texto',fonte:'moderna',jeito:'faixa',cor:'branco',fundo:'verde',linhas:['Domingo:','21 marmitas','prontas.'],x:50,y:46},
      {tipo:'hashtag',tag:'#MARMITAFIT',cor:'rosa',x:64,y:80,giro:-3}]},
  ],
  // NEW-20261024-ORQ-stories-vendedor-aposentado: the same viewer and looks for the two heroes of the second menu screen.
  'vendedor-praia':[
    {quando:'10 h',camadas:[
      {tipo:'texto',fonte:'forte',jeito:'faixa',cor:'branco',fundo:'laranja',linhas:['OLHA A ÁGUA!','OLHA O MATE!'],x:40,y:66,giro:-5,tam:1.5},
      {tipo:'hashtag',tag:'#PRAIALOTADA',cor:'amarelo',x:38,y:84,giro:4}]},
    {quando:'6 h',camadas:[
      {tipo:'texto',fonte:'classica',jeito:'faixa',cor:'branco',fundo:'verde',linhas:['Pix aprovado.','Mate entregue.'],x:52,y:50},
      {tipo:'curtidas',n:8,x:76,y:84}]},
    {quando:'3 h',camadas:[
      {tipo:'enquete',pergunta:'O FISCAL VOLTOU. E AGORA?',a:'Corre!',b:'Finge de turista',x:50,y:74}]},
    {quando:'40 min',camadas:[
      {tipo:'texto',fonte:'moderna',jeito:'sombra',cor:'branco',linhas:['Última geladinha','do dia.'],x:50,y:60,tam:1.1},
      {tipo:'pergunta',pergunta:'Quem leva a última?',x:50,y:80}]},
  ],
  'aposentado':[
    {quando:'11 h',camadas:[
      {tipo:'texto',fonte:'maquina',jeito:'caixa',cor:'preto',fundo:'branco',alinhar:'esquerda',linhas:['5h da manhã.','O peixe dorme.','Eu não.'],x:36,y:72},
      {tipo:'hashtag',tag:'#MADRUGADOR',cor:'azul',x:64,y:86,giro:-4}]},
    {quando:'8 h',camadas:[
      {tipo:'texto',fonte:'forte',jeito:'faixa',cor:'preto',fundo:'amarelo',linhas:['O MONSTRO','DO LAGO.'],x:46,y:60,giro:-4,tam:1.6},
      {tipo:'curtidas',n:2,x:26,y:82}]},
    {quando:'4 h',camadas:[
      {tipo:'texto',fonte:'classica',jeito:'faixa',cor:'preto',fundo:'branco',linhas:['Como desvira','essa câmera?'],x:50,y:22}]},
    {quando:'25 min',camadas:[
      {tipo:'texto',fonte:'moderna',jeito:'faixa',cor:'branco',fundo:'roxo',linhas:['Só descansando','os olhos.'],x:50,y:64},
      {tipo:'hashtag',tag:'#CAPÍTULOFINAL',cor:'rosa',x:60,y:82,giro:3}]},
  ],
});
export const storiesDe=(id:string):readonly InstaStory[]=>INSTA_STORIES[id]??[];
/** Story k (from 0) of a hero: requested only when the viewer opens (ui/insta-stories.ts), never with the profile. */
export const storyUrl=(id:string,k:number)=>instaUrl(`story-${id}-${k+1}`);

const corVar=(c:StoryCor)=>`var(--insta-st-${c})`;
/** One layer over a story; the place and colours ride in custom properties, the look in insta.css .insta-st-*. */
export function camadaHtml(c:StoryCamada,p:InstaPerfil):string{
  const lugar=`left:${c.x}%;top:${c.y}%`+(c.giro?`;--giro:${c.giro}deg`:'')+(c.tam?`;--tam:${c.tam}`:'');
  if(c.tipo==='texto'){
    const cores=`;--st-cor:${corVar(c.cor)}`+(c.fundo?`;--st-fundo:${corVar(c.fundo)}`:'');
    return `<p class="insta-st insta-st-texto" data-fonte="${c.fonte}" data-jeito="${c.jeito}"${c.alinhar?` data-alinhar="${c.alinhar}"`:''} style="${lugar}${cores}">`+
      `<span>${c.linhas.map(esc).join('<br>')}</span></p>`;
  }
  if(c.tipo==='enquete') return `<div class="insta-st insta-st-enquete" style="${lugar}"><p>${esc(c.pergunta)}</p>`+
    `<ol><li><i>A</i>${esc(c.a)}</li><li><i>B</i>${esc(c.b)}</li></ol></div>`;
  if(c.tipo==='pergunta') return `<div class="insta-st insta-st-pergunta" style="${lugar}">`+
    `<img class="insta-st-avatar" src="${perfilUrl(p.id)}" alt="" decoding="async" draggable="false"><p>${esc(c.pergunta)}</p><span>Digite algo...</span></div>`;
  if(c.tipo==='hashtag') return `<span class="insta-st insta-st-hashtag" style="${lugar};--st-cor:${corVar(c.cor)}">${esc(c.tag)}</span>`;
  return `<span class="insta-st insta-st-curtidas" style="${lugar}">${LINHA.coracao}<b>${c.n}</b></span>`;
}

/**
 * The stories viewer, over the whole page: one bar per story (it fills as the story plays), the avatar, @, when and the
 * close button, the pictures stacked (the one on screen fades in over the last) with their texts and stickers, and the
 * drawn reply bar. The <img> have no src: ui/insta-stories.ts sets it as each story comes near.
 */
export function storiesTelaHtml(p:InstaPerfil):string{
  const lista=storiesDe(p.id);
  const barras=lista.map(()=>'<i class="insta-sv-barra"><b></b></i>').join('');
  const fotos=lista.map((s,k)=>`<figure class="insta-sv-story" data-story="${k}" aria-hidden="true">`+
    `<img class="insta-sv-foto" alt="Story ${k+1} de ${lista.length} de ${esc(p.handle)}: ${esc(textoDe(s))}" decoding="async" draggable="false">`+
    `<figcaption class="insta-sv-camadas" aria-hidden="true">${s.camadas.map(c=>camadaHtml(c,p)).join('')}</figcaption></figure>`).join('');
  return `<div class="insta-sv" role="dialog" aria-modal="true" aria-label="Stories de ${esc(p.handle)}"><div class="insta-sv-palco">${fotos}`+
    `<div class="insta-sv-topo"><div class="insta-sv-barras">${barras}</div><div class="insta-sv-quem">`+
    `<img class="insta-sv-avatar" src="${perfilUrl(p.id)}" alt="" decoding="async" draggable="false"><b>${esc(p.handle)}</b>${img('icone-verificado','insta-sv-selo')}`+
    `<span class="insta-sv-quando"></span><button type="button" class="insta-sv-fechar" aria-label="Fechar">${LINHA.fechar}</button></div></div></div>`+
    `<div class="insta-sv-rodape" aria-hidden="true"><span class="insta-sv-responder">Enviar mensagem</span>${LINHA.coracao}${LINHA.enviar}</div></div>`;
}

/** The tabs: grid (active), video and liked, as in the reference; only the grid exists, the others are drawn. */
export const abasHtml=()=>`<div class="insta-abas" aria-hidden="true"><span class="insta-aba ativa">${LINHA.grade}</span><span class="insta-aba">${LINHA.video}</span><span class="insta-aba">${LINHA.coracao}</span></div>`;
