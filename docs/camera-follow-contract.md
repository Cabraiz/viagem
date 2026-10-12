# Câmera que segue o jogador (D-019)

Substitui o [`whole-island-contract.md`](whole-island-contract.md). Cards: `NEW-20261009-ORQ-camera-segue` e
`NEW-20261009-UX-camera-segue`. Código: `src/client/framing.ts` (`followZoom`, `FollowCamera`, `followTarget`, `edgeOf`),
`src/client/scene.ts` (ligação), `src/client/projection.ts` (`rotationLocked`, `viewDepth` com origem),
`src/contract/offscreen.ts` (o contrato com o diretor). Testes: `tests/client/camera-follow.test.ts`.

Esperado:
- **Tamanho:** um zoom fixo por orientação, que só depende do tamanho da tela. O herói tem a maior entre a razão do
  Vampire Survivors (7,0% do lado menor, medida nos prints da Steam a 1280×800) e a do piso do D-009 (56 px em 390 px,
  14,4%), nunca menos de 56 px CSS. Num celular a razão do VS daria 27 px, então vale o piso: zoom 0,583, herói 56 px,
  gosma 33 px, pernilongo 30 px. A câmera nunca mostra mais mundo que `VISIBLE_SHORT_PX × VISIBLE_LONG_PX`.
- **Onde fica o herói:** o corpo dele no centro da **área útil** (`IslandScene.usefulArea`, do UX-zonas-tela), não no
  centro da tela. Sem HUD (exploração solo, sala de espera), no centro da tela.
- **Movimento:** segue com suavização exponencial de 160 ms (independente do FPS) e olha 15% da meia área útil para
  onde o herói anda, com entrada e saída de 400 ms (parar não dá tranco). O olhar à frente nunca empurra a caixa do
  herói ± 40 px para fora da área útil (na paisagem sobra ~8 px). Sem tremor de tela.
- **Contrato com o diretor (`offscreen.ts`):** o pé do herói fica a no máximo `CAMERA_OFFSET_SHORT_PX` (130) e
  `CAMERA_OFFSET_LONG_PX` (150) px de mundo do centro da câmera nos eixos menor e maior da tela, mais
  `CAMERA_LAG_UNITS` (1 u) de atraso. Se mudar algum desses números ou o zoom, mude `offscreen.ts` junto: o teste
  "every point on a follow-camera screen counts as visible" falha se a tela sair do retângulo do contrato.
- **4 vistas:** ↶ ↷ giram 90° e a câmera volta para cima do herói no mesmo quadro (gira em volta dele). Quatro giros
  devolvem a mesma vista e a mesma câmera. O joystick continua relativo à tela, e o toque no bicho usa
  `getWorldPoint` da câmera que segue.
- **Trava:** a vista não gira durante a onda (`rotationLocked`: fase `combat` fora do intervalo `prepare`); os botões
  ficam cinza e voltam no intervalo, no lobby, na contagem e no resultado.
- **Mundo infinito:** a profundidade é tomada em relação a uma origem que acompanha o herói em passos de 24 u, para
  ficar na faixa da ilha (abaixo das camadas fixas 95 000+, acima do chão −9 970) a qualquer distância.
- **Fora da tela:** `scene.locate(ponto)` diz onde o ponto está na tela, se está na área útil e onde a seta ficaria na
  borda dela (`edgeOf`). Quem desenha as setas e o minimapa são `UX-bordas-fora-da-tela` e `ORQ-minimapa`.

Proibido: voltar a enquadrar a ilha inteira no jogo; zoom que muda sozinho em combate; centrar no meio da tela com
HUD; girar a vista durante a onda; mudar o zoom ou o deslocamento sem mudar o `offscreen.ts`.
