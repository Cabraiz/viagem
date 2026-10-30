# NEW-20261030-ORQ-ramo-b-e-6p-facil

Origem: `evidence/auditoria-economia-29-10.md` (quadro, E4), itens 10, 9 e 7.

## Parte 1 — ramo B por R$ (item 10) e comentário da barricada (item 9)

Mudança em `src/rules/towers.ts`: **B5 Obuseiro, dano 90 → 140**. Cadência, área e alcance ficam iguais (são espelhados
em `client/render/towers/tower-rules.ts`, que não muda). B3 e B4 ficam como estão: contando a área, já passam de 60 % do A.

Como medir. A tabela 3b da auditoria conta um alvo por impacto (dano × alvos ÷ cooldown). Assim a área não vale nada, e
"subir a área" não mudaria o número. Aqui cada impacto conta os inimigos que a área alcança, com 0,1 inimigo por u²:
`1 + 0,1·π·área²` (1,45 com área 1,2; 1,80 com 1,6; 2,81 com 2,4). R$ é o custo somado das evoluções, sem a raiz
(EVOLVE_PRICE: 10, +16, +25, +35). O teste `tests/rules/ramo-b-por-grana.test.ts` guarda a regra: de B3 a B5, B/A fica
entre 60 % e 100 %, e o B5 vale o que custa a mais que o B4.

| tier | A: DPS · DPS/R$ | B antes: DPS 1 alvo · com área · DPS/R$ | B depois: DPS/R$ | B/A antes → depois |
|---|---|---|---|---|
| 2 | A2 15,6 · 1,56 | B2 8,8 · 12,7 · 1,27 | igual | 81 % |
| 3 | A3 33,8 · 1,30 | B3 13,6 · 24,6 · 0,95 | igual | 73 % |
| 4 | A4 72,0 · 1,41 | B4 29,3 · 52,9 · 1,04 | igual | 74 % |
| 5 | A5 146,7 · 1,71 | B5 25,7 · 72,2 · **0,84** | B5 40,0 · 112,4 · **1,31** | **49 % → 76 %** |

- Marginal B4 → B5 (DPS a mais por R$ 35): 0,55 → 1,70 (A4 → A5: 2,13).
- Contando um alvo só, como na auditoria, o B5 vai de 0,30 para 0,47 DPS/R$.
- 0,1 inimigo/u² é uma estimativa (horda espalhada). B3 e B5 miram o grupo mais denso, então devem pegar mais que isso.
  O bench da parte 2 confere na prática: quantas vezes o B5 é comprado e quanto fica de pé no fim.

Comentário de `towers.ts:150`: dizia barricada R$ 10 / 400 hp / 8 de pé / 2 s / "anda 60 % mais lento em cima". O código
diz R$ 5 / 200 hp / 40 / 1 s / bloqueia (drag 1), e a barricada só sai de kit da tralha. O comentário agora diz isso.

## Parte 2 — 6p fácil (item 7)

Espera a vaga pesada (ordem do ORQ: lote → E6 → E7 → E3) e o saci integrar (saci-nasce-nos-ninhos, balanco-3-inimigos).
