#!/bin/bash
cd /mnt/d/Gits/viagem-board/evidence/NEW-20261023-ORQ-selecao-mobile-instagram/gerar || exit 1
for n in gato maromba viciado clt; do
  bash gera.sh perfil-$n ref-$n.png
  bash gera.sh grade-$n ref-$n.png
done
bash gera.sh icones ref-viciado.png
ls -la *.png
