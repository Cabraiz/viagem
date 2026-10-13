import './client/style.css';
import { setupSections } from './client/sections.ts';
import { classes, filterClasses, getClass, roles, type HeroClass } from './rules/index.ts';
import { mountIcons } from './client/ui/icon-sprite.ts';
import { icon } from './client/ui/icon.ts';
import { suit } from './client/ui/suit.ts';
import { startArt } from './client/ui/art-boot.ts';
import { startVersionWatch, fetchBuildId } from './client/ui/version-watch.ts';
import { chunkFailed, inMatchOf, linkWatch, opening, reloadPage, resumeOf, saveResume, showUpdateToast, takeResume, type ResumeIntent } from './client/ui/update-toast.ts';
import './client/ui/update-toast.css';
mountIcons();
// Old tab after a deploy (NEW-20261012-E5-chunk-velho-deploy): /version.json changed or a lazy chunk answered 404.
// Out of a match the page reloads by itself and comes back where it was (resume); in a match only the notice shows.
const session=()=>{try{return sessionStorage;}catch{return undefined;}};
linkWatch(startVersionWatch({win:window,current:__BUILD_ID__,fetchVersion:()=>fetchBuildId(),inMatch:()=>inMatchOf(document),
  reload:()=>reloadPage(location),onAvailable:()=>showUpdateToast(document),beforeReload:()=>saveResume(session(),resumeOf(document,Date.now()))}));
// Art v2 (NEW-20261012-ORQ-importar-arte-b-ligacao): the index is fetched in the background, never blocking the menu;
// the game and the horde sandbox await it (bounded) before Phaser preloads. Late or failed = SVG/procedural stays.
void startArt();
// Art cache (NEW-20261013-ORQ-3g-precarga-partida): public/sw.js keeps /art and /assets by content version, so a second
// match downloads no art. Production builds only: the dev server never gets a worker.
if(!import.meta.env.DEV&&'serviceWorker' in navigator)addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>undefined);},{once:true});
if(new URLSearchParams(location.search).get('sandbox')==='audio')void import('./client/sandboxes/sandbox-audio.ts').then(m=>m.openAudioSandbox()).catch(e=>console.error('audio sandbox failed to load',e));

