# Inventário: efeitos de ataque desenhados por código (etapa 1)

Card NEW-20261028-ORQ-efeitos-ataque-chatgpt. Prints a 390x844 retrato em `antes/`.
Pranchas: `antes/prancha-avisos.png` (um aviso por tipo) e `antes/prancha-ataques.png` (armas, luta).
Cena nova de foto: `telegraphs-tipos` (`tele=1&tipos=1`, ou `tipos=<kind>` para um só).

"Arte hoje" diz se já existe PNG (o código só é fallback) ou se é 100 % código.
Tamanhos em u (1 u = 1 tile do sim) vêm das formas do sim; px = pixels CSS no retrato.

## Família A: zonas de aviso de chefe/inimigo (telegraphs)

| # | Efeito | Arquivo:linha | Quem usa | Forma | Cor | Animação | Tamanho | Arte hoje | Print |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Preenchimento listrado | layers.ts:1170 (drawTelegraph), telegraph-art.ts | todos os avisos | círculo/cone/faixa (Rope) | laranja/vermelho hachurado | enche até fireTick | raio 0,6–4 u | PNG `telegraph-enchimento` (vetorial, não ChatGPT) | todos |
| A2 | Borda da zona | telegraph-edge.ts:52, 71 (drawCity), 89 (drawCityRim) | todos | contorno | Breu + Papel; tracejado na cidade | tracejado anda | = zona | PNG `telegraph-borda` + traço código | todos |
| A3 | "!" de alerta | telegraph-alert.ts:34 (planAlert) | todos | glifo | Breu/Papel | pisca perto do fireTick | ~0,5 u | **só código** | todos |
| A4 | Arroto (gás) | telegraph-look.ts:200 (gas) | Bêbado do Boteco | cone | verde | bolhas, redemoinho | 2,4 u | PNG `arroto` + bolhas código | arroto |
| A5 | Molotov | telegraph-look.ts:238 (bottle) | molotov | círculo + garrafa caindo | laranja, mira | garrafa cai, pano em chama | 1,1 u | **só código** | molotov |
| A6 | Fogo no chão | telegraph-look.ts:286 (flames) | fogo | círculo + chamas | vermelho/amarelo | chamas tremem | 1 u | **só código** (existe `fogo-chao`, não usado aqui) | fogo |
| A7 | Coco | telegraph-look.ts:316 (splat) | coco | círculo + respingo | marrom | cocô cai, gotas | 0,6 u | **só código** | coco |
| A8 | Explosão | telegraph-look.ts:348 (burst) | explosao | círculo + estrela | laranja | pulsa | 1,2 u | PNG `aviso-explosao` + estrela código | explosao |
| A9 | Carimbo | telegraph-look.ts:364 (stamp) | chefe burocrata | círculo + carimbo | tinta vermelha | carimbo desce | 1,3 u | **só código** (`carimbo-chefe` existe) | carimbo |
| A10 | Investida | telegraph-look.ts:384 (dash) | investida | faixa + setas | laranja | setas correm | 4 × 1 u | PNG `seta-investida` + chevrons código | investida |
| A11 | Pancada / varredura | TELEGRAPH_LOOKS (plain) | pancada, varredura | círculo / cone | só A1+A2+A3 | — | 1,2 / 2,4 u | só A1/A2 | pancada, varredura |

## Família B: anéis no chão

| # | Efeito | Arquivo:linha | Quem usa | Forma | Cor | Animação | Tamanho | Arte hoje | Print |
|---|---|---|---|---|---|---|---|---|---|
| B1 | Anel do alvo | layers.ts:1069 (drawRing) | inimigo mirado | anel | amarelo | gira | ~corpo | PNG `anel-alvo` (código = fallback) | luta |
| B2 | Anel da habilidade | scene.ts:1580 | skill do herói | anel | 0xffde88 | some em 10 quadros | raio da skill | PNG `anel-habilidade` (fallback) | — |
| B3 | Aviso de spawn | layers.ts:1321 | spawn | anel | vermelho | pulsa | ~1 u | PNG `aviso-spawn` (fallback) | — |
| B4 | Anéis de fase do inimigo | layers.ts:954 (drawPhase) | coach (ouro), ciano, açucarado (rosa) | anel sob o pé | ouro/ciano/rosa | pulsa | ~corpo | **só código** | — |
| B5 | Coroa / estrela do Cliente Prime | layers.ts:1000, 1013 | Cliente Prime | ícone | dourado | flutua | ~0,4 u | **só código** | — |

