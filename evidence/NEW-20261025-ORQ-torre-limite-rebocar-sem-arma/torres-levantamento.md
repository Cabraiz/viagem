# Torres da caixa: tamanho e o que defendem (etapa 3)

Lido de origin/main 79854879: `src/rules/towers.ts` (regras), `public/art/manifest.json` grupo `torres` (arte) e
`src/client/render/towers/*` (escala). Prancha: `torres-escala-heroi.png`, cada torre "pronta" (vista 0) ao lado do
herói, na escala do jogo (arte × 0,5 px de mundo por px de arte, `towerArtScale` com célula 0,88 u; herói 96 × 0,8 = 77 px).
A linha vermelha é o limite proposto de 2,5× o herói. Prints dentro do jogo (caixa flutuando, fantasma, pronta) saem
na vaga pesada.

| Torre | Footprint | Altura vs herói | O que faz | Passa do limite? |
|---|---|---|---|---|
| T1 Vigia do Prédio | 2×2 | 3,6× | atira: 8 de dano, alcance 6, 1 por s | sim (prédio de 3 andares) |
| A2 Vigias Armados | 2×2 | 3,8× | atira 2×7, alcance 6,5 | sim (prédio) |
| A3 Atiradores do Telhado | 2×2 | 4,8× | atira 3×9, alcance 7 | sim (prédio) |
| A4 Ninho de Metralhadora | 3×3 | 3,6× | atira 4×9 a cada 0,5 s, alcance 7,5 | sim (prédio) |
| A5 Guarnição do Prédio | 3×3 | **7,5×** | atira 6×11 a cada 0,45 s, alcance 8,5 | sim (o prédio amarelo do print) |
| A4b Ninho do Sniper | 2×2 | 5,9× | 70 de dano no mais forte, alcance 13 | sim (prédio) |
| A5b Equipe Antimaterial | 2×2 | 3,6× | 200 de dano no mais forte, alcance 15 | sim (torre de concreto) |
| B2 Rojão de Festa | 1×1 | 0,5× | área 1,2 no chão, 14 de dano | não |
| B3 Morteiro | 2×2 | 0,8× | área 1,6, 30 de dano, alcance 2..9 | não |
| B4 Lança-Foguetes | 3×2 | 1,8× | 4 foguetes de 22, área 1,6 | não (é um caminhão) |
| B5 Obuseiro | 3×3 | 2,1× | área 2,4, 90 de dano, alcance 3..12 | não |
| C2 Holofote | 1×1 | 1,1× | **dano 0**: deixa lento e ofusca | não |
| C3 Arame e Sirene | 1×2 | 0,7× | aura de 4 u: 5 de dano e lentidão | não |
| C4 Antiaérea Quádrupla | 2×2 | 1,8× | só voadores: 4×12, alcance 9 | não |
| C5 Posto de Radar | 2×2 | 1,1× | **não atira**: +30 % de alcance às vizinhas | não |
| Gustavão | 12×4 | — | trilho; já fora da caixa | — |

Footprint: todas cabem em 3×3; só o Gustavão (fora da caixa) passa.

## Proposta

1. **Limite de altura 2,5× o herói, já neste card:** o ramo A inteiro (7 torres) é desenhado como prédio de 3 a 7
   andares. Duas saídas:
   - (a) **Escala de desenho por torre**, só no cliente: cada uma encolhe até caber em 2,5× (a arma no topo encolhe
     junto). Rápido, sem fio, sem arte nova; o prédio vira um "predinho" do tamanho de um sobrado. Recomendo agora.
   - (b) **Arte nova do ramo A** (Codex) como posto de defesa e não prédio: guarita, torre de vigia de madeira, ninho
     de sacos de areia, plataforma do sniper, todas ≤ 2,5×. Card de arte separado, depois do (a).
2. **Sai da caixa por não defender:** C5 Posto de Radar (não atira nada, só dá alcance às vizinhas). O Holofote
   também não dá dano, mas segura a horda (lentidão e ofusca): proponho manter.
3. **Nomes:** tirar "Prédio" de "Vigia do Prédio" e "Guarnição do Prédio" se for a saída (b) (ex.: "Guarita",
   "Guarnição").

Anotado: o E3 viu no site `Texture key already in use: art:torres:vigia-do-predio:idle` (1 em 4 partidas). Corrijo
junto na etapa 4 se mexer nessa torre.
