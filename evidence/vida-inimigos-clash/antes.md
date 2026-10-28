# Vida dos inimigos hoje — golpes para matar (antes)

Card NEW-20261024-ORQ-vida-inimigos-estilo-clash, etapa 1. Gerado por `node --experimental-strip-types scripts/bench-golpes.ts`
(tabela pura, sem partida: vida = hp do catálogo × linha da rodada × playerScale(n).hp × NEST_PACE.hp, arredondada como
createEnemy; golpes = ceil(vida / dano da arma), might 1). JSON completo: `golpes-antes.json`.

Armas (dano por golpe já com ARSENAL_DAMAGE ×2 e raridade): faca verde 24 (a inicial, de todos) · pistola verde 30 ·
submetralhadora azul 13,8 · escopeta azul 64,4 · rifle roxo 93,6.

Fases do modo ninhos (o jogo de verdade): `inicio` = 0–3 min (linha 1, ×1,3); `ninhos-3` ≈ 2 min de ninhos (×1,5, igual
aos dorminhocos); `ninhos-5` ≈ 4 min (×1,6); `ninhos-9` ≈ 7 min (×2,35).

## Resumo

- **Com a faca inicial, solo, no começo: pombos/enxame, voador e motoboy/kamikaze morrem com 1 golpe**; corredor (bêbado),
  atirador com 2. É o que o usuário viu.
- **Com a pistola verde (a 1ª arma de caixa), corredor e kamikaze também morrem com 1 tiro** até ~4 min.
- Enxame morre com 1 golpe de qualquer arma a partir da verde, a partida inteira (8–14 de vida).
- Os grandes já estão no "estilo Clash": palhaço/brutamontes 6–11 golpes, mini-chefe 7–12.
- 3 e 6 jogadores: vida ×1,3 e ×1,75; o enxame continua em 1 golpe.

### 1 jogador(es) — golpes para matar (vida mediana do papel)

| papel | inicio hp · faca/pistola/smg/escopeta/rifle | ninhos-3 hp · faca/pistola/smg/escopeta/rifle | ninhos-5 hp · faca/pistola/smg/escopeta/rifle | ninhos-9 hp · faca/pistola/smg/escopeta/rifle |
|---|---|---|---|---|
| corredor | 26 · 2/1/2/1/1 | 30 · 2/1/3/1/1 | 32 · 2/2/3/1/1 | 47 · 2/2/4/1/1 |
| brutamontes | 143 · 6/5/11/3/2 | 165 · 7/6/12/3/2 | 176 · 8/6/13/3/2 | 259 · 11/9/19/5/3 |
| arremessador | 52 · 3/2/4/1/1 | 60 · 3/2/5/1/1 | 64 · 3/3/5/1/1 | 94 · 4/4/7/2/2 |
| atirador | 39 · 2/2/3/1/1 | 45 · 2/2/4/1/1 | 48 · 2/2/4/1/1 | 71 · 3/3/6/2/1 |
| suporte | 52 · 3/2/4/1/1 | 60 · 3/2/5/1/1 | 64 · 3/3/5/1/1 | 94 · 4/4/7/2/2 |
| palhaco | 130 · 6/5/10/3/2 | 150 · 7/5/11/3/2 | 160 · 7/6/12/3/2 | 235 · 10/8/18/4/3 |
| kamikaze | 23 · 1/1/2/1/1 | 27 · 2/1/2/1/1 | 29 · 2/1/3/1/1 | 42 · 2/2/4/1/1 |
| enxame | 8 · 1/1/1/1/1 | 9 · 1/1/1/1/1 | 10 · 1/1/1/1/1 | 14 · 1/1/2/1/1 |
| voador | 20 · 1/1/2/1/1 | 23 · 1/1/2/1/1 | 24 · 1/1/2/1/1 | 35 · 2/2/3/1/1 |
| refletor | 104 · 5/4/8/2/2 | 120 · 5/4/9/2/2 | 128 · 6/5/10/2/2 | 188 · 8/7/14/3/3 |
| invocador | 73 · 4/3/6/2/1 | 84 · 4/3/7/2/1 | 90 · 4/3/7/2/1 | 132 · 6/5/10/3/2 |
| mini-chefe | 156 · 7/6/12/3/2 | 180 · 8/6/14/3/2 | 192 · 8/7/14/3/3 | 282 · 12/10/21/5/4 |

### 3 jogador(es) — golpes para matar (vida mediana do papel)

