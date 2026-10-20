# Personagens MODELO07 e dança no pódio

A referência escolhida é somente o personagem 07 à esquerda de `07-08.png` do estudo do Aposentado. Cada classe mantém sua identidade. O gameplay definitivo dos 35 personagens usa [R06](movement128.md): repouso nativo em oito direções e 128 poses por caminhada/ataque/direção, com câmera intermediária. A dança R05 permanece frontal e é importada separadamente, sem exigir importação/reparo das folhas R05 de seis quadros.

O formato legado aceito pelo importador genérico continua `personagens/<id>.dir8.png`, RGBA 1152×4608, células 192×192, seis colunas e 24 linhas: oito blocos S, SW, W, NW, N, NE, E, SE, com idle/walk/attack. É dividido em dir4 (SE, SW, NE, NW) e dir4c (S, W, N, E). Os 33 legados direcionais presentes são preservados como fallback; não são regravados no plano atual. Tio do Churrasco e Conspiracionista recebem suas entradas diretamente de idle8 e dos 16 clipes nativos R06, sem fabricar folhas antigas. O downed legado permanece; não foram pedidos novos contratos hit/death para heróis.

A dança da revisão 05 usa `menu/danca/<id>.png` 6144×8192: oito colunas × 16 linhas de células 768×512, 128 quadros em ordem de leitura. O sidecar `<id>.meta.json` é:

```json
{"cell":[768,512],"columns":8,"rows":16,"frames":128,"anchor":[0.5,0.9],"fps":3.5555555555555554,"loop":true}
```

A dança nova dura 36 segundos por volta: 128/36 = 3.5555555555555554 fps, um quadro a cada 281,25 ms. A produção usa oito fontes nativas de 16 quadros: A, B, C, D, E, F, G e H. E/F/G/H acrescentam pontes nativas entre os 64 quadros anteriores. A montagem segue A0, E0, C0, F0, B0, G0, D0, H0, …, A15, E15, C15, F15, B15, G15, D15, H15; não duplica quadros nem cria interpolação por Python. O consumidor preserva a ordem de leitura e usa o FPS do manifesto.

Cada personagem recebe uma arma exclusiva somente na dança. O ataque usa mãos vazias. Card, `sources.json` e receipt precisam declarar `attackHands:"empty"` e o mesmo `danceWeaponAssignment:{id,name,reference,sha256,description}` de `armas-exclusivas.json`; os 35 IDs de arma são distintos e o SHA deve corresponder ao arquivo de referência real. O receipt declara `revision:5` e contém 18 fontes nativas: base, oito direções, downed e oito folhas de dança. Esse vínculo valida a arte, sem alterar regras de combate ou armas iniciais.

As entregas antigas de 64 quadros/12 segundos (6144×4096, grade 8×8, fps:64/12), 32 quadros/3,2 segundos (6144×2048, grade 8×4, fps:10) e 16 quadros numa linha (12288×512, `{"cell":[768,512],"anchor":[0.5,0.9],"fps":10}`) continuam aceitas. A conversão mantém cada página em até 4096 px: a dança nova ocupa três páginas 3840×4096 de 40 quadros e uma página 3840×1024 de oito quadros, todas com cinco colunas. Os índices 40, 80 e 120 iniciam páginas aos 11.250, 22.500 e 33.750 ms; o índice 0 retorna aos 36.000 ms. O manifesto registra frames, fps, loop e páginas. O menu baixa somente a dança selecionada, reproduz os quadros sobre o pódio e conserva o retrato quando a dança falta ou falha. Há tentativa da versão sem perda se a cópia lite falha, cancelamento ao trocar de classe e pausa fora da tela; reduzir movimento mantém o primeiro quadro.

O wrapper exclusivo do menu verifica os 35 receipts R05 e seleciona somente `groups:['menu']`, preservando todos os demais grupos e pixels legados. O caminho preferido no workspace é:

```powershell
node '<workspace>/.orquestracao/modelo07-menu-final-import.mjs' validate
node '<workspace>/.orquestracao/modelo07-menu-final-import.mjs' import
node scripts/art-lite.mjs --kinds menu
node scripts/art-lite.mjs --kinds menu --check
node '<workspace>/.orquestracao/modelo07-menu-final-import.mjs' check
node '<workspace>/.orquestracao/modelo07-menu-real-browser.mjs' --run --start-server
```

A importação real e a publicação são etapas separadas da implementação. Os testes usam somente entregas sintéticas e pastas temporárias.

A extensão R06 de caminhada/ataque com 128 poses por direção e uma pose de repouso por direção usa importador e fontes separados, descritos em [movement128.md](movement128.md). A câmera oblíqua dos movimentos/repouso usa a opção intermediária do estudo, aproximadamente 45°, como interpretação do ângulo pedido; esta dança R05 permanece frontal. Os arquivos antigos de idle e o downed são preservados. Ao abrir a partida, o consumidor da dança libera as páginas/RAF e recria a seleção ao voltar ao menu.
