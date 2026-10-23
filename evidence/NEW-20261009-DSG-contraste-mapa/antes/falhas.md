# Antes · contraste do HUD sobre o mapa (f0b1c8d, Prints run 39934472872)

Medição de `scripts/folha-contraste.mjs` na folha do CI: 1280×720, 390×844, celular-390×844 e celular-844×390, parado (neve e rua) e depois da rajada (horda). Números completos em `contraste.json`.

Falhas (corpo e contorno < 3:1 em algum dos 8 pontos do mapa):

| peça | corpo / contorno | pior | onde |
|---|---|---|---|
| nível | Lilás / Breu (aro Papel no meio, não medido) | 1,6:1 | rua escura, horda |
| retrato (você) | Lilás / Breu (aro Papel no meio, não medido) | 1,5:1 | rua escura, horda |
| retrato (aliado) | Papel / emblema (ciano, rosa, verde; aro Breu no meio, não medido) | 1,1:1 | neve |
| minimapa | ficha Breu / Breu (borda Papel no meio, não medida) | 1,4:1 | rua escura |
| relógio (celular) | transparente / nenhum; texto "Chaveiro chega em…" Papel | — | neve |

Leitura: as quatro primeiras já têm a borda dupla (um aro claro e um Breu), mas a medição só via corpo e aro de fora. O relógio fica dentro da barra do acampamento (não sobre o mapa), e o texto medido é o `.rh-sr`, que só é lido em voz alta. Os textos passam: o pior está em 6,2:1 (nível). Nenhum `box-shadow` com blur (lint-design 0).

Fora da medição: o "texto secundário claro" em `opacity` .8/.9 (contador do centro de ofertas, "Assistindo" do espectador, aviso do menu).
