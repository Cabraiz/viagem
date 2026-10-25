# Minimapa em arte do ChatGPT (NEW-20261025-ORQ-minimapa-arte-chatgpt)

Tudo pelo Codex (gpt-6.1-sol, effort low, vaga --codex). Foram 4 chamadas, todas aprovadas na 1ª tentativa.

| peça | prompt | referência enviada (-i) | saída | resultado |
|---|---|---|---|---|
| rostos 1 (6 heróis do menu, gato incluso) | rostos/prompt-t1.txt | rostos/ref-rostos.png (rostos do HUD + retrato do gato) | rostos/rostos-t1.png | ok |
| rostos 2 (as outras 10 classes jogáveis, as que os bots usam) | rostos/prompt-t2.txt | rostos/ref-rostos-2.png + rostos/rostos-t1.png (estilo) | rostos/rostos-2-t1.png | ok |
| ícones (12) | icones/prompt-t1.txt | rostos/rostos-t1.png (estilo) | icones/icones-t1.png | ok |
| fundo da Cidade Nevada | fundo/prompt-m1.txt | ref/planta.png (a planta real) | fundo/fundo-m1-t1.png | IoU 0,964 |

- `ref/`: `scripts/minimapa/referencia.ts`. `planta.png` é a planta fina (4 amostras por célula) e `mascara.png` é o sólido (gabarito); `ref-topo.png` é o minimapa de hoje (IoU 0,556 contra a planta).
- IoU: `scripts/minimapa/iou.ts <imagem>` (Otsu + alinhamento ±6 %). O arquivo enviado (`public/art/minimapa/cidade-nevada.webp`, escurecido) dá 0,966. `fundo/fundo-m1-t1-sobreposicao.png`: verde = acerto, vermelho = falta, azul = sobra.
- Arquivos do jogo: `node scripts/minimapa/atlas.mjs` (chroma key, recorte, rosto redondo, borda de adesivo nos ícones, fundo 512 px escurecido).
- Print e custo: `node scripts/minimapa/harness/print.mjs evidence/minimapa-arte-chatgpt/harness 124` (o minimap.ts de verdade, sem vite). `antes` = sem a arte (requisições abortadas).

## Etapa 5: no jogo e FPS
- `jogo/`: prints do CI (gif-ci, `andando`, modo chaveiro, celular e PC, run 40226736289). `mm-celular-pc.png` é só o minimapa, ampliado.
- `fps/`: roteiros do celular-travando (`fps/roteiros/run.mjs` + `celular.mjs`). Celular 393×873 DPR 3, CPU 4×, SwiftShader, solo com 4 bots, 60 s parado no Uno, duas rodadas por versão. Antes = main 8072e25; depois = esta branch (c7d2182).

| | fps | p95 (ms) | p99 (ms) | quadros >100 ms | script (ms/s) | estilo (ms/s) | textura (pico, MB) |
|---|---|---|---|---|---|---|---|
| antes 1 | 19,3 | 83 | 267 | 47 | 932 | 9,5 | 916 |
| antes 2 | 15,1 | 167 | 450 | 97 | 886 | 10,8 | 915 |
| depois 1 | 16,7 | 133 | 283 | 80 | 922 | 10,8 | 916 |
| depois 2 | 18,1 | 100 | 233 | 60 | 924 | 9,8 | 917 |

Diferença dentro do ruído (com CPU 4× o passo do Phaser satura a CPU). A medida fina do minimapa é a do harness: 1 pintura caiu de ~0,30 para 0,21 ms.
