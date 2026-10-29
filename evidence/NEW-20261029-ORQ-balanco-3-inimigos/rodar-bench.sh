#!/usr/bin/env bash
# Bench do card balanco-3-inimigos (vaga pesada): $1 = versão (antes | so3-sem-ajuste | so3-ajustado).
# antes: e5-bench-antes = origin/vgm/missao-proteger-uno-tempo (main + missão, elenco legado).
# so3-*: e5-bench-depois = este branch + merge local da missão (ONDAS padrão). Os dois com o patch bench-mortes-por-onda.patch.
set -e
E=D:/Gits/viagem-wt/balanco-3-inimigos/evidence/NEW-20261029-ORQ-balanco-3-inimigos
COMMON="--objective chaveiro --mode ninhos --combat manual --seeds 1-16 --players 1,3,6"
W=D:/Gits/viagem-wt/e5-bench-depois;[ "$1" = antes ] && W=D:/Gits/viagem-wt/e5-bench-antes
(cd $W && node --experimental-strip-types scripts/bench-city-run.ts $COMMON --out $E/$1.json > $E/$1.txt 2>&1)
echo fim $1
