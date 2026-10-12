import './sections.css';

export function setupSections(onLayoutChange: () => void) {
  const world = document.querySelector<HTMLElement>('.world')!;
  const masthead = world.querySelector<HTMLElement>('.masthead')!;
  const creation = world.querySelector<HTMLElement>('.creation-window')!;
  const content = creation.querySelector<HTMLElement>('.window-content')!;
  const sheet = creation.querySelector<HTMLElement>('.character-sheet')!;
  const roster = world.querySelector<HTMLElement>('.roster')!;
  const footer = world.querySelector<HTMLElement>('.page-footer')!;
  const stage = (id: string, label: string) => {
    const element = document.createElement('section');
    element.className = 'journey-screen'; element.id = id;
    element.setAttribute('aria-label', label); return element;
  };
  const characterStage = stage('personagem', 'Escolha seu personagem');
  const sheetStage = stage('ficha', 'Personalize sua ficha');
  const rosterStage = stage('classes', 'Catálogo de classes');
  characterStage.append(masthead, creation);
  characterStage.insertAdjacentHTML('beforeend', '<a class="section-next" id="character-next" href="#ficha">Personalizar minha ficha <span aria-hidden="true">↓</span></a>');
  sheetStage.insertAdjacentHTML('beforeend', '<div class="section-heading"><span class="eyebrow">DO SEU JEITO</span><h2>Sua ficha de aventura</h2></div>');
  sheetStage.append(sheet);
  sheetStage.insertAdjacentHTML('beforeend', '<a class="section-next" href="#classes">Explorar todas as classes <span aria-hidden="true">↓</span></a>');
  rosterStage.append(roster, footer);
  rosterStage.insertAdjacentHTML('beforeend', '<a class="section-next" href="#personagem">Voltar ao meu personagem <span aria-hidden="true">↑</span></a>');
  world.append(characterStage, sheetStage, rosterStage);
  world.insertAdjacentHTML('beforebegin', '<nav class="section-nav" aria-label="Seções da criação"><a href="#personagem" aria-current="location">Personagem</a><a class="sheet-link" href="#ficha">Minha ficha</a><a href="#classes">Classes</a></nav>');
  const nav = document.querySelector<HTMLElement>('.section-nav')!;
  const narrow = matchMedia('(max-width: 620px)');
  const next = document.querySelector<HTMLAnchorElement>('#character-next')!;
  function layout() {
    if (narrow.matches) sheetStage.insertBefore(sheet, sheetStage.querySelector('.section-next'));
    else content.append(sheet);
    sheetStage.hidden = !narrow.matches;
    next.href = narrow.matches ? '#ficha' : '#classes';
    next.firstChild!.textContent = narrow.matches ? 'Personalizar minha ficha ' : 'Explorar todas as classes ';
    onLayoutChange();
  }
  layout(); narrow.addEventListener('change', layout);
  new ResizeObserver(() => document.documentElement.style.setProperty('--section-nav-height', `${nav.getBoundingClientRect().height}px`)).observe(nav);
  let queued = false;
  const updateLocation = () => {
    queued = false;
    const visible = [characterStage, sheetStage, rosterStage].filter(element => !element.hidden);
    const offset = nav.getBoundingClientRect().height;
    const current = visible.reduce((closest, element) => Math.abs(element.getBoundingClientRect().top - offset) < Math.abs(closest.getBoundingClientRect().top - offset) ? element : closest);
    nav.querySelectorAll('a').forEach(link => {
      if (link.hash === `#${current.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(updateLocation); } }, { passive: true });
  requestAnimationFrame(() => {
    const target = location.hash === '#ficha' && !narrow.matches ? characterStage : [characterStage, sheetStage, rosterStage].find(element => `#${element.id}` === location.hash);
    target?.scrollIntoView(); updateLocation();
  });
}
