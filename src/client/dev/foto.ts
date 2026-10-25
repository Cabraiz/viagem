/**
 * Modo foto (D-049, card NEW-20261014-ORQ-modo-foto-navegador-compartilhado): `?foto=<cena>` opens one named scene from
 * fake data, renders it and says so: `window.__fotoPronta === true` once the frame is final (fonts in, art loaded, the
 * city's chunks baked, the fade warmed), then the clock stops so nothing moves under the screenshot. No room, no sim.
 * A scene is a sandbox (sandbox-cidade, sandbox-hud, sandbox-obra, sandbox-config, sandbox-elenco) with fixed parameters and, in the city, a fixed clock
 * (`t`, ms; the chaveiro's animations read it), so a scene prints the same every time.
 * tools/foto.mjs asks a shared browser for these pages (ESCALA.md "como pedir uma foto"); any extra query parameter
 * (view=1, zoom=0.79, t=4000, hero=…) passes through to the sandbox.
 */

export type FotoSandbox='cidade'|'hud'|'obra'|'config'|'elenco';
export interface FotoCena {
  sandbox:FotoSandbox;
  /** The sandbox's own parameters (without `sandbox=`). */
  query:string;
  /** What it shows (the list in tools/foto.mjs --lista). */
  descricao:string;
}

