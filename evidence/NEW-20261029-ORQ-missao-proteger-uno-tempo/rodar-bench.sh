#!/usr/bin/env bash
# Bench do card missao-proteger-uno-tempo: antes (origin/main) × depois (relógio 5:00) × depois com ondas adiantadas.
set -e
E=D:/Gits/viagem-wt/missao-proteger-uno-tempo/evidence/NEW-20261029-ORQ-missao-proteger-uno-tempo
COMMON="--objective chaveiro --mode ninhos --combat manual --seeds 1-16 --players 1,3,6"
ONDAS='{"minerva":30,"first":[5,15],"firstLate":[0,0],"explore":30}'
(cd D:/Gits/viagem-wt/e5-bench-antes && node --experimental-strip-types scripts/bench-city-run.ts $COMMON --out $E/antes.json > $E/antes.txt 2>&1)
(cd D:/Gits/viagem-wt/missao-proteger-uno-tempo && node --experimental-strip-types scripts/bench-city-run.ts $COMMON --out $E/depois.json > $E/depois.txt 2>&1)
(cd D:/Gits/viagem-wt/missao-proteger-uno-tempo && node --experimental-strip-types scripts/bench-city-run.ts $COMMON --nest-pace "$ONDAS" --out $E/depois-ondas.json > $E/depois-ondas.txt 2>&1)
echo fim
