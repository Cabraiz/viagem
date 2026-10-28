# Auditoria dos bots na sim headless (28/10)

Card: `NEW-20261028-ORQ-auditoria-bots-sim` (E4). Só medição: nenhum código do jogo mudou e nada no balanço.

## Método

- **Script:** `evidence/auditoria-bots-sim-28-10/audit-bots.ts`. A agregação está em `analisa.mjs`, e os dados brutos em `runs-{1,3,6}p.json`.
- **Configuração da sala real:**
  - cidade-nevada, objetivo chaveiro, modo ninhos, combate manual, `cityStructures:true`.
  - O laço é `RoomBots.think(sim)` → `sim.step()` dentro do `LevelupPause` (D-050).
  - As classes vêm de `botIdentity`. A vaga 0 anda em `sim.personPace`.
  - **Sem** o NavDriver do `bench-city-run.ts`, porque a sala de verdade não o usa.
- **Partidas:** 16 sementes (1–16) × 1p/3p/6p = 48 partidas, limitadas a 30 min de sim. Custo: 0,5–1,2 ms/tick.
- **Como cada coisa foi medida:**

| Registro | Critério |
|---|---|
| parado | andou < 0,5 u em 5 s |
| preso | stick > 0,5 e andou < 0,3 u em 2 s |
| longe | > 25 u do Uno por > 60 s |
| queda | registra quem estava de pé a ≤ 6 u e por quanto tempo |
| inimigo preso | acordado e andou < 1 u em 60 s (quem dorme não está em `world.enemies`) |
| caixas | nascimento, abertura, raridade e distância ao Uno |
| fases | tempo em cada modo da moto |

- **Paradas que não contam como "burrice":**
  - modo `bank` (Trabalhar) ou `push`;
  - `home`/`carro`/`escort` a ≤ 6 u do Uno;
  - ataque segurado (≥ 0,3).
- **Para reproduzir uma semente:**
  `npx tsx evidence/auditoria-bots-sim-28-10/audit-bots.ts --players 6 --seeds 13 --cap-min 30`
  Os tempos citados abaixo são segundos de sim.

## Números

| | 1p | 3p | 6p |
|---|---|---|---|
| vitórias / 16 | 4 | 12 | 10 |
| derrotas (Uno / time) | 7 / 5 | 1 / 3 | 1 / 3 (+2 estouros de 30 min) |
| parado "burro" (s por partida) | 26 | 143 | 343 |
| preso empurrando (s por partida) | ~0 | 0,9 | 2 |
| longe do Uno (s por partida, máx.) | ~7 (66 u) | 40 (66 u) | 67 (74 u) |
| quedas → revividas / eliminadas | — | 31 → 19 / — | 129 → 99 / 12 |
| eliminado com colega de pé a ≤ 6 u por ≥ 2 s | — | — | **11 de 12** |
| tempo até reviver (mediana) | — | 4,1 s | — |
| inimigo acordado parado ≥ 60 s (por partida) | — | 1,5 | 4,2 |
| caixas abertas | 32,5 % | 29 % | 46 % |
| caixa a ≤ 20 u do Uno: tempo até abrir (mediana) | — | 7 s | 53,5 s |

**Fases da moto (s médios por partida):**
- 1p: morta 131, tombo 44, volta 39. Primeiro nível aos 235 s.
- 6p: anda 859, tombo 119.
- Nas sementes 2 e 8 em 6p: anda ~1420 s e tombo 216–236 s.

**Tempo parado "burro" por modo, em 6p:** fight 3158 s, build 1254 s, loot 688 s.
- Nenhum desses episódios teve o stick empurrando. O bot **decide** ficar parado; não está preso.

**Caixas por raridade (vistas / abertas), em 1p:** r1 166/12, r2 200/19, r3 305/183.

## Itens

### 1. P0: bot de pé ao lado do colega caído e ninguém revive (6p)

