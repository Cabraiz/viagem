# Supervisão quadro a quadro: animações idle e atirando das torres B/C

Fontes: as folhas (`levantamento.png`, `medir.mjs`, `jitter.mjs`, `limpar-ilhas.mjs --check`) e o jogo. O jogo foi gravado
no CI com `node tools/gif-ci.mjs vgm/torres-animacao-idle-tiro torres --tela ambas --segundos 25 --lento 12 --workflow-ref
vgm/torres-animacao-idle-tiro`, no commit ca3ef77, run 40589698904: 0 erros no celular e no PC. A câmera fica na arma
(`foco=torre`), sem o contorno dourado (`contorno=0`), no zoom mais próximo do jogo (1), com a torre 12× mais lenta para
que a captura de ~1,5 quadro/s do CI pegue cada quadro.

| Torre | Idle (loop) | Atirando | Cano/base parados | Ilhas | Contorno | Loop sem salto | Tiro × alvo |
|---|---|---|---|---|---|---|---|
| B2 Rojão | 4 q a 4 fps, tripulante se mexe | 6 q: os rojões saem do suporte | sim (tremor ≤ 1 px de arte) | 1 de 2 px (não regravada) | igual | sim | sai das pontas dos rojões (meta.muzzle), fumaça |
| B3 Morteiro | 4 q | 8 q: carrega e dispara; clarão na boca do tubo, fumaça sobe | tubo fixo; a tripulação anda | **44 apagadas** (vazamento da célula vizinha) | igual | sim | clarão na boca do tubo; granada em arco |
| B4 Lança-Foguetes | 4 q | 10 q: a tripulação recarrega, o lançador fixo | sim | **83 apagadas** | igual | sim | foguetes saem da face dos tubos, fumaça |
| B5 Obuseiro | 4 q | 10 q: recuo do cano e volta | base fixa, o cano recua (é o tiro) | 3 de 1 px (não regravada) | igual | sim | clarão na ponta do cano nas 8 direções |
| C2 Holofote | 4 q | 4 q; o facho sai da lente | sim | 0 | igual | sim | facho da lente até o alvo |
| C3 Arame e Sirene | 4 q: tripulante na manivela (antes nem aparecia) | 6 q: gira a sirene | sim | 6 de 15 px (não regravada) | igual | sim | aura em volta (sem mira, como a sim) |
| C4 Antiaérea | 4 q | 8 q, reinicia a cada rajada (0,3 s) | sim | 0 | igual | sim | traçantes e clarão das pontas dos 4 canos (SW, S, N, NE vistos) |
| C5 Radar | 4 q; a antena varre sozinha | 12 q: a antena gira e solta o pulso; anel azul no alvo | sim | **31 apagadas** | igual | sim | pulso no grupo mais denso (regra nova) |

- **Sincronia:** o fire começa no quadro 0 no tique em que a sim atira (`fireAt` = a rajada desenhada, `weaponPose`) e
  reinicia a cada rajada. Entre as rajadas fica o idle, com fase diferente por torre (`weaponSeed`). Com movimento
  reduzido, o idle fica parado e o tiro continua aparecendo.
- **Boca:** marcada à mão na grade (`grade.mjs` → `bocas.mjs` → `meta.muzzle`) para as 6 torres que disparam por cano ou
  lente. Uma heurística automática (o ponto mais distante na direção do tiro) errava onde a tripulação fica na frente da
  arma e foi descartada.
- **Gustavão:** não tem arte de torre (é procedural, no trilho). Fica como está, com o ok do ORQ.
- **Ramo A:** usa o mesmo código (as folhas fire já existiam). A arte nova do ramo A é outro card.
