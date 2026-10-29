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
- **Sem medida:** a tabela usa o nome do arquivo, que tem o sha12. Uma folha reimportada, o legado e um herói caído ficam com o adesivo antigo ao lado até alguém rodar o script de novo. O teste `tests/client/hand-points.test.ts` reprova uma folha do viciado ou do CLT sem medida.
- **Prova:** `evidence/NEW-20261021-ORQ-arma-na-mao-viciado/` (folhas das 8 direções × andando, parado e atacando; GIF; celular). No sandbox, `?sandbox=cidade&mapa=real&tele=1&arsenal=1&arma=<id>&class=viciado-em-bet`, e `window.__cidade.golpe()` dispara um ataque.

### CLT e o acabamento (card NEW-20261022-ORQ-arma-na-mao, 22/10)

O usuário viu a faca do CLT "flutuando" e "parecendo um ícone por cima dele". O CLT usa as folhas R06 (128 poses, 8 direções desenhadas) e não tinha mão medida, então a arma ficava no adesivo fixo do quadril, por cima do corpo.

- **A mão no R06:** a regra do M16 (a pele mais de fora do lado da arma) cai no nariz do CLT e troca de mão nas vistas de lado. Por isso `scripts/hand-track.mjs` faz assim:
  - **Andar:** segue a mão de pose em pose. Quando ela some atrás do corpo, a pose fica marcada como escondida, preenchida entre as vizinhas e presa ao corpo.
  - **Ataque:** o punho foi marcado a olho a cada 8 poses (`CLT_KEYS` em `hand-points.mjs`) e encaixado no punho desenhado (mean shift sobre a pele).
  - **Parado (idle8):** uma pose por direção.
  - A mão da arma é a que soca. No W e no E, o CLT soca com a mão do lado de lá (o relógio fica na mão de perto), então a arma vai atrás do corpo.
- **Dedos por cima do cabo:** um recorte do próprio quadro do herói em volta da mão (`HAND_PATCH` = 3,5 px da célula, `patchCrop`) é desenhado logo acima da arma. O recorte usa a mesma textura, inclusive a cópia da cidade com o contorno, então o punho fecha sobre o cabo pixel a pixel. Com a mão atrás do corpo, não há recorte, porque o corpo já cobre a arma.
- **Luz:** a arma na mão não é mais o ícone do HUD. É uma cópia fosca (`heldLook`: ¼ do caminho até o cinza, brilhos com gama 1,25, 88 % da luz), com o anel Breu da cidade igual ao dos heróis. Atrás do corpo, ela ganha a sombra `HELD_TINT.behind`. O chão e o HUD continuam com o ícone.
- **Teste (CI):** cada folha que o viciado e o CLT mostram tem a mão em todo quadro, com pele a ≤ 3 px de tela do cabo e ≥ 6 px de pele sob o recorte dos dedos. A mão escondida fica sobre o corpo. A mão não salta mais de 9 px entre poses do R06. Costas e mão do lado de lá ficam atrás do corpo.
- **Prova:** `evidence/NEW-20261022-ORQ-arma-na-mao/` (GIFs da faca e da pistola, parado → correndo → atacando em S/W/N/E a 200 %; recorte a 400 %). Sandbox: `?sandbox=cidade&mapa=real&tele=1&arsenal=1&relevo=0&hero=60,60&arma=faca&class=clt-cansado`.
- **Falta:** as outras 13 classes R06 jogáveis ainda usam o adesivo ao lado. Elas precisam das marcações dos ataques (e, nas peles mais escuras, do tom de pele em `skin`).

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
- **Medida da 1ª versão (21/10; a arte foi trocada em 22/10, ver abaixo) (1280×720, câmera fixa, sola do tênis plantado pela cor do marcador, deslocamento ao longo do chão por quadro de jogo):**

  | direção | máximo | p90 | ciclos/s |
  |---|---|---|---|
  | W | 2 px | 1 px | 2,9 |
  | SE | 2,2 px | 1,8 px | 3,0 |
  | S | 1 px | 1 px | 2,9 |
  | NW | 1,3 px | — | 3,0 |
  | N | 2 px | 1 px | 2,9 |

  - No NW, o herói passa atrás de um poste num trecho da medida; o pico de ~27 px ali é o poste, não o pé (excluído).
  - Nenhum tênis arrasta na linha do chão de lado (≤ 1 px).

## Proporção da corrida, emenda do loop e contorno (corrida-proporcao-contorno, 22/10)