const colors = ['#75b8a6','#ed8f91','#a391d4','#edc66a','#73add1','#d99bbf'];
let selected = classes[0];
let query = '';
let role = 'Todas';
let page = 0;
let color = colors[0];
let nickname = '';
try {
  const saved = JSON.parse(localStorage.getItem('viagem:hero:v1') ?? 'null');
  if (saved && typeof saved.name === 'string' && typeof saved.classId === 'string') {
    selected = getClass(saved.classId) ?? selected;
    nickname = saved.name.slice(0,20);
    color = colors.includes(saved.color) ? saved.color : color;
  }
} catch { /* armazenamento indisponível: criação continua sem persistência */ }

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<main class="world criacao" data-build="viagem-island-v1">
  <nav class="section-nav" aria-label="Criação">
    <a class="wordmark" href="#personagem" aria-label="viagem, início">viagem</a>
    <div class="section-tabs" role="tablist" aria-label="Seções da criação"><button type="button" role="tab" id="tab-personagem" aria-controls="personagem" aria-selected="true">Personagem</button><button type="button" role="tab" id="tab-classes" aria-controls="classes" aria-selected="false" tabindex="-1">Classes</button></div>
  </nav>
  <section id="personagem" class="journey-screen creation-window" role="tabpanel" aria-labelledby="tab-personagem">
    <h1 id="screen-title" class="sr-only">Crie seu personagem</h1>
    <div class="window-content">
      <section class="portrait-panel" aria-label="Retrato do personagem selecionado">
        <div id="portrait" class="portrait" role="img"></div>
        <div class="portrait-caption"><span id="portrait-role"></span><blockquote id="quote"></blockquote></div>
        <nav class="portrait-navigation" aria-label="Trocar personagem"><button id="previous" class="round-button" aria-label="Classe anterior">‹</button><button id="next" class="round-button" aria-label="Próxima classe">›</button></nav>
      </section>
      <div class="character-sheet">
        <h2 id="class-name"></h2>
        <div class="identity-fields"><label for="nickname" class="sr-only">Seu nome de aventura</label><input id="nickname" maxlength="20" placeholder="Como a turma vai te chamar?" autocomplete="nickname" /><fieldset class="palette"><legend class="sr-only">Cor do emblema</legend><div>${colors.map((value,index)=>`<button type="button" class="swatch" data-color="${value}" style="--swatch:${value}" aria-label="Cor ${['menta','coral','lilás','dourado','azul','rosa'][index]}" aria-pressed="false"></button>`).join('')}</div></fieldset></div>
        <div class="stats-and-story"><div class="radar-wrap" role="img" aria-labelledby="stats-text"><svg viewBox="0 0 220 180" aria-hidden="true"><path d="M110 20 187 90 110 160 33 90Z" class="radar-grid"/><path d="M110 40 165 90 110 140 55 90Z M110 63 140 90 110 117 80 90Z" class="radar-grid"/><path d="M110 20V160 M33 90H187" class="radar-axis"/><polygon id="radar-shape"/><circle cx="110" cy="90" r="4" fill="#6d609e"/></svg><span class="stat-label power">Força <b id="stat-0"></b></span><span class="stat-label agility">Agilidade <b id="stat-1"></b></span><span class="stat-label wits">Malícia <b id="stat-2"></b></span><span class="stat-label charm">Carisma <b id="stat-3"></b></span><span class="sr-only" id="stats-text"></span></div><div class="skill-box"><span class="skill-icon" aria-hidden="true">✹</span><div><h3 id="skill-name"></h3><p id="skill-description"></p></div></div></div>
        <div class="selection-footer"><button id="confirm" class="primary-button">Esse sou eu!</button></div>
      </div>
    </div>
  </section>
  <section id="classes" class="journey-screen roster" role="tabpanel" aria-labelledby="tab-classes" hidden>
    <div class="roster-tools"><label class="search"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="Encontre sua classe…" aria-label="Buscar classe" /></label><div class="role-filters" aria-label="Filtrar por especialidade">${['Todas',...roles].map(value=>`<button class="filter" data-role="${value}" aria-pressed="${value==='Todas'}">${suit(value)}${value}</button>`).join('')}</div><span id="results-count" aria-live="polite"></span></div>
    <div id="class-list" class="class-list"></div>
    <nav class="roster-pagination" aria-label="Páginas de classes"><button id="page-prev" class="round-button" aria-label="Página anterior">‹</button><span id="page-count"></span><button id="page-next" class="round-button" aria-label="Próxima página">›</button></nav>
  </section>
