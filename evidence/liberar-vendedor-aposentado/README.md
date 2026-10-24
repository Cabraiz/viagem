# Vendedor de Praia e Aposentado liberados (24/10)

O usuário (24/10, ~04:00Z): "falta liberar o aposentado e o vendedor". Os dois entram em `PLAYABLE_CLASS_IDS` e em
`PERSONAGENS_LIBERADOS` e jogam com as folhas atuais de 4 direções (`dir4` / `dir4c`). A arte de 8 direções vem em outro
card (NEW-20261024-ORQ-vendedor-aposentado-arte-8-direcoes). Até lá eles também ficam em `NOT_FOR_BOTS`.

Partida real local: vite dev deste branch, worker local (`scripts/local-worker.mjs`, lab) e "Jogar sozinho" com o herói
salvo. O herói vai até o bicho vivo mais perto (lab `to`) e segura Atacar. Chromium SwiftShader, DPR 1. Os números estão em
`partida.json`.

| herói | tela | classe na sala | dano / abates | textura faltando | erros / 404 |
|---|---|---|---|---|---|
| vendedor-praia | 1920x1080 | vendedor-praia | 0 / 0 (nenhum bicho ao alcance nos 45 s) | — | — |
| vendedor-praia | 390x844 | vendedor-praia | 30 / 1 | — | — |
| vendedor-praia | 844x390 | vendedor-praia | 0 / 0 | — | — |
| aposentado | 1920x1080 | aposentado | 0 / 0 | — | — |
| aposentado | 390x844 | aposentado | 24 / 0 | — | — |
| aposentado | 844x390 | aposentado | 9 / 1 | — | — |

Nas 6 rodadas a animação de ataque das folhas dir4 tocou (`…:attack:front-right`). O CLT, no mesmo roteiro, fez
18 / 2 (comparação).

Já existia antes, não é destes dois: em 844x390 o cartão "Minuto de Minerva" cobre o herói no centro da tela. O CLT
fica igual.
