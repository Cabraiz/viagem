# pix-sem-acumular: bench 6p antes × depois

`node --experimental-strip-types scripts/bench-city-run.ts <cfg> --players 6 --seeds 1-4`. "antes" = multiplayer/room-bots.ts
de origin/main 74300671; "depois" = este branch. Arquivos: `{antes,depois}-{1,2,3}.json` (1 padrão, 2 `--objective chaveiro`,
3 `--objective chaveiro --mode ninhos`).

## Maior carteira / Grana do time, média nas amostras (a cada ECON_SAMPLE_S, só com Grana ≥ 30)

| config   | antes (s1 s2 s3 s4) | depois (s1 s2 s3 s4) | todas: antes → depois |
|----------|---------------------|----------------------|-----------------------|
| padrão   | 89 93 95 90 %       | 75 80 49 40 %        | **92 % → 51 %**       |
| chaveiro | 43 64 51 44 %       | 40 44 51 41 %        | **49 % → 43 %**       |

Divisão igual entre 6 seria 17 %. Ninhos: a conta do chaveiro leva toda a Grana, carteiras 0 no fim nos dois lados (sem diferença).

## Carteiras no fim e PIX

| config | seed | antes | depois |
|---|---|---|---|
| padrão | s3 | derrota, [295,3,0,0,0,0], PIX R$870 (ganho 971) | vitória, [73,9,11,8,8,8], PIX R$1178 (ganho 1357) |
| padrão | s4 | vitória, [87,10,12,9,11,9], PIX R$2343 (ganho 1709) | vitória, [149,17,61,25,29,117], PIX R$1169 (ganho 1595) |
| chaveiro | s2 | [0,0,0,0,120,0] | [60,0,55,15,20,40] |

O PIX acima do ganho (s4 antes: 2343 > 1709) caiu para menos que o ganho. Ainda passa do ganho em padrão s2 (613 > 523):
quando o banco cai, o próximo bot em pé vira o banco e recebe o que o anterior tinha acima da parte dele.

## Dona Cida

Compras só em chaveiro s4: brigadeiro 3, paçoca 2, cocada 2 (os 3 itens). Os bots não vão até a moto para comprar; só
compram quando passam perto dela numa onda. Mandar o bot até a moto seria outro card.

Vitórias (4 seeds, ruído): padrão 1 → 2, chaveiro 2 → 1, ninhos 0 → 0.