## Família C: golpes corpo a corpo

| # | Efeito | Arquivo:linha | Quem usa | Forma | Cor | Animação | Tamanho | Arte hoje | Print |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Cone de mira melee | melee-cone.ts:135–203 | facas, armas de cone | cone + aro, runas, cachos | ciano | abre e some (coneAlpha) | alcance da arma | **só código** | faca |
| C2 | Arco do corte da faca | arsenal-fx.ts:507 (drawSlash) | faca (FIRE_LOOKS kind 'slash') | arco | Breu/Papel | varre ~150 ms | ~1,5 u | **só código** | faca |

## Família D: tiros e impactos

| # | Efeito | Arquivo:linha | Quem usa | Forma | Cor | Animação | Tamanho | Arte hoje | Print |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Chumbo da escopeta | arsenal-fx.ts:442 | escopeta | cápsula (canvas) | amarelo | voa | ~0,15 u | **só código** | escopeta |
| D2 | Projéteis amigo/hostil/boleto | textures.ts:507 (drawFx) | tiros | bolinha | — | voa | ~0,2 u | PNGs `proj*` (fallback) | arsenal |
| D3 | Contorno dourado do tiro do jogador | layers.ts (glow.mark) | tiro do herói | contorno | ouro | — | — | **só código** | arsenal |
| D4 | Anel de abrir caixa / raridade | arsenal-fx.ts:515 (drawBurst), 271, 290 | caixa de item | anel | cor da raridade | expande | ~1 u | **só código** | — |

## Família E: morte / acerto

| # | Efeito | Arquivo:linha | Quem usa | Forma | Cor | Animação | Tamanho | Arte hoje | Print |
|---|---|---|---|---|---|---|---|---|---|
| E1 | Estrelas de abate | textures.ts:515 (FX.star), layers.ts:439 | inimigo morto | estrela 5 pontas | branca tingida | espalha e gira | 20 px | **só código** | luta |

## Família F: HUD (SVG de ataque)

| # | Efeito | Arquivo:linha | Quem usa | Forma | Cor | Animação | Tamanho | Arte hoje | Print |
|---|---|---|---|---|---|---|---|---|---|
| F1 | Seta de mira + aro + botão | hud/attack-button.ts:58–60 | botão de ataque (mira) | SVG círculo + seta | amarelo | segue o dedo | knob r=23 px | **só SVG** | mira (aparece só com o dedo) |

## Já é arte pintada (fica de fora)
aura-ring.ts (arruda/ventilador), clarões `clarao-*`, `explosao-m/p`, `fogos-estouro`, `impacto-*`, `fogo-pequeno`, `morte-*`, `poeira-*`.
Os PNGs de A1/A2/A8/A10/B1–B3 existem mas parecem vetoriais (Art v2, c0324d49). A proposta é regerar no ChatGPT também, para um estilo só.

## Proposta de geração (etapa 2)
- Lote 1 (zonas): enchimento 128² repetível, borda 128×16, "!", e decor de molotov, fogo, coco, carimbo, explosão, investida e arroto. São 10 PNGs.
- Lote 2 (anéis/golpes): anel alvo, habilidade, spawn, 3 anéis de fase, coroa, cone melee, arco da faca. São 9.
- Lote 3 (tiros/HUD): chumbo, projéteis ×3, anel de caixa, estrela de abate, seta de mira. São 7.
- Total ~26 PNGs, em 3 Codex paralelos (vaga --codex), fundo transparente, contorno Breu, vermelho de perigo fixo.
