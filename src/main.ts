import './client/style.css';
import './client/estadio.css';
import { getClass, heroiPadrao, isLiberado, playableClasses, type HeroClass } from './rules/index.ts';
import { mountIcons } from './client/ui/icon-sprite.ts';
import { icon } from './client/ui/icon.ts';
import { ROLE_LINE, suit } from './client/ui/suit.ts';
import { DEITADO, mostrarEscolha, rotulo } from './client/ui/escolha-popup.ts';
import { fotoEscolhida, menuArtNoNavegador, popupPrimeiro, previaAte, saveData } from './client/ui/menu-art-boot.ts';
import { startArt } from './client/ui/art-boot.ts';
import { startMenuMusic } from './client/ui/menu-music-boot.ts';
import { startAds } from './client/ui/ads-boot.ts';
import { CUTOUT_QUERY, cutoutFile, cutoutOf, fitCutout, frameArt, frameHero, placeCutout, placeOnBar, STADIUM, STADIUM_TALL_QUERY, type StadiumArt, type StadiumCutout } from './client/ui/stadium.ts';
import { startVersionWatch, fetchBuildId } from './client/ui/version-watch.ts';
import { formatRoomCode, inviteCode, inviterName, setInviter } from './client/ui/invite.ts';
import { fitName } from './client/ui/nick.ts';
import { hasNewArt, letreiroAltoOf, letreiroOf, plaqueText, titleFit, titleLines } from './client/ui/apelidos.ts';
import { confirmText, etapaOf, nameKey, showEtapa } from './client/ui/menu-etapa.ts';
import { manterAcimaDoTeclado } from './client/ui/teclado.ts';
import { chunkFailed, inMatchOf, linkWatch, opening, reloadPage, resumeOf, saveResume, showUpdateToast, takeResume, updateNow, type ResumeIntent } from './client/ui/update-toast.ts';
import { startPullToRefresh } from './client/ui/pull-refresh.ts';
import './client/ui/update-toast.css';
import './client/ui/pull-refresh.css';
import './client/ui/cadeado.css';
import './client/ui/insta.css';
import './client/ui/escolha.css';
import { abasHtml, barraHtml, chipsHtml, gradeHtml, INSTA_QUERY, instaPerfil, logoUrl, perfilHtml, aneisHtml, aneisOf } from './client/ui/insta.ts';
import { abrirPost, fecharPost } from './client/ui/insta-post.ts';
import { abrirStories, fecharStories } from './client/ui/insta-stories.ts';
import { emLoop, montarAneis } from './client/ui/insta-aneis.ts';
import { miniaturaOf } from './client/ui/miniatura.ts';
import { BOTS_MAX, BOTS_MIN, botsLabel, islandFlag, readBots, saveBots, soloErrorText, soloProgress, type SoloStep } from './client/ui/solo-plan.ts';
import { autoFullscreen, isFullscreen, lockMatchOrientation, paintButton, showButton, toggleFullscreen, unlockOrientation, type TelaCheiaEnv } from './client/ui/tela-cheia.ts';
mountIcons();
// Old tab after a deploy (NEW-20261012-E5-chunk-velho-deploy): /version.json changed or a lazy chunk answered 404.
// Out of a match the page reloads by itself and comes back where it was (resume); in a match only the notice shows.
const session=()=>{try{return sessionStorage;}catch{return undefined;}};
const storage=()=>{try{return localStorage;}catch{return undefined;}};
const versionWatch=startVersionWatch({win:window,current:__BUILD_ID__,fetchVersion:()=>fetchBuildId(),inMatch:()=>inMatchOf(document),
  reload:()=>reloadPage(location),onAvailable:()=>showUpdateToast(document),beforeReload:()=>saveResume(session(),resumeOf(document,Date.now()))});
linkWatch(versionWatch);
// arrastar-atualiza-versao-nova: a page from the HTTP cache (an old SW, or the browser's own) may be an older build than
// the site: ask once at startup, so it reloads into the new one before the rooms refuse it (the watch's guard stops loops).
void versionWatch.check();
// ...and in the menus, pulling down reloads (the browser's own pull-to-refresh is off: fullscreen, installed app, html overflow).
startPullToRefresh({doc:document,win:window,inMatch:()=>inMatchOf(document),refresh:()=>updateNow()});
// Art v2 (NEW-20261012-ORQ-importar-arte-b-ligacao): the index is fetched in the background, never blocking the menu;
// the game and the horde sandbox await it (bounded) before Phaser preloads. Late or failed = SVG/procedural stays.
void startArt();
// Menu music (NEW-20261014-ORQ-musica-do-menu): after load + idle, low priority, never on 2g/Save-Data; plays from the first tap.
startMenuMusic();
// Ads (NEW-20261023-ORQ-anuncios-h5-games): off by default; when on, the async script loads after the menu is ready.
startAds(window,import.meta.env.DEV);
// Art cache (NEW-20261013-ORQ-3g-precarga-partida): public/sw.js keeps /art and /assets by content version, so a second
// match downloads no art. Production builds only: the dev server never gets a worker.
if(!import.meta.env.DEV&&'serviceWorker' in navigator)addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>undefined);},{once:true});
if(new URLSearchParams(location.search).get('sandbox')==='audio')void import('./client/sandboxes/sandbox-audio.ts').then(m=>m.openAudioSandbox()).catch(e=>console.error('audio sandbox failed to load',e));

// cadeado-so-clt-viciado: the released heroes open the row, the locked ones follow (roster order in each part), so the
// first tile is always one that can be chosen (the scripts that play the menu click the first `.class-card`).
const classes = [...playableClasses.filter(hero=>isLiberado(hero.id)),...playableClasses.filter(hero=>!isLiberado(hero.id))];
const colors = ['#75b8a6','#ed8f91','#a391d4','#edc66a','#73add1','#d99bbf'];
// cadeado-so-clt-viciado: the menu opens on a released hero (the viciado), never on a locked one.
let selected = heroiPadrao();
let color = colors[0];
let nickname = '';
try {
  const saved = JSON.parse(localStorage.getItem('viagem:hero:v1') ?? 'null');
  if (saved && typeof saved.name === 'string' && typeof saved.classId === 'string') {
    // D-053 + cadeado-so-clt-viciado: a saved hidden or locked class falls back to the viciado.
    if(isLiberado(saved.classId)) selected = getClass(saved.classId) ?? selected;
    nickname = fitName(saved.name);
    color = colors.includes(saved.color) ? saved.color : color;
  }
} catch { /* armazenamento indisponível: criação continua sem persistência */ }

