# Etapa 1 · Conceito do ramo A como postos de defesa

Prancha: `conceito/prancha-conceito.png`. As 7 aparecem em 2 variantes (linha A em cima, linha B embaixo), cada uma ao lado
do herói na escala do jogo. A Antiaérea C4 (1,9×) fica na ponta como referência. Linha vermelha: limite de 2,5× o herói.

Como a escala foi medida: a arte da torre é desenhada a 0,5 px de mundo por px de arte, e a figura do herói a
96 × HERO_DRAW_SCALE 0,8 = 76,8 px de mundo (154 px de arte). Cada conceito foi escalado para a largura habitual do seu
footprint (2×2 ≈ 370 px de arte, 3×3 ≈ 520), com teto de 2,45× a altura do herói. Só as duas torres esbeltas (A2 e A4b)
bateram no teto e ficaram mais estreitas, sem encolher um prédio.

Geração: Codex (gpt-6.1-sol, esforço baixo), 1 chamada por torre com as 2 variantes lado a lado, 7 chamadas no total.
Prompts em `prompts/` (`_comum.txt` + um arquivo por torre). Referência só de estilo, câmera e escala:
`refs/ref-estilo.png` (herói + Morteiro, Antiaérea, Holofote e Obuseiro).

## Nomes (sem "Prédio"; os ids ficam iguais por causa do save e do protocolo)

| Id (fica) | Hoje | Proposto | Posto | Altura (A / B) |
|---|---|---|---|---|
| vigia-do-predio | T1 Vigia do Prédio | **Guarita** | guarita de madeira num anel de sacos, 1 vigia | 1,9× / 1,9× |
| vigias-armados | A2 Vigias Armados | Vigias Armados (fica) | torre de vigia de madeira com escada e telhado de zinco, 2 vigias | 2,4× / 2,4× |
| atiradores-do-telhado | A3 Atiradores do Telhado | **Plataforma de Tiro** | andaime com deque e parapeito de sacos, 3 atiradores | 1,7× / 1,7× |
| ninho-de-metralhadora | A4 Ninho de Metralhadora | Ninho de Metralhadora (fica) | ninho redondo de sacos com metralhadora no tripé, 2 homens | 2,4× / 2,4× |
| guarnicao-do-predio | A5 Guarnição do Prédio | **Bunker** | bunker baixo de concreto com seteiras e ninho duplo no teto | 2,4× / 2,5× |
| ninho-do-sniper | A4b Ninho do Sniper | Ninho do Sniper (fica) | torre esbelta de toras com esconderijo camuflado, sniper + observador | 2,4× / 2,4× |
| equipe-antimaterial | A5b Equipe Antimaterial | Equipe Antimaterial (fica) | casamata de chapas de aço e sacos com fuzil antimaterial no bipé | 1,4× / 1,5× |

"Telhado" sai junto, porque também pressupõe um prédio. Alternativas, se o usuário preferir: "Torre de Vigia" (A2),
"Atiradores do Andaime" (A3) e "Bunker da Guarnição" (A5).

## Recomendação

- **A** (madeira e sacos) para T1, A2, A3, A4 e A4b; **B** (mais concreto e aço) para A5 Bunker e A5b Antimaterial.
  A progressão de material fica madeira → sacos → concreto/aço, e o tier 5 tem cara de mais robusto.
- A3 Plataforma (1,7×) ficou mais baixa que a A2 (2,4×) e parece uma A2 mais fraca. Na arte final, o deque sobe para uns
  2,1× e o parapeito ganha chapa de aço, para a A3 ler como um passo acima da A2.

## O que muda da prancha para a arte final (etapa 2)

- **Os atiradores saem da base.** O jogo desenha a base (4 vistas × obra-1, obra-2, obra-3, pronta, danificada, ruína)
  e põe por cima a "torreta" no ponto `mount`, com os atiradores em 8 direções. A base final vem vazia (só o posto), e
  os atiradores são desenhados na **altura do herói**. Nos conceitos, essa escala variou: são pequenos em T1, A2 e A3 e
  maiores que o herói no A4.
- Visto no código, entra na etapa das animações: hoje o cliente usa só o quadro 0 da folha `idle`
  (`towers.ts`, `setFrame(weaponFrame(t.dir,0,frames))`), e a folha `fire` nunca é carregada. Por isso as torres parecem
  paradas.
- Causa provável do `Texture key already in use: art:torres:vigia-do-predio:idle`: a T1 é erguida antes de a fila tardia
  baixar as folhas, e `needTowerArt` (scene.ts) busca a folha por fora enquanto o loader do Phaser ainda tem a mesma chave
  na fila. Quando o loader termina, registra a chave de novo. Correção na etapa 2: tirar a chave da fila do loader antes
  da busca de alta prioridade.