| papel | inicio hp · faca/pistola/smg/escopeta/rifle | ninhos-3 hp · faca/pistola/smg/escopeta/rifle | ninhos-5 hp · faca/pistola/smg/escopeta/rifle | ninhos-9 hp · faca/pistola/smg/escopeta/rifle |
|---|---|---|---|---|
| corredor | 34 · 2/2/3/1/1 | 39 · 2/2/3/1/1 | 42 · 2/2/4/1/1 | 61 · 3/3/5/1/1 |
| brutamontes | 186 · 8/7/14/3/2 | 215 · 9/8/16/4/3 | 229 · 10/8/17/4/3 | 336 · 14/12/25/6/4 |
| arremessador | 68 · 3/3/5/2/1 | 78 · 4/3/6/2/1 | 83 · 4/3/7/2/1 | 122 · 6/5/9/2/2 |
| atirador | 51 · 3/2/4/1/1 | 59 · 3/2/5/1/1 | 62 · 3/3/5/1/1 | 92 · 4/4/7/2/1 |
| suporte | 68 · 3/3/5/2/1 | 78 · 4/3/6/2/1 | 83 · 4/3/7/2/1 | 122 · 6/5/9/2/2 |
| palhaco | 169 · 8/6/13/3/2 | 195 · 9/7/15/4/3 | 208 · 9/7/16/4/3 | 306 · 13/11/23/5/4 |
| kamikaze | 30 · 2/1/3/1/1 | 35 · 2/2/3/1/1 | 37 · 2/2/3/1/1 | 55 · 3/2/4/1/1 |
| enxame | 10 · 1/1/1/1/1 | 12 · 1/1/1/1/1 | 12 · 1/1/1/1/1 | 18 · 1/1/2/1/1 |
| voador | 25 · 2/1/2/1/1 | 29 · 2/1/3/1/1 | 31 · 2/2/3/1/1 | 46 · 2/2/4/1/1 |
| refletor | 135 · 6/5/10/3/2 | 156 · 7/6/12/3/2 | 166 · 7/6/13/3/2 | 244 · 11/9/18/4/3 |
| invocador | 95 · 4/4/7/2/2 | 109 · 5/4/8/2/2 | 116 · 5/4/9/2/2 | 171 · 8/6/13/3/2 |
| mini-chefe | 203 · 9/7/15/4/3 | 234 · 10/8/17/4/3 | 250 · 11/9/19/4/3 | 367 · 16/13/27/6/4 |

### 6 jogador(es) — golpes para matar (vida mediana do papel)

| papel | inicio hp · faca/pistola/smg/escopeta/rifle | ninhos-3 hp · faca/pistola/smg/escopeta/rifle | ninhos-5 hp · faca/pistola/smg/escopeta/rifle | ninhos-9 hp · faca/pistola/smg/escopeta/rifle |
|---|---|---|---|---|
| corredor | 46 · 2/2/4/1/1 | 53 · 3/2/4/1/1 | 56 · 3/2/5/1/1 | 82 · 4/3/6/2/1 |
| brutamontes | 250 · 11/9/19/4/3 | 289 · 13/10/21/5/4 | 308 · 13/11/23/5/4 | 452 · 19/16/33/8/5 |
| arremessador | 91 · 4/4/7/2/1 | 105 · 5/4/8/2/2 | 112 · 5/4/9/2/2 | 165 · 7/6/12/3/2 |
| atirador | 68 · 3/3/5/2/1 | 79 · 4/3/6/2/1 | 84 · 4/3/7/2/1 | 123 · 6/5/9/2/2 |
| suporte | 91 · 4/4/7/2/1 | 105 · 5/4/8/2/2 | 112 · 5/4/9/2/2 | 165 · 7/6/12/3/2 |
| palhaco | 228 · 10/8/17/4/3 | 263 · 11/9/20/5/3 | 280 · 12/10/21/5/3 | 411 · 18/14/30/7/5 |
| kamikaze | 41 · 2/2/3/1/1 | 47 · 2/2/4/1/1 | 50 · 3/2/4/1/1 | 74 · 4/3/6/2/1 |
| enxame | 14 · 1/1/2/1/1 | 16 · 1/1/2/1/1 | 17 · 1/1/2/1/1 | 25 · 2/1/2/1/1 |
| voador | 34 · 2/2/3/1/1 | 39 · 2/2/3/1/1 | 42 · 2/2/4/1/1 | 62 · 3/3/5/1/1 |
| refletor | 182 · 8/7/14/3/2 | 210 · 9/7/16/4/3 | 224 · 10/8/17/4/3 | 329 · 14/11/24/6/4 |
| invocador | 127 · 6/5/10/2/2 | 147 · 7/5/11/3/2 | 157 · 7/6/12/3/2 | 230 · 10/8/17/4/3 |
| mini-chefe | 273 · 12/10/20/5/3 | 315 · 14/11/23/5/4 | 336 · 14/12/25/6/4 | 494 · 21/17/36/8/6 |
