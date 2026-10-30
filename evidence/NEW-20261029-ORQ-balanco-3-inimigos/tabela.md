# Balanço com só 3 inimigos — antes × só-3-sem-ajuste × só-3-ajustado

Bench: `scripts/bench-city-run.ts --objective chaveiro --mode ninhos --combat manual --seeds 1-16 --players 1,3,6` (ONDAS, padrão da main), com o patch `bench-mortes-por-onda.patch` para contar mortes/caídos por onda e o mix da horda.

- **antes** = origin/main 8e6a3bcb (elenco legado, 40+ tipos).
- **só-3-sem-ajuste** = branch a4726d21 (so-3-inimigos + saci-nasce-nos-ninhos do E2), `LIBERADO_TUNE` todo 1.
- **it1** = mendigo hp ×1,2, dano ×1,2. **it2** = mendigo hp ×1, dano ×1,6 (5 → 8).

| versão | 1p vitórias | 3p | 6p |
|---|---|---|---|
| antes | 7/16 | 16/16 | 15/16 |
| só-3-sem-ajuste | 9/16 (+13 pp) | 16/16 (0) | 16/16 (+6 pp) |
| it1 (hp 1,2 / dano 1,2) | 11/16 (+25 pp) | 15/16 (−6 pp) | 14/16 (−6 pp) |
| it2 (dano 1,6) | 9/16 (+13 pp) | 16/16 (0) | 16/16 (+6 pp) |

**só-3-ajustado = só-3-sem-ajuste** (`LIBERADO_TUNE` fica em 1/1, pronto para remedir com o saci).

## Leitura

- 3p e 6p já ficam dentro de ±10 pp sem ajuste. 1p fica em +13 pp, ou seja 2 seeds de 16. O ruído entre seeds no 1p é de ±2 vitórias, a mesma ordem de grandeza.
- Os números não mexem no 1p acima do ruído. Mais hp (it1) deixou o 1p **mais fácil** e o 3p/6p um pouco mais difíceis. Dano ×1,6 (it2) deu exatamente o mesmo placar do sem-ajuste.
- O que torna o "antes" mais difícil no 1p são as mortes cedo do time (T191, T205, T217), causadas pelos inimigos de longe do legado. O mendigo, que é corpo a corpo, não reproduz isso só com hp ou dano. O carro também cai mais tarde: mediana de 348 s antes contra 400 s depois.
- O 6p tem menos corpos: 203–215 inimigos por partida, contra 322 antes. Se quiserem mais pressão no 6p, a alavanca é a quantidade por onda em ninhos.ts, não o mendigo.

## Pendências

- O saci nasce nos ninhos (card do E2): 0, 1, 1, 2, 2… elites por onda, cerca de 1 % da horda. É ele quem deveria repor a ameaça de longe e de elite. Remedir com `rodar-bench.sh` e mexer em `LIBERADO_TUNE['aberracao-saci']`.
- O legado do chefão e do dorminhoco não foi tocado; depende da pergunta ao usuário.

Tabela completa, com duração, carro, mortes e caídos por onda, causas e mix: `tabela-bruta.md`. Os dados brutos estão em `*.json` e `*.txt`.
