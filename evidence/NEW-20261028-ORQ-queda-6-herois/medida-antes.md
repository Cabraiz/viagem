# Queda dos 6 heróis: medida ANTES (28/10, E4)

Régua: `viagem-board/evidence/NEW-20261028-ORQ-queda-6-herois/medir/queda_med.py`. Usa as funções da skill
(`scripts/normalizar-quadros.py`: cabeça e tronco pelo molde do PARADO da mesma direção, IoU de alfa suave). Cada quadro é
girado até o corpo ficar de pé (eixo PCA da máscara, cabeça do lado da camisa), o que dá a medida "ao longo do eixo do corpo"
quando ele deita. Cintura = linha camisa → short pela paleta do herói (`cint_lib` do card das danças, E3), na proporção
da altura, em px de jogo, só com o corpo de pé. Limites: cabeça ±4 %, tronco ±6 % (onde o molde encaixa), altura ±4 % (de pé), cintura ±1 px.

Piso da régua (no parado aprovado `idle16`, 5 direções × 16 quadros): vendedor 0/80 fora; viciado e CLT ~17–25/80 só em
"altura +4 %" (2 px da respiração); aposentado e Gatito com tronco +7 a +23 % onde o braço passa no peito; maromba sem troca
de cor na cintura (a regata cobre tudo: a cintura dele não é medida).

## Achados

1. **As 5 quedas de hoje são de um modelo antigo**, não do herói atual: o viciado de boné AZUL, o CLT sem o cabelo
   cacheado, o maromba sem músculo, o vendedor e o aposentado com outro rosto e outras roupas. Já no quadro de pé a cabeça
   fica 5–20 % fora do parado.
2. **O Gatito (`gato-nada-pra-comer`) não tem folha `downed`.**
3. **O jogo não toca essas folhas**: o aliado caído é o sprite PARADO congelado e girado −90° (`src/client/scene.ts`,
   `setAngle(down?-90:0)`; `character-sprites.ts` pausa a animação quando `!alive`). A etapa 3 precisa ligar a animação.
4. Formato de hoje: 6 quadros × 8 direções, célula 192, linhas S, SW, W, NW, N, NE, E, SE, de pé no quadro 6 e deitado no 1.

| herói | quadros fora (de 48) | cabeça | altura | tronco | cintura |
|---|---|---|---|---|---|
| viciado-em-bet | 42 | 38 | 13 | 0 | 14 |
| clt-cansado | 40 | 28 | 9 | 4 | 16 |
| aposentado | 44 | 41 | 11 | 0 | 7 |
| maromba | 48 | 48 | 20 | 10 | 5 |
| vendedor-praia | 47 | 38 | 20 | 0 | 6 |
| gato-nada-pra-comer | sem folha | — | — | — | — |

Tabelas por quadro e contatos numerados (linha vermelha = cintura medida, só de pé): `antes/<herói>.md` e `antes/<herói>-contato.png`.
