# Bench antes × depois — inimigos-variedade (F pisão do brutamontes, H feel por clone)

`scripts/bench-city-run.ts`, players 1,3,6. "antes" = os 4 arquivos de origin/main 74300671 e sem `enemy-feel.ts`; "depois" = b82fa06f.

- `*-1.json`: modo padrão, seeds 1–4.
- `*-2.json`: `--objective chaveiro --mode ninhos`, seeds 1–4.
- `*-3.json`: `--objective chaveiro --mode ninhos`, seeds 5–12.

## Modo padrão (seeds 1–4)

| jogadores | vitórias antes | vitórias depois | min médios antes | min médios depois |
|---|---|---|---|---|
| 1 | 1/4 | 1/4 | 12.03 | 13.40 |
| 3 | 4/4 | 4/4 | 15.77 | 16.76 |
| 6 | 1/4 | 2/4 | 10.42 | 12.68 |

6p: antes morre nas rodadas 4, 5 e 7; depois, nas 4 e 6.

## Chaveiro + ninhos (seeds 1–12)

| jogadores | vitórias antes | vitórias depois | min médios antes | min médios depois |
|---|---|---|---|---|
| 1 | 1/12 | 0/12 | 6.35 | 5.95 |
| 3 | 2/12 | 2/12 | 7.69 | 6.71 |
| 6 | 0/12 | 0/12 | 4.72 | 4.48 |

ms/tick em 6p (seeds 1–4): 0.70 → 0.94.

## Leitura

- No modo padrão, as partidas duram um pouco mais e o 6p ganha uma a mais.
- No chaveiro + ninhos, quase toda partida acaba na rodada 1 dos dois lados. A diferença de vitórias (1 → 0 em 1p) é ruído.
- As partidas de ninhos terminam de 0.2 a 1 min mais cedo depois da mudança. O pisão (F) e os clones mais rápidos chegam antes no carro. É um sinal fraco: não muda nenhuma vitória e fica dentro da variação entre seeds.
- O balanço que segura o nível de ameaça (speed × hp ≈ 1 por clone) se mantém no geral. Não vi motivo para mexer nos números neste card.
