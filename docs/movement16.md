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

## Arma na mão

Card NEW-20261021-ORQ-arma-na-mao-viciado (21/10). Por enquanto só o viciado.

No combate manual, a arma da mão vai para a mão do quadro que o herói mostra. Antes ela ficava ao lado do quadril.

- **A mão:** `scripts/hand-points.mjs --ids <id>` mede, fora do jogo, a mão em cada pose M16 (16 de andar, 16 de ataque, 8 de repouso, nas 5 direções desenhadas) e grava `src/client/sprites/hand-points-data.ts`. Com `--sheet <pasta>`, salva também uma folha por clipe com um círculo na mão.
  - É a mão que soca no ataque daquela direção: a da esquerda da tela no S, a da direita no N e a do lado para onde ele olha no W, NW e SE.
  - Uma pose que a regra erra é corrigida à mão em `OVERRIDES`. No viciado W, a mão da arma é a de trás: some atrás do corpo nos quadros 1–3 e 8 do andar e no repouso. Nesses quadros a arma vai para trás do corpo.
- **O espelho:** E, NE e SW usam a pose do par espelhada, então a arma troca de mão junto com o desenho.
- **Na frente ou atrás:** a arma fica atrás do corpo nas vistas de costas (N, NW, NE) e nas poses marcadas; nas outras, na frente.
- **Como segura:** cada adesivo tem cabo e ângulo do cano (`WEAPON_HOLD` em `hand-points.ts`). O cabo vai na mão e o cano aponta para onde o herói olha (`AIM_ANGLE`). Mirando para a esquerda, a arma é virada de cabeça para baixo para continuar em pé. O maçarico é carregado em pé e só espelha.
- **Sem medida:** a tabela usa o nome do arquivo, que tem o sha12. Uma folha reimportada, a R06, o legado e um herói caído ficam com o adesivo antigo ao lado até alguém rodar o script de novo.
- **Prova:** `evidence/NEW-20261021-ORQ-arma-na-mao-viciado/` (folhas das 8 direções × andando, parado e atacando; GIF; celular). No sandbox, `?sandbox=cidade&tele=1&arsenal=1&arma=<id>&class=viciado-em-bet`, e `window.__cidade.golpe()` dispara um ataque.

## Passo sem deslizar e pés no chão

Card NEW-20261021-ORQ-passo-sem-deslizar-e-sombra (21/10). Vale para todos os heróis (M16, R06 e legado).
- **Andar:** o ciclo avança com a distância andada na tela, não com o relógio (`sprite-motion.ts` `walkCycles`). A passada desenhada é `WALK_STRIDE` = 0,68 altura de figura por ciclo, a mediana das 29 caminhadas laterais medida por `scripts/passada.mjs`. Na cidade, a 3,99 u/s, isso dá ~8 ciclos/s de lado e ~4 de frente. Antes o ciclo levava 857 ms e o chão corria ~7× mais rápido que o pé. Parado, o quadro congela, sem pedalar. Uma virada mantém a fase. `WALK_TUNE.lock` < 1 desacelera o ciclo (no sandbox, `passo=1` trava o pé).
- **Passo mais lento (passo-3x-mais-lento, 21/10):** o usuário mantém a velocidade do herói e achou 8 ciclos/s rápido demais. A medida está certa: o herói anda ~5,7 alturas de corpo por segundo, uma corrida, e a arte desenha um passeio. O jogo sai com `WALK_TUNE.lock` = 0,5 (~4 ciclos/s de lado, ~2 de frente), e o pé desliza metade do chão. A trava volta a 1 quando o viciado tiver uma corrida com passada longa (fatia 2). Opções em `evidence/NEW-20261021-ORQ-passo-3x-mais-lento/`.
- **Pés:** cada clipe fica na sua própria linha de pé (`hero-feet-data.ts`, gerado por `node scripts/hero-feet.mjs`): a última linha opaca (alpha > 128), mediana dos quadros. A linha única por classe deixava o viciado 3–4 px acima da sombra andando. Depois de importar arte, rode o script de novo: o teste `heroi-pes` falha se faltar algum clipe.
- **Prova:** sandbox `?sandbox=cidade&mapa=real&tele=1`. `window.__cidade.freeze()` + `step(ms)` + `move(x, y)` filmam quadro a quadro (o screenshot não roda quadro).

