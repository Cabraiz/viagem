# Rebuild the 7 crews with the single ruler (regua.json) and the parapets: sh montar_todas.sh [id…]
set -e
cd "$(dirname "$0")"
fps() { case $1 in vigia-do-predio|vigias-armados|atiradores-do-telhado) echo 12;; ninho-de-metralhadora) echo 16;; guarnicao-do-predio) echo 18;; ninho-do-sniper) echo 6;; equipe-antimaterial) echo 5;; esac; }
cw() { case $1 in vigia-do-predio|vigias-armados) echo 256;; *) echo 384;; esac; }
for id in ${@:-vigia-do-predio vigias-armados atiradores-do-telhado ninho-de-metralhadora guarnicao-do-predio ninho-do-sniper equipe-antimaterial}; do
  python montar_crew.py $id $(fps $id) $(cw $id)
done
