#!/bin/bash
cd /mnt/d/Gits/viagem-wt/aura-defumador-fumaca/evidence/NEW-20261029-ORQ-aura-defumador-fumaca/gerado
for N in "$@"; do
  echo "== $N $(date -u +%H:%M:%S)"
  P="$(cat prompt-$N.txt)"
  codex exec -m gpt-6.1-sol -c model_reasoning_effort="low" --skip-git-repo-check --disable apps -s workspace-write "$P" -i "estilo.png" < /dev/null 2>&1 | tail -4
  echo "== fim $N $(date -u +%H:%M:%S)"
done