const chaveiro=(moto:string,extra='')=>({sandbox:'cidade' as const,query:`mapa=real&objetivo=1&${moto}${extra}`,descricao:''});
/** The scenes. Names are kebab-case Portuguese, as the cards call them. */
export const FOTO_CENAS:Readonly<Record<string,FotoCena>>=Object.freeze({
  'chaveiro-anda':{...chaveiro('moto=anda','&t=6000'),descricao:'chaveiro: a moto andando na avenida'},
  'chaveiro-lombada':{...chaveiro('moto=lombada'),descricao:'chaveiro: a moto na lombada'},
  'chaveiro-volta':{...chaveiro('moto=volta','&alarme=1&pecas=1'),descricao:'chaveiro: volta no quarteirão com o alarme'},
  'chaveiro-morta':{...chaveiro('moto=morta','&empurra=.6'),descricao:'chaveiro: moto morta, "2 empurrando" com o progresso'},
  'chaveiro-entrega':{...chaveiro('moto=entrega'),descricao:'chaveiro: entrega (ele em pé com a bag)'},
  'chaveiro-tombo':{...chaveiro('moto=tombo'),descricao:'chaveiro: a moto caída, os dois na neve'},
  'chaveiro-abrindo':{...chaveiro('moto=abrindo','&pecas=3&alarme=1'),descricao:'chaveiro: abrindo o carro (15 s) com o alarme'},
  'chaveiro-vitoria':{...chaveiro('fim=vitoria','&pecas=7'),descricao:'chaveiro: o porta-malas abre, "conector errado"'},
  'chaveiro-derrota':{...chaveiro('fim=derrota'),descricao:'chaveiro: perda total'},
  // The game shows 2 balloons at once at most (legibility.ts): the cast's lines take two scenes.
  'chaveiro-falas':{...chaveiro('moto=abrindo','&alarme=1&pecas=3&fala=part,acordou&seed=2'),descricao:'falas do chaveiro: o Tio ao lado do carro (peça caiu) e a Cida na moto (ninho acordou)'},
  'chaveiro-falas-2':{...chaveiro('moto=abrindo','&alarme=1&pecas=3&fala=abrindo,volta&seed=7'),descricao:'falas do chaveiro: ele na porta (abrindo) e o alarme do Quadradão'},
  'chaveiro-falas-3':{...chaveiro('moto=entrega','&obra=1&anda=-40&t=1000&fala=puxa,empurra&seed=3'),descricao:'falas do chaveiro: o Quadradão puxado na corda (puxa) e empurrado (empurra)'},
  'obra-livre':{...chaveiro('moto=entrega','&obra=1'),descricao:'D-052 placeholder: muros, barricadas livres, corda no carro, fantasma verde e dicas'},
  'muralha-tralha':{...chaveiro('moto=entrega','&obra=1&muralha=1'),descricao:'barricada-2x: a muralha de tralha, 2 fileiras de 5 quadrados 2×2 (inteiros atrás, avariados na frente)'},
  'muralha-juntas':{...chaveiro('moto=entrega','&obra=1&muralha=2'),descricao:'barricada-2x: L, T e um quadrado sozinho (meias peças + pilar)'},
  'obra-livre-recusa':{...chaveiro('moto=entrega','&obra=1&fantasma=carro'),descricao:'D-052 placeholder: fantasma vermelho em cima do carro'},
  'ninhos':{sandbox:'cidade',query:'mapa=real&tele=1&ninhos=1&hero=120,140',descricao:'D-051: ninho dormindo (bando dormindo), ativo (bando acordando) e destruído'},
  'corda-livre':{...chaveiro('moto=entrega','&obra=1&corda=livre'),descricao:'puxar-uno-corda: a corda caída no chão na frente do Uno, o laço na ponta'},
  'corda-empurrando':{...chaveiro('moto=entrega','&empurrando=-40&t=1000'),descricao:'puxar-uno-corda: empurrando o Uno, a corda caída na frente'},
  'carro-andando':{...chaveiro('moto=entrega','&obra=1&anda=-40&t=1000'),descricao:'D-052: o carro puxado na corda, virado para o movimento, rodas girando'},
  'acucar':{sandbox:'cidade',query:'mapa=real&tele=1&acucar=1',descricao:'bichos açucarados (brilho rosa)'},
  'cidade-regua':{sandbox:'cidade',query:'mapa=real&regua=1&hero=156,74',descricao:'cidade com a régua em alturas de herói, ao lado de uma casa'},
  'cidade-postes':{sandbox:'cidade',query:'mapa=real&regua=1&hero=112,182',descricao:'cidade com a régua ao lado do poste e das casas'},
  'sombra':{sandbox:'cidade',query:'mapa=real&tele=1&elenco=rato-de-boteco,furry-de-convencao,pombos,cachorro-de-madame,bebado,tio-pave&hero=95,100',descricao:'sombras: o rato e o cachorro (enxame que anda), o lobo (furry), um pombo e dois de chão em volta do herói'},
  'luta':{sandbox:'cidade',query:'mapa=real&tele=1&elenco=1&ferido=1&hero=95,100',descricao:'luta: todo o elenco ferido (barras de vida), itens no chão, telegraphs'},
  'cidade-praca':{sandbox:'cidade',query:'mapa=real&hero=95,100',descricao:'a praça e o chafariz'},
  'bancos':{sandbox:'cidade',query:'mapa=real&bancos=1&hero=156,74',descricao:'bancos: um pagando (nota no ar), um roubado por Cliente Prime, um SEM CÉDULAS'},
  'veiculos':{sandbox:'cidade',query:'mapa=real&tele=1&veiculos=1&hero=95,100',descricao:'veículos: patinete, carrinho e crossfiteiro estacionados; o herói no carrinho (chip com 60 % da corrida)'},
  'bicos-trabalhar':{sandbox:'cidade',query:'mapa=real&bancos=1&bicos=1&turno=0&acao=1&hero=156,74',descricao:'bicos (etapa 4): o herói no anel da loja aberta, o botão Atacar vira Trabalhar na cor de interação'},
  'bicos-turno':{sandbox:'cidade',query:'mapa=real&bancos=1&bicos=1&turno=1&acao=1&hero=156,74',descricao:'bicos (etapa 4): o herói no turno (sumiu na porta acesa), "Você no turno" na placa, o botão No turno'},
  'bancos-aberto':{sandbox:'cidade',query:'mapa=real&bancos=1&banco=aberto&hero=156,74',descricao:'bancos: os três cheios, ninguém no caixa'},
  'arsenal':{sandbox:'cidade',query:'mapa=real&tele=1&arsenal=1&hero=112,182',descricao:'D-051: caixas por raridade (uma abrindo, uma estourando), itens no chão, arma na mão e o tiro (arma=pistola|escopeta|…; padrão: as 7 em ciclo)'},
  'ataque-mira':{sandbox:'cidade',query:'mapa=real&hero=95,100&n=8&parado=1&acao=1&arrasto=-40,-50',descricao:'ataque manual (D-051): arrasto do botão Atacar, linha amarela e retícula'},
  'ataque-auto':{sandbox:'cidade',query:'mapa=real&hero=95,100&n=8&parado=1&acao=1&segura=1',descricao:'ataque manual (D-051): Atacar segurado, retícula na mira automática'},
  'hud-topo':{sandbox:'hud',query:'state=wave&frozen=1',descricao:'HUD em onda (topo, time, controles)'},
  'arsenal-retrato':{sandbox:'hud',query:'state=wave&frozen=1&players=4&arsenal=1',descricao:'D-051: a arma na mão de cada um no retrato do time'},
  'oferta':{sandbox:'hud',query:'state=offer-open&frozen=1',descricao:'oferta aberta'},
  'aura':{sandbox:'cidade',query:'mapa=real&tele=1&arsenal=1&arma=pistola&aura=3&hero=112,182',descricao:'upgrades-megabonk: a fumaça pintada do Defumador (aura de dano, nível 3) no herói e, mais fraca, no aliado'},
  'oferta-tomos':{sandbox:'hud',query:'state=offer-tomos&frozen=1',descricao:'upgrades-megabonk: os tomos na tela de nível (+1 projétil, aura, estilingue, dano)'},
  'forja':{sandbox:'hud',query:'state=camp-forge&frozen=1',descricao:'forja no intervalo'},
  'carro-puxar':{sandbox:'hud',query:'state=wave&frozen=1&mapa=cidade&heroi=1&carro=perto',descricao:'D-052 HUD: Puxar perto do carro e Construir com o contador de muros'},
  'carro-soltar':{sandbox:'hud',query:'state=wave&frozen=1&mapa=cidade&heroi=1&carro=corda',descricao:'D-052 HUD: Soltar (na corda)'},
  'carro-obra':{sandbox:'hud',query:'state=wave&frozen=1&mapa=cidade&heroi=1&carro=obra-muro',descricao:'D-052 HUD: a bandeja de Construir aberta (Muro escolhido)'},
  'perfil-inimigo':{sandbox:'hud',query:'state=wave&frozen=1&perfis=1',descricao:'nome-inimigo-rede-social: o perfil de app de namoro do inimigo novo (Tio do Pavê)'},
  'perfis-leque':{sandbox:'hud',query:'state=wave&frozen=1&perfis=3',descricao:'nome-inimigo-rede-social: 3 inimigos novos seguidos, os perfis em leque'},
  'resultado':{sandbox:'hud',query:'state=result&frozen=1',descricao:'tela de resultado'},
  // D-050: the team's level-up pause (4 players): the combat offer open with the title and the bar above it.
  'pausa-escolhendo':{sandbox:'hud',query:'pausa=escolhendo&frozen=1&heroi=1',descricao:'pausa do level-up: oferta aberta, 10 s, esperando você, Tia e Bruninha'},
  'pausa-esperando':{sandbox:'hud',query:'pausa=esperando&frozen=1&heroi=1',descricao:'pausa do level-up: você já escolheu, esperando 2'},
  'pausa-ultimo':{sandbox:'hud',query:'pausa=ultimo&frozen=1&heroi=1',descricao:'pausa do level-up: os 3 s finais, "Falta você!"'},
  'inventario':{sandbox:'hud',query:'state=wave&frozen=1&inv=meio',descricao:'D-051: inventário com 3 itens (arma na mão, coxinha ×2)'},
  'kit-hud':{sandbox:'hud',query:'state=wave&frozen=1&inv=kit&kit=1',descricao:'torre-pela-caixa: o kit Morteiro (roxa) e o de muro ×6 nos slots, a barra "pôr torre" aberta'},
  'kit-obra':{sandbox:'cidade',query:'mapa=real&torres=1&kit=morteiro',descricao:'torre-pela-caixa: o Morteiro do kit em obra e o fantasma verde do próximo'},
  'kit-barricada':{sandbox:'cidade',query:'mapa=real&torres=1&kit=barricada',descricao:'barricada-tocar-no-mapa: o fantasma da barricada = a própria arte (amarelo) sobre a pegada 2×1'},
  'kit-barricada-giro':{sandbox:'cidade',query:'mapa=real&torres=1&kit=barricada&giro=1',descricao:'barricada-tocar-no-mapa: o mesmo fantasma girado (arrastou no outro eixo)'},
  'kit-recusa':{sandbox:'cidade',query:'mapa=real&torres=1&kit=morteiro&fantasma=ocupado',descricao:'torre-pela-caixa: o fantasma vermelho em cima da obra'},
  'inventario-cheio':{sandbox:'hud',query:'state=wave&frozen=1&inv=cheio',descricao:'D-051: 6 slots cheios e o botão Trocar'},
  // D-051 (ninhos-rounds-fora): the nests mode's top, in a fight and in a calm (no "Onda N", no "Intervalo").
  'ninhos-hud':{sandbox:'hud',query:'mapa=cidade&chaveiro=1&ninhos=1&state=wave&frozen=1',descricao:'D-051 modo ninhos: moto m:ss e ninhos vivos/8 no topo, sem Onda N'},
  'ninhos-hud-calmo':{sandbox:'hud',query:'mapa=cidade&chaveiro=1&ninhos=1&state=prepare&frozen=1',descricao:'D-051 modo ninhos na calmaria: sem Intervalo nem contagem'},
  'minimapa':{sandbox:'hud',query:'mapa=cidade&chaveiro=1&state=prepare&frozen=1',descricao:'HUD da cidade: minimapa WC3, setas, chaveiro'},
  'bancos-hud':{sandbox:'hud',query:'mapa=cidade&chaveiro=1&bancos=1&state=wave&frozen=1',descricao:'HUD da cidade com bancos: seta do roubado (Cone), "$" no minimapa, "Bicho sacando no …!"'},
  'obra':{sandbox:'obra',query:'cena=arvore',descricao:'menu de obra com a árvore aberta'},
  'config-jogo':{sandbox:'config',query:'cena=jogo',descricao:'engrenagem do jogo: Música, Efeitos e vibração'},
  'config-menu':{sandbox:'config',query:'cena=menu',descricao:'engrenagem do menu: Música, Efeitos e vibração'},
  'menu-sala':{sandbox:'config',query:'cena=sala',descricao:'engrenagem numa sala: Continuar, Configurações, Copiar convite, Sair'},
  'menu-sair':{sandbox:'config',query:'cena=sala&vista=sair',descricao:'engrenagem numa sala: "Seus amigos vão ficar com um a menos, certeza?"'},
  'elenco-roster':{sandbox:'elenco',query:'pagina=1',descricao:'folha de contato do elenco com arte (herói + S, SE, E; ids=, novos=1, pagina=N)'},
});

