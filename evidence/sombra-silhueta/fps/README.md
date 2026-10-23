# FPS da sombra-silhueta (card NEW-20261022-ORQ-sombra-silhueta)

Roteiro `estresse.mjs` do E1 (`?sandbox=horda&n=N`, build de produção, `scripts/serve.mjs`), 12 s por medida.
Antes = 6ae2842c (elipse de contato + silhueta só na qualidade cheia). Depois = 2ca22a3 (só a silhueta, em toda qualidade).
As duas builds com a mesma arte (548 MB de textura), rodadas em seguida (06:14–06:43Z), mesmo PC.

## Celular (390×844, CPU 4×), fps médio

| bichos | cheio antes | cheio depois | Leve antes | Leve depois |
|---|---|---|---|---|
| 300 | 41,7 | 41,8 | 42,5 | 41,6 |
| 600 | 34,5 | 42,2 | 41,5 | 42,3 |
| 1500 | 24,4 | 28,3 | 28,5 | 27,8 |

## PC (1335×620, CPU 1×), 1500 bichos

| | antes | depois |
|---|---|---|
| cheio | 41,5 | 42,5 |
| Leve | 43,0 | 42,5 |

Cheio: igual ou melhor (cada bicho tinha elipse + silhueta, agora só a silhueta). Leve: ganhou a silhueta no lugar da
elipse (mesmo número de sprites por bicho) e ficou igual dentro do ruído. Sem LOD: nada caiu.
`depois-rodada1/` é uma rodada 2 h antes com o PC carregado por outras sessões (números mais baixos e ruidosos; não
comparável), guardada só para registro.
