# Desempenho e custo gratuito (VGM-048)

Medido em 12/10/2026 pelo Executor-N25, branch `vgm/048-desempenho`.

> **Isto é laboratório, não celular.** Contêiner de 2 núcleos sem GPU (o WebGL roda no SwiftShader, na CPU), dividido
> com outros dois executores (load average 8–16 durante as medições de cena). A sala roda no `wrangler dev` local,
> não na Cloudflare. Os números servem para comparar versões e achar gargalos, não para dizer como o jogo roda num
> celular. O que falta medir no aparelho está no fim (VGM-051).

Ferramentas: `npm run bots -- <cenário>` (VGM-045, bots de protocolo contra a sala) e `scripts/perf-lab.mjs`
(Playwright de celular, `isMobile`, DPR 3, 390×844: `weight` mede a primeira carga do build; `scene` abre a cena real
com 1 pessoa e 5 bots da sala, horda alta com `LAB_HORDE=300`). JSON de cada medição em
`board/evidence/VGM-048/perf/` e `board/evidence/VGM-048/bots/`.

## 1. Relógio da sala (N17)

`setInterval(…,50)` no workerd disparava a cada ~52,5 ms e não recuperava: a sala andava a ~19 ticks/s. Agora a sala
usa um relógio de parede (`multiplayer/tick-clock.ts`): um `setTimeout` mirado no próximo tick, até 3 ticks por disparo
quando atrasa, e atraso acima de 0,5 s é descartado (um tick e o relógio recomeça), não acelerado.

| medição | antes (main 5d6f062) | depois |
|---|---|---|
| `bots smoke`, máquina calma (load < 1,5) | 18,77 · 18,85 ticks/s | **20,00** |
| `bots smoke`, máquina cheia (load 8–9,5) | — | **20,05 · 20,08** |
| run inteira `base` (6 bots, 150 ms, quedas) | VGM-045: 18,96 ticks/s, combate 18:33 | **19,99 ticks/s, vitória no round 10, combate 16:01** |

- Na run inteira, com a máquina cheia (load ~10): 18 805 disparos, 18 411 com 1 tick, 249 com 2, 135 com 3, e **um**
  descarte de 11 ticks (uma pausa acima de 0,5 s). Sem a máquina cheia (smoke calmo) todos os 907 disparos rodaram 1 tick.
- A run de 16:01 de combate cabe com folga na janela `RUN_START_WINDOW_MS` (18 min); as do VGM-045 (17:14–18:33) não.
  As runs não são iguais tick a tick (os bots reagem ao tempo de rede), então a comparação é de duração e resultado:
  vitória no round 10, nível 23, muralha inteira, 46 de 52 forjas aceitas, nenhuma checagem falhou.
- Tick da sala nessa run: p50 3 ms, p95 18 ms (VGM-045, máquina mais calma: p95 3 ms). A diferença é a máquina cheia,
  não o relógio: o custo por tick é o mesmo código.
- Recuperação manda **um quadro por cliente por rajada** (os ticks de dentro da rajada só simulam e empilham eventos;
  o quadro sai no último), e o relógio **para quando não sobra socket**: inclusive quando a própria sala corta celulares
  mudos (sem rede o fechamento nunca volta e o relógio ficaria ligado até o alarme, ~230 GB-s por sala). Conferido no
  `wrangler dev`: depois do smoke, `clock.fires` parado em 906 com 0 conexões. Smoke depois disso: 20,05 · 20,02 ticks/s.
- Teste com relógio falso: `tests/tick-clock.test.ts` (atraso fixo de 2,5 ms → 1 199 ticks em 60 s, nenhum disparo
  duplo; atraso aleatório 0–20 ms por 10 min → 20 ticks/s, nunca dois disparos duplos seguidos; dívida > 0,5 s descartada).

## 2. Números da cena (6 jogadores = 1 pessoa + 5 bots da sala, horda de 300)

Cada linha é uma janela de 34–52 s em combate, depois de 8 s de aquecimento.

| medição | modo normal (3 medições) | modo econômico (3 medições) |
|---|---|---|
| FPS desenhado (Phaser `postrender`) | 1,0 · 1,5 · 1,5 | 1,5 · 1,3 · 2,3 |
| tempo de thread principal por quadro | 633–656 ms (JS 84–90 ms) | 429–767 ms (JS 52–114 ms) |
| heap JS (mín–máx na janela) | 36–91 MB | 32–73 MB |
| inimigos no cliente | 298–300 | 299–300 |
| sala → cliente | 10,4–10,9 msgs/s · **30–38 KB/s** | 10,1–10,3 msgs/s · 24–28 KB/s |
| cliente → sala (pessoa parada) | 0,6–0,7 msgs/s · 15–16 B/s | 0,8–0,9 msgs/s · 18–21 B/s |
| tick da sala p50 / p95 / pico | 5–8 / 46–83 / 300–768 ms | 3–4 / 12–44 / 91–274 ms |
| relógio da sala | 0–5 descartes por janela (load 16) | nenhum descarte |