/**
 * The scene's page query: the sandbox, its parameters, `foto=<cena>`, then the caller's extras (they win). The HUD
 * sandbox prints without its row of state buttons (`clean=1`): it covered the phone's team fan and the offer.
 */
export function fotoSearch(cena:string,search:string):string|undefined{
  const scene=FOTO_CENAS[cena];if(!scene)return undefined;
  const out=new URLSearchParams(`sandbox=${scene.sandbox}&${scene.query}`);
  if(scene.sandbox==='hud')out.set('clean','1');
  out.set('foto',cena);
  for(const [k,v] of new URLSearchParams(search))if(k!=='foto'&&k!=='sandbox')out.set(k,v);
  return `?${out.toString()}`;
}

/** The fixed clock of a scene (ms): `t` from the page, else 2000. */
export const fotoClock=(search:string)=>{const t=Number(new URLSearchParams(search).get('t'));return Number.isFinite(t)&&t>=0&&new URLSearchParams(search).has('t')?t:2000;};

type FotoWindow={__fotoPronta?:boolean;__fotoErro?:string;__cidade?:{freeze?:()=>void;ground?:()=>boolean}};
const frames=(n:number)=>new Promise<void>(r=>{const step=(k:number)=>k<=0?r():requestAnimationFrame(()=>step(k-1));step(n);});
const until=async(test:()=>boolean,ms:number)=>{for(const end=performance.now()+ms;performance.now()<end;){if(test())return true;await frames(1);}return false;};