</main>
<dialog id="confirmation" aria-labelledby="confirmation-title"><button id="close-dialog" class="close-dialog" aria-label="Fechar">${icon('fechar',{size:32})}</button><h2 id="confirmation-title">Seu personagem está escolhido!</h2><div id="chosen-art" class="class-art" aria-hidden="true"></div><strong id="chosen-name"></strong><p id="chosen-class"></p><p id="save-status"></p><p class="coming-next">Sua primeira parada: a Ilha do Começo.<br/>Para se verem, entrem na mesma sala em Jogar com amigos.</p><button id="enter-island" class="primary-button">Explorar a ilha</button><p id="explore-error" class="explore-error" role="status"></p><button id="back-to-classes" class="primary-button">Voltar às classes</button></dialog>
<div class="sr-only" id="announcement" aria-live="polite"></div>`;

function text(id: string,value: string) { document.getElementById(id)!.textContent=value; }
function artStyle(hero: HeroClass, detailed=false) {
  return `background-image:url('/art/portraits/${hero.id}${detailed?'':'-thumb'}.webp')`;
}
// BUG-menu-travando: the big portrait is an <img> with srcset (768/1024 for the real DPR), decoded off-screen before it
// swaps in, so a class change never waits on a decode inside a frame. Neighbours are warmed so the next tap is instant.
const portraitSizes='(orientation: landscape) 34vw, calc(100vw - 48px)';
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
// Catalog thumbs live in the Classes tab: they load when it shows them (hidden panels never intersect).
const lazyArt=new IntersectionObserver(entries=>{
  for(const entry of entries) if(entry.isIntersecting) { const img=entry.target as HTMLImageElement; img.dataset.seen='1'; if(img.dataset.src) img.src=img.dataset.src; lazyArt.unobserve(img); }
},{rootMargin:'300px 0px'});
function lazySrc(img: HTMLImageElement, url: string) {
  if(img.dataset.seen) { img.src=url; return; }
  img.dataset.src=url; lazyArt.observe(img);
}
// After the first screen is up, the page of thumbs already rendered comes in idle time, so "Classes" opens filled.
addEventListener('load',()=>idle(()=>document.querySelectorAll<HTMLImageElement>('img[data-src]:not([data-seen])').forEach(img=>{ img.dataset.seen='1'; img.src=img.dataset.src!; lazyArt.unobserve(img); })),{once:true});
let portraitToken=0, pending: HTMLImageElement|null=null;
const thumbUrl=(hero: HeroClass)=>`/art/portraits/${hero.id}-thumb.webp`;
function showPortrait(hero: HeroClass, interactive: boolean) {
  const frame=document.getElementById('portrait')!;
  const current=frame.querySelector('img'), img=portraitImage(hero,!current), token=++portraitToken;
  // Flicking past a class drops its half-downloaded art, so on 4G the bandwidth goes to the one that stays on screen.
  if(pending&&pending!==img&&pending!==current&&!pending.complete) { forget(pending); pending.removeAttribute('srcset'); pending.src=''; }
  pending=img;
  if(current===img) { frame.removeAttribute('aria-busy'); return; }
  let placed=false;
  const place=()=>{ if(token!==portraitToken) return; placed=true; frame.replaceChildren(img); frame.removeAttribute('aria-busy'); if(interactive) warmNeighbours(hero); };
  // Failed download: forget it (the next tap fetches again) and keep what is on screen, never a blank frame.
  const failed=()=>{ forget(img); if(token===portraitToken) frame.removeAttribute('aria-busy'); };
  if(!current) { img.addEventListener('error',()=>{ forget(img); placed=false; showThumb(); },{once:true}); place(); return; }
  img.decode().then(place,failed);
  // Not on screen yet: the new class's thumb (17 KB, the catalog card uses the same file) holds the frame right away,
  // so the name and the art never disagree; the full art replaces it once decoded.
  if(!(img.complete&&img.naturalWidth)) showThumb();
  function showThumb() {
    const thumb=new Image(); thumb.alt=''; thumb.decoding='async'; thumb.className='portrait-art'; thumb.src=thumbUrl(hero);
    thumb.decode().then(()=>{ if(token!==portraitToken||placed) return; frame.replaceChildren(thumb); frame.setAttribute('aria-busy','true'); },()=>{});
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
function renderSelected(announce=false) {
  const index=classes.indexOf(selected);
  document.getElementById('portrait-role')!.innerHTML=`${suit(selected.role)}${selected.role}`;
  text('quote',`“${selected.quote}”`);
  text('class-name',selected.name);
  text('skill-name',selected.skill);
  text('skill-description',selected.skillDescription);
  showPortrait(selected,announce);
  document.getElementById('portrait')!.setAttribute('aria-label',`Ilustração de ${selected.name}`);
  selected.stats.forEach((value,index)=>text(`stat-${index}`,String(value)));
  text('stats-text',`Força ${selected.stats[0]}, agilidade ${selected.stats[1]}, malícia ${selected.stats[2]}, carisma ${selected.stats[3]}.`);
  const [power,agility,wits,charm]=selected.stats;
  document.getElementById('radar-shape')!.setAttribute('points',`110,${90-power*14} ${110+agility*15.4},90 110,${90+wits*14} ${110-charm*15.4},90`);
  // Writing a custom property on <html> restyles the whole page, even with the same value: only on a real change.
  if(document.documentElement.style.getPropertyValue('--emblem')!==color) document.documentElement.style.setProperty('--emblem',color);
  document.querySelectorAll<HTMLButtonElement>('.swatch').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===color)));
  document.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.hero===selected.id)));
  if(announce) text('announcement',`${selected.name}, ${selected.role}. ${selected.subtitle}`);
}
// The catalog never scrolls (criacao-tela-cheia): a page holds as many cards as the grid's box fits, so a phone gets
// fewer per page and the arrows (or a swipe) turn pages. Hidden (other tab) keeps the last measured size.
const CARD_MIN_W=92, CARD_MIN_H=112, CARD_GAP=8;
// Before the catalog was ever shown (hidden tab), guess from the viewport so a small phone does not fetch 12 thumbs.
let lastPageSize=Math.max(1,Math.floor((innerWidth-24+CARD_GAP)/(CARD_MIN_W+CARD_GAP))*Math.floor((innerHeight-200+CARD_GAP)/(CARD_MIN_H+CARD_GAP)));
function rosterPageSize() {
  const list=document.getElementById('class-list');
  if(!list||!list.clientWidth||!list.clientHeight) return lastPageSize;
  const cols=Math.max(1,Math.floor((list.clientWidth+CARD_GAP)/(CARD_MIN_W+CARD_GAP)));
  const rows=Math.max(1,Math.floor((list.clientHeight+CARD_GAP)/(CARD_MIN_H+CARD_GAP)));
  list.style.setProperty('--cols',String(cols)); list.style.setProperty('--rows',String(rows));
  return lastPageSize=cols*rows;
}
// Card names stay on ONE line: a name that does not fit shrinks 0.5 px at a time down to NAME_MIN_PX (the CSS
// ellipsis covers anything still too long at the floor). The text is measured with a Range, in sub-pixels:
// scrollWidth rounds, so a name 0.4 px too wide would read as fitting and still show the ellipsis.
const NAME_MIN_PX=8;
function fitCardNames(container: HTMLElement) {
  const range=document.createRange();
  container.querySelectorAll<HTMLElement>('.card-label strong').forEach(name=>{
    name.style.fontSize='';
    let size=parseFloat(getComputedStyle(name).fontSize);
    range.selectNodeContents(name);
    const tooWide=()=>range.getBoundingClientRect().width>name.getBoundingClientRect().width;
    while(tooWide()&&size>NAME_MIN_PX){ size=Math.max(NAME_MIN_PX,size-.5); name.style.fontSize=`${size}px`; }
  });
}
let renderedPageSize=0;
function renderRoster() {
  const results=filterClasses(query,role);
  const pageSize=renderedPageSize=rosterPageSize();
  const pages=Math.max(1,Math.ceil(results.length/pageSize));
  page=Math.max(0,Math.min(page,pages-1));
  const container=document.getElementById('class-list')!;
  container.querySelectorAll<HTMLImageElement>('img[data-src]').forEach(img=>lazyArt.unobserve(img));
  container.innerHTML=results.length?results.slice(page*pageSize,page*pageSize+pageSize).map(hero=>`<button type="button" class="class-card" data-hero="${hero.id}" aria-pressed="${hero.id===selected.id}"><img class="card-portrait class-art" draggable="false" data-src="/art/portraits/${hero.id}-thumb.webp" alt="" width="256" height="256" decoding="async" aria-hidden="true" /><span class="card-label"><strong>${hero.name}</strong></span><span class="card-suit">${suit(hero.role,{label:true})}</span><span class="selected-mark" aria-hidden="true">✓</span></button>`).join(''):'<p class="empty-state">Nenhuma classe por aqui. Tente outro nome ou especialidade.</p>';
  container.querySelectorAll<HTMLImageElement>('img[data-src]').forEach(img=>lazySrc(img,img.dataset.src!));
  fitCardNames(container);
  text('results-count',`${results.length} ${results.length===1?'classe':'classes'}`);
  text('page-count',`${page+1} / ${pages}`);
  // One page only: the pager says nothing, so it goes (and gives its row back to the grid).
  (document.querySelector('.roster-pagination') as HTMLElement).hidden=pages<=1;
  (document.getElementById('page-prev') as HTMLButtonElement).disabled=page===0;
  (document.getElementById('page-next') as HTMLButtonElement).disabled=page>=pages-1;
}
function pickCard(target: EventTarget|null) {
  const button=(target as HTMLElement|null)?.closest<HTMLButtonElement>('[data-hero]');
  if(!button) return;
  selected=getClass(button.dataset.hero!)!;
  renderSelected(true);
  sections.show('personagem');
}
document.getElementById('class-list')!.addEventListener('click',event=>pickCard(event.target));
// The catalog's pressed-state fade only runs when someone can see it: from the carousel, off-screen, it flips silently.
let catalogVisible=false;
new IntersectionObserver(entries=>{ catalogVisible=entries[entries.length-1].isIntersecting; }).observe(document.getElementById('class-list')!);
function cycle(direction:number) {
  selected=classes[(classes.indexOf(selected)+direction+classes.length)%classes.length];
  const nextPage=Math.floor(classes.indexOf(selected)/rosterPageSize());
  // Rebuilding the catalog on every tap re-created its images and re-laid the page: only when the page or filter moves.
  if(query!==''||role!=='Todas'||nextPage!==page) {
    query=''; role='Todas'; page=nextPage;
    (document.getElementById('search') as HTMLInputElement).value='';
    document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.role==='Todas')));
    renderRoster();
  }
  const list=document.getElementById('class-list')!;
  if(!catalogVisible) { list.dataset.quiet=''; requestAnimationFrame(()=>requestAnimationFrame(()=>delete list.dataset.quiet)); }
  renderSelected(true);
}
document.querySelector('.portrait-navigation')!.addEventListener('pointerdown',()=>warmNeighbours(selected),{once:true,passive:true});
document.getElementById('previous')!.addEventListener('click',()=>cycle(-1));
document.getElementById('next')!.addEventListener('click',()=>cycle(1));
const nameInput=document.getElementById('nickname') as HTMLInputElement;
nameInput.value=nickname;
nameInput.addEventListener('input',()=>{nickname=nameInput.value;nameInput.setCustomValidity('');});
document.getElementById('search')!.addEventListener('input',event=>{query=(event.target as HTMLInputElement).value;page=0;renderRoster();});
document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(button=>button.addEventListener('click',()=>{
  role=button.dataset.role!;page=0;
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  renderRoster();
}));
document.querySelectorAll<HTMLButtonElement>('.swatch').forEach(button=>button.addEventListener('click',()=>{color=button.dataset.color!;renderSelected();}));
document.getElementById('page-prev')!.addEventListener('click',()=>{page--;renderRoster();});
document.getElementById('page-next')!.addEventListener('click',()=>{page++;renderRoster();});
// Swipe on the catalog turns the page; a real swipe swallows the click so it never also picks a class.
// A touch tap picks on pointerup: right after a swipe, Chrome on Android may not synthesize the click for the next
// tap, and a lost tap reads as a dead card. The click that may still follow is swallowed, so it never picks twice.
{
  const list=document.getElementById('class-list')!;
  let startX=0,startY=0,swallow=false;
  list.addEventListener('pointerdown',event=>{startX=event.clientX;startY=event.clientY;swallow=false;},{passive:true});
  list.addEventListener('dragstart',event=>event.preventDefault());
  list.addEventListener('pointerup',event=>{
    const dx=event.clientX-startX,dy=event.clientY-startY;
    if(event.pointerType!=='mouse'&&Math.abs(dx)<10&&Math.abs(dy)<10){swallow=true;pickCard(event.target);return;}
    if(Math.abs(dx)<48||Math.abs(dx)<Math.abs(dy)*1.5)return;
    const next=dx<0?document.getElementById('page-next') as HTMLButtonElement:document.getElementById('page-prev') as HTMLButtonElement;
    swallow=true; if(!next.disabled)next.click();
  },{passive:true});
  list.addEventListener('click',event=>{if(swallow){event.stopImmediatePropagation();event.preventDefault();swallow=false;}},{capture:true});
}
const dialog=document.getElementById('confirmation') as HTMLDialogElement;
document.getElementById('confirm')!.addEventListener('click',()=>{
  if(!nickname.trim()) {nameInput.setCustomValidity('Escolha um nome para seu personagem.');nameInput.reportValidity();nameInput.focus();return;}
  nameInput.setCustomValidity('');
  const saved={version:1,classId:selected.id,name:nickname.trim(),color};
  let persisted=false;
  try {localStorage.setItem('viagem:hero:v1',JSON.stringify(saved));persisted=true;} catch { /* fallback explícito abaixo */ }
  text('chosen-name',saved.name);text('chosen-class',selected.name);setArt('chosen-art',selected);
  text('save-status',persisted?'Ficha salva neste navegador.':'Ficha escolhida nesta sessão. O navegador não permitiu salvá-la.');
  dialog.showModal();
});
document.getElementById('close-dialog')!.addEventListener('click',()=>dialog.close());
const coopButton=document.createElement('button');coopButton.id='enter-coop';coopButton.className='primary-button';coopButton.textContent='Jogar com amigos';document.getElementById('enter-island')!.before(coopButton);
const comingNext=dialog.querySelector('.coming-next');if(comingNext)comingNext.textContent='Explore a ilha ou reúna até seis amigos para enfrentar os bêbados do boteco.';
// A chunk of an older deploy is not "could not open": the watch reloads and the resume reopens the lobby (and the room).
async function openCoop(options:{room?:string;autoJoin?:boolean}={}){
  coopButton.disabled=true;
  const intent:ResumeIntent=options.room?{view:'lobby',room:options.room}:{view:'lobby'};
  try{await opening(intent,async()=>{const {openLobby}=await import('./client/lobby.ts');dialog.close();await openLobby(selected,nickname.trim(),options);});}
  catch(e){if(!chunkFailed(e))text('explore-error','Não foi possível abrir as salas.');}
  finally{coopButton.disabled=false;}
}
coopButton.addEventListener('click',()=>void openCoop());
document.getElementById('back-to-classes')!.addEventListener('click',()=>{dialog.close();sections.show('classes');});
document.getElementById('enter-island')!.addEventListener('click',async()=>{
  const button=document.getElementById('enter-island') as HTMLButtonElement;
  button.disabled=true;text('explore-error','');
  try {
    const {openExploration}=await import('./client/explore.ts');
    dialog.close();await openExploration(selected,nickname.trim());
  } catch(e) {if(!chunkFailed(e))text('explore-error','Não foi possível carregar a ilha. Tente novamente.');}
  finally {button.disabled=false;}
});
// Same page size (e.g. the tab just became visible after rendering hidden): only the names need refitting.
const sections=setupSections(()=>{const size=rosterPageSize();if(size!==renderedPageSize){page=Math.floor(page*renderedPageSize/size);renderRoster();}else fitCardNames(document.getElementById('class-list')!);});
renderRoster();renderSelected();
// The display font arrives after the first render and is wider than the fallback: fit the names again.
// A face may start loading only when the names first use it, after `ready` already settled: refit on every load too.
const refitNames=()=>fitCardNames(document.getElementById('class-list')!);
document.fonts?.ready.then(refitNames);
document.fonts?.addEventListener('loadingdone',refitNames);
// Back from a version reload (at most RESUME_MAX_MS old): the hero came from localStorage; the lobby opens again and,
// with a room, joins it by itself (the room's token in sessionStorage keeps the same seat for GRACE_MS).
const resume=takeResume(session(),Date.now());
if(resume?.view==='lobby'&&nickname.trim())void openCoop(resume.room?{room:resume.room,autoJoin:true}:{});
if(new URLSearchParams(location.search).get('sandbox')==='horda')void import('./client/sandboxes/sandbox-horde.ts').then(m=>m.openHordeSandbox());
if(new URLSearchParams(location.search).get('sandbox')==='fun')void import('./client/sandboxes/sandbox-fun.ts');
if(new URLSearchParams(location.search).get('sandbox')==='hud')void import('./client/sandboxes/sandbox-hud.ts');
if(new URLSearchParams(location.search).get('sandbox')==='voce')void import('./client/sandboxes/sandbox-voce.ts');
if(new URLSearchParams(location.search).get('sandbox')==='sala')void import('./client/sandboxes/sandbox-sala.ts');
if(new URLSearchParams(location.search).get('sandbox')==='cidade')void import('./client/sandboxes/sandbox-cidade.ts');
// Playtest metrics (UX-playtest-metricas), dev only (exactly ?dev=1, as dev/ux-flag.ts; the menu imports nothing from
// the game in client/ statically, menu-perf): "Métricas" of this tab's last room session after "Sair".
if(new URLSearchParams(location.search).get('dev')==='1'&&!new URLSearchParams(location.search).get('sandbox'))void import('./client/dev/ux-metrics.ts').then(m=>m.mountHomeExport(window)).catch(()=>undefined);
