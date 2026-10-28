# bots-resgatam (P0): 48 partidas headless, antes × depois

Mesmo script da auditoria (`evidence/auditoria-bots-sim-28-10/audit-bots.ts`, seeds 1–16, teto 30 min, ninhos + manual, sem NavDriver).
- **Antes:** `evidence/auditoria-bots-sim-28-10/runs-*.json` (bf766c45).
- **Depois:** `evidence/bots-resgatam-28-10/runs-*.json`, agregado por `analisa.mjs`, que é cópia do mesmo script.

| | 1p antes | 1p depois | 3p antes | 3p depois | 6p antes | 6p depois |
|---|---|---|---|---|---|---|
| vitórias (meta) | 4/16 (2–6) | **4/16** | 12/16 (7–11) | **15/16** | 10/16 (7–11) | **14/16** |
| eliminados com colega ≤ 6 u por ≥ 2 s | 0/0 | 0/0 | 0/0 | 0/0 | **11/12** | **0/1** |
| quedas (revividas / abertas / eliminadas) | 5 (0/5/0) | 4 (0/4/0) | 31 (19/12/0) | 26 (22/4/0) | 129 (99/18/12) | 114 (100/13/1) |
| parado fora dos legítimos, s/run | 26.6 | 18.4 | 143.2 | 109.4 | 343.3 | 226.6 |
|  · fight | 155 | 182 | 1526 | 669 | 3158 | 1792 |
|  · build | 86 | 112 | 509 | 711 | 1255 | 1354 |
|  · loot | 0 | 0 | 6 | 0 | 688 | 0 |
| longe do carro (> 25 u por > 60 s), s/run | 6.6 | **0** | 40.5 | **4.1** | 67.1 | **0** |
| preso (empurra e não sai), s/run | 0.1 | 0.2 | 0.9 | 0 | 2.0 | 0.3 |
| caixas ≤ 20 u do carro: abertas / tempo mediano | 105/132, 10 s | 96/134, 10 s | 122/194, 7 s | 237/302, 14 s | 310/387, 53.5 s | **379/387, 17 s** |
| caixas abertas no total | 220 | 96 | 242 | 242 | 656 | 408 |
| inimigo acordado parado ≥ 60 s, por run | 0.4 | 0.7 | 1.5 | 1.5 | 4.2 | 1.3 |

## Leitura
- **Item 1: a meta foi cumprida.**
  - No 6p, ninguém foi eliminado com um colega de pé a ≤ 6 u por mais de 3 s. Antes eram 11 de 12.
  - As eliminações no 6p caíram de 12 para 1, e essa uma não tinha colega por perto.
- **Itens 2 e 3:**
  - A luta parada na abertura do 3p sumiu: 1526 s → 669 s.
  - O tempo longe do carro foi a ~0.
  - Ainda sobra 1 caso no 1p: a seed 11 passa 118 s parada em fight a 4.5 u do carro, com o alvo atrás de uma estrutura.
- **Item 4:** no 6p, a caixa perto do carro abria em 53 s e agora abre em 17 s (mediana).
  - O total de caixas abertas caiu porque o runner não vai mais a 50–70 u do carro (a coleira de 20 u).
  - O total do 1p caiu de 220 para 96, sem mudar as vitórias.
- **Item 8, build: não melhorou (3p 509 → 711 s, 6p 1255 → 1354 s).**
  - Os piores episódios são build parado a 2.5–3 u do carro, com stick 0.
  - É o bot à beira da obra esperando a vez de construir (TOWER_EARLY), não um bot preso.
  - O analisa.mjs conta isso como não legítimo, mas o comentário dele diz que "a obra (build)" é legítima.
- **Balanço: passou do teto.**
  - 3p ficou em 15/16, 4 acima do teto de 11.
  - 6p ficou em 14/16, 3 acima do teto de 11.
  - 1p ficou em 4/16, dentro da meta.
  - Não mexi no balanço; isso fica com o ORQ.

## Balanço (ORQ, 28/10 16:59): só 3p e 6p, na tabela CROWD de `src/sim/ninhos/ninhos.ts`
Calibração headless, 16 seeds (`calib/`, flag `--crowd` do audit-bots.ts):

| CROWD (march / hp / damage) | 3p | 6p |
|---|---|---|
| hoje (3p 1/1/1; 6p 1.25/2/1.3) | 15/16 | 14/16 |
| 3p 1.05/1.25/1.1 | 16/16 | |
| 3p 1.08/1.5/1.15 | 14/16 | |
| 3p 1.15/2/1.3 | 12/16 | |
| 3p 1.25/2.5/1.45 | 11/16 | |
| 3p 1.3/3/1.6 | 7/16 | |
| 6p 1.3/2.5/1.45 | | 14/16 |
| 6p 1.33/2.75/1.5 | | 14/16 |
| 6p 1.35/3/1.6 | | 10/16 |
| **final: 3p 1.28/2.75/1.5, 4p e 5p entre eles, 6p 1.35/3/1.6** (`final/`) | **11/16** | **10/16** |

- 1p e 2p não mudaram. O 1p continua em 4/16, dentro da meta.
- **Resgate com a tabela final:**
  - **3p:** 0 eliminados com colega ≤ 6 u.
  - **6p:** 2 de 4 tiveram colega ≤ 6 u (antes do card eram 11 de 12). Os dois são da seed 4, onde o colega passou o tempo em rescue e dodge, ou seja, tentou socorrer debaixo de fogo.
  - Tempo até reviver, mediana: 3p 4.2 s, 6p 3.4 s.
- O 3p ficou exatamente no teto (11/16). O 6p dá 14/16 com hp ×2.75 e 10/16 com ×3, então o ruído entre seeds é grande.
