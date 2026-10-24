# Proposta — vida por papel, estilo Clash Royale (etapa 2)

Medição de hoje: `antes.md`. A ideia do Clash: cada papel tem um tempo para morrer fixo (TTK), medido na arma inicial; a
vida de todos os inimigos do papel sai dessa tabela, nunca de número solto por bicho. A rodada e o número de jogadores
continuam multiplicando como hoje (×1,3 → ×2,35; ×1,15 por jogador a mais).

## Regra

`vida = golpes do papel × 24 (faca verde) − margem`, no começo da partida, 1 jogador. A margem (0,35 golpe) garante que a
faca dourada e a pistola roxa ainda precisem do mesmo número de golpes. Os bichos de um papel ficam todos com a mesma
vida (o bêbado e as artes novas do mesmo papel iguais).

## Tabela (opção B, recomendada)

| papel | hoje (faca, começo, solo) | proposta | vida no começo (solo) | papel no Clash |
|---|---|---|---|---|
| enxame (pombos) | **1** | 2 | 8 → 40 | Exército de esqueletos, mas sem morrer no tapa |
| kamikaze (motoboy) | **1** | 2 | 23 → 40 | Corredor (Hog) frágil |
| corredor (bêbado) | 2 | 2 (mas a pistola verde não mata mais com 1) | 26 → 40 | Goblin |
| voador | **1** | 3 | 20 → 64 | Morcego/Minion mais duro |
| atirador (agiota) | 2 | 3 | 39 → 64 | Arqueira |
| arremessador (anão) | 3 | 3 | 52 → 64 | Mago |
| suporte (coach) | 3 | 3 | 52 → 64 | Feiticeira |
| invocador | 4 | 4 | 73 → 88 | Bruxa |
| refletor (influencer) | 5 | 5 | 104 → 112 | Valquíria |
| palhaço (Tio do Pavê) | 6 | 6 | 130 → 136 | Mini P.E.K.K.A |
| brutamontes | 6 | 7 | 143 → 160 | Gigante |
| mini-chefe | 7 | 9 (× elite como hoje) | 156 → 208 | P.E.K.K.A |
| chefe | — | sem mudança | — | — |

Opção A ("Clash cheio": enxame 2, corredor/kamikaze 3, voador 3, atirador 3, arremessador/suporte 4, invocador 5,
refletor 6, palhaço 7, brutamontes 8, mini 10): vida média da horda ×1,8, teria que cortar ~45 % dos corpos.

## Compensação (para não alongar a horda)

Com o peso dos papéis no modo ninhos (ROLE_WEIGHT: corredor 4, enxame 3…), a vida média por corpo vai de 40,8 para
60,2 (**×1,48**), quase toda do enxame (×5) e do corredor (×1,5).

- **Corpos −30 %** (ninhos: tamanho das ondas e cota do mapa ×0,7; ondas: orçamento ×0,7) → vida total da horda ≈ +4 %.
- **XP por corpo ×1,4** para o nível subir no mesmo ritmo com menos mortes (sem isso o time fica fraco no fim).
- **Moedas/loot por corpo**: o mesmo ajuste se o loot vier por morte.
- Sem mexer no dano dos inimigos nem no chefão.
- Conferir no bench (vaga pesada, 1/3/6 jogadores, etapa 5) que a vitória fica na meta; se sair, o ajuste é a
  porcentagem de corpos, não a tabela.

## O que muda no código (etapa 3)

- `src/rules/enemy-roles.ts`: `ROLE_HITS` (a coluna "proposta") no lugar do `hp` multiplicador; a vida base de cada papel
  sai de `ROLE_HITS × FACA_VERDE / escala da linha 1`.
- `src/sim/enemies/catalog.ts`: os 9 bichos antigos e as artes novas leem a vida da tabela do papel.
- Contagem e XP: knobs no ninhos/waves (um só multiplicador cada).
- Teste: nenhum inimigo comum morre com 1 golpe da faca verde nem da pistola verde, 1–6 jogadores, todas as fases.
- Servidor: a vida está na sim (Worker) → fila com `--worker`.

## Barra de vida (etapa 4, não precisa de decisão)

Já aparece só nos danificados (2,5 s) com teto (30 / 12 no celular). Muda: largura proporcional ao corpo (hoje 40 px fixo
para todos), colada na cabeça, cor por lado (inimigo vermelho; aliado/torre verde).
