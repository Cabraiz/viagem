import './client/style.css';
import './client/estadio.css';
import { getClass, heroiPadrao, isLiberado, playableClasses, type HeroClass } from './rules/index.ts';
import { mountIcons } from './client/ui/icon-sprite.ts';
import { icon } from './client/ui/icon.ts';
import { suit } from './client/ui/suit.ts';
import { startArt } from './client/ui/art-boot.ts';
import { startMenuMusic } from './client/ui/menu-music-boot.ts';
import { startAds } from './client/ui/ads-boot.ts';
import { MenuDance } from './client/ui/menu-dance.ts';
import { CUTOUT_QUERY, cutoutFile, cutoutOf, fitCutout, frameArt, frameHero, placeCutout, placeOnBar, STADIUM, STADIUM_TALL_QUERY, type StadiumArt, type StadiumCutout } from './client/ui/stadium.ts';
import { startVersionWatch, fetchBuildId } from './client/ui/version-watch.ts';
import { formatRoomCode, inviteCode } from './client/ui/invite.ts';
import { fitName } from './client/ui/nick.ts';
import { hasNewArt, letreiroOf, plaqueText, titleFit, titleLines } from './client/ui/apelidos.ts';
import { CONFIRM_TEXT, etapaOf, nameKey, showEtapa } from './client/ui/menu-etapa.ts';
import { chunkFailed, inMatchOf, linkWatch, opening, reloadPage, resumeOf, saveResume, showUpdateToast, takeResume, type ResumeIntent } from './client/ui/update-toast.ts';
import './client/ui/update-toast.css';
import './client/ui/cadeado.css';
import { BOTS_MAX, BOTS_MIN, botsLabel, islandFlag, readBots, saveBots, soloErrorText } from './client/ui/solo-plan.ts';
mountIcons();
// Old tab after a deploy (NEW-20261012-E5-chunk-velho-deploy): /version.json changed or a lazy chunk answered 404.
// Out of a match the page reloads by itself and comes back where it was (resume); in a match only the notice shows.
const session=()=>{try{return sessionStorage;}catch{return undefined;}};
const storage=()=>{try{return localStorage;}catch{return undefined;}};
linkWatch(startVersionWatch({win:window,current:__BUILD_ID__,fetchVersion:()=>fetchBuildId(),inMatch:()=>inMatchOf(document),
  reload:()=>reloadPage(location),onAvailable:()=>showUpdateToast(document),beforeReload:()=>saveResume(session(),resumeOf(document,Date.now()))}));
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
// chosen hero big, dancing on the bar, and on the side the letreiro with the hero's name, the plaque with his nickname
// (ui/apelidos.ts; botao-selecionar), the row of heroes between ‹ › and "Selecionar". Letreiro, plaque and button are
// HTML over the picture, so the text can be translated and changed. The name field only after "Selecionar"
// (nome-depois-de-selecionar, ui/menu-etapa.ts): the row gives its place to [‹] [chosen tile] [name], the button enters.
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<main class="world criacao estadio" data-build="viagem-island-v1">
  <div class="estadio-palco"><div id="portrait" class="estadio-heroi dance-pending" role="img"></div><img class="estadio-recorte" alt="" aria-hidden="true" decoding="async" hidden><img class="estadio-mureta" alt="" aria-hidden="true" decoding="async" hidden></div>
  <button type="button" class="menu-config" aria-label="Configurações" aria-haspopup="dialog">${icon('config',{size:32})}</button>
  <section id="personagem" class="estadio-escolha" aria-labelledby="screen-title" data-etapa="escolher">
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
  </section>