- **O FPS do laboratório não mede o jogo**: ~85% do tempo do quadro fica fora do JS (o desenho WebGL em software); o JS da cena é 52–114 ms.
  Por isso o modo econômico quase não muda o número aqui: o limite de 30 fps nunca é alcançado e o que ele corta (efeitos)
  é pouco perto do desenho em software. Com CPU 4× mais lenta (D-009, CDP `setCPUThrottlingRate`) a cena caiu a 0,7 fps
  e a run acabou no meio da janela (0 bichos no fim, sala parada; provável queda da pessoa, não investigado): não dá para medir isso aqui.
- A diferença da sala entre as colunas é a carga da máquina, não o modo (o modo econômico é só do cliente).
- Normal fora da horda de laboratório (VGM-045, run inteira com 6 bots de protocolo, horda do jogo): 9,7–10,3 msgs/s
  e **5,1–6,3 KB/s** por cliente (p95 10,5–13,5). A horda de 300 em volta de todo mundo custa ~5× isso.
- **Canvas do mundo: 1 pixel por px CSS** (390×844 com DPR 3; o Phaser 3.90 não tem `resolution`). O HUD é DOM e fica
  na nitidez do aparelho (DPR 3). O DPR já está abaixo do teto de 2 nos dois modos; `tests/economy.test.ts` trava a
  config do jogo sem `resolution`.

## 3. Peso inicial (build de produção, `scripts/serve.mjs`, sem compressão no servidor de teste)

| o quê | bruto | gzip | brotli |
|---|---|---|---|
| primeira carga da página (16 arquivos: HTML, JS 61 KB, CSS 29 KB, fontes 83 KB, retratos 236 KB) | 411 KB | 345 KB | 342 KB |
| JS que só carrega ao jogar (31 arquivos; Phaser 1,2 MB) | 1,61 MB | 475 KB | 396 KB |
| arte que a cena pede numa sala de 6 (86 arquivos: sprites das 6 classes, árvores, texturas) | 12,2 MB | — (webp) | — |

- Primeira pintura em 0,8 s e `load` em 0,9 s no laboratório (rede local; num 4G de 10 Mbit/s a primeira carga seria
  ~0,3 s de transferência e a entrada no jogo ~10 s só de arte).
- O maior arquivo da primeira carga é o retrato grande da classe (137 KB).
- **Achado:** entrar numa sala puxa ~12 MB de arte (cada folha de sprite ~450 KB, cada árvore ~420 KB). Card sugerido.

## 4. Cotas do plano gratuito (consultadas em 12/10/2026)

| serviço | cota Free | fonte (atualizada em) |
|---|---|---|
| Durable Objects | 100 000 requisições/dia (conexão WebSocket = 1; **20 mensagens recebidas = 1**; enviadas não contam); **13 000 GB-s/dia** de duração (128 MB enquanto houver WebSocket aceito sem hibernação); 5 mi linhas lidas e 100 000 escritas/dia; 5 GB; zera às 00:00 UTC; passou de uma, as operações daquele tipo falham | https://developers.cloudflare.com/durable-objects/platform/pricing/ (30/09/2026) |
| Durable Objects (CPU) | 30 s de CPU por requisição; **cada requisição ou mensagem WebSocket recebida renova os 30 s**; espera de I/O não conta | https://developers.cloudflare.com/durable-objects/platform/limits/ (01/06/2026) |
| Workers | 100 000 requisições/dia; 10 ms de CPU por requisição HTTP; 128 MB | https://developers.cloudflare.com/workers/platform/limits/ (08/10/2026) |
| Pages | 500 builds/mês, 1 build por vez, 20 000 arquivos, 25 MiB por arquivo, 100 domínios por projeto; Functions contam na cota do Workers (a página não diz nada sobre limite de requisições a arquivos estáticos) | https://developers.cloudflare.com/pages/platform/limits (05/09/2026) |
| Vercel Hobby | por mês: 100 GB de Fast Data Transfer, 1 000 000 de invocações de função, 10 GB de Fast Origin Transfer, 4 h de Active CPU, 360 GB-h de memória; uso só não comercial | https://vercel.com/docs/limits/fair-use-guidelines (14/09/2026) |
| Turso Free | 100 bancos, 5 GB, 500 mi linhas lidas/mês, 10 mi linhas escritas/mês, 3 GB de sync/mês | https://turso.tech/pricing.md (sem data na página) |

### Partidas por dia

Medido: run inteira com 6 jogadores = 967 s de sala ativa, 17 120 mensagens recebidas, 11 conexões (bots de protocolo,
~3 mensagens/s por jogador).

- **Duração (quem limita):** 967 s × 0,125 GB = 121 GB-s → 13 000 / 121 = **107 partidas/dia**. Com espera e resultado
  de gente de verdade (+2 min por partida): 136 GB-s → **~95/dia**. Não depende de quantos jogam nem de serem bots.
- **Requisições:** 6 pessoas a ~3 mensagens/s → ~870 por partida → 115/dia; no teto do input-10hz (10/s em combate)
  ~2 900 → **~34/dia** (aí as requisições mandam).
