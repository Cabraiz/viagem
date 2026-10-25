# projetil-mais-rapido (NEW-20261025-ORQ-projetil-mais-rapido)

Usuário (25/10): "a velocidade do projétil deve [ser] 50% mais rápido no início".

## O que mudou

`HERO_SHOT_SLOWDOWN` 3 → 2 (`src/rules/budget.ts`). Todas as armas do herói que atiram projétil (pistola, rifle, Boleto, Pombo,
Carnê, sandálias da evolução, torre) passam a voar a 1,5× desde o início. Exemplo: a pistola vai de 1,67 para 2,5 u/s. O tiro
vive 2/3 do tempo, então o **alcance é o mesmo**. O Estilingue continua multiplicando por cima, então o teto também sobe 1,5×.
O tiro do agiota e o tiro refletido não mudam (`PROJECTILE_SPEED_MULT`).

## Bench de produção (chaveiro + combate manual + ninhos, 1/3/6 × 16)

Mesma árvore, só a constante trocada (`bench-antes-prod.json` com 3, `bench-depois-prod.json` com 2):

| time | antes | depois | alvo |
|---|---|---|---|
| 1p | 1/16 (7,55 min) | 1/16 (7,79 min) | 2–6: já estava abaixo |
| 3p | 11/16 (9,26 min) | 10/16 (9,09 min) | — |
| 6p | 13/16 (18,55 min) | 13/16 (20,55 min) | 7–11: já estava acima |

A mudança não move o solo nem o 6p em relação ao alvo: os dois já estavam fora dele antes.

## GIF

`gif/antes-depois-celular.gif`: partida de verdade no celular 412×915 (build dev estático + Worker local, swiftshader), pistola,
4 toques no Atacar. Ofertas puladas para nenhum Estilingue entrar. Roteiro em `gif-projetil.mjs`.