// menu-estadio (the user, 21/10): no Personagem/Classes tabs, one screen. The approved stadium behind everything, the
// chosen hero big, standing still on the bar (menu-sem-danca: he dances only in the match, hero-dance.ts), and on the
// side the letreiro with the hero's name, the plaque with his nickname
// (ui/apelidos.ts; botao-selecionar), the row of heroes between ‹ › and "Selecionar". Letreiro, plaque and button are
// HTML over the picture, so the text can be translated and changed. The name field only after "Selecionar"
// (nome-depois-de-selecionar, ui/menu-etapa.ts): the row gives its place to [‹] [chosen tile] [name], the button enters.
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<main class="world criacao estadio" data-build="viagem-island-v1">
  <div class="estadio-palco"><div id="portrait" class="estadio-heroi" role="img"></div><img class="estadio-recorte" alt="" aria-hidden="true" decoding="async" hidden><img class="estadio-mureta" alt="" aria-hidden="true" decoding="async" hidden></div>
  <button type="button" class="menu-config" aria-label="Configurações" aria-haspopup="dialog">${icon('config',{size:32})}</button>
  <button type="button" class="menu-tela-cheia" hidden></button>
  <section id="personagem" class="estadio-escolha" aria-labelledby="screen-title" data-etapa="escolher">
    <p class="convite-faixa" role="status" hidden></p>
    <div class="insta-topo">${barraHtml()}<nav class="insta-stories" aria-label="Trocar personagem"></nav><p class="insta-trocar">Toque para trocar</p><div class="insta-perfil"></div><ul class="insta-chips"></ul></div>
    <div class="insta-grade-area">${abasHtml()}<div class="insta-grade"></div></div>
    <div class="estadio-caixa-titulo"><h1 id="screen-title" class="estadio-titulo"><span></span> <span></span><img class="estadio-letreiro" alt="" hidden></h1>
    <h2 id="class-name" class="estadio-classe"></h2></div>
    <nav class="estadio-fileira" aria-label="Trocar personagem">
      <button id="previous" class="round-button" aria-label="Personagem anterior">‹</button>
      <div id="class-list" class="class-list" role="group" aria-label="Personagens"></div>
      <button id="next" class="round-button" aria-label="Próximo personagem">›</button>
    </nav>
    <div class="estadio-nome" hidden>
      <button type="button" id="trocar" class="round-button" aria-label="Trocar personagem">‹</button>
      <span id="escolhido" class="class-card estadio-escolhido" aria-hidden="true"></span>
      <label for="nickname" class="sr-only">Seu nome de aventura</label><input id="nickname" maxlength="60" placeholder="Como a turma vai te chamar?" autocomplete="nickname" enterkeyhint="go" />
    </div>
    <button id="confirm" class="primary-button estadio-confirmar"><span aria-hidden="true">★</span><span class="estadio-cadeado" hidden>${icon('cadeado',{size:48})}</span><span class="estadio-confirmar-texto">SELECIONAR</span></button>
    <nav class="menu-rodape" aria-label="O site"><a class="menu-privacidade" href="/privacidade/">Privacidade</a><a class="menu-sobre" href="/sobre/">Sobre</a></nav>
  </section>
