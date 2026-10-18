# Ritmo de XP antes/depois de tirar as gemas (D-054)

Bench: `node --experimental-strip-types scripts/bench-city-run.ts --seeds 1-24 --players 1,3,6 --objective chaveiro --mode ninhos --combat manual --cap-min 15`
(o modo das salas: chaveiro + ninhos + combate manual). "antes" = d66654a (main 97d3464 + o registro `levels[]` no bench), "depois" = vgm/remover-gemas.
`levels[i]` = segundo de simulação em que o time chegou ao nível i+2. Tabelas: mediana sobre as 24 runs que chegaram ao nível.

Vitórias (de 24): 1p 10 → 4 · 3p 14 → 14 · 6p 16 → 20.
Controle 1p (o "depois" com um sorteio a mais no abate, só para repor o fluxo do RNG de antes): 9/24. A queda do 1p é ruído do RNG, não efeito da mudança.

Leitura: sem coleta, o XP entra na hora do abate, e os níveis chegam ~10–30% mais cedo (mediana ~15%; os bots não pegavam toda gema na hora).
O valor de cada abate é o mesmo (D-054); não mexi na curva. Se o balanço quiser o ritmo de antes, o ajuste é ~-15% no XP do abate (E6).

```

1p — antes 24 runs (defeat/5.58min victory/12.96min defeat/11.97min victory/12.57min defeat/4.84min defeat/10.13min defeat/11.32min victory/12.12min victory/11.71min defeat/10.85min victory/11.87min defeat/5.12min defeat/11.22min defeat/10.71min victory/11.96min defeat/10.02min victory/12.22min victory/12.28min victory/12.06min defeat/9.19min defeat/4.72min victory/11.7min defeat/11.35min defeat/5.4min), depois 24 (defeat/6.04min defeat/9.49min defeat/10.17min defeat/11.05min defeat/4.83min defeat/11.18min victory/12.26min defeat/12.12min defeat/10.19min victory/11.9min victory/11.85min defeat/5.12min defeat/9.56min defeat/10.71min defeat/11.58min defeat/8.23min defeat/12.08min victory/12.46min defeat/11.34min defeat/10.95min defeat/4.72min defeat/11.85min defeat/8.77min defeat/5.42min)
nível | antes (mediana s) | depois (mediana s) | diferença
2 | 285 | 205 | -80 s (-28%)
3 | 461 | 302 | -159 s (-34%)
4 | 624 | 409 | -215 s (-34%)
5 | 673 | 530 | -143 s (-21%)
6 | 651 | 636 | -15 s (-2%)
nível final: antes 2,5,6,5,2,3,3,4,5,4,6,2,5,4,5,2,5,5,5,2,2,4,2,2 · depois 3,4,6,5,2,5,5,6,5,6,6,2,5,5,6,5,5,5,6,5,2,5,4,2

3p — antes 24 runs (defeat/6.63min defeat/8.14min victory/11.41min victory/10.53min victory/8.91min defeat/7.12min defeat/4.85min victory/10.96min victory/9.99min victory/9.73min victory/9.82min defeat/5.09min victory/9.11min defeat/8.39min defeat/9.69min victory/9.93min defeat/3.63min victory/9.23min victory/10.22min defeat/3.26min defeat/6.46min victory/10.2min victory/10.17min victory/10.67min), depois 24 (defeat/6.63min defeat/8.67min defeat/10.69min victory/10.69min victory/8.96min victory/8.95min defeat/4.84min defeat/5.98min victory/10.15min victory/9.51min victory/10.23min victory/8.97min victory/9.08min victory/9.62min defeat/9.59min defeat/10.09min defeat/3.42min victory/9.69min victory/11.19min defeat/3.26min defeat/9.21min victory/9.59min victory/10.45min victory/10.01min)
nível | antes (mediana s) | depois (mediana s) | diferença
2 | 173 | 147 | -26 s (-15%)
3 | 241 | 197 | -44 s (-18%)
4 | 302 | 269 | -34 s (-11%)
5 | 352 | 308 | -44 s (-12%)
6 | 470 | 366 | -104 s (-22%)
7 | 495 | 439 | -56 s (-11%)
8 | 523 | 497 | -25 s (-5%)
9 | 568 | 560 | -7 s (-1%)
10 | 575 | 579 | 4 s (1%)
11 | 646 | 617 | -29 s (-5%)
nível final: antes 5,7,11,10,7,5,3,9,8,7,8,4,7,6,8,8,2,7,8,2,5,8,7,8 · depois 5,8,11,10,8,8,4,5,9,9,9,8,8,8,9,9,2,10,10,2,8,8,9,9

6p — antes 24 runs (victory/9.93min defeat/6.69min defeat/8.94min defeat/8.55min victory/8.76min victory/8.8min victory/10.37min defeat/9.37min victory/9.26min victory/9.04min victory/9.88min victory/8.84min victory/9.16min victory/9.86min victory/9.44min victory/10.06min defeat/9.63min victory/10.58min victory/11.27min defeat/4.42min defeat/9.25min victory/9.15min victory/10.53min defeat/11.94min), depois 24 (victory/8.95min victory/10.49min defeat/12.06min victory/10.43min victory/8.81min victory/8.98min defeat/5.49min victory/10.55min victory/9.02min victory/8.63min victory/10.59min victory/9.02min victory/9.59min victory/9.76min victory/9.32min victory/10.18min victory/10.31min victory/9.53min victory/11.97min defeat/8.03min defeat/10.84min victory/9.25min victory/10.95min victory/10.84min)
nível | antes (mediana s) | depois (mediana s) | diferença
2 | 130 | 121 | -9 s (-7%)
3 | 159 | 132 | -27 s (-17%)
4 | 170 | 151 | -19 s (-11%)
5 | 244 | 175 | -69 s (-28%)
6 | 285 | 215 | -70 s (-25%)
7 | 309 | 257 | -52 s (-17%)
8 | 347 | 305 | -42 s (-12%)
9 | 397 | 337 | -60 s (-15%)
10 | 441 | 382 | -59 s (-13%)
11 | 469 | 421 | -47 s (-10%)
12 | 511 | 469 | -42 s (-8%)
13 | 547 | 514 | -33 s (-6%)
14 | 549 | 588 | 39 s (7%)
15 | 589 | 607 | 18 s (3%)
16 | - | 709 | -
nível final: antes 13,9,12,12,14,12,12,13,12,14,11,13,14,13,13,13,12,14,14,7,13,11,15,13 · depois 11,16,16,14,13,13,6,15,12,12,14,13,11,13,13,15,15,14,16,11,14,12,14,14
```
