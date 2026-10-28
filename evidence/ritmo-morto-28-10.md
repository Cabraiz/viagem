# Ritmo morto e viaduto (NEW-20261028-ORQ-ritmo-morto-e-viaduto)

Auditoria headless: `evidence/ritmo-morto-28-10/levelup-audit.ts`. É a partida como a sala joga:
- cidade, chaveiro + ninhos, combate manual;
- RoomBots.think → sim.step, com a pausa de nível D-050;
- o assento 0 anda no passo de uma pessoa.

16 seeds e teto de 240 s por modo. O tempo é o do **1º nível com a tela de escolha**. Em todas as rodadas antes e depois, a pausa abriu e nenhuma oferta foi escolhida sozinha.

## Segundos até o 1º nível (p50 / p90)

"Sem as seeds paradas" tira as seeds em que o bot1 nunca se arma. Esse bug fica no card bot-nao-trava-entre-casa-e-arma (E7):
- 1p: seeds 6, 10, 11 e 12;
- 3p: seeds 6, 7 e 11;
- 6p: seed 7, que sobe mesmo assim.

| modo | antes, todas | antes, sem paradas | depois, todas | **depois, sem paradas** | na janela 60–120 (sem paradas), antes → depois |
|---|---|---|---|---|---|
| 1p | 237.5 / ∞ (8 sem nível) | 233.4 / ∞ (4 sem nível) | 85.5 / ∞ (só as 4 paradas sem nível) | **70.5 / 105.3** | 1/12 → 11/12 |
| 3p | 56.1 / ∞ | 27.4 / 82.8 | 71.5 / ∞ (só as 3 paradas sem nível) | **68.9 / 102.6** | 3/13 → 10/13 |
| 6p | 61.2 / 142.7 | 61.2 / 142.7 | 90.5 / 124.9 | **90.5 / 118.0** | 4/15 → 9/15 |

Arquivos:
- antes: `antes/` (origin/main 6c9c8f87);
- depois: `v6/`;
- tentativas intermediárias: `v1`, `v3`, `v4` e `v5`;
- curva de XP sem nível, de 1p a 6p: `curva/` (gerada com `--first-xp 999`).

## O que mudou

1. **O 1º nível custa conforme os heróis da partida** (progression.ts `FIRST_LEVEL_XP=[6,9,11,12,12,12]`, só no modo ninhos; aprovado pelo ORQ às 22:02Z).
   - Antes, a barra do time era de 5 XP para qualquer tamanho de time. Com 3 heróis ela enchia em 12–27 s; com 1 herói, não enchia antes de 4 min.
   - Os heróis são contados no 1º passo da partida (pessoas e bots, sem espectadores) e o número fica fixo: alguém cair ou sair não muda a barra.
   - Os níveis 2+ não mudaram.
   - Os valores saíram da curva `curva/`.
2. **Visitas no minuto de Minerva** (sono.ts `VISIT_*`). Enquanto Minerva segura a horda, a partir de 60 s e a cada 15 s, 2 dos dorminhocos mais fracos em volta dos heróis armados acordam caçando e vêm até eles.
   - Só depois de 10 s sem nenhum abate do time, então quem já achou briga não recebe visita.
   - Herói desarmado não recebe visita.
   - Isso resgata o 1p, que antes ficava 4 min sem nada.
3. **Viaduto** (ai.ts). Um corpo de cerco acordado no tabuleiro do viaduto agora desce a rampa até a estrutura na rua (o carro). Antes ele só procurava estrutura a partir do andar 0 e ficava preso.

Limite conhecido: em algumas seeds de 6p (9, 12, 16) e de 3p (3, 10) o time topa com um bando e faz 11–12 XP em 20–30 s. Isso só mudaria mexendo no XP por abate, que fica fora deste card.
