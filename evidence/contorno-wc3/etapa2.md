# Contorno WC3 — etapa 2: realce no render (23/10)

Módulo único: `src/client/render/usable-glow.ts` (+ regras puras em `usable-glow-rules.ts`). Ouro INTERATIVO_COR (o
dourado "interativo" do WC3 que já contorna o quadrado da barricada no hover) a 2,5 px de tela sobre uma faixa Breu até
3,5 px (o ouro segura na neve), pulso de 1 s entre 55 % e 100 % (fixo com movimento reduzido). Cópias tint-fill do
próprio sprite em 8 direções, na mesma textura (lote com o sprite), nada assado na carga; cópias em pool (uma rajada
de tiros não cria GameObject depois de aquecer). `?brilho=0` desliga (A/B no mesmo build).

Ligado em: barricada (arte), muralha de tralha e muro pintado (peças sob a mais baixa: sem costura dentro do quadrado;
meias peças respeitam o crop), caixas de saque (cidade e arsenal), itens e veículos no chão, defesas (base), Uno, e o
tiro do jogador (faixa fina, 4 direções por faixa = 8 cópias). Nada no tiro dos bichos (fica com o visual de perigo).

## Prints (depois/)
- `muralha-tralha`, `z-muralha-esq`, `z-muralha-dir`: muralha contornada, sem os blocos das meias peças.
- `obra-livre`, `z-obra`: muro pintado, barricada, Uno.
- `arsenal-1335x620`, `arsenal-844x390` (celular): caixas por raridade.
- `horda-bala-1`, `z-horda-bala`: o tiro do jogador com o contorno fino.
- Linha dourada entre quadrados VIZINHOS da muralha continua: cada quadrado é uma estrutura (conserta/destrói sozinho).

## Custo (medir-js.mjs: sandbox horda 300 bichos, celular 390×844 com toque, CPU 4× via CDP, 12 s, ms de JS em HordeLayers.update)
| versão | quadros com / sem (3 rodadas) | média ms com | média ms sem | cópias visíveis |
|---|---|---|---|---|
| 1ª (cria 16 imagens por tiro novo) | 81+88 / 217+105 (2 rodadas) | 48,2 · 28,6 | 11,5 · 16,4 | 240–336 |
| pool | 618 / 642 | 11,2 · 14,6 · 13,5 | 12,0 · 10,7 · 11,2 | 336–384 |
| pool + tiro com 8 cópias (final) | 565 / 641 | 5,8 · 13,8 · 19,0 | 9,3 · 12,6 · 5,6 | 152–208 |
SwiftShader: a variação entre rodadas iguais (5,6–19 ms) é maior que a diferença com/sem. A 1ª versão tinha custo real
(criar objetos por tiro), corrigido com o pool. Falta a medida de verdade no celular emulado com o build
(`scripts/perf-andar.mjs` com e sem `--query brilho=0`): precisa do lock pesado (estava com o E8, sons TangoFlux ~2,7 h).

## Etapa 3 (23/10)
- `depois/pulso-muralha.gif`: 2 s do pulso (gif.mjs: foto `muralha-tralha` congelada, `__cidade.step(100)` por quadro, ffmpeg).
- perf-andar com/sem `?brilho=0` (2 rodadas cada, alternadas): as 4 pararam em `__partidaPronta` (240 s) — GPU 100 %
  com o E8 (TangoFlux); o worker mostra a sala em combate com lag 7 s e expira. Não é do brilho (o `sem` também para).
  Medir de novo quando a GPU soltar: `node scripts/perf-andar.mjs --saida …` e `--query brilho=0`, alternados.
