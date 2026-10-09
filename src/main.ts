import './style.css';
import { setupSections } from './sections.ts';
import { classes, filterClasses, getClass, roles, type HeroClass } from './classes.ts';
if(new URLSearchParams(location.search).get('sandbox')==='audio')void import('./game/sandbox-audio.ts').then(m=>m.openAudioSandbox()).catch(e=>console.error('audio sandbox failed to load',e));

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
<main class="world" data-build="viagem-island-v1">
  <div class="leaf leaf-left" aria-hidden="true"></div><div class="leaf leaf-right" aria-hidden="true"></div>
  <header class="masthead">
    <a class="wordmark" href="#" aria-label="viagem, início">viagem<span class="star">✦</span><small>UMA AVENTURA FORA DO COMUM</small></a>
    <div class="chapter"><span>PRIMEIRO CAPÍTULO</span><strong>Todo herói começa em algum lugar.</strong></div>
    <span class="version-badge">PRÉVIA · 36 CLASSES</span>
  </header>
  <section class="creation-window" aria-labelledby="screen-title">
    <div class="window-title"><div><span class="window-spark">✦</span><h1 id="screen-title">Crie seu personagem</h1></div><span class="step">01 <i>/</i> 02 <i>—</i> ESCOLHA SUA CLASSE</span></div>
    <div class="window-content">
      <section class="portrait-panel" aria-label="Retrato do personagem selecionado">
        <span class="portrait-index" id="portrait-index"></span><span class="portrait-star" aria-hidden="true">✧</span>
        <div id="portrait" class="portrait class-art" role="img"></div>
        <div class="portrait-caption"><span id="portrait-role"></span><blockquote id="quote"></blockquote></div>
        <nav class="portrait-navigation" aria-label="Trocar personagem"><button id="previous" class="round-button" aria-label="Classe anterior">‹</button><div><strong id="portrait-name"></strong><small id="portrait-counter"></small></div><button id="next" class="round-button" aria-label="Próxima classe">›</button></nav>
      </section>
      <div class="character-sheet">
        <div class="sheet-heading"><span class="eyebrow">GENTE COMO A GENTE. MAIS OU MENOS.</span><h2 id="class-name"></h2><p id="class-subtitle"></p></div>
        <div class="identity-row">
          <div class="sprite-preview"><span class="tiny-label">PRÉVIA</span><div id="sprite" class="class-art" aria-hidden="true"></div><span class="sprite-shadow"></span></div>
          <div class="identity-fields"><label for="nickname">Seu nome de aventura</label><input id="nickname" maxlength="20" placeholder="Como a turma vai te chamar?" autocomplete="nickname" /><div class="class-meta"><span>Especialidade</span><strong id="role-name"></strong></div><fieldset class="palette"><legend>Cor do emblema</legend><div>${colors.map((value,index)=>`<button type="button" class="swatch" data-color="${value}" style="--swatch:${value}" aria-label="Cor ${['menta','coral','lilás','dourado','azul','rosa'][index]}" aria-pressed="false"></button>`).join('')}</div></fieldset></div>
        </div>
        <div class="stats-and-story"><section class="stats-box" aria-labelledby="stats-title"><h3 id="stats-title">Seu jeitinho de jogar</h3><div class="radar-wrap"><svg viewBox="0 0 220 180" aria-hidden="true"><path d="M110 20 187 90 110 160 33 90Z" class="radar-grid"/><path d="M110 40 165 90 110 140 55 90Z M110 63 140 90 110 117 80 90Z" class="radar-grid"/><path d="M110 20V160 M33 90H187" class="radar-axis"/><polygon id="radar-shape"/><circle cx="110" cy="90" r="4" fill="#6d609e"/></svg><span class="stat-label power">FORÇA <b id="stat-0"></b></span><span class="stat-label agility">AGILIDADE <b id="stat-1"></b></span><span class="stat-label wits">MALÍCIA <b id="stat-2"></b></span><span class="stat-label charm">CARISMA <b id="stat-3"></b></span></div><p class="stats-note">Cada um tem seu talento.</p></section><div class="story"><p id="class-description"></p><div class="skill-box"><span class="skill-icon" aria-hidden="true">✹</span><div><span class="tiny-label">HABILIDADE DA CLASSE · CONCEITO</span><h3 id="skill-name"></h3><p id="skill-description"></p></div></div></div></div>
        <div class="selection-footer"><p>Uma turma de até <strong>6 amigos.</strong><br/>Uma boa dose de falta de juízo.</p><button id="confirm" class="primary-button">Esse sou eu! <span aria-hidden="true">➜</span></button></div>
      </div>
    </div>
  </section>
  <section class="roster" aria-labelledby="roster-title"><div class="roster-heading"><div><span class="eyebrow">ESCOLHA SEU TIPO DE CAOS</span><h2 id="roster-title">Tem lugar pra todo mundo.</h2></div><label class="search"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="Encontre sua classe…" aria-label="Buscar classe" /></label></div><div class="roster-tools"><div class="role-filters" aria-label="Filtrar por especialidade">${['Todas',...roles].map(value=>`<button class="filter" data-role="${value}" aria-pressed="${value==='Todas'}">${value}</button>`).join('')}</div><span id="results-count" aria-live="polite"></span></div><div id="class-list" class="class-list"></div><div class="roster-pagination"><span>Personagens improváveis. Aventuras inesquecíveis.</span><nav aria-label="Páginas de classes"><button id="page-prev" aria-label="Página anterior">‹</button><span id="page-count"></span><button id="page-next" aria-label="Próxima página">›</button></nav></div></section>
  <footer class="page-footer"><span>viagem.cyou <i>✦</i> feito pra jogar junto</span><span>Seleção local · o multiplayer ainda está em desenvolvimento</span></footer>