O usuário viu a corrida menor que o parado (cabeça menor, corpo fino), o fim do ciclo sem casar com o início e, às vezes, o contorno preto sumindo e ficando só o branco.
- **Medidor:** `node scripts/proporcao.mjs [--ids <id>] [--sheet <pasta>] [--json <arquivo>]`. Para cada direção desenhada, compara cada pose do andar e da corrida com o parado da mesma direção, na escala do jogo (96/height de cada clipe):
  - **cabeça:** o boné e o cabelo do parado encaixados na pose, nas escalas de 0,6 a 1,4 (IoU > 0,9);
  - **altura:** só nas poses de apoio da corrida (as de voo e o agachamento mudam a altura);
  - **emenda 16→1:** distância de forma (1 − IoU no melhor encaixe a ±3 px) entre a última pose e a primeira, contra a mediana entre vizinhas;
  - **tronco e área:** só informativos (braço cruzando o peito muda a medida).
  - O teste `tests/tools/proporcao.test.ts` exige cabeça e altura dentro de ±4 % e a emenda até 1,2× a mediana em toda corrida e todo parado. As falhas do andar (que não aparece com a corrida ligada) estão listadas em `KNOWN_WALK`.
- **Causa da proporção:** o montador escalava a corrida pela altura, e uma pose de corrida é mais baixa. Além disso, cada meio passo (uma imagem) vem num tamanho próprio, e S, N e NW tinham sido desenhados com a câmera na altura dos olhos, com pernas compridas. Agora cada metade é escalada para a cabeça bater com a do parado (`montar3.mjs`, com KA e KB). S, N e NW foram regerados com a proporção e a câmera do parado no prompt e com poses igualmente espaçadas (`gerar4.mjs`). W e SE ficaram com o desenho do E7, reescalados. Os scripts e as tentativas estão em `D:/Gits/viagem-board/evidence/NEW-20261022-ORQ-corrida-proporcao-contorno/`.
- **Pé no jogo** (câmera fixa, marcador): W máx. 1 px, NW 1,3, SE 3,1, S 0, N 0, a 2,9–3 ciclos/s. W e NW foram calibrados pelo salto medido (`calibra.mjs`). No W, o pé roxo das poses 7–9 (voo, rente ao chão) salta para o pouso na pose 10; a corrida anterior já fazia isso (19 px, agora 23 px na escala nova).
- **Contorno:** o cache de folhas M16 (`movement128-textures.ts`) contava folhas: 8, um número pensado para a R06 de 1536×768. O herói usa 10 (5 de parado e 5 de corrida), então ao virar uma folha despejava a outra, a cópia com o anel Breu e o adesivo "você" eram refeitos, e nesse meio-tempo o contorno caía nas 16 cópias deslocadas, com só 1 px de Breu. Agora cada folha pesa a sua fração de uma R06 (`sheetWeight`). Na cidade, o fallback desenha as três faixas do adesivo (`CITY_CONTOUR` em `you.ts`): Breu, Papel e Breu por fora. Só falta o adesivo na primeira vez que cada clipe aparece (cerca de 4 quadros).

## Corrida do CLT (corrida-clt, 22/10)

O usuário gostou da corrida do viciado (proporção, loop) e pediu a mesma no CLT, com as mesmas regras. O CLT é R06 (walk128, attack128 e idle8, 8 direções desenhadas) e não tem M16.
- **Corrida sobre a R06:** uma classe R06 com `run16` nas 5 direções desenhadas corre nela (`hasRun16` não exige mais o M16; `movementPlan(id,'walk',…)` devolve a corrida). O parado (idle8) e o ataque (attack128) continuam R06. O lado desenhado de cada par sai das próprias folhas de corrida (`movement16Source(id,d,'run')`): o CLT desenha S, N, W, NW e SE, como o viciado, e espelha E, NE e SW.
- **Importar só a corrida:** `import-movimento16.mjs` aceita `personagens-movimento16/<id>/run/` sozinho quando a classe tem o idle8 R06. A altura de referência é a do idle8 (49), e a corrida é montada nessa escala.
- **Medidor:** `proporcao.mjs` usa a coluna do idle8 como parado quando não há idle16. O teste exige o CLT na lista.
- **Contorno:** `tests/tools/corrida-contorno.test.ts` assa a cópia da cidade (`outlineRgba` com `CITY_RING`, recorte pela caixa da figura) em cada pose de toda corrida, cheia e lite, e anda pela borda de fora: ≥ 95 % tem Breu por fora. Uma franja clara semitransparente em volta do boneco (sobra do recorte do fundo) reprova.
- **Arte (ChatGPT/Codex):** `D:/Gits/viagem-board/evidence/NEW-20261022-ORQ-corrida-clt/` (`gerar/gerar.mjs`, `remontar/montar.mjs`, `final.sh`). É o pipeline do viciado com dois marcadores: o sapato esquerdo vermelho e o direito ciano, porque o sapato marrom se confunde com a calça. Os dois voltam ao marrom na montagem.
  - O prompt que pedia "pernas CURTAS" fez o modelo encolher o corpo: a cabeça batia e a altura ficava 6–16 % baixa. O que funcionou foi dar as proporções medidas no idle8 (cabeça ~40 % da altura, pernas ~70 % da cabeça, "não mais curtas") e pedir a cabeça "do mesmo tamanho, não maior".
  - No N, a pose 7 da metade A sempre deixava o pé que pousa atrás. Por isso o N usa a metade B, com as cores dos marcadores trocadas, mais o espelho dela.
  - No W, a linha de voo (poses 4–7) se apoiava no pé que vai pousar, que então raspava o chão junto com o corpo, o mesmo defeito do W do viciado. `LIFT_A=6` ergue essa linha 6 px (a 192), e o pé pousa de cima na pose 8.