/**
 * An entrance lasts up to this (ms, delay included): the result's cards ≤ 0.95 s, the defeat's title droop 1.4 s, an
 * arrow's bump 0.44 s; the minimap's ping (1.6 s) and the round's banner (1.8 s) are lives, not entrances.
 */
const ENTRANCE_MS=1500;
/**
 * Waits for the entrances running now to finish, up to `ms`. Longer finite animations are a thing's whole life and end
 * invisible (the round's banner 1.8 s, the confetti, the minimap's ping): they are left where they are, like the loops.
 */
async function settleAnimations(ms:number){
  const running=document.getAnimations().filter(a=>a.playState==='running'&&(a.effect?.getComputedTiming().endTime as number??Infinity)<=ENTRANCE_MS);
  if(!running.length)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  await Promise.race([Promise.all(running.map(a=>a.finished.catch(()=>undefined))),new Promise(r=>{timer=setTimeout(r,ms);})]);
  clearTimeout(timer);
  await frames(2);
}

/**
 * `?foto=<cena>`: rewrites the address to the scene's sandbox query (the sandboxes read location.search when they load),
 * loads it, waits for the scene to be drawn and sets window.__fotoPronta (or __fotoErro with the reason).
 */
export async function abrirFoto(){
  const w=window as unknown as FotoWindow;
  const cena=new URLSearchParams(location.search).get('foto')??'',search=fotoSearch(cena,location.search);
  if(!search){w.__fotoErro=`cena desconhecida: ${cena} (conhecidas: ${Object.keys(FOTO_CENAS).join(', ')})`;return;}
  history.replaceState(null,'',`${location.pathname}${search}`);
  const scene=FOTO_CENAS[cena];
  try{
    if(scene.sandbox==='cidade')await import('../sandboxes/sandbox-cidade.ts');
    else if(scene.sandbox==='hud')await import('../sandboxes/sandbox-hud.ts');
    else if(scene.sandbox==='config')await import('../sandboxes/sandbox-config.ts');
    else if(scene.sandbox==='elenco')await import('../sandboxes/sandbox-elenco.ts');
    else await import('../sandboxes/sandbox-obra.ts');
    // Drawn: the city sandbox publishes __cidade on its first placement; the HUD sandbox marks body[data-hud-ready]
    // (and body[data-cidade] for the city's HUD). The HUD and the obra also wait for the art index: the HUD draws its
    // scene again when it lands (icons, faces), so a print before it would miss them now and then.
    const body=document.body.dataset;
    // The city also waits for its ground albedo (or its failure): the chunks bake again when it lands.
    const drawn=scene.sandbox==='cidade'?()=>!!w.__cidade&&w.__cidade.ground?.()!==false
      :scene.sandbox==='hud'?()=>body.hudReady==='1'&&(!scene.query.includes('mapa=cidade')||body.cidade==='1')
      :scene.sandbox==='config'?()=>body.configReady==='1':scene.sandbox==='elenco'?()=>body.elencoReady==='1':()=>true;
    if(!await until(drawn,30000)){w.__fotoErro='a cena não desenhou em 30 s';return;}
    if(w.__fotoErro)return;
    if(scene.sandbox!=='cidade')await (await import('../ui/art-boot.ts')).artReady();
    await document.fonts?.ready;
    // The city: its chunks bake and the cover fade settles over a few frames; the HUD needs one layout pass.
    await frames(scene.sandbox==='cidade'?20:4);
    // Entrances (the result's cards, an arrow's bump) end before the print.
    await settleAnimations(3000);
    w.__cidade?.freeze?.();
    w.__fotoPronta=true;
  }catch(e){w.__fotoErro=String(e);}
}
