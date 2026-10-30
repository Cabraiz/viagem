# hitbox-bate-com-arte: corpo × desenho (cidade, 390×844)

Regra (tests/client/hitbox-bate-com-arte.test.ts): o diâmetro do corpo fica entre 60 % e 110 % da largura do tronco desenhado, as duas medidas no eixo x da tela, com o zoom da cidade.
Larguras medidas uma vez com `medir.mjs` (alpha ≥ 128; mediana dos quadros do parado; o tronco são as linhas entre 45 % e 60 % da altura da figura, contando os pés; braços e objetos entram na conta). Tabela gerada por `tabela.ts`. O print `hitbox-390x844.png` é uma montagem fora do jogo, feita por `print.mjs`.
Raio do saci: o de base do catálogo (0,759). Se ele nascer como elite, o diretor ainda multiplica por ELITE_SIZE 1,35.

### main (HERO_DRAW_SCALE 0.8, ENEMY_DRAW_SCALE 1.15)

| quem | raio (u) | diâmetro (u) | tronco desenhado (u) | pé desenhado (u) | diâmetro/tronco | diâmetro/pé |
|---|---|---|---|---|---|---|
| viciado | 0.22 | 0.440 | 0.191 | 0.161 | 231 % | 273 % |
| clt | 0.22 | 0.440 | 0.176 | 0.139 | 250 % | 316 % |
| gato | 0.22 | 0.440 | 0.337 | 0.235 | 130 % | 188 % |
| maromba | 0.22 | 0.440 | 0.242 | 0.191 | 182 % | 231 % |
| vendedor | 0.22 | 0.440 | 0.213 | 0.198 | 207 % | 222 % |
| aposentado | 0.22 | 0.440 | 0.235 | 0.191 | 188 % | 231 % |
| mendigo | 0.368 | 0.736 | 0.583 | 0.417 | 126 % | 177 % |
| saci | 0.759 | 1.519 | 1.015 | 0.363 | 150 % | 418 % |
| sanfoneiro | — | — | sem arte na main | — | — | — |

### escala 1.5/1.5 (HERO_DRAW_SCALE 1.5, ENEMY_DRAW_SCALE 1.5)

| quem | raio (u) | diâmetro (u) | tronco desenhado (u) | pé desenhado (u) | diâmetro/tronco | diâmetro/pé |
|---|---|---|---|---|---|---|
| viciado | 0.22 | 0.440 | 0.357 | 0.302 | 123 % | 145 % |
| clt | 0.22 | 0.440 | 0.330 | 0.261 | 133 % | 168 % |
| gato | 0.22 | 0.440 | 0.632 | 0.440 | 70 % | 100 % |
| maromba | 0.22 | 0.440 | 0.454 | 0.357 | 97 % | 123 % |
| vendedor | 0.22 | 0.440 | 0.399 | 0.371 | 110 % | 119 % |
| aposentado | 0.22 | 0.440 | 0.440 | 0.357 | 100 % | 123 % |
| mendigo | 0.368 | 0.736 | 0.761 | 0.544 | 97 % | 135 % |
| saci | 0.759 | 1.519 | 1.904 | 0.681 | 80 % | 223 % |
| sanfoneiro | — | — | sem arte na main | — | — | — |

## Leitura
- Na main, todos os 8 com arte ficam fora da faixa: o corpo é mais largo que o desenho (126 % a 250 %).
- Com a escala 1,5/1,5 (card NEW-20261028-ORQ-escala-heroi-uno-inimigo, ainda sem merge), entram gato, maromba, aposentado, mendigo e saci. Viciado (123 %), clt (133 %) e vendedor (110,3 %) continuam fora → card NEW-20261030-E3-raio-heroi-pos-escala.
- Com um só RADIUS para os 6 heróis, a faixa não fecha para todos: tronco mínimo 0,330 (clt) e máximo 0,632 (gato com os braços). Proposta: 0,18 com a escala, o que deixa só o gato em 57 %.
