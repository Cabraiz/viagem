# Estudo: arquivos de até 400 linhas e pastas pequenas

Card: `NEW-20261030-ORQ-estudo-arquivos-400-linhas` (P1, Executor-8).
Medido em `origin/main` `506b1ffc` (30/10/2026). Nenhum arquivo de `src/` foi movido ou cortado.

Este documento tem quatro partes:

1. o que a pesquisa diz;
2. o que concluímos e o que muda nas metas do card;
3. o plano de corte de cada arquivo grande;
4. o protocolo de teste de cada corte e a ordem dos cards.

A trava está em `tests/tools/limites-codigo.test.ts`, com a base em `tests/tools/limites-codigo.base.json`.

---

## 1. Pesquisa (internet)

Cada item traz o link da fonte e está marcado como **EVIDÊNCIA** (medição em dados reais) ou **OPINIÃO** (guia, regra de time, livro, padrão de ferramenta).

### 1.1 Tamanho de arquivo × defeitos

| Tipo | Fonte | O que diz |
|---|---|---|
| EVIDÊNCIA | Koru, El Emam, Zhang, Liu, Mathew, "Theory of relative defect proneness", *Empirical Software Engineering* 13, 2008. https://doi.org/10.1007/s10664-008-9080-x | Em 10 produtos open source, os defeitos crescem com o tamanho, mas abaixo do proporcional (lei de potência). Por linha, os módulos **pequenos** têm mais defeitos. Os autores recomendam dar mais atenção aos módulos pequenos, não aos grandes. |
| EVIDÊNCIA | Yamashita, Huang, Nagappan, Kamei, Mockus, Hassan, Ubayashi, "Thresholds for Size and Complexity Metrics: A Case Study from the Perspective of Defect Density", QRS 2016. https://www.swag.uwaterloo.ca/www/publications/thresholds-for-size-and-complexity-metrics-a-case-study-from-the-perspective-of-defect-density.html | Arquivos grandes têm mais chance de ter algum defeito, mas **densidade** de defeitos menor. Limites de tamanho devem ser usados "com cautela, se usados". Dividir um arquivo pode ser contraproducente. |
| EVIDÊNCIA | Les Hatton, "Reexamining the Fault Density–Component Size Connection", *IEEE Software* 14(2), 1997, doi 10.1109/52.582978. https://kar.kent.ac.uk/21532 | A densidade de falhas forma uma curva em U. Componentes médios são os mais confiáveis; os muito pequenos e os muito grandes são piores. |
| EVIDÊNCIA | El Emam, Benlarbi, Goel, Rai, "The Confounding Effect of Class Size on the Validity of OO Metrics", *IEEE TSE* 27(7), 2001 (resumo: https://neverworkintheory.org/2011/07/07/the-confounding-effect-of-class-size-on-the-validity-of-object-oriented-metrics.html). Réplica de Evanco, *IEEE TSE* 2003, doi 10.1109/TSE.2003.1214331. | O tamanho explica boa parte do que outras métricas parecem prever. Ou seja, "tamanho" é um sinal forte de risco, mas não prova que cortar resolve. A réplica contesta o método. |
| EVIDÊNCIA (relatório de fornecedor) | Coverity Scan / DHS, citado em https://scmagazine.com/news/dhs-report-open-source-code-quality-is-up | O número de defeitos sobe de forma linear com as linhas de código. Não há correlação com o comprimento das funções. |

### 1.2 Revisão de código, conflitos e carga cognitiva

| Tipo | Fonte | O que diz |
|---|---|---|
| EVIDÊNCIA (estudo de fornecedor, Cisco) | SmartBear, "Best Practices for Peer Code Review". https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/ | A revisão rende melhor com 200–400 linhas por vez, menos de 500 linhas por hora e sessões de até 60 min. Isso fala do tamanho da **mudança** (diff), não do arquivo. |
| EVIDÊNCIA | Dias, Borba, Barreto, "Understanding predictive factors for merge conflicts", *Information and Software Technology* 121, 2020, doi 10.1016/j.infsof.2020.106256. https://pauloborba.github.io/publication/2020understanding_predictive_factors_for_merge_conflicts/2020ISTPredictiveFactorsForMergeConflicts.pdf | Contribuições maiores (mais arquivos, commits, autores, duração) predizem conflito de merge. Contribuições que não tocam nenhum trecho em comum não conflitam. **É a evidência mais próxima do nosso motivo real** (ver 2.1). |
| EVIDÊNCIA (psicologia, analogia fraca) | Cowan, "The magical number 4 in short-term memory", *Behavioral and Brain Sciences* 24, 2001. https://www.cambridge.org/core/journals/behavioral-and-brain-sciences/article/magical-number-4-in-shortterm-memory-a-reconsideration-of-mental-storage-capacity/44023F1147D4A1D44BDC0AD226838496 | A memória de trabalho segura cerca de 4 blocos (de 3 a 5). Aplicar isso a "arquivos por pasta" é só analogia: o estudo não mede código. |

### 1.3 Regras de times e linters

| Tipo | Fonte | O que diz |
|---|---|---|
| OPINIÃO | ESLint `max-lines`. https://eslint.org/docs/rules/max-lines | O padrão é 300. A própria doc diz que não há um máximo objetivo e que as recomendações vão de 100 a 500. |
| OPINIÃO | ESLint `max-lines-per-function`. https://eslint.org/docs/latest/rules/max-lines-per-function | O padrão é 50. |
| OPINIÃO | Biome `noExcessiveLinesPerFile`. https://biomejs.dev/linter/rules/no-excessive-lines-per-file | O padrão é 300, mas a regra não vem ligada no conjunto recomendado. |
| OPINIÃO | Airbnb, `eslint-config-airbnb-base/rules/style.js`. https://raw.githubusercontent.com/airbnb/javascript/master/packages/eslint-config-airbnb-base/rules/style.js | `max-lines` está **desligado** (com max 300 só sugerido). `max-lines-per-function` também está desligado (50). `max-len` é erro acima de 100. |
| OPINIÃO | Google C++ Style Guide. https://google.github.io/styleguide/cppguide.html | "No hard limit is placed on functions length". A sugestão é repensar acima de ~40 linhas. |
| OPINIÃO | Google TypeScript Style Guide. https://google.github.io/styleguide/tsguide.html | Não fixa limite de linhas por arquivo. |
| OPINIÃO | R. Martin, *Clean Code*, cap. 5 (resumos: https://dev.to/codingblocks/clean-code--formatting-matters e https://www.goodreads.com/notes/6607720-clean-code/9119367-aboud-akhdir/336385c2-0926-4009-81f7-60696d4bf1ce) | No FitNesse os arquivos têm em geral 200 linhas, com teto de 500. É "not hard and fast". |

### 1.4 Organização de pastas

| Tipo | Fonte | O que diz |
|---|---|---|
| OPINIÃO | Feature-Sliced Design, camadas. https://feature-sliced.design/docs/reference/layers | Camadas com regra de import só "para baixo", uma API pública por fatia (`index.ts`) e um linter próprio (Steiger). Não fixa número de arquivos por pasta. |
| OPINIÃO | Vaadin, pacotes por funcionalidade. https://vaadin.com/docs/v25/building-apps/architecture/packages | Pacote por funcionalidade (feature) em vez de por camada técnica. |
| OPINIÃO | DZone, "Package by feature". https://dzone.com/articles/package-by-feature-is-demanded | Mesma ideia: o código que muda junto fica junto. |
| EVIDÊNCIA (relato de engenharia) | Shopify, Packwerk. https://shopify.engineering/enforcing-modularity-rails-apps-packwerk | Monólito modular com fronteiras **verificadas por ferramenta**, em vez de quebrar em microserviços. As fronteiras checadas são o que prepara uma futura separação. |
| OPINIÃO | Glossário de monólito modular. https://singhajit.com/glossary/modular-monolith/ | Módulos com API pública e sem acesso ao interior uns dos outros. |

### 1.5 O nosso tipo de jogo

Nosso jogo é um cliente TS no navegador (Phaser 3.90, não Pixi como diz o card), com uma sala autoritativa no Worker/Durable Object e uma sim determinística compartilhada.

| Tipo | Fonte | O que diz |
|---|---|---|
| OPINIÃO (referência clássica) | Gabriel Gambetta, predição no cliente e reconciliação no servidor. https://gabrielgambetta.com/client-side-prediction-server-reconciliation.html | O mesmo código de simulação roda no cliente (predição) e no servidor (autoridade). Por isso a sim precisa ficar pura e sem DOM. |
| OPINIÃO | Cloudflare, jogos em tempo real com Workers e Durable Objects. https://blog.cloudflare.com/building-real-time-games-using-workers-durable-objects-and-unity | Um DO por sala é a fonte da verdade do estado. |
| EVIDÊNCIA (código real) | Ralph Island. https://github.com/Periphery-AI/ralphorio | Um DO é a autoridade da sala, e um `sim-core` compartilhado é separado do cliente. |
| EVIDÊNCIA (código real) | Skip-Bo. https://github.com/yesh0907/skibo | Um motor puro separado, e um DO por partida. |

### 1.6 Ferramentas de CI

| Tipo | Fonte | O que diz |
|---|---|---|
| OPINIÃO (doc da ferramenta) | dependency-cruiser. https://github.com/sverweij/dependency-cruiser | Suporta TS e tem regras `no-circular` e "proibido de X para Y". É a mais completa. |
| EVIDÊNCIA (issues) | madge. https://github.com/thecodedrift/docmq/issues/11 e https://gitlab.com/operator-ict/golemio/code/modules/core/-/issues/122 | Em TS, tem falsos negativos e positivos em ciclos (`import type`, paths). |
| OPINIÃO (doc da ferramenta) | eslint-plugin-boundaries. https://github.com/javierbrea/eslint-plugin-boundaries | Regras de dependência entre tipos de elemento. Exige ESLint 9 a partir da v5. |
| OPINIÃO (doc da ferramenta) | ESLint `max-lines` (acima) | Faz o limite de linhas, mas sem "catraca" por arquivo. |

**Escolha:** o repo não usa ESLint e já tem um scanner próprio de setores (`tests/arquitetura.test.ts`, mais estrito que o card, com casos plantados). Por isso a trava nova é um teste node **sem dependência nova**, no mesmo estilo. Instalar dependency-cruiser só para ciclos traria mais peso que ganho.

---

## 2. Conclusão da pesquisa e ajuste das metas

### 2.1 O que a evidência sustenta

- **Não há evidência para um limite rígido de 400 linhas.** Os estudos mostram que o número de defeitos cresce com o tamanho, mas a densidade cai (Koru 2008, Yamashita 2016) ou forma um U (Hatton 1997). Cortar em pedaços muito pequenos não melhora a qualidade e pode piorar.
- **400 cabe no consenso dos guias** (ESLint e Biome com padrão 300, *Clean Code* com teto de 500, faixa citada de 100–500). É uma regra de time razoável, não um número científico.
- **O ganho real para nós é outro:** menos conflito de merge entre 8 executores em paralelo (Dias 2020) e diffs que cabem numa revisão (SmartBear, 200–400 linhas por vez). O mapa da seção 4 mostra o problema concreto:
  - `horde-art.ts` está tocado por 7 branches ao mesmo tempo;
  - `protocol4.ts` e `scene.ts`, por 5 cada.
- **"4–5 arquivos por pasta" não tem base direta.** Só existe a analogia com a memória de trabalho de Cowan, e nenhum guia fixa esse número. A organização **por funcionalidade** com API pública por pasta (FSD, Packwerk) tem mais apoio prático que a contagem.
- **Para preparar a separação em serviços, o que importa são fronteiras verificadas**, não o tamanho do arquivo (Packwerk). Isso nós já temos: `tests/arquitetura.test.ts` com setores e `index.ts` por setor.

### 2.2 Metas ajustadas (proposta ao ORQ)

| Meta do card | Proposta |
|---|---|
| Arquivo novo de `src/` com no máximo 400 linhas | **Manter**, travado em teste. É uma regra de time coerente com os guias. |
| Arquivos grandes de hoje: catraca | **Manter.** Podem diminuir, nunca crescer, e saem da lista ao chegar a ≤400. |
| Cortar todos os grandes até ≤400 | **Priorizar pelo conflito**, não pelo tamanho. Primeiro os arquivos que muitos cards tocam ao mesmo tempo, cortando onde as mudanças caem. Arquivos grandes e parados (ex.: `hero-feet-data.ts`, que é dado puro) não precisam ser cortados. |
| 4–5 arquivos por pasta, máximo ~8 | **Guia, não trava.** Agrupar por funcionalidade com um `index.ts`. Uma pasta com mais de ~8 arquivos é sinal para olhar, não erro de CI. |
| Regras de setor | **Já travadas** em `tests/arquitetura.test.ts`, de forma mais estrita que o card. O teste novo verifica de novo só o subconjunto do card, com um caso plantado próprio. |
| Sem ciclo novo | **Travar** pelo grafo de imports de runtime (sem `import type`), com base nos ciclos de hoje. |

Notas de medição:

- Na main de hoje há **53** arquivos de `src/` acima de 400 linhas (`.ts`, `.css`, `.mjs`, `.js`), num total de 526 arquivos. A lista do ORQ tinha 34, com outros números. A base JSON é a fonte da verdade daqui em diante.
- O cliente é **Phaser 3.90**, não Pixi.
- O client **não** importa `sim`: a sim compartilhada roda no `multiplayer` (Durable Object), e a predição do cliente usa `rules`/`maps`/`protocol`.

---

## 3. Plano de corte por arquivo

Regras de todo corte:

- **Só mover código.** O arquivo original vira **fachada**: mantém o nome e reexporta tudo (`export { … } from './x/…'`). Nenhum import de fora muda.
- Classes gigantes (`IslandScene`, `HordeRenderer`, `CoopClient`, `TowerRenderer`, `EnemyAi`, `CityLayer`, `RunHud`) são cortadas por **funções livres** que recebem a instância ou um estado explícito (`fooStep(this, …)`). A classe fica com os campos e com métodos de uma linha que delegam. Assim a API pública e a ordem de execução não mudam.
- Tuning (blocos de constantes) vai para `*-tuning.ts`. Isso é seguro e não muda a ordem de avaliação, desde que as constantes não leiam outros módulos no topo (ver o ciclo de chunks em `prod-chunk-cycle`).
- As linhas estimadas são aproximadas, a partir das declarações e dos métodos medidos.

### 3.1 Os 15 maiores (detalhe)

**`client/scene.ts` (2119) → `client/scene/`**, fachada em `scene.ts` (exporta `IslandScene`, `createIsland`, `SceneHooks`):

| Módulo | Responsabilidade | ~linhas |
|---|---|---|
| `scene/hooks.ts` | `SceneHooks`, constantes de cena e tipos | 190 |
| `scene/preload.ts` | `preload`, fila de arte (horda, base, torre), `standIn`, `artFallback` | 120 |
| `scene/create.ts` | `create`, `buildWorld`, `clearWorld`, `swapWorld` | 220 |
| `scene/camera.ts` | `updateCamera`, `rotateCamera`, `reproject`, `rebaseDepth`, `fit`, zoom, `shakeCamera`, `cityCamera` | 260 |
| `scene/input.ts` | toque, teclado, `goTo`, `followHold`, `predictAttack`, alvo, `drawDestination` | 200 |
| `scene/coop.ts` | `updateCoop` (157), `update`, `isOut`, `watch` e fantasma | 330 |
| `scene/world-push.ts` | `pushTowers`, `pushNests`, `pushBanks`, `pushChaveiro`, `pushFortify`, ghost de obra | 170 |
| `scene/trees.ts` | árvores e props: `chooseTrees` (111), `spawnTrees`, `syncProps`, `treeLoaded`, `drawProp`, `drawLandmark` | 340 |
| `scene/ground.ts` | `drawArena`, `drawGround`, `drawFear`, `applyGrade`, `streamCityArt`, `drawTreeShadows` | 230 |
| `scene/quality.ts` | `setQuality`, `frameGate`, `watchFrames`, `fpsHistory`, `blackoutAudit`, consultas para HUD e testes | 160 |
| `scene/island-scene.ts` | a classe: campos e métodos que delegam | 350 |

**`sim/bot-brain.ts` (1528) → `sim/bots/`**, fachada em `bot-brain.ts`:

| Módulo | Responsabilidade | ~linhas |
|---|---|---|
| `bots/tuning.ts` | as ~45 constantes de 79–271 | 200 |
| `bots/memory.ts` | `BrainMemory`, `newMemory`, `BrainInput`, `Decision` | 110 |
| `bots/geometry.ts` | `dist`, `norm`, `toward`, `standing`, `wallOf`, `homeOf`, `attackReach` | 80 |
| `bots/objectives.ts` | escolha de objetivo (resgate, loot, chaveiro, ninho, obra) | 380 |
| `bots/combat.ts` | engajar, recuar, chefão, cerco | 330 |
| `bots/movement.ts` | escolta, coleira, empurrar carro, travas de giro e de chegada | 300 |
| `bots/decide.ts` | a função principal que junta tudo | 140 |

**`protocol/protocol4.ts` (1521) → `protocol/wire/`**, fachada em `protocol4.ts`:

| Módulo | Responsabilidade | ~linhas |
|---|---|---|
| `wire/constants.ts` | `PROTOCOL_VERSION`, `MAGIC`, escalas, limites, `WIRE_HZ`, `SEND_EVERY` | 60 |
| `wire/dict.ts` | `DICT`, `DICT_INDEX`, `DICT_EXTENDED`, `dictIndexWire` | 110 |
| `wire/io.ts` | `Writer`, `Reader`, `FrameError`, `clip`, `finite` | 100 |
| `wire/codecs.ts` | `Codec` e primitivas (`posQ`, `vel`, `uint`, `str`, `optional`, …) | 140 |
| `wire/schemas.ts` | `SECTIONS`, `SCHEMAS`, itens, `downed`, `contribution` | 220 |
| `wire/events.ts` | `WireEvent`, `EventField`, codificação de eventos | 300 |
| `wire/frame-encode.ts` | montar o quadro (completo e delta) | 300 |
| `wire/frame-decode.ts` | ler o quadro | 290 |

**Atenção:** é o arquivo mais disputado do servidor e mexe com bytes no fio. O card dele exige `test:protocol` e `test:protocol:stress` iguais à main, e mais `fila --worker`.

**`client/render/layers.ts` (1518) → `client/render/horde/`**, fachada em `layers.ts`:

| Módulo | Responsabilidade | ~linhas |
|---|---|---|
| `horde/types.ts` | `HordeRendererOptions`, atores, tipos de fx | 170 |
| `horde/styles.ts` | constantes, estilos, `PALETTE`, `applyPalette`, `paint` | 140 |
| `horde/sync.ts` | `syncEnemy`, `syncPickup`, `syncProjectile`, `syncTelegraph`, `applyCap` | 220 |
| `horde/events.ts` | `handle`, números, morte, poof, balões, `say` | 250 |
| `horde/marks.ts` | `drawEyes`, `drawPhase`, `drawName`, `drawBar`, `drawRing`, `catchNote` | 300 |
| `horde/telegraphs.ts` | `planDecor`, `drawTelegraphs`, faixas, `replayDecor`, `decorSprite` | 200 |
| `horde/renderer.ts` | a classe `HordeRenderer` (campos e delegação) | 260 |

**`sim/director.ts` (1267) → `sim/director/`**. É uma fábrica de closures (`createDirector`), então cada parte vira um módulo que recebe um `DirectorCtx`:

| Módulo | Responsabilidade | ~linhas |
|---|---|---|
| `director/types.ts` | opções, estado e tipos | 200 |
| `director/tuning.ts` | constantes e `lastCallBoost` | 100 |
| `director/spawn-points.ts` | `coastalSpawnPoints`, `pickPoint`, âncoras, escondidos, anel | 220 |
| `director/city.ts` | avenidas: `planCity`, `cityWarn`, `cityTeamField`, recuo | 330 |
| `director/tutorial.ts` | rodada tutorial | 90 |
| `director/waves.ts` | `dispatch`, `spawnPending`, `startWave`, `stepWave`, `beginRetreat`, `endRound` | 300 |
| `director/index-fn.ts` | `createDirector` liga as partes | 120 |

**`client/render/towers/towers.ts` (1116)**, fachada em `towers.ts`:

| Módulo | ~linhas |
|---|---|
| `towers/tower-fx.ts` (tiros, clarão, explosão, cratera, `drawEffects` com 90 linhas, `bakeCrater`) | 330 |
| `towers/tower-draw.ts` (`drawTower`, base, arma, trilho, sombra, fio) | 320 |
| `towers/tower-aim.ts` (`aim`, `fire`, `reaches`, `muzzle`) | 140 |
| `towers/tower-art-queue.ts` (1083–fim) | 50 |
| a classe `TowerRenderer` | 290 |

**`client/net/client.ts` (1036)**, fachada em `client.ts`:

| Módulo | ~linhas |
|---|---|
| `net/retry.ts` (constantes de tentativa, `retryDelay`, banner, `jittered`) | 180 |
| `net/link.ts` (`connect`, `beat`, `goneAway`, `visibility`, `resume`, `renewLink`, silêncio) | 280 |
| `net/frames.ts` (`message`, `frame`, `setRun`, ack) | 220 |
| `net/commands.ts` (`forge`, `build`, `pix`, `emote`, `rematch`, …) | 200 |
| a classe `CoopClient` | 200 |

**`client/sandboxes/sandbox-cidade.ts` (1028)**:

| Módulo | ~linhas |
|---|---|
| `sandboxes/cidade/params.ts` (parâmetros de URL, 141–290) | 160 |
| `cidade/fixtures.ts` (`withCast`, `nestLab`, frota, arsenal) | 220 |
| `cidade/scene.ts` (a classe `CitySandbox`, cortada em duas por fase) | 2 × 330 |

É ferramenta de dev, com risco baixo, mas está tocado por 4 branches.

**`sim/enemies/ai.ts` (969)**. O `step` sozinho tem 391 linhas:

| Módulo | ~linhas |
|---|---|
| `enemies/ai-tuning.ts` | 140 |
| `enemies/ai-move.ts` (`moveSafely`, `probe`, `clearFrom`, separação, zigue-zague) | 150 |
| `enemies/ai-step.ts` (`step` em 3 funções: alvo, movimento, ataque) | 390 |
| `enemies/ai-acts.ts` (carga, palestra, molotov, minions, perigos, devendo) | 260 |
| a classe `EnemyAi` e `createEnemyAi` | 100 |

**`client/art/horde-art.ts` (958)**, o mais disputado, com 7 branches:

| Módulo | ~linhas |
|---|---|
| `art/enemy-art-ids.ts` (ids, fantasias, `enemyArtKey`) | 80 |
| `art/projectile-art.ts` (tudo de projétil, 125–200) | 120 |
| `art/horde-art-load.ts` (fila e carga, `queueEnemyArt`, `releaseEnemyArt`) | 140 |
| `art/horde-bake.ts` (`bakeFrame` em diante) | 2 × 300 |

O corte tem de ser feito **depois** que as 7 branches assentarem.

**`client/render/city/city-layer.ts` (946)**:

| Módulo | ~linhas |
|---|---|
| `city/chunk-build.ts` (`buildChunk` 88, `bakeGround` 77, `groundMesh`, `drawLot`, `drawBuilding`, `drawDecor`) | 330 |
| `city/occlusion.ts` (`applyOcclusion`, `covers`, colunas, fade) | 150 |
| `city/city-props.ts` (`drawProp`, `propRect`, entrada e saída) | 120 |
| a classe `CityLayer` | 340 |

**`client/explore.ts` (939)**. `openExploration` é um closure gigante, com `updateStick` de 266 linhas:

| Módulo | ~linhas |
|---|---|
| `explore/settings.ts` (configurações e câmera) | 180 |
| `explore/stick.ts` (`updateStick`) | 280 |
| `explore/connection.ts` (`lost`, reconexão, revanche) | 160 |
| `explore/quality.ts` (economia e qualidade) | 80 |
| `explore.ts` como orquestrador | 250 |

**`client/hud/hud.css` (938)**. Cortar por seção comentada (os comentários `----------` já marcam as seções):

| Módulo | ~linhas |
|---|---|
| `hud/css/topo.css` | 180 |
| `hud/css/centro.css` | 200 |
| `hud/css/time.css` | 220 |
| `hud/css/bordas.css` | 170 |
| `hud/css/resto.css` | 170 |

`hud.css` fica só com os `@import`, ou com o import em `hud.ts`. **A ordem da cascata não pode mudar**, e o print de 390 px tem de ficar igual.

**`sim/crates.ts` (859)**:

| Módulo | ~linhas |
|---|---|
| `crates/tuning.ts` (81–170) | 100 |
| `crates/prizes.ts` (`rollPrize`, `drawPrize`, pools, inicial) | 250 |
| `crates/placement.ts` (`spreadPick`, faixas de início, respawn) | 200 |
| `crates/system.ts` (`Crates`) | 300 |

**`client/hud/hud.ts` (744)**:

| Módulo | ~linhas |
|---|---|
| `hud/hud-audio.ts` (bloco de 105 linhas) | 110 |
| `hud/hud-objective.ts` (missão, objetivo, motivo, coach) | 200 |
| `hud/hud-layout.ts` (`avoidHero`, `zones`, `veil`, linhas) | 150 |
| `RunHud` | 290 |

### 3.2 Os outros 38 (resumo)

Formato: módulos novos com ~linhas. A fachada mantém o nome original. "parado" quer dizer que nenhuma branch ativa toca o arquivo.

| Arquivo | Linhas | Corte proposto | Conflito |
|---|---|---|---|
| client/sandboxes/sandbox-hud.ts | 742 | `hud-lab/fixtures.ts` 250, `hud-lab/scenes.ts` 300, entrada 200 | 3 branches |
| client/lobby.ts | 699 | `lobby/texts.ts` (frases e piadas) 260, `lobby/waiting-room.ts` (`mountWaitingRoom`) 210, `lobby/create.ts` 230 | 1 |
| sim/chaveiro/system.ts | 671 | `chaveiro/tuning.ts` 130, `chaveiro/plan.ts` 120, `chaveiro/system.ts` 380 | parado |
| sim/city/avenues.ts | 663 | `avenues-tuning.ts` 240, `avenue-planner.ts` 400 (classe), `avenues-util.ts` 30 | parado |
| client/render/chaveiro/renderer.ts | 662 | `chaveiro/frozen.ts` 110, `chaveiro/car-draw.ts` 250, a classe 300 | 2 |
| sim/assemble.ts | 643 | `assemble-types.ts` 210, `assemble-elite.ts` 60, `createRunSystems` 380 | 1 |
| sim/ninhos/sono.ts | 615 | `sono-tuning.ts` 200, `sono.ts` 360, `sono-bodies.ts` 60 | parado |
| main.ts | 600 | `menu/stage.ts` 150, `menu/portraits.ts` 160, `menu/insta.ts` 120, `main.ts` 200 | parado no origin, **mas sujo no checkout principal** |
| client/render/stonewards.ts | 587 | `stonewards-fx.ts` 200, a classe 390 | parado |
| client/render/textures.ts | 572 | `textures/enemies.ts` 360, `textures/props.ts` 210 | parado |
| client/render/city/viaduct.ts | 569 | `viaduct-geom.ts` 200, `viaduct-uv.ts` 100, `ViaductLayer` 280 | parado |
| client/hud/result.ts | 568 | `result-texts.ts` 200, `createResultScreen` 370 | parado |
| client/dev/ux-metrics.ts | 568 | `ux-types.ts` 140, `ux-recorder.ts` 240, `ux-export.ts` 190 | parado |
| client/render/arsenal-fx.ts | 562 | `arsenal-draw.ts` 250, a classe 310 | 2 |
| client/sandboxes/sandbox-horde.ts | 549 | `horde-lab/fake.ts` 330, `horde-lab/scene.ts` 220 | parado |
| maps/city-asset.ts | 546 | `city-asset-types.ts` 120, `city-asset-encode.ts` 200, `city-asset-decode.ts` 230 | parado |
| client/hud/edges.ts | 526 | `edges-layout.ts` 260 (`placeEdges`), `edges-tags.ts` 100, `EdgeArrows` 170 | parado |
| sim/ninhos/ninhos.ts | 519 | `ninhos-tuning.ts` 160, `ninhos.ts` 360 | parado |
| client/render/city/decor.ts | 519 | `decor-ground.ts` 230, `decor-walls.ts` 290 | parado |
| sim/city/grid.ts | 517 | `flow-grid.ts` 120, `city-steer.ts` 400 | parado |
| sim/boss.ts | 503 | `boss-tuning.ts` 190, `boss.ts` 310 | parado |
| client/render/city/art-plan.ts | 499 | `art-plan-sheets.ts` 260, `art-plan-lots.ts` 240 | 1 |
| sim/progression.ts | 488 | `progression-types.ts` 180, `progression.ts` 310 | parado |
| sim/towers/system.ts | 486 | `towers-build.ts` 230, `towers-combat.ts` 250 | parado |
| rules/waves.ts | 486 | `waves-rounds.ts` (tabelas) 220, `waves-plan.ts` 270 | 1 |
| client/hud/camp.ts | 472 | `camp-readouts.ts` 210, `createCamp` 260 | parado |
| sim/enemies/catalog.ts | 466 | `catalog-tuned.ts` (tabela) 180, `catalog-acts.ts` 290 | 1 |
| client/audio/engine.ts | 464 | `audio-files.ts` 80, `AudioEngine` 380 | parado |
| client/sprites/hero-feet-data.ts | 458 | **não cortar.** É dado gerado (um literal). Fica na base sem prazo | 1 |
| maps/terrain/chunks.ts | 442 | `chunk-gen.ts` 270, `chunk-world.ts` 170 | parado |
| client/sprites/character-sprites.ts | 442 | `sprite-anim-tables.ts` 60, a classe 380 | 2 (e sujo no checkout principal) |
| client/hud/offer.ts | 442 | `offer-texts.ts` 150, `createOfferPanel` 290 | parado |
| sim/weapons/system.ts | 441 | `weapons-aim.ts` 120, `createWeaponSystem` 320 | 2 |
| client/audio/music.ts | 416 | `music-track.ts` 190, `GameMusic` 230 | parado |
| client/render/telegraph-look.ts | 415 | `telegraph-shapes.ts` 240, `telegraph-look.ts` 180 | 1 |
| sim/stonewards/system.ts | 411 | `stonewards-targets.ts` 60, sistema 350 | parado |
| client/render/towers/tower-rules.ts | 409 | `tower-calibre.ts` 120, `tower-rules.ts` 290 | parado |
| client/framing.ts | 401 | `follow-camera.ts` 170, `framing.ts` 230 | parado |

### 3.3 Árvore de pastas proposta (por setor)

Guia, não trava: por funcionalidade, com um `index.ts` (API pública) por pasta e ~4–8 arquivos cada.

```
src/
  contract/            (inalterado, só importa runtime)
  rules/               waves/{rounds,plan,modifiers}.ts
  maps/                city-asset/{types,encode,decode}.ts  terrain/{chunk-gen,chunk-world}.ts
  protocol/
    wire/              constants dict io codecs schemas events frame-encode frame-decode
  sim/
    bots/              tuning memory geometry objectives combat movement decide
    director/          types tuning spawn-points city tutorial waves
    enemies/           catalog/ ai/{tuning,move,step,acts}
    crates/            tuning prizes placement system
    city/              avenues/ grid/{flow-grid,city-steer}
    ninhos/  chaveiro/  stonewards/  towers/  weapons/  boss/  progression/
  multiplayer/         (inalterado)
  client/
    scene/             hooks preload create camera input coop world-push trees ground quality island-scene
    net/               retry link frames commands client
    render/
      horde/           types styles sync events marks telegraphs renderer
      towers/  city/  chaveiro/  fx/
    hud/               css/ objective/ layout/ offer/ result/ camp/ edges/
    art/               enemy-art-ids projectile-art horde-art-load horde-bake
    explore/           settings stick connection quality
    sandboxes/         cidade/ hud-lab/ horde-lab/
    audio/  sprites/  dev/
```

---

## 4. Mapa de conflito (branches ativas × arquivos grandes)

Fonte: `git diff --name-only origin/main...vgm/<branch>` nas 26 branches de worktree não integradas, em 30/10 ~09h. Inclui o lote `fila/20261030-101356`, que estava rodando.

| Arquivo | Branches que tocam |
|---|---|
| client/art/horde-art.ts | efeitos-ataque-chatgpt, fortes-fracos, mendigo-andar-poses, mendigo-andar-proporcao, mendigo-andar-regerar, mendigo-completo, teste-mendigo |
| protocol/protocol4.ts | lote 20261030-101356, anim-ser-empurrado, animacoes-de-recarga, colisao-entre-herois, pente-e-recarga |
| client/scene.ts | anim-ser-empurrado, bico-sem-limite-pix-voando, q3-fatia2-art-nivel, q4-preaquecer (9 dias), torre-folha-ao-pegar-kit |
| client/sandboxes/sandbox-cidade.ts | animacoes-de-recarga, bico-sem-limite-pix-voando, efeitos-ataque-chatgpt, fortes-fracos |
| client/net/client.ts | lote, anim-ser-empurrado, colisao-entre-herois, sala-ate-10-jogadores (6 dias) |
| sim/bot-brain.ts | animacoes-de-recarga, bot-nao-trava, pente-e-recarga |
| client/sandboxes/sandbox-hud.ts | animacoes-de-recarga, objetivo-com-verbo, pente-e-recarga |
| sim/weapons/system.ts | animacoes-de-recarga, pente-e-recarga |
| client/sprites/hero-feet-data.ts | lote, gato-troca-pe-lado |
| client/sprites/character-sprites.ts | anim-ser-empurrado, q3-fatia2-art-nivel |
| client/render/chaveiro/renderer.ts | chaveiro-chegou-e-relogio, objetivo-com-verbo |
| client/render/arsenal-fx.ts | animacoes-de-recarga, efeitos-ataque-chatgpt |
| catalog.ts / crates.ts / assemble.ts / waves.ts | inimigos-avisos-justos / uno-estaciona-fora-da-boca / lojas-bico-fora-das-bocas / piadas-so-elenco-ativo |
| telegraph-look.ts, layers.ts | efeitos-ataque-chatgpt |
| city-layer.ts, art-plan.ts | cidade-decor-alto-colocacao |
| lobby.ts / explore.ts | sala-ate-10-jogadores / torre-folha-ao-pegar-kit |

O checkout principal `D:/Gits/viagem` também tem mudanças não commitadas em `scene.ts`, `main.ts`, `character-sprites.ts`, `sprite-sheets.ts` e outros. **O ORQ precisa saber de quem são** antes de qualquer corte nesses arquivos.

**Consequência da catraca:** uma branch em voo que **aumenta** um arquivo listado vai ficar vermelha no lote depois que a trava entrar. Isso vale, por exemplo, para as que acrescentam linhas em `protocol4.ts` ou `horde-art.ts`. Há duas saídas:

- a branch corta o próprio acréscimo para um módulo novo (o certo);
- o ORQ sobe o número na base, de forma justificada no commit do lote.

---

## 5. Cards de corte, em ordem

Regras: **um arquivo grande por card**, nunca dois executores no mesmo arquivo, e só **depois** que as branches que tocam o arquivo forem integradas ou abandonadas.

### Onda 0: pré-requisito (1 card)

- **C0 `sim-digest`**: hoje não existe um "digest de replay da sim". Criar `scripts/sim-digest.ts`: roda `createRunSystems` com uma seed fixa, 4 bots e N=3600 ticks na cidade e na ilha, e imprime o hash FNV do estado serializado a cada 60 ticks. Sem isso, a regra "digest igual à main" não pode ser verificada. É barato e não toca `src/`.

### Onda 1: arquivos parados (sem nenhuma branch ativa), em paralelo por setor

| Card | Arquivo | Setor | Executor sugerido |
|---|---|---|---|
| C1 | sim/director.ts (1267) | sim | E-a |
| C2 | client/render/towers/towers.ts (1116) | client | E-b |
| C3 | sim/enemies/ai.ts (969) | sim | E-c (depois do C1, porque ambos rodam os benches) |
| C4 | client/hud/hud.css (938) | client css | E-d |
| C5 | client/hud/hud.ts (744) | client | E-d (depois do C4: mesma área de print) |
| C6 | sim/chaveiro/system.ts + sim/city/avenues.ts | sim | 2 cards separados, em série |
| C7 | maps/city-asset.ts, maps/terrain/chunks.ts | maps | 2 cards, `--worker` |
| C8 | client/render/textures.ts, viaduct.ts, decor.ts, stonewards.ts | client render | 1 por card |
| C9 | client/hud/result.ts, edges.ts, camp.ts, offer.ts | client hud | 1 por card |
| C10 | sim/ninhos/sono.ts, ninhos.ts, boss.ts, progression.ts, towers/system.ts, stonewards/system.ts | sim | 1 por card, em série por causa dos benches |
| C11 | o resto parado: ux-metrics, sandbox-horde, audio/engine, music, tower-rules, framing | client | 1 por card |

Cabem até ~4 executores ao mesmo tempo (sim, client render, client hud, maps). Os de sim vão em série, porque os benches pedem a vaga pesada.

### Onda 2: depois que as branches atuais assentarem

| Card | Arquivo | Espera por |
|---|---|---|
| C12 | client/net/client.ts | lote atual, anim-ser-empurrado, colisao-entre-herois, sala-ate-10 |
| C13 | protocol/protocol4.ts | as mesmas, mais animacoes-de-recarga e pente-e-recarga. **`--worker` obrigatório** |
| C14 | sim/bot-brain.ts | animacoes-de-recarga, bot-nao-trava, pente-e-recarga |
| C15 | client/render/layers.ts | efeitos-ataque-chatgpt |
| C16 | client/explore.ts, lobby.ts | torre-folha-ao-pegar-kit, sala-ate-10 |
| C17 | sim/crates.ts, assemble.ts, catalog.ts, rules/waves.ts, weapons/system.ts | os respectivos cards únicos |
| C18 | client/render/city/city-layer.ts, art-plan.ts | cidade-decor-alto-colocacao |

### Onda 3: os mais disputados, por último e com o ORQ segurando a área

| Card | Arquivo | Observação |
|---|---|---|
| C19 | client/scene.ts | Segurar novos cards em `scene.ts` durante o corte. 5 branches mais o checkout sujo |
| C20 | client/art/horde-art.ts | 7 branches do mendigo e de efeitos. Só depois de todas |
| C21 | sandbox-cidade.ts, sandbox-hud.ts | ferramentas de dev |
| C22 | chaveiro/renderer.ts, arsenal-fx.ts, character-sprites.ts, telegraph-look.ts, main.ts | 1 por card |

`hero-feet-data.ts` **não ganha card**: é dado gerado.

---

## 6. Protocolo de teste de todo card de corte

Todo card de corte copia este bloco e marca cada item com a saída real.

1. **Só mover.**
   - O diff mostra blocos movidos, com `git diff --color-moved=dimmed-zebra` mostrando quase tudo como "moved".
   - Nenhuma linha de lógica muda.
   - Os imports de fora continuam iguais, pela fachada.
   - `git grep` dos imports do arquivo original antes e depois: mesma lista.
2. `npx tsc --noEmit` limpo.
3. Suíte inteira verde: `npm test`, que inclui `tests/arquitetura.test.ts` e `tests/tools/limites-codigo.test.ts`. A trava exige que o arquivo cortado **saia** da base (ou diminua) e que nenhum módulo novo passe de 400 linhas.
4. **Sim** (se tocar `sim/`, `rules/` ou `maps/`): `scripts/sim-digest.ts` (do card C0) dá saída **idêntica** à da main.
5. **Build**:
   - `npx vite build` na main e na branch;
   - mesmo número de chunks (±1);
   - tamanho total do `dist/assets` dentro de ±1 %;
   - anotar os dois números no card.
6. **Preview de produção**:
   - `npm run preview` (ou `vite preview`) com o probe `prod-erro2.cjs` (`D:/Gits/viagem-board/claims/NEW-20261013-ORQ-chaveiro-render/prod-erro2.cjs`, `BASE=http://127.0.0.1:4208`);
   - **nenhum** chunk rejeita.
   - Isso pega o ciclo de chunks que só existe em produção (ver o incidente de 14/10).
7. **Desempenho** (se tocar sim ou maps; pedir a vaga pesada ao ORQ):
   - benches `tests/rooms/city-room-bots.test.ts` e bots-tique;
   - ms/tick dentro de ±5 % da main;
   - 3 rodadas, mediana.
8. **Visual** (se tocar `client/`): print de 390 px da partida e da tela afetada, **igual** ao da main. Mostrar os dois prints lado a lado.
9. **Worker** (se tocar `maps/`, `sim/` ou `protocol/`): pôr na fila com `--worker`.
10. Um commit por arquivo cortado, com push a cada passo.

---

## 7. A trava (`tests/tools/limites-codigo.test.ts`)

Arquivos:

- `tests/tools/limites-codigo.test.ts`
- `tests/tools/limites-codigo.base.json`

O que ela verifica:

- **Arquivo novo**: qualquer `.ts/.css/.mjs/.js` de `src/` com mais de 400 linhas, fora da base, falha.
- **Catraca**: cada arquivo da base falha se:
  - crescer acima do número gravado;
  - chegar a ≤400 e continuar listado (é preciso tirar a entrada);
  - deixar de existir (é preciso tirar ou renomear a entrada).
- **Setores**: sim, rules, maps, protocol e contract não importam `client`; `contract` não importa nenhum setor; rules, maps e protocol não importam `sim`. É o subconjunto do card. `tests/arquitetura.test.ts` continua sendo a regra completa.
- **Ciclos**: usa o grafo de imports de runtime de `src/` (ignora `import type` e `export type`) e calcula os componentes fortemente conexos. Cada componente com mais de um arquivo precisa estar contido num componente da base. Isso pega ciclo novo e também a fusão de dois ciclos antigos. Quando um ciclo antigo some, o teste avisa para enxugar a base, mas não falha.
- **Autoteste**: o próprio teste planta um arquivo de 401 linhas e um `sim → client` num `src` falso em memória, e exige vermelho. Também planta um ciclo novo e exige vermelho.

Estado da base em `506b1ffc`:

- 53 arquivos grandes.
- 3 ciclos de runtime já existentes:
  - `client/art/manifest.ts ↔ client/art/mendigo.ts`;
  - `sim/enemies/ai.ts ↔ sim/enemies/sanfoneiro.ts` (o card C3 deve desfazer esse ciclo ao cortar `ai.ts`, ou pelo menos não aumentá-lo);
  - `sim/projectiles.ts → weapons/mine.ts → weapons/ricochet.ts`.

Verificado:

- verde na main;
- vermelho ao plantar em `src/` real um `src/sim/_plantado.ts` de 402 linhas que importa `client/scene`, com as duas falhas apontadas (o arquivo foi apagado em seguida);
- `tsc --noEmit` limpo;
- `tests/arquitetura.test.ts` verde.

Para atualizar a base de propósito (só o ORQ, num lote, com justificativa):

```bash
node --experimental-strip-types tests/tools/limites-codigo.test.ts --gravar
```