## Parado com respiração (parado-respiracao-herois, 24/10)
- **Folha:** `idle/<dir>.png` com 768×768 (4×4) é o parado que respira: 16 poses distintas em 3,2 s, pés plantados, importadas como desenhadas (sem alinhar). A 4×2 continua valendo como parado fixo.
- **Como sai:** `gerar/respirar.py` (evidência do card) deforma o parado aprovado: abaixo do quadril os bytes do parado, o tronco sobe, os ombros abrem e a cabeça balança. O quadro 0 é o parado byte a byte. Figuras menores (viciado, CLT) pedem mais balanço e mais ombro para os quadros vizinhos passarem no `quadros16.py`, porque a altura já bate +4 %.
- **Só o parado:** `--motions idle` importa só o parado, na escala da classe. Numa classe M16 (viciado), andar, ataque e corrida ficam como estão.
- **CLT (R06):** `--motions idle` troca o idle8 pelo idle16 nas **8 direções desenhadas**, sem espelho. O espelho trocaria o relógio e o crachá de lado e tiraria os pés do lugar do attack128. O pivô é o âncora do idle8 (48), o mesmo ponto contra o qual o attack128 e o hurt16 foram desenhados. No cliente, `hasIdle16` faz a classe R06 respirar, e corrida, empurrar, puxar e dano continuam achando o lado desenhado pelas próprias folhas. O idle8 fica no manifest como referência de escala.

## Construir (build16, card animacao-construir-6)

- **Quando toca:** o herói PARADO a ≤ 3 u da borda de uma defesa em obra (`obra-1..3`, `BUILD_REACH` da sim), virado para ela (`src/client/sprites/build-facing.ts`). Construir não trava o herói: andar volta à corrida e a obra segue sozinha. Arma guardada enquanto constrói. Vale para o herói, os aliados e os bots (scene.ts) e para o sandbox da cidade (`?sandbox=cidade&torres=1&kit=<peça>`).
- **Folha:** `build/<dir>.png` (768×768, 4×4, 16 poses, loop de 2 s, os dois pés plantados). As 5 direções desenhadas ou nenhuma; o resto é espelho. O importador não mexe nas poses e põe o pivô do parado da direção (`idle16-<dir>`, senão o idle8), como no hurt16: o herói pega a ferramenta sem pular de lado.
- **Arte:** `viagem-board/evidence/NEW-20261025-ORQ-animacao-construir-6/gerar/gerar.mjs` (Codex, a piada de cada herói) → `remontar/um.sh <quem> <dir> <job> [DELTA]` (esticar + montar-build.mjs: escala pela altura mediana, pés no x do parado, emenda 15→0).

## Trabalhar (work16, card animacao-trabalhar-6)

- **Quando toca:** no turno de um bico (RunView.banks workers). Uma classe com work16 fica no anel da loja tocando o loop, de costas para a porta e virada para a frente da loja (`src/client/sprites/work-facing.ts`: `frontNormal` das 4 viradas da câmera); uma sem work16 continua entrando pela porta (some). A sim não muda: no turno não atira e não toma dano. Vale para o herói, os aliados e os bots (scene.ts) e para o sandbox da cidade (`?sandbox=cidade&mapa=real&bancos=1&bicos=1&turno=1&hero=112.5,99.9&class=<id>`). Arma guardada.
- **Folha:** `work/<dir>.png` (768×768, 4×4, 16 poses, loop de 3,2 s, os dois pés plantados), o plano do build16, mais lento porque a piada segura poses. O importador aceita até `WORK_HELD_POSES` (2) poses repetidas, sempre a vizinha anterior (um quadro do Codex que quebrava o loop: caneca que some, corpo virado).
- **Arte:** `viagem-board/evidence/NEW-20261025-ORQ-animacao-trabalhar-6/gerar/gerar.mjs` (Codex, a piada de trabalho de cada herói) → `remontar/um.sh <quem> <dir> <job> [DELTA]` (`montar-work.mjs`: o montador do build16 com a COR medida contra o parado) → `remontar/busca.sh` (a cabeça por DELTA). Escolhas por direção em `remontar/escolhas.txt`.