## Corrida (run16)

Card NEW-20261021-ORQ-passo-3x-mais-lento, fatia 2 (21/10). Por enquanto só o viciado. O usuário pediu a corrida como padrão, sem apagar o andar, com o pé parado no chão e no máximo uns 3 ciclos/s de lado.
- **Por quê:** o herói anda ~5,7 alturas de corpo por segundo, e o andar desenhado é um passeio (0,68 altura por ciclo). Travado, isso dá 8 ciclos/s.
- **Arte (ChatGPT, codex sol):** 5 direções desenhadas do plano B (S, N, W, NW, SE). Cada imagem tem 8 poses, e o prompt pinta o tênis ESQUERDO de vermelho (marcador). Com isso a regra de perna fica visual ("o vermelho lidera" / "o roxo lidera") e a alternância pode ser medida. Em 8 poses o modelo desenha o apoio do pé que lidera, o voo e o pouso do outro. A folha de 16 é A + B: o apoio vermelho, o voo, o pouso roxo (A7 ≈ B0), o apoio roxo, o voo e o pouso vermelho (B7 → A0). S e N usam B = A espelhado. O vermelho volta a roxo na montagem. Prompts, montador, medidas e tentativas ficam em `D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-passo-3x-mais-lento/corrida/` (`gerar2.mjs`, `montar2.mjs`; `MARCADOR=1` mantém o vermelho para medir no jogo).
- **Montagem:** cada linha da imagem (um passo) fica no seu próprio chão, porque o modelo desenha as linhas em alturas diferentes. O tronco fica em x 96, a pose fica na altura em que voa, e o pé fica em y 168 (células de 192).
- **Tabela de fase** (`run/<dir>.phase.json` → `phase` no manifest; `movement128.ts` `runPhase`): o quadro sai da distância andada, não do relógio.
  - Numa pose de apoio, o tênis que encosta no chão do passo e recua com ele cobre o recuo medido da sola (`d`), e o sprite recua junto dentro da pose (`v`, só ao longo do chão). Assim o pé fica parado.
  - As poses de voo ficam com o resto da passada, até 3 ciclos/s na velocidade da cidade (a folha tem 2 ciclos).
  - Sem tabela, uma corrida usa `RUN_STRIDE`.
- **Importar:** `run/<dir>.png` (768×768, 4×4) e o `.phase.json` ao lado das pastas walk/attack/idle em `personagens-movimento16/<id>/`. A corrida é opcional: as 5 direções ou nenhuma. O importador não mexe nas poses da corrida, porque mover a pose moveria o pé medido. Depois rode `node scripts/art-lite.mjs --kinds sprites`, `node scripts/hero-feet.mjs` (na corrida, a linha do pé é a da pose mais baixa) e `node scripts/hand-points.mjs --ids <id>`.
- **No jogo:** `HERO_GAIT.run` (sprite-motion.ts) faz a classe com `run16` correr ao se mover (`movementPlan(id,'walk',…)` devolve a corrida). Ataque e repouso não mudam. Com `run:false` volta o andar, com `WALK_TUNE.lock` 0,5. No sandbox, `corrida=0` mostra o andar. `__cidade.fixar()` para a câmera, o que deixa o chão parado na tela para medir o pé.
- **Medida (21/10, 1280×720, câmera fixa, sola do tênis plantado pela cor do marcador, deslocamento ao longo do chão por quadro de jogo):**

  | direção | máximo | p90 | ciclos/s |
  |---|---|---|---|
  | W | 2 px | 1 px | 2,9 |
  | SE | 2,2 px | 1,8 px | 3,0 |
  | S | 1 px | 1 px | 2,9 |
  | NW | 1,3 px | — | 3,0 |
  | N | 2 px | 1 px | 2,9 |

  - No NW, o herói passa atrás de um poste num trecho da medida; o pico de ~27 px ali é o poste, não o pé (excluído).
  - Nenhum tênis arrasta na linha do chão de lado (≤ 1 px).
