# NEW-20261025-ORQ-alarme-uno-pausa · prova da pausa

Chromium headless (Playwright, vaga browser-2), AudioContext real a 48 kHz. A `AlarmLoop` do jogo (src/client/audio/alarm.ts,
empacotada com esbuild) baixa e decodifica o `uno-alarme.webm` de verdade, com o herói colado no carro (distância 0).
Nível RMS da saída medido a cada 50 ms durante 17 s (`alarme-pausa-log.json`). O áudio gravado está em `alarme-pausa.webm`.

Arquivo: 3,54 s, mono. Buffer em loop: 7,54 s (passada + 4 s).

| trecho | tempo |
|---|---|
| sirene | 0,06–2,40 s |
| bip, bip | 2,58–3,11 s |
| **silêncio** | **3,17–7,49 s** (os 4 s da pausa, mais a cauda quieta do arquivo) |
| sirene de novo | 7,55–9,90 s |
| bip, bip | 10,07–10,68 s |
| **silêncio** | **10,74–15,05 s** |
| sirene de novo | 15,11 s… |

Para rodar de novo: `esbuild src/client/audio/alarm.ts --bundle --format=iife --global-name=Alarm --outfile=<tmp>/alarm.js` e depois
`node prova.mjs <tmp>/alarm.js public <saída>` (usa o Playwright de D:/Gits/viagem-tools).
