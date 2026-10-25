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