- **O que acontece:** em 11 das 12 eliminações em 6p, havia colega de pé a ≤ 6 u por pelo menos 2 s. Muitas vezes estava a 0,1–2 u, durante os 30 s inteiros do sangramento. Os modos do colega nesse tempo foram home 110 s, rescue 68 s, dodge 21 s e bank 20 s. São dois casos:
  - **a) O colega nem tenta.**
    - semente 10: bot6 caiu aos 498 s, e o colega ficou em `home` 30 s a 1,8 u;
    - semente 10: bot4 caiu aos 1136 s, com o colega em `home` 30 s a 1,7 u;
    - semente 13: bot2 caiu aos 1272 s, com o colega em `bank` 14 s a 0,1 u.
  - **b) O colega tenta (`rescue`), mas `dodge`/`unstick` cortam a revivida e ela recomeça do zero.** Sementes 1 (bot5 e bot2 aos ~306 s; bot3 aos 736 s) e 11 (bot3/4/6 aos ~255 s, contra o mapinguari).
- **Para reproduzir:** 6p, sementes 10 (498 s) e 1 (306 s).
- **Proposta:**
  - Colega caído a ≤ 8 u tem prioridade sobre `home`, `bank` e `escort`.
  - Durante o `rescue`, só sair para `dodge` diante de dano iminente (telegrafado), não por inimigo perto.
  - Não deixar o `unstick` disparar enquanto o bot segura o reviver.
- **Tamanho:** M.
- **Escopo:** `src/sim/bot-brain.ts` (prioridade e histerese de rescue), `src/sim/revive.ts` (só leitura, para conferir se o progresso zera).

### 2. P1: na abertura, bot fica "lutando" parado por ~2 min a 9–22 u do Uno

- **O que acontece:** o bot fica em `fight` com stick 0 e sem atacar, por 70–119 s, começando entre 3 e 26 s de partida. É sempre perto de (83–86, 92–100) ou (70, 86), com 1 a 4 inimigos perto.
  - Em 3p, 9 dos 16 episódios de fight parado > 20 s começam antes de 30 s.
  - Em 6p, são 19 de 34.
  - Na semente 13 (6p), bot2, bot4 e bot6 ficam juntos ~115 s parados em (83, 99).
  - **Os inimigos presos do item 5 estão no mesmo lugar e na mesma hora:** acordados e parados aos 5–10 s em (85–89, 96–101).
  - Tudo indica que bot e inimigos se enxergam através de uma estrutura. O bot escolhe um alvo que não alcança e fica esperando ele chegar.
- **Para reproduzir:**
  - 3p: semente 6 (bot2, 2,8 s, (85.8, 93.1)); semente 11 (3 s); semente 7 (25,8 s).
  - 6p: semente 13 (6 s); semente 3 (bot2/4/6 aos 26,8 s em (70.5, 86.1)).
- **Proposta:**
  - O alvo de `fight` precisa ser alcançável (linha de visão ou caminho no fluxo) ou estar dentro do alcance da arma.
  - Se passar 4 s em `fight` sem causar dano e sem andar, marcar o alvo como inalcançável por 10 s e voltar para `escort`/`home`.
- **Tamanho:** M.
- **Escopo:** `src/sim/bot-brain.ts`, `multiplayer/room-bots.ts` (leitura, para confirmar que a sala não reorienta o stick).

### 3. P1: bot some para longe do Uno (até 74 u) atrás de loot ou "voltando para casa"

- **O que acontece:** episódios de > 25 u por > 60 s, quase todos em `loot` e `home`. Médias por partida: 40 s em 3p e 67 s em 6p.
  - Piores casos em 6p: semente 8, bot2, 198 s a partir de 1472 s; semente 12, bot2, 111 s até 74 u.
  - Piores casos em 3p: semente 9, bot2, 179 s; semente 1, bot2, 159 s até 66 u; semente 16, bot2, 108 s até 66 u.
  - Em 1p: semente 9, 105 s até 66 u.
  - `home` longe do Uno significa que o caminho de volta não converge. Sem o NavDriver do bench, o bot anda reto contra a quadra.
