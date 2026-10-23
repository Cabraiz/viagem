# Seleção no celular estilo Instagram — etapas 1 e 2 (arte + textos)

Referência do usuário: `referencia-usuario.jpg`. Folha de contato: `folha-contato.jpg`. Textos: `textos.md`.

Arte gerada no Codex (gpt-6.1-sol, effort low, 9 chamadas), com as referências reais do jogo: herói do menu do Viciado e do CLT, o gato do roupão (`vgm/gato-menu-recorte`) e o Maromba da praia (pose 14 de NEW-20261023-ORQ-tela-maromba). Os PNG originais ficam em `viagem-board/evidence/<ID>/gerar/`; aqui vão JPG q92 (`fontes/`) e os prompts.

- `fontes/perfil-<nome>.jpg`: grade 2x2 com 4 opções de foto de perfil.
- `fontes/grade-<nome>.jpg`: 3 fotos para a grade do perfil. Saíram em retrato 5:6 (Viciado, CLT e gato), então serão cortadas ao quadrado no centro.
- `fontes/icones.png`: 10 ícones em fundo verde #00FF00 (sino, menu, verificado, cadeado, grade, vídeo, coração, óculos=Estilo, coroa=Especialidade, pata=Status).

## Foto de perfil escolhida

| Personagem | Escolha | Por quê |
|---|---|---|
| Viciado | 1 | Sorriso aberto e corneta à mostra, olhando para a câmera: é o "acha que vai ficar rico" num relance e lê bem no círculo pequeno do story. A 3 tem os olhos fechados e some no tamanho pequeno. |
| CLT | 1 | Cabeça apoiada na mão, olheiras e cara de segunda-feira: o cansaço se lê sem legenda. A 3 (bocejo) é engraçada, mas a mão cobre a boca e os olhos estão fechados. |
| Gato | 1 | Lágrima e tigela vazia: é a piada do personagem ("nada pra comer em casa"). A 3 (grito) é mais genérica. |
| Maromba | 4 | Sorriso confiante com o polegar para cima, o "Tá leve!" dele. Rosto no centro; o polegar fica dentro do círculo. |

`recorta.cjs` divide as folhas pelas faixas brancas; `folha.cjs` monta a folha de contato (os dois rodam sobre os PNG da pasta do board).