</main>
<dialog id="confirmation" aria-labelledby="confirmation-title" tabindex="-1"><button id="close-dialog" class="close-dialog" aria-label="Fechar">${icon('fechar',{size:32})}</button><h2 id="confirmation-title" class="sr-only">Personagem escolhido</h2><div class="chosen-card"><div id="chosen-art" class="class-art" aria-hidden="true"></div><div class="chosen-id"><strong id="chosen-name"></strong><p id="chosen-class"></p></div></div><p id="save-status" class="save-status" role="status"></p><div class="chosen-actions"><div class="solo-row"><button id="enter-island" class="secondary-button"><span class="escolha-rotulo">Jogar sozinho</span></button><div class="solo-bots" role="group" aria-labelledby="solo-bots-title"><span id="solo-bots-title" class="solo-bots-title">Bots</span><button type="button" class="solo-bots-step" data-step="-1" aria-label="Menos um bot">−</button><output class="solo-bots-value" aria-live="polite"><span aria-hidden="true"></span><span class="sr-only"></span></output><button type="button" class="solo-bots-step" data-step="1" aria-label="Mais um bot">+</button></div></div></div><p id="explore-error" class="explore-error" role="status"></p><button id="back-to-menu" class="link-button">Trocar de personagem</button></dialog>
<div class="sr-only" id="announcement" aria-live="polite"></div>`;

// The menu's gear (config-audio-musica-efeitos): Música, Efeitos and the vibration; its code loads on the first tap.
const menuConfig=document.querySelector<HTMLButtonElement>('.menu-config')!;
const openSettings=(from:HTMLElement)=>{void import('./client/audio/settings-dialog.ts').then(m=>m.openSoundSettings(from)).catch(e=>console.error('settings failed to load',e));};
menuConfig.addEventListener('click',()=>openSettings(menuConfig));
// The phone upright shows the hero pick as an Instagram profile (ui/insta.ts): its ≡ is the gear.
const instaMenu=document.querySelector<HTMLButtonElement>('.insta-menu')!;
instaMenu.addEventListener('click',()=>openSettings(instaMenu));
// Game-style full screen (celular-deitado-tela-cheia, ui/tela-cheia.ts): the corner button, and SELECIONAR / JOGAR on a
// touch screen; a match started on its side stays on its side until the game closes.
const tela:TelaCheiaEnv={doc:document as unknown as TelaCheiaEnv['doc'],media:q=>matchMedia(q).matches,
  orientation:screen.orientation as TelaCheiaEnv['orientation'],storage:storage()};
const telaCheia=document.querySelector<HTMLButtonElement>('.menu-tela-cheia')!;
const paintTela=()=>{telaCheia.hidden=!showButton(tela);paintButton(telaCheia,isFullscreen(tela.doc));};
paintTela();
document.addEventListener('fullscreenchange',paintTela);document.addEventListener('webkitfullscreenchange',paintTela);
telaCheia.addEventListener('click',()=>void toggleFullscreen(tela));
// The manifest's `fullscreen` makes the site installable: no install prompt pops up for it (as with `browser`).
addEventListener('beforeinstallprompt',e=>e.preventDefault());
const toMatch=()=>void autoFullscreen(tela).then(()=>lockMatchOrientation(tela));
// Back at the menu (no game dialog open): the phone turns freely again.
new MutationObserver(()=>{if(!document.querySelector('dialog.explore-shell[open]'))unlockOrientation(tela);})
  .observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});

// The hero's feet on the bar: the stage's box and the file the CSS shows (phone upright = the tall crop) give the
// point; the CSS sizes the hero from it. PC: the hero stands at 70% of the width, like the approved reference.
const stage=document.querySelector<HTMLElement>('.estadio-palco')!;
const tallStadium=matchMedia(STADIUM_TALL_QUERY),cutoutScreen=matchMedia(CUTOUT_QUERY);
// Landscape (the PC, the phone on its side) shows E6's bleed (menu-fundo-sangria, estadio.css under CUTOUT_QUERY): framed here, so the approved picture,
// the bar and the hero on it are never cut. Its size and position in px; the CSS keeps `cover` until this runs.
const stageArt=():StadiumArt=>tallStadium.matches?STADIUM.tall:cutoutScreen.matches?STADIUM.bleed:STADIUM.wide;
// The hero whose picture the stage shows (his own background moved with him, clt-mesmo-lugar; or the stadium he stands
// in), framed for him (heroi-grande-por-tela, stadium.ts frameHero): set together with the picture (showStageFundo).
let stageCut:StadiumCutout|undefined;
function frameStage(box:{w:number;h:number}) {
  const art=stageArt(),frame=art.focal&&box.w>0&&box.h>0?(stageCut?frameHero(box,art,stageCut):frameArt(box,art)):undefined;
  const size=frame?`${Math.round(art.w*frame.s)}px ${Math.round(art.h*frame.s)}px`:'',at=frame?`${Math.round(frame.ox)}px ${Math.round(frame.oy)}px`:'';
  if(stage.style.backgroundSize!==size) stage.style.backgroundSize=size;
  if(stage.style.backgroundPosition!==at) stage.style.backgroundPosition=at;
}
function placeHero() {
  const box={w:stage.clientWidth,h:stage.clientHeight},tall=tallStadium.matches;
  frameStage(box);
  const spot=placeOnBar(box,stageArt(),box.w*(tall?.5:.7));
  if(!spot) return;
  const x=`${Math.round(spot.x)}px`,y=`${Math.round(spot.y)}px`;
  // Only on a real change: a custom property written on every resize tick restyles the stage for nothing.
  if(stage.style.getPropertyValue('--hero-x')!==x) stage.style.setProperty('--hero-x',x);
  if(stage.style.getPropertyValue('--bar-y')!==y) stage.style.setProperty('--bar-y',y);
}
new ResizeObserver(placeHero).observe(stage);
tallStadium.addEventListener('change',placeHero);
cutoutScreen.addEventListener('change',placeHero);
placeHero();

function text(id: string,value: string) { document.getElementById(id)!.textContent=value; }
// BUG-menu-travando: the big portrait is an <img> with srcset (768/1024 for the real DPR), decoded off-screen before it
// swaps in, so a class change never waits on a decode inside a frame. Neighbours are warmed so the next tap is instant.
const portraitSizes='(orientation: landscape) 60vh, 70vw';
const warmed=new Map<string,HTMLImageElement>();
function portraitImage(hero: HeroClass, first=false) {
  let img=warmed.get(hero.id);
  if(img) warmed.delete(hero.id);
  // A download that failed (or was dropped) leaves a finished image with no pixels: never reuse it, try again.
  if(img&&img.complete&&!img.naturalWidth) img=undefined;
  if(!img) {
    img=new Image(); img.alt=''; img.decoding='async'; img.className='portrait-art'; img.dataset.portraitOf=hero.id;
    if(first) img.fetchPriority='high'; // the first screen's LCP; set before src, or the fetch already left at low priority
    img.sizes=portraitSizes; img.srcset=`/art/portraits/${hero.id}-768.webp 768w, /art/portraits/${hero.id}.webp 1024w`;
    img.src=`/art/portraits/${hero.id}.webp`;
  }
  warmed.set(hero.id,img);
  for(const key of warmed.keys()) { if(warmed.size<=4) break; if(key!==hero.id) warmed.delete(key); }
  return img;
}
const idle=(task: () => void)=>('requestIdleCallback' in window ? requestIdleCallback(task,{timeout:2000}) : setTimeout(task,300));
// menu-imagens-sem-buraco: the popup's pictures come down in idle time once the page is in, so BORA! opens it whole.
const menuArt=menuArtNoNavegador(idle,()=>selected.id);
// Only once the player touches the carousel: the first screen downloads a single portrait.
function forget(img: HTMLImageElement) {
  const id=img.dataset.portraitOf!;
  if(warmed.get(id)===img) warmed.delete(id);
}
function warmNeighbours(hero: HeroClass) {
  if(saveData()) return;
  const index=classes.indexOf(hero);
  idle(()=>{
    for(const step of [1,-1]) { const img=portraitImage(classes[(index+step+classes.length)%classes.length]); img.decode().catch(()=>forget(img)); }
    portraitImage(selected);
  });
}
// The row's thumbs load when they scroll into the row (the row is their root), plus a margin on each side.
const rowList=document.getElementById('class-list')!;
const lazyArt=new IntersectionObserver(entries=>{
  for(const entry of entries) if(entry.isIntersecting) { const img=entry.target as HTMLImageElement; img.dataset.seen='1'; if(img.dataset.src) img.src=img.dataset.src; lazyArt.unobserve(img); }
},{root:rowList,rootMargin:'0px 160px'});
function lazySrc(img: HTMLImageElement, url: string) {
  if(img.dataset.seen) { img.src=url; return; }
  img.dataset.src=url; lazyArt.observe(img);
}
// After the first screen is up, the rest of the row comes in idle time, so scrolling it never shows empty frames.
// Not on the profile (phone upright), where the row is hidden: its faces come in when it shows (the observer above).
addEventListener('load',()=>idle(()=>!instaScreen.matches&&document.querySelectorAll<HTMLImageElement>('img[data-src]:not([data-seen])').forEach(img=>{ img.dataset.seen='1'; img.src=img.dataset.src!; lazyArt.unobserve(img); })),{once:true});
let portraitToken=0, pending: HTMLImageElement|null=null;
// A hero with his own art drawn in place (menu-arte-viciado, stadium.ts RECORTES) stands there instead of the portrait, on
// every landscape screen (the PC and the phone on its side, celular-deitado-foto).
const cutoutImg=stage.querySelector<HTMLImageElement>('.estadio-recorte')!;
// mureta-camada-frente: the piece of the background over the hero (the bar), placed by the background's own framing.
const frontImg=stage.querySelector<HTMLImageElement>('.estadio-mureta')!;
// A cutout with its own background (tela-clt-pose2) swaps the stage's picture once it is decoded (never a blank stage);
// the CSS's stadium otherwise. Same geometry as the stadium's bleed, so frameStage's size and position fit both.
let stageFundo='',stageWant:StadiumCutout|undefined;
function showStageFundo(cut:StadiumCutout|undefined) {
  const url=cut?.fundo,want=url?`url("${url}")`:'';
  if(want===stageFundo&&cut===stageWant) return;
  stageFundo=want;stageWant=cut;
  // The picture and its framing change together, so neither is ever drawn with the other's.
  const swap=()=>{stage.style.backgroundImage=want;stageCut=cut;frameStage({w:stage.clientWidth,h:stage.clientHeight});};
  if(!url) {swap();return;}
  const img=new Image();img.src=url;
  void img.decode().catch(()=>{}).then(()=>{ if(stageWant===cut) swap(); });
}
function showCutout() {
  const cut=cutoutScreen.matches?cutoutOf(selected.id):undefined;
  // The whole hero on screen, his feet on the floor the background's framing puts there (fitCutout, menu-pes-nitidez).
  const box={w:stage.clientWidth,h:stage.clientHeight},placed=cut&&placeCutout(box,STADIUM.bleed,cut),spot=placed&&fitCutout(box,placed);
  stage.classList.toggle('com-recorte',!!spot);cutoutImg.hidden=!spot;
  showStageFundo(spot?cut:undefined);
  if(!cut||!spot) {showFront(box,undefined);return;}
  // The file by the shown width x devicePixelRatio (never the 2/3 copy stretched on a big or HiDPI screen).
  const file=cutoutFile(cut,spot.w,devicePixelRatio);
  if(cutoutImg.getAttribute('src')!==file) cutoutImg.src=file;
  const css=`left:${Math.round(spot.x)}px;top:${Math.round(spot.y)}px;width:${Math.round(spot.w)}px;height:${Math.round(spot.h)}px`;
  if(cutoutImg.dataset.box!==css) {cutoutImg.dataset.box=css;cutoutImg.style.cssText=css;}
  showFront(box,cut);
}
function showFront(box:{w:number;h:number},cut:StadiumCutout|undefined) {
  const front=cut?.frente,art=STADIUM.bleed,show=!!front&&!cutoutImg.hidden&&box.w>0&&box.h>0;
  frontImg.hidden=!show;
  if(!cut||!front||!show) return;
  if(frontImg.getAttribute('src')!==front.file) frontImg.src=front.file;
  // The background's px exactly as frameStage draws it (its size and offset rounded), so the bar meets itself.
  const {s,ox,oy}=frameHero(box,art,cut),sx=Math.round(art.w*s)/art.w,sy=Math.round(art.h*s)/art.h,f=art.focal;
  const css=`left:${Math.round(ox)+(f.x+front.x)*sx}px;top:${Math.round(oy)+(f.y+front.y)*sy}px;width:${front.w*sx}px;height:${front.h*sy}px`;
  if(frontImg.dataset.box!==css) {frontImg.dataset.box=css;frontImg.style.cssText=css;}
}
new ResizeObserver(showCutout).observe(stage);
cutoutScreen.addEventListener('change',showCutout);
const thumbUrl=(hero: HeroClass)=>`/art/portraits/${hero.id}-thumb.webp`;
function showPortrait(hero: HeroClass, interactive: boolean) {
  const frame=document.getElementById('portrait')!;
  const current=frame.querySelector('img'), img=portraitImage(hero,!current), token=++portraitToken;
  // Flicking past a class drops its half-downloaded art, so on 4G the bandwidth goes to the one that stays on screen.
  if(pending&&pending!==img&&pending!==current&&!pending.complete) { forget(pending); pending.removeAttribute('srcset'); pending.src=''; }
  pending=img;
  if(current===img) { frame.removeAttribute('aria-busy'); return; }
  let placed=false;
  const replaceImage=(image:HTMLImageElement)=>{for(const old of frame.querySelectorAll('img'))old.remove();frame.prepend(image);};
  const place=()=>{ if(token!==portraitToken) return; placed=true; replaceImage(img); frame.removeAttribute('aria-busy'); if(interactive) warmNeighbours(hero); };
  // Failed download: forget it (the next tap fetches again) and keep what is on screen, never a blank frame.
  const failed=()=>{ forget(img); if(token===portraitToken) frame.removeAttribute('aria-busy'); };
  if(!current) { img.addEventListener('error',()=>{ forget(img); placed=false; showThumb(); },{once:true}); place(); return; }
  img.decode().then(place,failed);
  // Not on screen yet: the new class's thumb (17 KB, the row uses the same file) holds the frame right away,
  // so the name and the art never disagree; the full art replaces it once decoded.
  if(!(img.complete&&img.naturalWidth)) showThumb();
  function showThumb() {
    const thumb=new Image(); thumb.alt=''; thumb.decoding='async'; thumb.className='portrait-art'; thumb.src=thumbUrl(hero);
    thumb.decode().then(()=>{ if(token!==portraitToken||placed) return; replaceImage(thumb); frame.setAttribute('aria-busy','true'); },()=>{});
  }
}
function setArt(id: string,hero: HeroClass) {
  if(id==='portrait') return showPortrait(hero,true);
  const element=document.getElementById(id)!;
  if(element instanceof HTMLImageElement) lazySrc(element,thumbUrl(hero));
  else fotoEscolhida(element,hero.id,menuArt);
}
// The row holds every playable hero once (built here, never rebuilt); a pick only moves aria-pressed and scrolls the
// chosen one into the row's middle. The row scrolls by itself (a swipe on the phone), the page never does.
// The row's faces wait for the new art (21/10): a "?" in the letreiro's style until the hero is in ui/apelidos.ts ARTE_NOVA.
// selecao-miniatura-rosto: a released hero shows his face over his own background (ui/miniatura.ts), loaded lazily too.
// cadeado-so-clt-viciado: a locked hero (rules/personagens-liberados.ts) keeps his tile, darkened under a lock.
const cardFace=(hero:HeroClass)=>{
  const rosto=miniaturaOf(hero.id,isLiberado(hero.id)),url=rosto??(hasNewArt(hero.id)?thumbUrl(hero):undefined);
  return url?`<img class="card-portrait${rosto?' card-rosto':''}" draggable="false" data-src="${url}" alt="" width="192" height="192" decoding="async" aria-hidden="true" />`
    :'<span class="card-misterio" aria-hidden="true">?</span>';
};
rowList.innerHTML=classes.map(hero=>`<button type="button" class="class-card" data-hero="${hero.id}"${isLiberado(hero.id)?'':' data-bloqueado'} aria-pressed="${hero.id===selected.id}" aria-label="${hero.name}${isLiberado(hero.id)?'':' (em breve)'}">${cardFace(hero)}${isLiberado(hero.id)?'':`<span class="card-cadeado">${icon('cadeado',{size:32})}</span>`}</button>`).join('');
rowList.querySelectorAll<HTMLImageElement>('img[data-src]').forEach(img=>lazySrc(img,img.dataset.src!));
function showInRow(smooth: boolean) {
  const card=rowList.querySelector<HTMLElement>(`[data-hero="${selected.id}"]`);
  if(!card||!rowList.clientWidth) return;
  const left=card.offsetLeft-(rowList.clientWidth-card.offsetWidth)/2;
  rowList.scrollTo({left:Math.max(0,left),behavior:smooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto'});
}
new ResizeObserver(()=>showInRow(false)).observe(rowList);
function renderSelected(announce=false) {
  // Caps written in the text, not by CSS (design lint): the letreiro is the hero's name (a long one shrinks the sign,
  // --titulo-fit) and the pill his nickname or, until he gets one, his subtitle (ui/apelidos.ts).
  // The hero's own letreiro picture (E7) replaces both when it exists; its alt says what it shows.
  const lines=titleLines(selected.name),title=document.getElementById('screen-title')!,[top,big]=title.querySelectorAll('span');
  const sign=title.querySelector<HTMLImageElement>('.estadio-letreiro')!,picture=letreiroOf(selected.id),plaque=plaqueText(selected);
  top.textContent=lines[0];top.hidden=!lines[0]||!!picture;big.textContent=lines[1];big.hidden=!!picture;
  // The phone held upright never shows the letreiro (insta.css): no download there (primeira-visita-leve); turning it
  // sideways runs syncInsta → here again, and the picture comes then.
  if(picture){if(!instaScreen.matches&&sign.getAttribute('src')!==picture)sign.src=picture;sign.alt=`${selected.name}: ${plaque}`;}
  sign.hidden=!picture;title.classList.toggle('com-letreiro',!!picture);document.getElementById('class-name')!.hidden=!!picture;
  // A letreiro taller than its sign (the gato's collar): laid out by the sign's own shape, the rest over the top.
  const tall=picture?letreiroAltoOf(selected.id):undefined;sign.classList.toggle('letreiro-alto',!!tall);
  if(tall){sign.style.setProperty('--sinal-ar',String(tall.sinal/tall.w));sign.style.setProperty('--alto-ar',String(tall.h/tall.w));}
  else{sign.style.removeProperty('--sinal-ar');sign.style.removeProperty('--alto-ar');}
  const fit=String(titleFit(lines));if(title.style.getPropertyValue('--titulo-fit')!==fit)title.style.setProperty('--titulo-fit',fit);
  text('class-name',plaque);
  showCutout(); // first: a hero drawn in place hides the portrait
  // The profile (phone upright) shows no portrait: it does not download until the stadium comes back.
  if(instaScreen.matches) renderInsta(); else showPortrait(selected,announce);
  menuArt.warm(selected.id);
  document.getElementById('portrait')!.setAttribute('aria-label',`Ilustração de ${selected.name}`);
  // Writing a custom property on <html> restyles the whole page, even with the same value: only on a real change.
  if(document.documentElement.style.getPropertyValue('--emblem')!==color) document.documentElement.style.setProperty('--emblem',color);
  rowList.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(button=>{const on=String(button.dataset.hero===selected.id);if(button.getAttribute('aria-pressed')!==on)button.setAttribute('aria-pressed',on);});
  showInRow(announce);
  showLock();
  if(announce) text('announcement',`${selected.name}, ${selected.role}. ${selected.subtitle}${isLiberado(selected.id)?'':'. Em breve.'}`);
}
// The profile screen (selecao-mobile-instagram): the other heroes as stories, the chosen one's profile and his 3 photos
// (none for a locked one). Built only while the phone is upright, so the stadium never downloads its pictures.
const instaScreen=matchMedia(INSTA_QUERY);
const insta={stories:document.querySelector<HTMLElement>('.insta-stories')!,perfil:document.querySelector<HTMLElement>('.insta-perfil')!,
  chips:document.querySelector<HTMLElement>('.insta-chips')!,grade:document.querySelector<HTMLElement>('.insta-grade')!,
  logo:document.querySelector<HTMLImageElement>('.insta-logo')!};
const instaIds=classes.map(hero=>hero.id);
let instaShown='',instaAneis='';
// The heroes' rings: one endless row a finger drags (ui/insta-aneis.ts); drawn again only when the heroes or locks change.
const aneis=montarAneis(insta.stories);
// Whose stories were watched this visit: his ring goes grey (ui/insta.ts perfilHtml).
const instaVistos=new Set<string>();
function renderInsta() {
  const perfil=instaPerfil(selected.id);
  if(!perfil||instaShown===selected.id) return;
  instaShown=selected.id;
  // The top bar's logo is the letreiro of the profile on screen (BUG-20261023-ORQ-instagram-letreiro-do-perfil).
  insta.logo.src=logoUrl(perfil.id);insta.logo.alt=perfil.letreiro;
  const perfis=aneisOf(instaIds),assinatura=perfis.map(p=>`${p.id}${isLiberado(p.id)?'':'!'}`).join();
  if(instaAneis!==assinatura){
    instaAneis=assinatura;
    insta.stories.innerHTML=aneisHtml(perfis,isLiberado,emLoop(perfis.length));
    aneis.montou(perfis.length,perfis.indexOf(perfil));
  }
  insta.stories.querySelectorAll<HTMLElement>('[data-hero]').forEach(anel=>{if(anel.dataset.hero===perfil.id)anel.setAttribute('aria-current','true');else anel.removeAttribute('aria-current');});
  aneis.mostrar(perfis.indexOf(perfil));
  insta.perfil.innerHTML=perfilHtml(perfil,isLiberado(perfil.id),instaVistos.has(perfil.id));
  insta.chips.innerHTML=chipsHtml(perfil);
  insta.grade.innerHTML=gradeHtml(perfil,isLiberado(perfil.id));
  for(const img of [...insta.perfil.querySelectorAll('img'),...insta.grade.querySelectorAll('img')]) previaAte(img,menuArt);
  void document.fonts.ready.then(fitHandle);
}
// The @handle's size was a guess from its letters (insta.ts handleFit): measured once the font is in, a handle wider than
// its column shrinks until it and the badge fit (its share in card px, so any screen size keeps it).
function fitHandle() {
  const line=insta.perfil.querySelector<HTMLElement>('.insta-arroba'),text=line?.firstElementChild as HTMLElement|null;
  if(!line||!text||line.scrollWidth<=line.clientWidth) return;
  const fit=parseFloat(line.style.getPropertyValue('--arroba-fit'))||1,room=line.clientWidth-(line.scrollWidth-text.offsetWidth);
  line.style.setProperty('--arroba-fit',(fit*room/text.offsetWidth*.98).toFixed(3));
}
insta.stories.addEventListener('click',event=>{
  const story=(event.target as HTMLElement|null)?.closest<HTMLButtonElement>('[data-hero]');
  if(!story) return;
  // The half ring at the edge comes fully into view, also when it is the one already chosen.
  aneis.mostrar(aneisOf(instaIds).findIndex(p=>p.id===story.dataset.hero));
  if(etapaOf(etapa)==='nome') showEtapa(etapa,'escolher');
  selected=getClass(story.dataset.hero!)!;
  renderSelected(true);
});
// The profile photo opens the hero's stories (ui/insta-stories.ts); a locked hero's is no button (a private account).
insta.perfil.addEventListener('click',event=>{
  const foto=(event.target as HTMLElement|null)?.closest<HTMLButtonElement>('.insta-foto-botao'),perfil=instaPerfil(selected.id);
  if(!foto||!perfil) return;
  abrirStories(perfil,foto,()=>{instaVistos.add(perfil.id);foto.toggleAttribute('data-visto',true);});
});
// A grid photo opens as a post (ui/insta-post.ts); it grows out of its thumbnail and shrinks back into it.
insta.grade.addEventListener('click',event=>{
  const foto=(event.target as HTMLElement|null)?.closest<HTMLElement>('[data-post]'),perfil=instaPerfil(selected.id);
  if(!foto||!perfil) return;
  abrirPost(perfil,Number(foto.dataset.post),i=>insta.grade.querySelector<HTMLElement>(`[data-post="${i}"]`));
});
// A hero with no profile (picked on the stadium) becomes the default one when the profile is up.
function syncInsta() {
  fecharPost(true);fecharStories(true);
  if(instaScreen.matches&&!instaPerfil(selected.id)) selected=heroiPadrao();
  instaShown='';
  renderSelected();
}
instaScreen.addEventListener('change',syncInsta);
// A locked hero can be looked at, never chosen: SELECIONAR turns into a disabled "EM BREVE" with the lock in the star's place.
function showLock() {
  const button=document.getElementById('confirm') as HTMLButtonElement,locked=!isLiberado(selected.id);
  if(button.disabled===locked) return;
  button.disabled=locked;
  button.querySelector<HTMLElement>('.estadio-cadeado')!.hidden=!locked;
  document.querySelector('.estadio-confirmar-texto')!.textContent=locked?'EM BREVE':confirmText(etapaOf(etapa),etapa.convite);
}
rowList.addEventListener('click',event=>{
  const button=(event.target as HTMLElement|null)?.closest<HTMLButtonElement>('[data-hero]');
  if(!button||button.dataset.hero===selected.id) return;
  selected=getClass(button.dataset.hero!)!;
  renderSelected(true);
});
rowList.addEventListener('dragstart',event=>event.preventDefault());
function cycle(direction:number) {
  selected=classes[(classes.indexOf(selected)+direction+classes.length)%classes.length];
  renderSelected(true);
}
document.querySelector('.estadio-fileira')!.addEventListener('pointerdown',()=>warmNeighbours(selected),{once:true,passive:true});
document.getElementById('previous')!.addEventListener('click',()=>cycle(-1));
document.getElementById('next')!.addEventListener('click',()=>cycle(1));
const nameInput=document.getElementById('nickname') as HTMLInputElement;
nameInput.value=nickname;
// BORA! with no name (auditoria-ui-menus 9): the menu's own warning, not the browser's balloon (its look changes from
// browser to browser): the field turns red, says it in its placeholder and shakes once; the live region reads it.
const NAME_MISSING='Escolhe um nome primeiro!',namePlaceholder=nameInput.placeholder;
const nameMissing=(on:boolean)=>{
  nameInput.classList.remove('nome-faltando');nameInput.placeholder=on?NAME_MISSING:namePlaceholder;
  if(on){void nameInput.offsetWidth;nameInput.classList.add('nome-faltando');nameInput.setAttribute('aria-invalid','true');text('announcement',NAME_MISSING);}
  else nameInput.removeAttribute('aria-invalid');
};
nameInput.addEventListener('input',()=>{nickname=nameInput.value;if(nameInput.classList.contains('nome-faltando'))nameMissing(false);});
// A name longer than the rooms take is cut at a whole word with "…" (client/ui/nick.ts) when the field is left, not mid-word.
nameInput.addEventListener('change',()=>{nickname=nameInput.value=fitName(nameInput.value);});
// Step 2 (nome-depois-de-selecionar): "Selecionar" locks the hero, the name field takes the row's place and the button
// enters. ‹, Escape or the dialog's "Trocar de personagem" go back to the row.
const etapa={section:document.getElementById('personagem')!,row:document.querySelector<HTMLElement>('.estadio-fileira')!,
  nameRow:document.querySelector<HTMLElement>('.estadio-nome')!,input:nameInput,label:document.querySelector<HTMLElement>('.estadio-confirmar-texto')!,convite:false};
function chooseHero() {
  if(!isLiberado(selected.id)) return;
  document.getElementById('escolhido')!.innerHTML=hasNewArt(selected.id)
    ?`<img class="card-portrait" draggable="false" src="${thumbUrl(selected)}" alt="" width="256" height="256" decoding="async" />`
    :'<span class="card-misterio">?</span>';
  // A mouse gets the cursor in the field; a touch only when it is empty (a saved name never pops the keyboard for nothing).
  showEtapa(etapa,'nome',{focusName:matchMedia('(pointer: fine)').matches||!nameInput.value.trim()});
}
function backToRow() {
  showEtapa(etapa,'escolher');
  showInRow(false);
  rowList.querySelector<HTMLElement>(`[data-hero="${selected.id}"]`)?.focus({preventScroll:true});
}
document.getElementById('trocar')!.addEventListener('click',backToRow);
// The phone's keyboard never covers the field and BORA! (teclado-cobre-nome-bora): the column takes what it leaves.
manterAcimaDoTeclado(etapa.section,nameInput);
nameInput.addEventListener('keydown',event=>{
  const key=nameKey(event);
  if(!key) return;
  event.preventDefault();
  if(key==='entrar') document.getElementById('confirm')!.click(); else backToRow();
});
const dialog=document.getElementById('confirmation') as HTMLDialogElement;
document.getElementById('confirm')!.addEventListener('click',()=>{
  if(!isLiberado(selected.id)) return; // a locked hero never gets past here (a click, Enter or a script)
  void autoFullscreen(tela); // inside the tap: browsers allow it only there
  if(etapaOf(etapa)==='escolher') {chooseHero();return;}
  if(!nickname.trim()) {nameMissing(true);nameInput.focus();return;}
  nickname=nameInput.value=fitName(nickname);
  const saved={version:1,classId:selected.id,name:nickname,color};
  let persisted=false;
  try {localStorage.setItem('viagem:hero:v1',JSON.stringify(saved));persisted=true;} catch { /* fallback explícito abaixo */ }
  showChosen();
  // Saved: nothing to say. Only a failure to save is worth a line.
  text('save-status',persisted?'':'Ficha escolhida nesta sessão. O navegador não permitiu salvá-la.');
  // Invited (menu-diz-o-jogo-e-convite #11): ENTRAR goes into the room; the popup only if the room fails to open.
  if(invite) {toMatch();void openInvite();return;}
  dialog.showModal();dialog.focus(); // o foco não cai no X (o anel dele aparecia como um quadrado escuro)
  // auditoria-ui-menus 5: the match's code, the city and the hero's first art come down while the popup is read.
  if(!island)void popupPrimeiro(menuArt,selected.id).then(()=>import('./client/lobby.ts')).then(m=>m.warmSolo(selected.id)).catch(()=>undefined);
});
/** The popup's card: the hero, the player's name, the class with its suit and what the role does (not the long name). */
function showChosen() {
  text('chosen-name',nickname.trim());setArt('chosen-art',selected);
  const line=ROLE_LINE[selected.role];
  document.getElementById('chosen-class')!.innerHTML=`<span class="chosen-role" title="${line}">${suit(selected.role)}${selected.role}</span><small class="chosen-role-linha">${line}</small>`;
  mostrarEscolha(dialog,selected.id,menuArt,matchMedia(DEITADO).matches);
}
document.getElementById('close-dialog')!.addEventListener('click',()=>dialog.close());
const coopButton=document.createElement('button');coopButton.id='enter-coop';coopButton.className='primary-button';coopButton.innerHTML='<span class="escolha-rotulo">Jogar com amigos</span>';document.querySelector('#confirmation .solo-row')!.before(coopButton);
// A chunk of an older deploy is not "could not open": the watch reloads and the resume reopens the lobby (and the room).
// The links the lobby shares say who called (&de=, invite.ts setInviter). False when the lobby did not open: the popup
// says why (a saved hero's invite opens it from the menu, so it is filled first).
async function openCoop(options:{room?:string;autoJoin?:boolean}={}){
  coopButton.disabled=true;setInviter(nickname.trim());
  const intent:ResumeIntent=options.room?{view:'lobby',room:options.room}:{view:'lobby'};
  try{await opening(intent,async()=>{const {openLobby}=await import('./client/lobby.ts');dialog.close();await openLobby(selected,nickname.trim(),options);});}
  catch(e){
    if(!chunkFailed(e)){text('explore-error','As salas não abriram. Tenta de novo.');if(!dialog.open){showChosen();dialog.showModal();}}
    return false;
  }
  finally{coopButton.disabled=false;}
  return true;
}
// Invite link (?sala=, NEW-20261009-UX-lobby-mobile): the lobby enters that room by itself, once. A saved hero goes
// straight in (below); a new player sees who called and which room on the menu (menu-diz-o-jogo-e-convite #11), picks a
// hero and a name, and ENTRAR goes in. If the room does not open, the invite stays for the popup's button.
let invite=inviteCode(location.search);
const conviteFaixa=document.querySelector<HTMLElement>('.convite-faixa')!;
function showInvite() {
  etapa.convite=Boolean(invite);
  if(invite)etapa.section.dataset.convite=''; else delete etapa.section.dataset.convite;
  conviteFaixa.hidden=!invite;
  if(invite)conviteFaixa.textContent=`${inviterName(location.search)??'Um amigo'} te chamou para a sala ${formatRoomCode(invite)}`;
  rotulo(coopButton).textContent=invite?`Entrar na sala ${formatRoomCode(invite)}`:'Jogar com amigos';
  if(isLiberado(selected.id))etapa.label.textContent=confirmText(etapaOf(etapa),etapa.convite);
}
showInvite();
const openInvite=async()=>{
  const room=invite;invite=undefined;showInvite();
  if(!await openCoop({room,autoJoin:true})){invite=room;showInvite();}
};
coopButton.addEventListener('click',()=>{toMatch();void(invite?openInvite():openCoop());});
document.getElementById('back-to-menu')!.addEventListener('click',()=>{dialog.close();backToRow();});
// "Jogar sozinho" (BUG-20261013-ORQ-jogar-sozinho-abre-ilha): a real match in the Cidade Nevada with 0–5 room bots
// (the stepper, remembered). The old island exploration only with ?ilha=1 (tests).
const island=islandFlag(location.search);
const soloBots=document.querySelector<HTMLElement>('#confirmation .solo-bots')!;
let bots=readBots(storage());
const showBots=()=>{
  soloBots.querySelector('.solo-bots-value [aria-hidden]')!.textContent=String(bots);
  soloBots.querySelector('.solo-bots-value .sr-only')!.textContent=botsLabel(bots);
  for(const b of soloBots.querySelectorAll<HTMLButtonElement>('.solo-bots-step'))b.disabled=Number(b.dataset.step)<0?bots<=BOTS_MIN:bots>=BOTS_MAX;
};
soloBots.hidden=island;showBots();
soloBots.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('.solo-bots-step');if(b&&!b.disabled){bots=saveBots(storage(),bots+Number(b.dataset.step));showBots();}});
/** The bar under "Jogar sozinho"'s line while the match opens (0..1; undefined hides it). */
function soloBar(button:HTMLElement){
  let bar=button.querySelector<HTMLElement>('.carga');
  if(!bar){
    bar=document.createElement('span');bar.className='carga';bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','Carregando a partida');
    bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.hidden=true;bar.innerHTML='<span class="carga-cheio"></span>';
    const line=rotulo(button);if(line===button)button.append(bar);else line.after(bar);
  }
  const el=bar;
  return {set(fraction:number|undefined){
    el.hidden=fraction===undefined;if(fraction===undefined)return;
    const pct=Math.round(fraction*100);el.setAttribute('aria-valuenow',String(pct));el.style.setProperty('--carga',`${pct}%`);
  }};
}
document.getElementById('enter-island')!.addEventListener('click',async()=>{
  const button=document.getElementById('enter-island') as HTMLButtonElement;
  toMatch();
  button.disabled=true;text('explore-error','');
  if(island){
    try {
      const {openExploration}=await import('./client/explore.ts');
      dialog.close();await openExploration(selected,nickname.trim());
    } catch(e) {if(!chunkFailed(e))text('explore-error','A ilha não carregou. Tenta de novo.');}
    finally {button.disabled=false;}
    return;
  }
  // auditoria-ui-menus 5: the card says which step is running, over a bar of the real steps (solo-plan.ts).
  const label=rotulo(button).textContent,parts:Partial<Record<SoloStep,number>>={};
  const bar=soloBar(button);
  const showStep=()=>{const p=soloProgress(parts);rotulo(button).textContent=p.text;bar.set(p.fraction);};
  button.setAttribute('aria-busy','true');showStep();
  try {
    const {openSolo}=await import('./client/lobby.ts');
    await openSolo(selected,nickname.trim(),{bots,
      onStep:(step,fraction)=>{parts[step]=Math.max(parts[step]??0,fraction);showStep();},
      onJoined:()=>{rotulo(button).textContent=label;dialog.close();}});
  } catch(e) {if(!chunkFailed(e))text('explore-error',soloErrorText(e));}
  finally {button.disabled=false;button.removeAttribute('aria-busy');bar.set(undefined);rotulo(button).textContent=label;}
});
syncInsta();
// Back from a version reload (at most RESUME_MAX_MS old): the hero came from localStorage; the lobby opens again and,
// with a room, joins it by itself (the room's token in localStorage keeps the same seat, net/room-return.ts).
// F5 in a room lands on the invite path: the welcome put ?sala= in the address (F5 volta pra sala).
const resume=takeResume(session(),Date.now());
if(resume?.view==='lobby'&&nickname.trim())void openCoop(resume.room?{room:resume.room,autoJoin:true}:{});
else if(invite&&nickname.trim()&&!new URLSearchParams(location.search).has('foto'))void openInvite();
// Modo foto (D-049): one named scene from fake data, drawn once, window.__fotoPronta (src/client/dev/foto.ts).
if(new URLSearchParams(location.search).has('foto'))void import('./client/dev/foto.ts').then(m=>m.abrirFoto());
if(new URLSearchParams(location.search).get('sandbox')==='horda')void import('./client/sandboxes/sandbox-horde.ts').then(m=>m.openHordeSandbox());
if(new URLSearchParams(location.search).get('sandbox')==='fun')void import('./client/sandboxes/sandbox-fun.ts');
if(new URLSearchParams(location.search).get('sandbox')==='hud')void import('./client/sandboxes/sandbox-hud.ts');
if(new URLSearchParams(location.search).get('sandbox')==='voce')void import('./client/sandboxes/sandbox-voce.ts');
if(new URLSearchParams(location.search).get('sandbox')==='sala')void import('./client/sandboxes/sandbox-sala.ts');
if(new URLSearchParams(location.search).get('sandbox')==='cidade')void import('./client/sandboxes/sandbox-cidade.ts');
if(new URLSearchParams(location.search).get('sandbox')==='obra')void import('./client/sandboxes/sandbox-obra.ts');
if(new URLSearchParams(location.search).get('sandbox')==='config')void import('./client/sandboxes/sandbox-config.ts');
// Playtest metrics (UX-playtest-metricas), dev only (exactly ?dev=1, as dev/ux-flag.ts; the menu imports nothing from
// the game in client/ statically, menu-perf): "Métricas" of this tab's last room session after "Sair".
if(new URLSearchParams(location.search).get('dev')==='1'&&!new URLSearchParams(location.search).get('sandbox'))void import('./client/dev/ux-metrics.ts').then(m=>m.mountHomeExport(window)).catch(()=>undefined);