- **Para reproduzir:** 3p semente 1 (bot2); 6p sementes 8 (1472 s) e 12.
- **Proposta:**
  - Limitar o raio do `loot` a ~20 u do Uno, cortando o alvo se o Uno se afastar.
  - Fazer o `home` seguir o fluxo de caminhos que a cidade já tem (o mesmo do bench), não a reta.
- **Tamanho:** M.
- **Escopo:** `src/sim/bot-loot.ts`, `src/sim/bot-brain.ts`.

### 4. P1: bot quase não abre caixa comum (r1/r2) e demora perto do Uno em 6p

- **O que acontece:**
  - Em 1p, abre 7 % das r1 e 9,5 % das r2, contra 60 % das r3.
  - No total: 32,5 % em 1p, 29 % em 3p e 46 % em 6p.
  - Em 6p, a caixa que nasce a ≤ 20 u do Uno leva em mediana 53,5 s para ser aberta. Em 3p, leva 7 s.
- **Para reproduzir:** qualquer semente 1p (o JSON lista `crates[]` com `bornS`/`openedS`); 6p semente 5.
- **Proposta:**
  - Dar ao bot ocioso (`escort`/`home` sem inimigo perto) a tarefa de abrir caixa a ≤ 12 u, de qualquer raridade.
  - Em 6p, reservar a caixa para um único bot, para os outros não desistirem nem disputarem.
  - Sem mexer em drop nem em raridade.
- **Tamanho:** P.
- **Escopo:** `src/sim/bot-loot.ts`, `src/sim/crates.ts` (só leitura).

### 5. P2: inimigos acordados parados ≥ 60 s nos mesmos pontos

- **O que acontece:**
  - São 1,5 por partida em 3p e 4,2 em 6p.
  - Acordam e não andam por ≥ 60 s, quase sempre logo no começo (5–20 s), a 12–20 u do Uno, em (85–89, 96–101), (98–102, 83–88), (61–68, 82–89).
  - Exemplos: bebado, boleto-vivo, estagiario-imortal, ressaca-ambulante e cachorro-de-madame.
  - Em 6p, semente 2, um grupo (sogra-do-chinelo, gerente-vampiro, influencer, caixa-eletronico) fica parado em (108–111, 83) a partir de 1585 s.
  - A rede de bichos-travados do `sono.ts` não pegou esses casos.
- **Para reproduzir:** 3p sementes 2 e 4 (10 s); 6p semente 1 (10 s) e semente 2 (1585 s).
- **Proposta:**
  - Inimigo acordado que não anda há 8 s com alvo a mais de 3 u volta a dormir ou recebe um empurrão do fluxo.
  - Conferir se esses pontos são células do ninho dentro de uma estrutura.
- **Tamanho:** P.
- **Escopo:** `src/sim/ninhos/sono.ts`, `src/sim/ninhos/ninhos.ts`.

### 6. P1: derrota pelo Uno em 1p com o bot lutando colado nele

- **O que acontece:**
  - 7 das 12 derrotas em 1p são pelo Uno. A fase `morta` soma 131 s por partida.
  - Nos 20 s finais, o bot está em `fight` a ≤ 4 u do Uno com 12 a 16 inimigos perto. Ele luta em cima do Uno em vez de puxar os inimigos para longe.
  - Em 6p, semente 1, o time inteiro cai no Uno com ~35 inimigos perto.
  - Em 6p, semente 4, todos ficam em `dodge` no Uno com 20–36 inimigos perto.
- **Para reproduzir:** 1p, uma derrota pelo Uno (`outcome:'defeat', cause:'car'` em `runs-1p.json`); o `lastMinute` traz a foto a cada 5 s.
- **Proposta:**
  - Com mais de 8 inimigos a ≤ 6 u do Uno, o bot que tem HP vai para um lado e atrai a horda para longe do Uno.
  - O `dodge` não deve escolher uma rota que passe pelo Uno.
