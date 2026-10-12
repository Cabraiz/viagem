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

- Dentro de cada bloco, igual à folha de hoje: linha 1 **parado**, linha 2 **andando** (6 quadros, 5 por segundo), linha 3 **ataque** (6 quadros, 6 por segundo, toca uma vez).
- **As 6 células do parado precisam de desenho** (pode repetir o mesmo 6 vezes). O jogo mostra só a 1ª; o importador recusa célula vazia.
- Pode desenhar a esquerda espelhando a direita no editor, se a roupa deixar (bolsa, arma e cabelo trocam de mão).
- **Não desenhe sombra no chão** (o jogo põe o anel embaixo do boneco). Bolsa, capa ou qualquer coisa **abaixo do pé reprova**: o ponto mais baixo do desenho é lido como o pé.

Referência visual: `tests/fixtures/sprites-4dir/tira-referencia.png` (a 1ª célula de cada bloco do lote de TESTE, na ordem da tabela) e o lote inteiro em `tests/fixtures/sprites-4dir/cidadao-comum.dir4.webp`.

## O pivô (onde o boneco pisa)

Coordenadas em pixels **contando de 0 a partir do canto de cima à esquerda da célula**.

- **Pés em y = 168.** É o ponto (0,5; 0,88) da célula, onde o boneco encosta no chão.
- **Pés em x = coluna da classe.** Para não mudar o pivô que o jogador já vê, cada classe mantém a coluna dos pés da sua folha aprovada (a 1ª célula do parado). Nos blocos da esquerda, a coluna é a espelhada: 191 − x.

| Classe: coluna dos pés (direita) |
|---|
| aposentado 104; astrologa 98; caca-promocao 100; **cidadao-comum 109**; **clt-cansado 113**; coach 100; concurseira 97; **conspiracionista 84**; faxineira 101; feirante 93; **gambiarreiro 77**; **gamer-mobile 75**; goleira 94; mae-pet 96; maromba 87; mendigo 92; merendeira 93; motogirl 97; **pagodeiro 83**; **passageira 84**; pedreiro 101; porteiro 89; rainha-bateria 93; rei-arraia 92; rei-pastel 93; roqueira 88; salva-vidas 84; sensei 96; streamer 96; tecnico-ti 87; tia-festa 96; **tio-do-churrasco 67**; universitario 105; vendedor-praia 88; viciado-em-bet 100; vizinha-fofoqueira 93 |

As 8 em negrito têm os pés fora de 96 ± 12 na folha atual. **Não recentralize**: desenhe as 4 direções com os pés na coluna da tabela (± 12), e a esquerda na espelhada. O importador já confere contra essa coluna.

## O que o importador confere (exatamente)

1. Tamanho 1152 × 2304 e canal alfa.
2. **Todas as 72 células**: desenhadas, com fundo transparente e nada encostando na borda.
3. **Cada célula** (parado, andar e ataque): pés em y = 168 ± 8 (o balanço do passo e o bote do ataque cabem nisso).
4. **Cada linha** de cada bloco, pela mediana das 6 células: pés em y = 168 ± 3 no parado e no andar, ± 6 no ataque.
5. **A 1ª célula do parado** de cada bloco: centro dos pés (média das colunas dos pixels nas 6 linhas mais baixas do desenho) na coluna da classe ± 12 (espelhada na esquerda).
6. **Linha por linha contra a frente-direita** (medianas das 6 células, coluna espelhada na esquerda): pés na mesma altura (± 2 px no parado, ± 3 no andar e no ataque), centro dos pés a até 12 px, altura do desenho a até 6 %.

A altura da 1ª célula do parado da frente-direita define a escala no jogo: o boneco é desenhado com **96 px de mundo** de altura, o que dá **56 px de CSS na tela do celular** (≈ 168 pixels físicos num aparelho de densidade 3), medido na cena real em retrato e paisagem.

### Mensagens do importador

| Mensagem | O que fazer |
|---|---|
| `atlas de 4 direções com L×A, esperado 1152×2304` | exportar a folha inteira, 6 × 12 células de 192 |
| `atlas sem transparência` | salvar PNG com canal alfa (sem fundo branco nem xadrez pintado) |
| `célula vazia ou sem fundo transparente (linha L, coluna C)` | desenhar a célula (no parado, repita o desenho) ou apagar o fundo |
| `desenho encostando na borda da célula` | afastar o desenho 1 px da borda (arma, cabelo, efeito) |
| `pés na linha Y da célula … esperado 168 ± 8` | aquela célula subiu ou desceu demais; alinhar os pés |
| `os pés ficam na linha Y (mediana das 6 células)` | a linha toda está fora do chão; mover o bloco |
| `parado: pés centrados em x = X, esperado C ± 12` | mover o boneco para a coluna da classe (tabela acima) |
| `pivô diferente entre direções` | aquela direção pisa em outro ponto que a frente-direita |
| `altura diferente entre direções` | o boneco cresceu ou encolheu naquela direção |
| `a classe não tem folha aprovada` / `já existe; use --replace` | falar com o dev |

Se houver qualquer problema em qualquer atlas do lote, **nada é gravado**, e a lista mostra todos os problemas de uma vez.

## Para o dev

```
# atlas em <pasta>/<id>/atlas-4dir.png (ou <pasta>/<id>.dir4.png)
node --experimental-strip-types scripts/import-sprites.mjs --dir4 <pasta>
```

- Grava `public/art/sprites/<id>.dir4.webp` (sem perda) e a entrada `dir4` (altura e caixa da figura) em `src/client/sprites/sprite-catalog.ts`. Nunca escreve `<id>.webp`; recusa sobrescrever um `.dir4.webp` sem `--replace`.
- Depois de importar, rode `node scripts/art-lite.mjs`: o jogo baixa a cópia com perda em `public/art/lite/sprites/` (N27, ~45% do peso, qualidade medida em `scripts/art-lite.json`), nunca a folha aprovada; `npm test` reprova uma folha sem cópia ou mais nova que ela.
- `--figures` remede as caixas da figura de toda a arte já importada (o jogo não lê pixels durante a partida).
- Lote de TESTE (não é arte): `node scripts/make-lab-sprites4.mjs` e depois `--dir4 artifacts/lab-sprites4 --lab` (grava em `tests/fixtures/sprites-4dir/`). Ele só aparece no servidor de desenvolvimento com `?lab=sprites4` e nunca entra no catálogo nem no build. É derivado da folha aprovada do Cidadão Comum: as costas pintam o rosto de cabelo e levam a faixa "COSTAS", e cada direção tem seu código na camisa (FD, FE, CD, CE).
- **Memória**: um atlas de 4 direções ocupa 1152 × 2304 × 4 bytes ≈ **10,6 MB de memória de vídeo** (a folha única, 2,7 MB). Só carregam as classes da sala; com 6 classes diferentes são ≈ 64 MB, o que cabe em celular intermediário (o orçamento de textura do navegador costuma ficar em centenas de MB), mas é o maior gasto de textura do jogo: num aparelho de 2 GB de RAM vale medir. A textura tem 2304 px de altura: aparelhos com `MAX_TEXTURE_SIZE` 2048 (muito antigos, WebGL 1) não carregariam; quase todo celular desde 2013 aceita 4096.
