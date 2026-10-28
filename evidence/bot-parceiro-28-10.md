# NEW-20261028-ORQ-bot-parceiro-e-bichos-parados (E4, 28/10)

Base: `vgm/bots-resgatam` (7fc7dc69). Código em `src/sim/bot-brain.ts`, `src/sim/ninhos/sono.ts` e `multiplayer/room-bots.ts`.

## O que mudou
- **Item 1, bot parceiro.**
  - Em ninhos com 2 ou mais jogadores, a sala escolhe um bot parceiro (`RoomBots.partner`).
  - O parceiro sai dos bots livres, ou seja, nem o forjador nem o construtor. Entre eles, prefere um roamer (slot ímpar) e pega o de slot mais alto.
  - Ele acompanha a pessoa mais sozinha: a que está mais longe do jogador de pé mais próximo, sem contar o próprio parceiro.
  - No `decide` ele entra com `BrainInput.partner`:
    - só saqueia, banca ou pega veículo a até `PARTNER_LOOT` = 5 u da pessoa;
    - fora disso, anda até ela (modo `escort`) e para a `PARTNER_NEAR` = 3 u;
    - na onda luta ancorado nela, como o escort.
  - Os outros bots saqueiam como antes. A coleira de loot do 1p não mudou: sozinho não há parceiro.
- **Item 2, bichos parados (rede rápida, `sono.ts`).**
  - Vale para corpo acordado parado por `STILL_S` = 8 s que esteja:
    - longe do herói mais próximo, entre `STILL_NEAR` = 3 u e `STUCK_FAR`;
    - longe dos pontos guardados;
    - sem bater, agir nem estar em ataque nos últimos 2 s.
  - Esse corpo leva um empurrão de 2 u, de lado em relação ao herói, alternando o lado a cada vez.
  - Depois de `STILL_SLEEP` = 2 empurrões, um corpo do plano volta a dormir. Um corpo de grupo continua sendo empurrado.
  - A contagem se apaga após 30 s sem empurrão. A rede antiga de 20 s continua igual. Nada disso roda com a Minerva segurando.
  - `recruit` não acorda mais quem dorme no viaduto (andar 1). Veja os achados.

## Headless (`audit-bots.ts`, 16 seeds; o tempo com e sem companhia exclui o cerco)
| rodada | 3p vitórias | 3p perto de bot | 6p vitórias | 6p perto de bot | parados ≥ 60 s (3p/6p) | empurrões (3p/6p) |
|---|---|---|---|---|---|---|
| antes (bots-resgatam) | 14/16 | 51.8 % | 10/16 | 58.3 % | 0 / 1 | — |
| v1, parceiro = slot mais alto | 12/16 | 95.1 % | 12/16 | 95.3 % | 0 / 0 | 407 / 1259 |
| v2, parceiro roamer + rede nova | 12/16 | 95.7 % | 10/16 | 93.7 % | 0 / 1 (z-590 no viaduto) | 9 / 207 |
| **v3, recruit sem o viaduto** (`v3/`) | **11/16** | **94.9 %** | **10/16** | **93.0 %** | **0 / 0** | 8 / 191 |

- "Perto de bot" mede quanto tempo a pessoa fora do Uno passa a ≤ 8 u de um bot. A meta é ≥ 80 %.
- A distância da pessoa até o bot mais próximo, em p50 / p80 / p95, ficou em 2.4 / 4.4 / 8 u no 3p e 2.8 / 4.5 / 9 u no 6p.
- **v1 deu errado:** o slot mais alto era um guarda (slot par). Sem ele no carro, o 3p perdia o Uno cedo nas seeds 3 e 16. A v2 passou a preferir um roamer.

## Bench ao vivo (`bench/`, chaveiro + ninhos + manual, seeds 1–16)
| rodada | 1p (meta 2–6) | 3p (meta 7–11) | 6p (meta 7–11) |
|---|---|---|---|
| antes (bots-resgatam: 1p `bench3-1p`, 3p `bench2`, 6p `bench`) | 4/16 | 11/16 | 9/16 |
| **depois** (`bench/log.txt`, `bench/bench.json`) | **3/16** | **10/16** | **10/16** |

- As três contagens estão dentro da meta, então a tabela CROWD não mudou.
- Derrotas:
  - 1p: 13 por carro.
  - 3p: 3 por time e 3 por carro.
  - 6p: 4 por time e 2 por carro.
- O veredito do bench também aponta o quanto da Grana vai para o banco. Este card não mexe nisso:
  - o 1p banca 21 % da Grana (meta 25–35 %);
  - o 6p banca 52 %.

## Achados (para o ORQ)
- **Os "parados" de antes eram quase todos esperados.** Eram a Minerva segurando o grupo e os cercos da torre e da moto. Nenhum caso era célula de ninho dentro de estrutura.
- **O único travado de verdade (seed 1, 6p, z-590)** era um corpo de cerco com FOCO_UNO no viaduto (andar 1).
  - A IA só procura estruturas com `floor === 0` (`src/sim/enemies/ai.ts`). No viaduto, ele fica sem alvo e para.
  - `recruit` o acordava de novo a cada chamada.
  - Dentro do escopo, `recruit` agora pula quem dorme no viaduto.
  - A correção de raiz em `ai.ts` (alvo de estrutura em outro andar) fica para o ORQ decidir.
- **O bot anda a 0.8 da velocidade da pessoa.** Quando a pessoa corre, o parceiro fica para trás: é daí que vem o p95 de 8–9 u.
- **`multiplayer/room-bots.ts` está fora da lista de arquivos do card.** A escolha do parceiro precisa da sala inteira (mentes, forjador e construtor), por isso entrou ali.
