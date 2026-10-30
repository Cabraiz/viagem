#!/usr/bin/env bash
# Bench ao vivo do card bot-nao-trava (vaga pesada): antes × depois, seeds 1–16, 1p/3p/6p, chaveiro + ninhos + manual.
# "antes" = a main c45f9426 (o conserto d9f7008a já está nela): bot-brain.ts e bot-loot.ts da main; "depois" = esta branch.
# (30/10: o antes.patch antigo não aplica mais desde que d9f7008a entrou na main.)
# Uso (Git Bash, com a vaga): bash evidence/bot-nao-trava-28-10/bench/rodar.sh
set -euo pipefail
W=D:/Gits/viagem-wt/bot-nao-trava; B=evidence/bot-nao-trava-28-10/bench
cd "$W"
test -z "$(git status --porcelain -- src)" || { echo "src sujo; pare"; exit 1; }
restore(){ git -C "$W" checkout -- src/sim/bot-loot.ts src/sim/bot-brain.ts; }
git show c45f9426:src/sim/bot-brain.ts > src/sim/bot-brain.ts; git show c45f9426:src/sim/bot-loot.ts > src/sim/bot-loot.ts; trap restore EXIT
npx tsx scripts/bench-city-run.ts --objective chaveiro --combat manual --mode ninhos --seeds 1-16 --players 1,3,6 \
  --out "$B/antes.json" > "$B/antes-log.txt" 2>&1
restore; trap - EXIT
test -z "$(git status --porcelain -- src)" || { echo "restauração falhou"; exit 1; }
npx tsx scripts/bench-city-run.ts --objective chaveiro --combat manual --mode ninhos --seeds 1-16 --players 1,3,6 \
  --out "$B/depois.json" --before "$B/antes.json" > "$B/log.txt" 2>&1
tail -40 "$B/log.txt"
