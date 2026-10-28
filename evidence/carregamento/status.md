# NEW-20261028-ORQ-carregamento-config-menu · status
Fase: NA FILA (P1, vgm/carregamento-config-menu). PRÓXIMO PASSO: nenhum do E1; o ORQ integra no lote. Se o lote pedir conflito em render/arsenal-rules.ts, fica a versão do E3 e só o comentário de arsenalLoads.

Itens da auditoria-ui-menus-28-10: 5, 4, 9, 12, 13, 14, 15; mais o 14 da auditoria de jogabilidade (pedido do ORQ).

| Item | O que mudou | Arquivos |
|---|---|---|
| 5 | A pré-carga começa quando o popup abre (código, cidade, /multiplayer.json, P0 do herói). O cartão "Jogar sozinho" mostra a etapa real numa barra: Baixando o jogo… → a cidade… → Abrindo a sala… → Entrando…. Na contagem solo aparece "Começando…" em vez de "Ops, peraí". | lobby.ts, main.ts, solo-plan.ts, escolha.css |
| 4 | Em paisagem, as configurações ficam em duas colunas: à esquerda câmera, mapa e qualidade; à direita o som inteiro, com Vibrar, já na 1ª tela. | explore.css |
| 9 | Nome vazio: nada de balão nativo; aparece a dica própria no campo e o campo treme. | main.ts, style.css |
| 12 | Chips com 12 px; valor longo quebra em duas linhas. Os chips medem 88 u e a grade dá 18 u de volta, então o cartão segue numa tela só. | insta.css, insta.test.ts |
| 13 | ≡ e Privacidade com área de toque de 44 px (::after). | style.css |
| 14 | O popup em paisagem sobe (13dvh → 9dvh). O herói fica a 34 px do topo (antes 15) e "Trocar de personagem" sai de cima da lã. | escolha.css |
| 15 | No menu de pausa, "Partida solo" (ou "N jogadores na sala") no lugar de "Sala F0121F65F2". | hud/menu.ts, explore.ts |
| jogab. 14 | "Jogar sozinho" tenta a sala e a entrada mais uma vez, em silêncio, antes de mostrar o erro. Não tenta de novo quando a resposta do servidor é fatal. | solo-plan.ts, lobby.ts |
| extra caixa | O item flutuante das caixas chegava atrás da cidade: os stickers do arsenal só entravam na fila do Phaser na 1ª visão manual. Agora os 60 stickers (~750 KB) são P1 na sala de espera e a cena de sala manual os põe no preload, junto com a arte de perto. As faixas de tiro seguem tardias. | match-assets.ts, scene.ts, arsenal-rules.ts (comentário) |

## Medição do carregamento (4× CPU + 4G, 800 ms no popup)

Antes = produção; depois = esta branch, servida em HTTPS com a origem do site. Valores em segundos.

| Tela | Popup fecha, antes frio/quente | Popup fecha, depois frio/quente | Partida pronta, antes frio/quente | Partida pronta, depois frio/quente |
|---|---|---|---|---|
| retrato | 3,9 / 2,9 | 2,2 / 2,5 | 9,98 / 9,6 | 9,37 / 8,19 |
| paisagem | 3,0 / 2,8 | 2,0 / 2,5 | 8,5 / 9,3 | 7,5 / 9,2 |
| PC | 2,6 / 3,4 | 1,8 / 1,7 | 8,6 / 11,6 | 7,4 / 8,1 |

- Depois do toque, a produção baixa 212 recursos (4,7 MB) e a branch, 120 (1,8 MB): o resto já desceu com o popup aberto.
- Os 25 s e os > 3 min da auditoria não se repetiram.
- O que sobra até "pronta" é a contagem (~3 s) mais o boot da cena (3–5 s).

Prints e JSON: `antes-celular-*` e `depois-celular-*` nesta pasta.

## Extra da caixa: medição em t=0

Sonda `scripts/sonda-caixa-t0.mts` (4× CPU + 4G, 1280×720, `?perf=1`). Antes = produção; depois = build desta branch. t=0 é o 1º quadro com `__partidaPronta`.

| | Stickers do arsenal prontos em t=0 | Caixa mais perto, com a câmera nela desde antes da partida |
|---|---|---|
| antes | 0/60 (3 rodadas) | chão vazio em +0, +1 e +3 s; caixa e item só em +6 s |
| depois | 60/60 (3 rodadas) | caixa e item já no 1º quadro sem a capa |

- Em produção, nenhuma caixa nasce à vista do herói em t=0 (a mais perto fica a 11–14 u). A caixa a ≤ 3 u do spawn é do card comeca-armado (E6), que ainda não está na main.
- Por isso a sonda leva a câmera até a caixa. O salto às vezes mostra a capa "Arrumando a ilha" enquanto o chão daquela região assa. A capa vem do salto da câmera, não do sticker.
- O print limpo em t=0, com a caixa ao lado do herói, sai quando as duas branches estiverem juntas.

## Prints do build real (depois)

- `item4-config-paisagem-antes-depois.png`: Vibrar na 1ª tela, em duas colunas.
- `item9-nome-vazio-antes-depois.png`: a dica própria no lugar do balão nativo (`required` desligado).
- `item12-chips-depois-*.png`: chips com 12 px e nada cortado em 360, 390 e 412 px de largura.
- `item14-popup-paisagem-antes-depois.png`: herói a 34 px do topo; "Trocar de personagem" (326–356) fora da lã.
- `item15-menu-antes-depois.png`: "Partida solo" no lugar de "Sala F0121F65F2 / Conectado".
- `caixa-t0-antes-depois.png` e `caixa-t0-*.json`: o extra da caixa.
- Item 13: ≡ mede 29,75 px e ganha 7,1 px de cada lado (44 px); Privacidade mede 22,4 px de altura e ganha 10,8 px em cima e embaixo (44 px).
- `npm run test:changed`: 1269 passam, 0 falham.

## Graphify

Nos itens de menu não usei: o card já dizia os arquivos, e a pergunta era de CSS ou de fluxo em lobby.ts e main.ts, então grep bastou. No extra da caixa ajudou: `explain pickupLook` levou direto a render/arsenal-fx.ts (queueArt só na 1ª visão manual) e a arsenal-rules.ts (arsenalLoads), sem varrer o render inteiro.
