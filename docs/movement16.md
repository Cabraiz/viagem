# Movimento M16 (5 direções + espelho)

Card NEW-20261021-ORQ-movimento16-espelho (21/10). Teste com o viciado-em-bet: 16 poses de andar e de ataque, 8 de repouso, desenhadas em 5 direções: S, N e um lado de cada par (W×E, NW×NE, SW×SE). O jogo mostra o outro lado do par espelhado. O lado desenhado é escolhido por personagem e por par (plano B, 21/10): o viciado desenha W, NW e SE, o melhor lado de cada par na tabela de `evidence/NEW-estudo-espelho-5-direcoes/tabela.md`, e espelha E, NE e SW. Quem não tem o M16 completo continua com a R06 (`docs/movement128.md`): 128 poses e 8 direções desenhadas.

## Entrega

Em `arte-entrada/personagens-movimento16/<id>/`:

| arquivo | tamanho | grade | poses | duração |
|---|---|---|---|---|
| `walk/{S,N}.png` + um lado de cada par | 768×768 | 4×4 | 16 (todas diferentes) | 600 ms, em loop |
| `attack/{S,N}.png` + um lado de cada par | 768×768 | 4×4 | 16 (todas diferentes) | 1000 ms, sem loop |
| `idle/{S,N}.png` + um lado de cada par | 768×384 | 4×2 | 8 (pode repetir) | 2000 ms, em loop |

- Os PNG são RGBA, com células de 192, em ordem de leitura.
- Cada célula tem desenho, transparência e margem de 2 px (alfa > 20).
- A âncora é [0.5, 0.875] e as mãos ficam vazias.
- O `meta.json` é opcional e o importador não o lê.

## Importar

```powershell
node scripts/import-movimento16.mjs --input <arte-entrada> --ids viciado-em-bet            # só valida
node scripts/import-movimento16.mjs --input <arte-entrada> --ids viciado-em-bet --write --report m16.json
node scripts/art-lite.mjs --kinds sprites
```

O importador valida as 15 folhas antes de gravar e então:
- **Alinha** cada pose inteira, como na R06, sem redesenhar: o x do tronco e a linha do pé ficam na mediana do clipe.
- **Grava** os WebP com células de 96: 384×384 para andar e ataque, 384×192 para o repouso. O nome é `<id>.<motion>16-<dir>.<sha12>.webp`.
- **Acrescenta** ao piece em `personagens` as chaves `walk16-*`, `attack16-*` e `idle16-*`, só das 5 direções desenhadas, com `revision:16`, `frames`, `durationMs`, `loop`, `height` (o idle-S / 2), `figure` e `pivotX`.
  - `pivotX` é a coluna do tronco na célula de 96.
- **Mantém** a R06, o legado e o `meta`.

## No jogo

- **Quando usa:** `movementPlan` (src/client/sprites/movement128.ts) escolhe o M16 só quando as 15 folhas são válidas. Se faltar alguma, a classe fica inteira na R06.
- **Lado por par:** o importador vê qual lado de cada par foi entregue nas 3 animações (os dois lados entregues é erro) e grava só esse; num reimport que troca de lado, as chaves do lado antigo saem do manifest. O cliente (`movement16Source`) lê do manifest: a direção com as 3 folhas mostra a sua; senão, a do outro lado do par.
- **Espelho:** a direção espelhada usa a textura do outro lado do par (mesma chave, mesmo cache, a fase do passo continua ao virar) com `flipX`.
- **Origem pelo corpo:** o Phaser 3.90 espelha o quadro dentro da própria caixa, em volta do centro da célula. Por isso:
  - a origem x é `pivotX/96` sem espelho e `1 − pivotX/96` com espelho;
  - na cópia de cidade, que tem recorte simétrico, o espelho é aplicado depois do `variantOrigin`;
  - a silhueta usa o mesmo `1 − x`.
- **Pré-carga:** os 5 repousos e, para o próprio herói, os 5 andares. `heroMotionUrls` lista andar, ataque e os outros repousos sem repetir.

## Prova sem a arte

`evidence/NEW-20261021-ORQ-movimento16-espelho/` tem:
- `fake-m16.mjs`: um M16 falso do viciado, feito de 16 das 128 poses da R06 (uma a cada 8) e com o repouso R06 repetido;
- `walk8.mjs` e `sheet.mjs`: geram a folha das 8 direções no sandbox da cidade.

O falso **não** vai para o manifest real.