</main>
<dialog id="confirmation" aria-labelledby="confirmation-title"><button id="close-dialog" class="close-dialog" aria-label="Fechar">${icon('fechar',{size:32})}</button><h2 id="confirmation-title" class="sr-only">Personagem escolhido</h2><div class="chosen-card"><div id="chosen-art" class="class-art" aria-hidden="true"></div><div class="chosen-id"><strong id="chosen-name"></strong><p id="chosen-class"></p></div></div><p id="save-status" class="save-status" role="status"></p><div class="chosen-actions"><div class="solo-row"><button id="enter-island" class="secondary-button">Jogar sozinho</button><div class="solo-bots" role="group" aria-labelledby="solo-bots-title"><span id="solo-bots-title" class="solo-bots-title">Bots</span><button type="button" class="solo-bots-step" data-step="-1" aria-label="Menos um bot">−</button><output class="solo-bots-value" aria-live="polite"><span aria-hidden="true"></span><span class="sr-only"></span></output><button type="button" class="solo-bots-step" data-step="1" aria-label="Mais um bot">+</button></div></div></div><p id="explore-error" class="explore-error" role="status"></p><button id="back-to-menu" class="link-button">Trocar de personagem</button></dialog>
<div class="sr-only" id="announcement" aria-live="polite"></div>`;

// The menu's gear (config-audio-musica-efeitos): Música, Efeitos and the vibration; its code loads on the first tap.
const menuConfig=document.querySelector<HTMLButtonElement>('.menu-config')!;
menuConfig.addEventListener('click',()=>{void import('./client/audio/settings-dialog.ts').then(m=>m.openSoundSettings(menuConfig)).catch(e=>console.error('settings failed to load',e));});

// The hero's feet on the bar: the stage's box and the file the CSS shows (phone upright = the tall crop) give the
// point; the CSS sizes the dancer from it. PC: the hero stands at 70% of the width, like the approved reference.
const stage=document.querySelector<HTMLElement>('.estadio-palco')!;
const tallStadium=matchMedia(STADIUM_TALL_QUERY),cutoutScreen=matchMedia(CUTOUT_QUERY);
// The PC shows E6's bleed (menu-fundo-sangria, estadio.css under CUTOUT_QUERY): framed here, so the approved picture,
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
function artStyle(hero: HeroClass, detailed=false) {
  return `background-image:url('/art/portraits/${hero.id}${detailed?'':'-thumb'}.webp')`;
}
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
// Only once the player touches the carousel: the first screen downloads a single portrait.
function forget(img: HTMLImageElement) {
  const id=img.dataset.portraitOf!;
  if(warmed.get(id)===img) warmed.delete(id);
}
function warmNeighbours(hero: HeroClass) {
  if((navigator as Navigator & {connection?:{saveData?:boolean}}).connection?.saveData) return;
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
addEventListener('load',()=>idle(()=>document.querySelectorAll<HTMLImageElement>('img[data-src]:not([data-seen])').forEach(img=>{ img.dataset.seen='1'; img.src=img.dataset.src!; lazyArt.unobserve(img); })),{once:true});
let portraitToken=0, pending: HTMLImageElement|null=null;
const menuDance=new MenuDance(document.getElementById('portrait')!);
// A hero with his own art drawn in place (menu-arte-viciado, stadium.ts RECORTES) stands there instead of the dance, on
// the wide picture only (PC, landscape); the dance is held (its pages released) while he does.
const cutoutImg=stage.querySelector<HTMLImageElement>('.estadio-recorte')!;
// mureta-camada-frente: the piece of the background over the hero (the bar), placed by the background's own framing.
const frontImg=stage.querySelector<HTMLImageElement>('.estadio-mureta')!;
let cutoutHold:(()=>void)|undefined;
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
  if(spot&&!cutoutHold) cutoutHold=menuDance.hold();
  else if(!spot&&cutoutHold) {menuDance.show(selected.id);cutoutHold();cutoutHold=undefined;} // the new hero's dance, not the last one's
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
  menuDance.show(hero.id);
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
  else {
    // The dialog reuses the file the portrait already shows (768 or 1024), so confirming never downloads a second copy.
    const shown=document.querySelector<HTMLImageElement>('#portrait img');
    element.style.cssText=shown?.currentSrc.includes(`/${hero.id}`)?`background-image:url('${shown.currentSrc}')`:artStyle(hero,true);
  }
}
// The row holds every playable hero once (built here, never rebuilt); a pick only moves aria-pressed and scrolls the
// chosen one into the row's middle. The row scrolls by itself (a swipe on the phone), the page never does.
// The row's faces wait for the new art (21/10): a "?" in the letreiro's style until the hero is in ui/apelidos.ts ARTE_NOVA.
// cadeado-so-clt-viciado: a locked hero (rules/personagens-liberados.ts) keeps his tile, darkened under a lock.
rowList.innerHTML=classes.map(hero=>`<button type="button" class="class-card" data-hero="${hero.id}"${isLiberado(hero.id)?'':' data-bloqueado'} aria-pressed="${hero.id===selected.id}" aria-label="${hero.name}${isLiberado(hero.id)?'':' (em breve)'}">${hasNewArt(hero.id)
  ?`<img class="card-portrait" draggable="false" data-src="${thumbUrl(hero)}" alt="" width="256" height="256" decoding="async" aria-hidden="true" />`
  :'<span class="card-misterio" aria-hidden="true">?</span>'}${isLiberado(hero.id)?'':`<span class="card-cadeado">${icon('cadeado',{size:32})}</span>`}</button>`).join('');
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
  if(picture){if(sign.getAttribute('src')!==picture)sign.src=picture;sign.alt=`${selected.name}: ${plaque}`;}
  sign.hidden=!picture;title.classList.toggle('com-letreiro',!!picture);document.getElementById('class-name')!.hidden=!!picture;
  const fit=String(titleFit(lines));if(title.style.getPropertyValue('--titulo-fit')!==fit)title.style.setProperty('--titulo-fit',fit);
  text('class-name',plaque);
  showCutout(); // first: a hero standing in place never starts his dance
  showPortrait(selected,announce);
  document.getElementById('portrait')!.setAttribute('aria-label',`Ilustração de ${selected.name}`);
  // Writing a custom property on <html> restyles the whole page, even with the same value: only on a real change.
  if(document.documentElement.style.getPropertyValue('--emblem')!==color) document.documentElement.style.setProperty('--emblem',color);
  rowList.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(button=>{const on=String(button.dataset.hero===selected.id);if(button.getAttribute('aria-pressed')!==on)button.setAttribute('aria-pressed',on);});
  showInRow(announce);
  showLock();
  if(announce) text('announcement',`${selected.name}, ${selected.role}. ${selected.subtitle}${isLiberado(selected.id)?'':'. Em breve.'}`);
}
// A locked hero can be looked at, never chosen: SELECIONAR turns into a disabled "EM BREVE" with the lock in the star's place.
function showLock() {
  const button=document.getElementById('confirm') as HTMLButtonElement,locked=!isLiberado(selected.id);
  if(button.disabled===locked) return;
  button.disabled=locked;
  button.querySelector<HTMLElement>('.estadio-cadeado')!.hidden=!locked;
  document.querySelector('.estadio-confirmar-texto')!.textContent=locked?'EM BREVE':CONFIRM_TEXT[etapaOf(etapa)];
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
nameInput.addEventListener('input',()=>{nickname=nameInput.value;nameInput.setCustomValidity('');});
// A name longer than the rooms take is cut at a whole word with "…" (client/ui/nick.ts) when the field is left, not mid-word.
nameInput.addEventListener('change',()=>{nickname=nameInput.value=fitName(nameInput.value);});
// Step 2 (nome-depois-de-selecionar): "Selecionar" locks the hero, the name field takes the row's place and the button
// enters. ‹, Escape or the dialog's "Trocar de personagem" go back to the row.
const etapa={section:document.getElementById('personagem')!,row:document.querySelector<HTMLElement>('.estadio-fileira')!,
  nameRow:document.querySelector<HTMLElement>('.estadio-nome')!,input:nameInput,label:document.querySelector<HTMLElement>('.estadio-confirmar-texto')!};
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
nameInput.addEventListener('keydown',event=>{
  const key=nameKey(event);
  if(!key) return;
  event.preventDefault();
  if(key==='entrar') document.getElementById('confirm')!.click(); else backToRow();
});
const dialog=document.getElementById('confirmation') as HTMLDialogElement;
document.getElementById('confirm')!.addEventListener('click',()=>{
  if(!isLiberado(selected.id)) return; // a locked hero never gets past here (a click, Enter or a script)
  if(etapaOf(etapa)==='escolher') {chooseHero();return;}
  if(!nickname.trim()) {nameInput.setCustomValidity('Escolha um nome para seu personagem.');nameInput.reportValidity();nameInput.focus();return;}
  nameInput.setCustomValidity('');
  nickname=nameInput.value=fitName(nickname);
  const saved={version:1,classId:selected.id,name:nickname,color};
  let persisted=false;
  try {localStorage.setItem('viagem:hero:v1',JSON.stringify(saved));persisted=true;} catch { /* fallback explícito abaixo */ }
  text('chosen-name',saved.name);setArt('chosen-art',selected);
  // The class with its suit, like the creation's seal (confirmacao-70h).
  document.getElementById('chosen-class')!.innerHTML=`<span class="chosen-role">${suit(selected.role)}${selected.role}</span> ${selected.name}`;
  // Saved: nothing to say. Only a failure to save is worth a line.
  text('save-status',persisted?'':'Ficha escolhida nesta sessão. O navegador não permitiu salvá-la.');
  dialog.showModal();
});
document.getElementById('close-dialog')!.addEventListener('click',()=>dialog.close());
const coopButton=document.createElement('button');coopButton.id='enter-coop';coopButton.className='primary-button';coopButton.textContent='Jogar com amigos';document.querySelector('#confirmation .solo-row')!.before(coopButton);
// A chunk of an older deploy is not "could not open": the watch reloads and the resume reopens the lobby (and the room).
async function openCoop(options:{room?:string;autoJoin?:boolean}={}){
  coopButton.disabled=true;
  const releaseDance=menuDance.hold();
  const intent:ResumeIntent=options.room?{view:'lobby',room:options.room}:{view:'lobby'};
  try{await opening(intent,async()=>{const {openLobby}=await import('./client/lobby.ts');dialog.close();await openLobby(selected,nickname.trim(),options);});}
  catch(e){if(!chunkFailed(e))text('explore-error','Não foi possível abrir as salas.');}
  finally{releaseDance();coopButton.disabled=false;}
}
// Invite link (?sala=, NEW-20261009-UX-lobby-mobile): the lobby enters that room by itself, once. A saved hero goes
// straight in (below); a new player makes one first and the confirmation's button says which room it opens.
let invite=inviteCode(location.search);
if(invite)coopButton.textContent=`Entrar na sala ${formatRoomCode(invite)}`;
const openInvite=()=>{const room=invite;invite=undefined;coopButton.textContent='Jogar com amigos';return openCoop({room,autoJoin:true});};
coopButton.addEventListener('click',()=>void(invite?openInvite():openCoop()));
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
document.getElementById('enter-island')!.addEventListener('click',async()=>{
  const button=document.getElementById('enter-island') as HTMLButtonElement;
  button.disabled=true;text('explore-error','');
  if(island){
    const releaseDance=menuDance.hold();
    try {
      const {openExploration}=await import('./client/explore.ts');
      dialog.close();await openExploration(selected,nickname.trim());
    } catch(e) {if(!chunkFailed(e))text('explore-error','Não foi possível carregar a ilha. Tente novamente.');}
    finally {releaseDance();button.disabled=false;}
    return;
  }
  const label=button.textContent;button.textContent='Preparando…';
  const releaseDance=menuDance.hold();
  try {
    const {openSolo}=await import('./client/lobby.ts');
    await openSolo(selected,nickname.trim(),{bots,onJoined:()=>{button.textContent=label;dialog.close();}});
  } catch(e) {if(!chunkFailed(e))text('explore-error',soloErrorText(e));}
  finally {releaseDance();button.disabled=false;button.textContent=label;}
});
renderSelected();
// Back from a version reload (at most RESUME_MAX_MS old): the hero came from localStorage; the lobby opens again and,
// with a room, joins it by itself (the room's token in sessionStorage keeps the same seat for GRACE_MS).
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
