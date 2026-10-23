#!/bin/bash
# uso (WSL): bash gera.sh <nome-do-prompt> <imagem...>
cd /mnt/d/Gits/viagem-board/evidence/NEW-20261023-ORQ-selecao-mobile-instagram/gerar || exit 1
N=$1; shift
codex exec -m gpt-6.1-sol -c model_reasoning_effort=low --skip-git-repo-check --disable apps -s workspace-write "$(cat prompt-$N.txt)" -i "$@" < /dev/null > codex-$N.log 2>&1
tail -1 codex-$N.log
