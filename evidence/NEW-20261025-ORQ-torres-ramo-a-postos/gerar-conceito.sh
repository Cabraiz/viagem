#!/bin/bash
# Etapa 1: one Codex call per tower (2 variants side by side), serial, skipping what already exists.
D=/mnt/d/Gits/viagem-wt/torres-ramo-a-postos/evidence/NEW-20261025-ORQ-torres-ramo-a-postos
for k in vigia-do-predio vigias-armados atiradores-do-telhado ninho-de-metralhadora guarnicao-do-predio ninho-do-sniper equipe-antimaterial; do
  out=$D/conceito/$k.webp
  [ -s "$out" ] && { echo "pula $k"; continue; }
  cat $D/prompts/_comum.txt $D/prompts/$k.txt > $D/conceito/$k.prompt.txt
  echo "== $k $(date -u +%H:%M:%S)"
  bash $D/gen.sh $D/conceito/$k.prompt.txt $D/conceito/$k.png $D/refs/ref-estilo.png > $D/conceito/$k.log 2>&1 || echo "falhou $k (ver $k.log)"
  [ -s "$D/conceito/$k.png" ] && echo "ok $k (png; converter para webp)" || echo "SEM ARQUIVO $k"
done
