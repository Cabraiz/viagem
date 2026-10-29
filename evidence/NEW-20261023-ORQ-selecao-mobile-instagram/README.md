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
| Vendedor de Praia | 4 | Gargalhada de frente, rosto e óculos no centro e o chapéu inteiro dentro do círculo. As quatro são parecidas (todas rindo); na 1 e na 3 a aba do chapéu encosta na borda e seria cortada pelo círculo. |
| Aposentado | 3 | Olhos abertos e rosto no centro, com o cafezinho da pose dele no menu (sentado no banquinho). A 2 (piscadela e joinha) é simpática, mas o polegar fica na borda e o círculo corta. Grade: as variações 1, 2 e 5 da tela dele, cortadas ao quadrado nele (sem Codex novo). |

`recorta.cjs` divide as folhas pelas faixas brancas; `folha.cjs` monta a folha de contato (os dois rodam sobre os PNG da pasta do board).

## Etapas 3 e 4 (E2) — a tela no celular em pé

- Código: `src/client/ui/insta.ts` (dados, textos e HTML), `src/client/ui/insta.css` (só sob `(orientation: portrait) and (max-width: 820px)`), `src/main.ts` (monta, toques, ≡ = configurações, dança e retrato pausados no perfil). PC e celular deitado continuam no estádio e não baixam nada do perfil.
- Arte: `scripts/insta-arte.mjs` gera `public/art/menu/insta/` (q95, 2x o tamanho na tela) a partir de `viagem-board/evidence/<ID>/gerar`; `scripts/art-lite.mjs --kinds menu` faz as cópias `public/art/lite/menu/insta/`, que a página carrega (~360 KB a tela inteira).
- Medidas: cada faixa é o px da referência (card 734x1415) vezes `--u`; o card cabe inteiro na tela (largura ou altura), sem rolagem. `prints/medidas.txt` tem cada faixa medida no DOM, em px da referência: barra 17–135, stories 151–365, perfil 458–778, chips 782–852, abas 880–951, grade 967–1232, botão 1251–1374 (referência: 17–134, 151–366, 458–778, 782–852, 880–955, 967–1231, 1251–1373).
- Fotos da grade: 228x262 como na referência (não quadradas), cortadas no meio.
- Ícones: chips, selo e cadeado são os do Codex; sino, ≡ e abas são traço fino em SVG, como na referência (os 3D ficavam pesados a 20 px).
- Fonte do jogo (Lilita One / M PLUS Rounded) é mais larga que a da referência: os chips têm a largura do texto (nunca reticências) e o @ encolhe para caber com o selo (medido depois da fonte carregar).
- Bloqueado (Maromba): story com cadeado, perfil visível, grade vira "Esta conta é privada" (nenhuma foto dele é pedida), botão EM BREVE.
- Etapa do nome: SELECIONAR troca abas+grade pelo campo de nome; BORA! confirma; tocar num story volta a escolher.
- `print.cjs` (prints DPR 2 lado a lado + medidas), `interacao.cjs` (16 verificações de toque/giro/console), `outros.cjs` (PC e deitado sem o perfil).
