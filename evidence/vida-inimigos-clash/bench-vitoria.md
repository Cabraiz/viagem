# Bench de vitória (etapa 5): cidade, chaveiro (jogo ao vivo), seeds 1–16, CI (tools/ci.mjs bench), 27/10

| time | main 51c211b6 | branch 14efecaa (corpos ×0,7, XP ×1,4) | sonda corpos ×0,85, XP ×1,2 | meta |
|---|---|---|---|---|
| 1p vitórias | 10/16 (fácil demais) | 15/16 (fácil demais) | 14/16 (fácil demais) | 2–6 |
| 3p vitórias | 12/16 | 16/16 | 13/16 | sem meta |
| 6p vitórias | 5/16 (difícil demais) | **8/16 (na meta)** | 8/16 (na meta) | 7–11 |
| chefão morto 1p/3p/6p | 0/3/1 | 3/15/2 | 2/12/5 | — |
| minutos de sim (média) 1p/3p/6p | 11,7/9,1/8,6 | 12,5/9,6/8,3 | 12,6/8,8/8,1 | — |

Execuções: main https://github.com/Cabraiz/viagem/actions/runs/40587766152 · branch https://github.com/Cabraiz/viagem/actions/runs/40587756310 · sonda ×0,85 https://github.com/Cabraiz/viagem/actions/runs/40590781262

- Menos corpos, mesmo mais duros, batem menos no time e no carro: o 1p perde menos (main: 5 derrotas do time; branch: 1).
- O ×0,85 não tira o 1p do "fácil demais" e só aproxima o 3p da main; ainda mexe em ~8 testes de digest/seed. Não foi aplicado.
- O 1p já está fácil demais na main (10/16): é um balanço à parte.
