#!/usr/bin/env bash
# Bench ao vivo do card bot-nao-trava (vaga pesada): antes × depois, seeds 1–16, 1p/3p/6p, chaveiro + ninhos + manual.
# "antes" = a main de agora sem o conserto d9f7008a (antes.patch: tira só ele; mantém bots-resgatam e bots-build-parado).
# Uso (Git Bash, com a vaga): bash evidence/bot-nao-trava-28-10/bench/rodar.sh
set -euo pipefail
W=D:/Gits/viagem-wt/bot-nao-trava; B=evidence/bot-nao-trava-28-10/bench
cd "$W"
test -z "$(git status --porcelain -- src)" || { echo "src sujo; pare"; exit 1; }
restore(){ git -C "$W" checkout -- src/sim/bot-loot.ts src/sim/bot-brain.ts; }
git apply "$B/antes.patch"; trap restore EXIT
npx tsx scripts/bench-city-run.ts --objective chaveiro --combat manual --mode ninhos --seeds 1-16 --players 1,3,6 \
  --out "$B/antes.json" > "$B/antes-log.txt" 2>&1
restore; trap - EXIT
test -z "$(git status --porcelain -- src)" || { echo "restauração falhou"; exit 1; }
npx tsx scripts/bench-city-run.ts --objective chaveiro --combat manual --mode ninhos --seeds 1-16 --players 1,3,6 \
  --out "$B/depois.json" --before "$B/antes.json" > "$B/log.txt" 2>&1
tail -40 "$B/log.txt"
