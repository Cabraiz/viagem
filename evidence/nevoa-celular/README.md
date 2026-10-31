# Névoa no celular: cinzas e vento também no Leve

Card NEW-20261031-ORQ-nevoa-cinzas-no-celular.

**Causa:** no Leve (economy), a névoa mostrava só o véu. As faixas de vento e as cinzas eram escondidas.

**Correção:** o Leve mantém as três camadas, com metade dos flocos (`ECONOMY_ASH_SHARE=.5`, `nevoaLayers` em nevoa-rules.ts).

**Movimento reduzido:** o vento anda a 1/5 e as cinzas continuam visíveis.

## Imagens

| Arquivo | O que mostra |
|---|---|
| `comparar-meio.jpg` | O meio da partida em 390×844: Normal e Leve, antes × depois, ao lado do PC. O gravar-partida grava o PC em 1335×620. |
| `leve-zoom.png` | Recorte do Leve: antes não há flocos nem faixas; depois aparecem as cinzas e as faixas diagonais. |
| `antes-leve-curto.gif`, `depois-leve-curto.gif` | 5 s andando no Leve. |

## FPS

Medido com `scripts/gravar-partida.mjs --tela celular --cpu 4 --medir --sem-gif`, em 20 s andando na cidade (névoa 2), 390×844 com DPR 3. Antes e depois foram rodados intercalados, 2 rodadas cada. Os valores brutos estão em `medida.json`.

| | fps desenhado | ms P50 | ms P95 |
|---|---|---|---|
| Leve antes | 22.0 / 23.0 | 27.2 / 25.7 | 62.6 / 51.2 |
| Leve depois | 22.5 / 24.8 | 27.3 / 22.5 | 58.6 / 41.7 |
| Normal antes | 24.0 / 23.9 | 26.1 / 26.2 | 55.5 / 51.5 |
| Normal depois (mesmo código) | 23.1 / 18.7 | 27.8 / 31.3 | 50.5 / 76.2 |

O código do Normal não mudou, e mesmo assim ele variou de 18.7 a 24 fps entre rodadas. Esse é o ruído da máquina.

No Leve, a diferença entre antes e depois fica dentro desse ruído. As cinzas não pesam de forma mensurável, então não reduzi além da metade.

## "Preto"

Não reproduzi em nenhuma das 10 gravações, nem na cidade nem no Leve, nem no Normal.

O print do usuário (viagem-board/evidence/nevoa-celular-usuario.jpg) é da ilha tropical. Lá a névoa é 0 de propósito (`NEVOA_DEFAULT.ilha=0`), então não há cinza nem vento.
