#!/bin/bash
# Prints antes×depois da aura (card NEW-20261029-ORQ-aura-defumador-fumaca): 2 builds (sem tsc, já conferido), dist servido
# por um servidor estático, 1 Chromium na vaga browser-N. Uso: bash rodar.sh 81.532,84.524 72.556,51.612 (praça de pedras, neve fofa: cidade-nevada.json)
set -e
WT=D:/Gits/viagem-wt/aura-defumador-fumaca; EV=$WT/evidence/NEW-20261029-ORQ-aura-defumador-fumaca; SCR=C:/Users/Cabraiz/AppData/Local/Temp/claude/D--Gits-viagem/d1f61a22-8639-403c-ae9a-0fd77c94e262/scratchpad
cd $WT
VAGA=""; for v in browser-1 browser-2; do if mkdir D:/Gits/viagem-board/locks/$v 2>/dev/null; then VAGA=$v; break; fi; done
[ -z "$VAGA" ] && { echo "sem vaga de navegador"; exit 3; }
echo "{\"quem\":\"E4\",\"at\":\"$(date -u +%FT%TZ)\"}" > D:/Gits/viagem-board/locks/$VAGA/dono.json
PID=""
limpa(){ [ -n "$PID" ] && taskkill //F //T //PID $PID >/dev/null 2>&1 || true; git checkout -q HEAD -- src/client/render/aura-ring.ts public/art/fx/aura-defumador.webp; rm -rf D:/Gits/viagem-board/locks/$VAGA; }
trap limpa EXIT
[ -d $SCR/dist-depois ] || npx vite build --outDir $SCR/dist-depois --emptyOutDir --logLevel warn
if [ ! -d $SCR/dist-antes ]; then
  git show origin/main:src/client/render/aura-ring.ts > src/client/render/aura-ring.ts
  git show origin/main:public/art/fx/aura-defumador.webp > public/art/fx/aura-defumador.webp
  npx vite build --outDir $SCR/dist-antes --emptyOutDir --logLevel warn
  git checkout -q HEAD -- src/client/render/aura-ring.ts public/art/fx/aura-defumador.webp
fi
# Uma porta por build (o $! do Git Bash não é o PID do Windows: o servidor diz o seu no log e é por ele que morre).
PORTA=4291
for R in depois antes; do
  PORTA=$((PORTA+1)); node $EV/estatico.mjs $SCR/dist-$R $PORTA > $SCR/estatico-$R.log 2>&1 &
  sleep 1; grep -q "em $PORTA pid" $SCR/estatico-$R.log || { cat $SCR/estatico-$R.log; exit 4; }
  PID=$(sed -n 's/.* pid \([0-9]*\).*/\1/p' $SCR/estatico-$R.log)
  node $EV/prints.mjs $PORTA $R "$@"
  taskkill //F //T //PID $PID >/dev/null 2>&1 || true; PID=""
done
for R in depois antes; do
  ffmpeg -loglevel error -y -framerate 15 -i $EV/$R-calcada-quadros/%03d.png -vf "crop=600:760:90:520,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" $EV/$R-3s.gif
done
ls -la $EV/*.png $EV/*.gif