</main>
<dialog id="confirmation" aria-labelledby="confirmation-title"><button id="close-dialog" class="close-dialog" aria-label="Fechar">×</button><span class="eyebrow">PRONTO PARA A PRÓXIMA ETAPA</span><h2 id="confirmation-title">Seu personagem está escolhido!</h2><div id="chosen-art" class="class-art" aria-hidden="true"></div><strong id="chosen-name"></strong><p id="chosen-class"></p><p id="save-status"></p><p class="coming-next">Sua primeira parada: a Ilha do Começo.<br/>Para se verem, entrem na mesma sala em Jogar com amigos.</p><button id="enter-island" class="primary-button">Explorar a ilha ✦</button><p id="explore-error" class="explore-error" role="status"></p><button id="back-to-classes" class="primary-button">Voltar às classes</button></dialog>
<div class="sr-only" id="announcement" aria-live="polite"></div>`;

function text(id: string,value: string) { document.getElementById(id)!.textContent=value; }
function artStyle(hero: HeroClass, detailed=false) {
  return `background-image:url('/art/portraits/${hero.id}${detailed?'':'-thumb'}.webp')`;
}
function setArt(id: string,hero: HeroClass) {
  document.getElementById(id)!.style.cssText=artStyle(hero,id!=='sprite');
}
function renderSelected(announce=false) {
  const index=classes.indexOf(selected);
  text('portrait-index',`Nº ${String(index+1).padStart(2,'0')}`);
  text('portrait-role',selected.role);
  text('quote',`“${selected.quote}”`);
  text('portrait-name',selected.name);
  text('portrait-counter',`${String(index+1).padStart(2,'0')} / 36`);
  text('class-name',selected.name);
  text('class-subtitle',selected.subtitle);
  text('role-name',selected.role);
  text('class-description',selected.description);
  text('skill-name',selected.skill);
  text('skill-description',selected.skillDescription);
  setArt('portrait',selected); setArt('sprite',selected);
  document.getElementById('portrait')!.setAttribute('aria-label',`Ilustração de ${selected.name}`);
  selected.stats.forEach((value,index)=>text(`stat-${index}`,String(value)));
  const [power,agility,wits,charm]=selected.stats;
  document.getElementById('radar-shape')!.setAttribute('points',`110,${90-power*14} ${110+agility*15.4},90 110,${90+wits*14} ${110-charm*15.4},90`);
  document.documentElement.style.setProperty('--emblem',color);
  document.querySelectorAll<HTMLButtonElement>('.swatch').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===color)));
  document.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.hero===selected.id)));
  if(announce) text('announcement',`${selected.name}, ${selected.role}. ${selected.subtitle}`);
}
function rosterPageSize() {
  return matchMedia('(max-width:620px)').matches ? (matchMedia('(max-height:740px)').matches ? 3 : 6) : 12;
}
function renderRoster() {
  const results=filterClasses(query,role);
  const pageSize=rosterPageSize();
  const pages=Math.max(1,Math.ceil(results.length/pageSize));
  page=Math.max(0,Math.min(page,pages-1));
  const container=document.getElementById('class-list')!;
  container.innerHTML=results.length?results.slice(page*pageSize,page*pageSize+pageSize).map(hero=>`<button type="button" class="class-card" data-hero="${hero.id}" aria-pressed="${hero.id===selected.id}"><span class="card-number">${String(hero.art+1).padStart(2,'0')}</span><span class="card-portrait class-art" style="${artStyle(hero)}" aria-hidden="true"></span><span class="card-label"><strong>${hero.name}</strong><small>${hero.role}</small></span><span class="selected-mark" aria-hidden="true">✓</span></button>`).join(''):'<p class="empty-state">Nenhuma classe por aqui. Tente outro nome ou especialidade.</p>';
  text('results-count',`${results.length} ${results.length===1?'classe':'classes'}`);
  text('page-count',`${page+1} / ${pages}`);
  (document.getElementById('page-prev') as HTMLButtonElement).disabled=page===0;
  (document.getElementById('page-next') as HTMLButtonElement).disabled=page>=pages-1;
}
document.getElementById('class-list')!.addEventListener('click',event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-hero]');
  if(!button) return;
  selected=getClass(button.dataset.hero!)!;
  renderSelected(true);
});
function cycle(direction:number) {
  selected=classes[(classes.indexOf(selected)+direction+classes.length)%classes.length];
  query=''; role='Todas'; page=Math.floor(classes.indexOf(selected)/rosterPageSize());
  (document.getElementById('search') as HTMLInputElement).value='';
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.role==='Todas')));
  renderRoster(); renderSelected(true);
}
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
const comingNext=dialog.querySelector('.coming-next');if(comingNext)comingNext.textContent='Explore a ilha ou reúna até seis amigos para enfrentar as gosmas.';
coopButton.addEventListener('click',async()=>{coopButton.disabled=true;try{const {openLobby}=await import('./game/lobby.ts');dialog.close();await openLobby(selected,nickname.trim());}catch{text('explore-error','Não foi possível abrir as salas.');}finally{coopButton.disabled=false;}});
document.getElementById('back-to-classes')!.addEventListener('click',()=>dialog.close());
document.getElementById('enter-island')!.addEventListener('click',async()=>{
  const button=document.getElementById('enter-island') as HTMLButtonElement;
  button.disabled=true;text('explore-error','');
  try {
    const {openExploration}=await import('./game/explore.ts');
    dialog.close();await openExploration(selected,nickname.trim());
  } catch {text('explore-error','Não foi possível carregar a ilha. Tente novamente.');}
  finally {button.disabled=false;}
});
setupSections(()=>{page=0;renderRoster();});
matchMedia('(max-height:740px)').addEventListener('change',()=>{page=0;renderRoster();});
renderRoster();renderSelected();
if(new URLSearchParams(location.search).get('sandbox')==='horda')void import('./game/sandbox-horde.ts').then(m=>m.openHordeSandbox());
if(new URLSearchParams(location.search).get('sandbox')==='fun')void import('./game/sandbox-fun.ts');
if(new URLSearchParams(location.search).get('sandbox')==='hud')void import('./game/sandbox-hud.ts');
