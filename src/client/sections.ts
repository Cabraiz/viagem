import './sections.css';

export type CreationTab = 'personagem' | 'classes';

/**
 * Creation screen as two real tabs that each fill the viewport (criacao-tela-cheia): nothing scrolls, the tab
 * shows its panel and hides the other. `#personagem` and `#classes` in the URL pick the tab (invite links end in
 * `#personagem`; the old `#ficha` lands on Personagem). `onLayoutChange` runs when the catalog's box changes size,
 * so the page size follows the space instead of a breakpoint.
 */
export function setupSections(onLayoutChange: () => void) {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.section-tabs [role=tab]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')!)!);
  const fromHash = (): CreationTab => (location.hash === '#classes' ? 'classes' : 'personagem');
  function show(id: CreationTab, focus = false) {
    tabs.forEach((tab, index) => {
      const on = panels[index].id === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[index].hidden = !on;
      if (on && focus) tab.focus();
    });
    if (location.hash !== `#${id}`) history.replaceState(history.state, '', `${location.pathname}${location.search}#${id}`);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => show(panels[index].id as CreationTab));
    tab.addEventListener('keydown', event => {
      const to = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (to < 0) return;
      event.preventDefault();
      show(panels[to].id as CreationTab, true);
    });
  });
  document.querySelector<HTMLAnchorElement>('.section-nav .wordmark')?.addEventListener('click', event => { event.preventDefault(); show('personagem'); });
  addEventListener('hashchange', () => show(fromHash()));
  show(fromHash());
  const list = document.getElementById('class-list');
  if (list) new ResizeObserver(() => { if (list.clientWidth && list.clientHeight) onLayoutChange(); }).observe(list);
  return { show };
}
