# Sprites em 4 direções: formato do atlas

Para quem for desenhar as 36 classes (cards `NEW-20261009-ORQ-classe-*`). O jogo escolhe entre 4 diagonais pelo movimento na tela, nas 4 vistas da câmera. Classe sem atlas novo continua com o desenho atual espelhado: nada quebra enquanto a arte chega, e **a folha aprovada (`<id>.webp`) nunca é trocada**.

## A folha

- Um PNG com transparência (canal alfa), **1152 × 2304 px**: 6 colunas × 12 linhas de células de **192 × 192 px**.
- Quatro blocos de 3 linhas, de cima para baixo, sempre nesta ordem:

| Linhas | Bloco | Quando aparece |
|---|---|---|
| 1–3 | frente-direita | anda para baixo e para a direita na tela (é o desenho de hoje) |
| 4–6 | frente-esquerda | baixo e esquerda |
| 7–9 | costas-direita | cima e direita: vemos as costas |
| 10–12 | costas-esquerda | cima e esquerda |

- Dentro de cada bloco, igual à folha de hoje: linha 1 parado (o jogo usa só a 1ª célula), linha 2 andando (6 quadros, 5 fps), linha 3 ataque (6 quadros, 6 fps, toca uma vez).
- Pode desenhar a esquerda espelhando a direita no editor, se a roupa deixar (bolsa, arma e cabelo trocam de mão).

## O pivô (o que o importador confere)

- **Pés na linha 168** da célula (± 3 px) em todos os blocos, e a mesma linha (± 2 px) entre as 4 direções. É o ponto (0,5; 0,88) onde o boneco pisa no chão.
- **Pés centrados na coluna 96** (± 12 px): o boneco gira em volta desse eixo. Entre direções, ± 12 px.
- **Mesma altura** de pé nas 4 direções (± 6 %): a altura da célula parada de frente-direita define a escala do boneco no jogo.
- Nenhum pixel encostando na borda da célula; nenhuma célula vazia nem opaca; fundo transparente (nada de branco ou xadrez "pintado").

## Importar

```
# coloque em <pasta>/<id>/atlas-4dir.png (ou <pasta>/<id>.dir4.png)
node --experimental-strip-types scripts/import-sprites.mjs --dir4 <pasta>
```

O importador valida tudo acima e lista todos os problemas de uma vez. Se passar, grava `public/art/sprites/<id>.dir4.webp` (sem perda) e a entrada `dir4` da classe em `src/game/sprite-catalog.ts`. Ele se recusa a sobrescrever um `.dir4.webp` que já existe sem `--replace`.

## Lote de TESTE (não é arte)

`tests/fixtures/sprites-4dir/cidadao-comum.dir4.webp` é derivado da folha aprovada do Cidadão Comum (`scripts/make-lab-sprites4.mjs`): as costas pintam o rosto de cabelo e levam a faixa "COSTAS", e cada direção tem seu código na camisa (FD, FE, CD, CE). Ele só aparece no servidor de desenvolvimento com `?lab=sprites4` e nunca entra no catálogo nem no build.