- **Com bots da sala (D-025):** bot não tem WebSocket, então não gera requisição nenhuma; só a CPU do tick, que o plano
  Free não cobra (cobra duração, igual com ou sem bots). 1 pessoa + 5 bots: ~3 000 mensagens da pessoa / 20 + 2 conexões
  ≈ 150 requisições → ~650/dia por requisições, **~95–107/dia pela duração**. Os 5 bots custaram 0,3–1,7 ms por chamada
  (`thinkMs`/`thinks` do `/lab`), dentro dos 3–8 ms de p50 do tick com 300 bichos. Os 30 s de CPU são renovados por cada mensagem
  da pessoa (input e o ping de 5 s): a sala gasta ~0,1–0,3 s de CPU por segundo, então mesmo sem mensagem nenhuma
  levaria 100+ s para esgotar; a sala já fecha a conexão muda em 12 s.
- **Worker:** ~11 requisições por partida (criar sala + upgrades) → ~9 000 partidas/dia; não limita, mas divide os
  100 000/dia com qualquer Function do Pages.
- **Vercel e Turso:** o cliente ainda não grava resultado (`backend/api/results.ts` existe, mas nada no `src/` chama).
  Se gravar uma vez por run: 1 linha escrita e ~2 lidas no Turso, ~7–12 invocações na Vercel (6 POSTs + preflight).
  1 mi de invocações/mês ≈ 33 000/dia e 10 mi de escritas/mês: nenhum dos dois chega perto de 100 partidas/dia.
- **Conclusão:** ~95–107 partidas inteiras por dia no Free, com ou sem bots da sala; quem trava é a duração do Durable
  Object (a sala tica e não hiberna). Hibernar não serve para uma sala que roda a 20 Hz.

## 5. Modo econômico e DPR

- Configurações → "Modo econômico": 30 fps (o portão de quadros do Phaser a 85% do período, para não cair a 20 fps num
  quadro de 60 Hz que chega cedo) e o orçamento de efeitos `reduced` da horda (números, estrelas, balões e barras).
  Salvo no aparelho com try/catch (`viagem:economia:v1`); sem armazenamento vale só na sessão.
- Na tela: título "Modo econômico", etiqueta à direita "Ligado" (Amarelo) ou "Desligado", e "Menos efeitos, jogo mais
  leve: poupa bateria."; o item continua com cara de botão nos dois estados.
- **Liga sozinho**: em combate, depois de 8 s, duas janelas seguidas de 5 s abaixo de 40 fps. Janelas que não provam
  engasgo são jogadas fora (não contam nem quebram a sequência): qualquer pausa do rAF acima de 250 ms (cortina de
  notificação, ligação, tela travada) ou a aba escondida em qualquer momento. rAF estável em ~30 Hz (Modo de Pouca Energia
  do iOS) não é engasgo: zera a sequência, porque o modo econômico já desenharia a 30.
- O aviso ("Modo econômico ligado" / "Tava engasgando", adesivo de 24 px, Desligar) entra na fila da faixa de avisos do
  HUD: uma vaga só, depois dos avisos de queda, da kill-cam e da dica do treinador; um aviso de perigo toma a vaga e ele
  volta depois com o tempo que faltava; fica 9 s na tela e entra na conta de desviar do herói.
- Desligar depois de ele ligar sozinho é lembrado: o vigia não liga de novo naquele aparelho (um toque na chave ainda liga).
- No laboratório o vigia **não** liga mais sozinho: a cena anda a ~1 fps, então toda janela tem pausa acima de 250 ms e é
  descartada (o mesmo vale para um celular abaixo de ~4 fps: a chave continua lá). Os prints chamam o mesmo gancho da cena.
- DPR: ver a seção 2 (o canvas já desenha em DPR 1; o HUD DOM fica nítido).

## 6. O que falta medir no celular (VGM-051)

1. FPS real com 6 jogadores e horda alta, normal × econômico, num Android de entrada (ex.: 3–4 GB, GPU Mali) e num
   iPhone; quanto o modo econômico ganha de verdade e se o vigia (40 fps) liga cedo ou tarde demais.
2. Temperatura e bateria em 15 min de run (com e sem modo econômico).
3. Heap e memória total da aba depois de 2 runs seguidas (o laboratório viu 32–91 MB de heap JS numa janela de 40 s).
4. Entrada no jogo pelo 4G: tempo até o primeiro quadro com os ~12 MB de arte; primeira carga no 4G.
5. Sala na Cloudflare de verdade (quando o deploy voltar, D-024): `npm run bots -- smoke --endpoint <worker>` para
   conferir os 20 ticks/s e o tick p95 no workerd de produção.
6. Celular lento demais (0,7 fps com CPU 4× no laboratório): a run acabou no meio da medição (provável queda); conferir se um
   aparelho fraco mantém a conexão (input e ping) quando o quadro passa de 1 s.
7. Se vale desenhar o mundo em DPR 2 (mais nítido, 4× os pixels) nos aparelhos que aguentam.