- **Tamanho:** M.
- **Escopo:** `src/sim/bot-brain.ts` (só decisão do bot; nada no carro).

### 7. P2: bot empurra o Uno parado na célula (78, 84)

- **O que acontece:**
  - O episódio "preso" mais comum é perto do Uno: 0,9 s por partida em 3p e 2 s por partida em 6p, em 5 sementes.
  - O bot segura o stick contra o carro parado, em `home`/`escort`.
  - É curto, mas repete, e no jogo parece burrice.
- **Para reproduzir:** 6p, o JSON lista `stuck[]` com `near:'carro'` (célula 78, 84).
- **Proposta:** em `home`/`escort`, parar a ≤ 2,5 u do Uno em vez de mirar o centro dele.
- **Tamanho:** P.
- **Escopo:** `src/sim/bot-brain.ts`.
- **Fora do escopo:** a colisão do Uno e a tralha (`src/sim/towers/tralha.ts`, carro), que estão com E7.

### 8. P2: bot parado em `build` e `loot` sem fazer nada

- **O que acontece:**
  - **`build` parado > 8 s:** 19 episódios em 3p e 50 em 6p. Em 6p soma 1254 s. Muitos acontecem a 15–27 u do Uno, por exemplo em 3p, semente 1, bot3, 24 s aos 599 s, e em 6p, semente 2, bot1, 32 s aos 118 s.
  - **`loot` parado > 8 s:** 17 episódios em 6p. Exemplos: semente 8, bot2, 49 s aos 326 s a 26 u; semente 10, bot6, 44 s aos 31 s.
  - Nos dois modos o stick fica em ≤ 0,2: o bot "quer" o alvo mas não se move.
  - Pode ser que parte do `build` seja trabalho legítimo na obra. Falta o sinal de progresso da obra para separar.
- **Para reproduzir:** 6p semente 8 (326 s) e semente 10 (31 s) para `loot`; 3p semente 2 (bot1, 651 s) para `build`.
- **Proposta:**
  - Para `loot`: se o stick fica < 0,3 por 3 s, descartar o alvo (provavelmente atrás de parede ou inalcançável).
  - Para `build`: conferir se a obra avança; se não avança, sair do modo.
- **Tamanho:** P.
- **Escopo:** `src/sim/bot-loot.ts`, `src/sim/bot-brain.ts`.

### 9. P2: duas partidas de 6p estouram 30 min sem fim (sementes 2 e 8)

- **O que acontece:**
  - A moto fica ~1420 s em `anda` e 216–236 s em `tombo`.
  - No fim há uma sequência de tombo → anda a cada 4–10 s (semente 8, entre 1484 s e 1508 s).
  - O chaveiro não termina: semente 2 com `paid 28/budget 28`, eta 373.
  - O time sobrevive, mas a partida não acaba.
- **Para reproduzir:** 6p sementes 2 e 8 até 1800 s; o `phaseLog` traz as fases.
- **Proposta:**
  - Registrar o caso para o E7: o tombo em série parece vir do carro e da tralha.
  - Do lado do bot, ver se o `push` está empurrando para o lado errado depois do tombo.
  - Não mudar o balanço.
- **Tamanho:** P (investigar).
- **Escopo:** `src/sim/bot-brain.ts` (só o `push`). O carro e a tralha ficam com o E7 e estão fora deste card.

## Conclusão

- A maior burrice visível é de **decisão, não de colisão**. Quase nenhum bot fica preso empurrando parede. Ele escolhe ficar parado:
  - "lutando" com quem não alcança na abertura (item 2);
  - ao lado do colega caído (item 1);
  - mirando caixa ou obra que não alcança (item 8).
- Os itens 1 e 2, sozinhos, explicam a maior parte do tempo parado em 3p/6p.
- Os itens 1 e 6 explicam boa parte das derrotas do time.
