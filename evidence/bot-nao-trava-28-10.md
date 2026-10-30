# NEW-20261028-ORQ-bot-nao-trava-entre-casa-e-arma (E6, 28/10)

Base: origin/main 2c1f1d2. Código em `src/sim/bot-loot.ts` e `src/sim/bot-brain.ts`; teste novo em `tests/sim/bot-nao-trava.test.ts`.

## A causa
O diagnóstico do E7 (o dorminhoco contava no `LOOT_SAFE`) está certo, mas é só parte da história. Nas seeds do card, o corpo ao lado do baú quase sempre estava **acordado**: o próprio bot o acordava (WAKE_SIGHT 3.75) e a Minerva o deixava parado por 120 s.

O bot sem arma não consegue bater (`attackReach` precisa de arma equipada). O ciclo era este:
1. `planLoot` desistia por causa do bicho a menos de 6 u;
2. o bot ia para `home`;
3. longe do bicho, voltava para `loot`;
4. repetia a cada ~2 s.

Havia mais três travas:
- **seed 11:** um bicho parado pela Minerva a 10.6 u do Uno disparava o `carThreat`, que mantém o bot em `fight`. Desarmado, ele ficava lá ~60 s.
- **seed 12:** baú com bicho mordendo. O baú só abre para quem não leva dano (crates.ts); o bot ficou 18 s em pé ao lado.
- **3p seed 7:** o bot parceiro (preso à pessoa por PARTNER_NEAR) chegava "um fio" mais perto do baú da pessoa e o reivindicava (`claimed`). A pessoa largava o baú, e o parceiro ia atrás dela. O baú nunca abria, com 4 trocas em 5 s.

## O que mudou
- `planLoot` e `vehicleGoal` não contam mais corpo `asleep` (a parte do E7).
- **Bot sem arma nenhuma** (`hasWeapon`): procura arma mesmo com bicho perto, se tiver hp ≥ `LOOT_KEEP_HP` (50 %). Para ele não vale o `carThreat`.
- **Bot armado:** com bicho perto, segue só para a meta que já tinha (`opts.keep`). Se larga o saque por causa de um bicho, só começa outro depois de `LOOT_REST` = 5 s.
- **Dano no baú:** se o bot levou dano junto do baú desde a última decisão, ele pula esse baú por `LOOT_SKIP` e vai para outro.
- **Reivindicação:** o bot que já está junto do baú que vinha saqueando (até `CRATE_CLAIM`) fica com ele, mesmo que outro bot esteja um pouco mais perto.
  - Testei também "bot desarmado ignora reivindicação a qualquer distância". O 3p piorou (28/32 em 30 s, seed 9 bot3 nunca se armou) e eu reverti.

## Headless (16 seeds, 60 s, chaveiro + ninhos + manual; `bot-nao-trava-28-10/headless/`, `sweep.ts` + `summ.js`)
Contagem sem o parceiro (escort), que só saqueia a até 5 u da pessoa.

| | 1p armado | 1p mediana / pior | 1p trocas home↔loot | 3p armado em 30 s | 3p armado em 60 s | 3p pior | 3p trocas |
|---|---|---|---|---|---|---|---|
| antes (origin/main) | 14/16 (6 e 11 nunca) | 5.4 / 19.4 s | 180 | 22/32 | 26/32 | 48.1 s | 314 |
| **depois** | **16/16** | **5.4 / 10.8 s** | **66** | **30/32** | **32/32** | **34.5 s** | **94** |

- **Janelas de 5 s com mais de 2 trocas:** antes 11 no 1p e 16 no 3p; depois 0 e 1.
- **O que sobra são trocas com motivo:**
  - o baú abre e o próximo aparece uma decisão depois (um blip de 0.2 s);
  - outro bot abre o baú primeiro.
- **O parceiro arma-se em 5/16 antes e 5/16 depois.** A coleira PARTNER_LOOT não mudou, então "fica perto" segue igual (bot-parceiro.test.ts passa).

## Teste
`tests/sim/bot-nao-trava.test.ts`:
- **Seeds do card**, 1p 6/10/11/12 e 3p 6/7/11, em 30 s: cada bot, menos o parceiro, se arma, e volta para `loot` depois de largar para `home` no máximo 1× em qualquer janela de 5 s. Eu li "1 troca" como uma ida e volta.
- **Seeds 1–16**, 1p e 3p: arma em até 36 s (~30 s).
- **Unitários** de `planLoot` e `hasWeapon`.

Na origin/main, 12 dos 13 testes falham. Com o fix, os 13 passam.

`test:changed`: 1138 de 1140 passam, 0 falhas. tsc ok.

## Bench ao vivo
Pendente: aguardando a vaga pesada.
