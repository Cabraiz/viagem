# Ritmo morto e viaduto (NEW-20261028-ORQ-ritmo-morto-e-viaduto)

Auditoria headless: `evidence/ritmo-morto-28-10/levelup-audit.ts`. É a partida como a sala joga:
- cidade, chaveiro + ninhos, combate manual;
- RoomBots.think → sim.step, com a pausa de nível D-050;
- o assento 0 anda no passo de uma pessoa.

16 seeds e teto de 240 s por modo. O tempo é o do **1º nível com a tela de escolha**. Em todas as rodadas, antes e depois, a pausa abriu e nenhuma oferta foi escolhida sozinha.

## Segundos até o 1º nível (p50 / p90)

"Seed parada" é a seed em que o bot1 só se arma depois de 60 s, ou nunca. Esse bug fica no card bot-nao-trava (E6/E7), não neste. As seeds paradas mudam entre antes e depois porque a main mudou no meio (rebase sobre bot-parceiro e bots-resgatam):
- antes: 1p 6, 10, 11, 12; 3p 6, 7, 11, 16; 6p 1, 5, 6, 7;
- depois: 1p 6, 11; 3p 6, 11, 16; 6p 5, 11, 13.

| modo | antes, todas | antes, sem paradas | depois, todas | **depois, sem paradas** | na janela 60–120 s, sem paradas: antes → depois |
|---|---|---|---|---|---|
| 1p | 237.5 / ∞ (8 sem nível) | 233.4 / ∞ (4 sem nível) | 84.5 / ∞ (só as 2 paradas sem nível) | **83.5 / 102.8** | 1/12 → **13/14** |
| 3p | 56.1 / ∞ (3 sem nível) | 26.4 / 82.8 | 70.9 / 112.1 (1 parada sem nível) | **70.9 / 93.9** | 2/12 → **11/13** |
| 6p | 61.2 / 142.7 | 45.5 / 139.8 | 66.3 / 138.3 | **69.0 / 114.2** | 2/12 → **6/13** |

Na janela, contando todas as seeds: 1p 1/16 → 13/16, 3p 3/16 → 13/16, 6p 5/16 → 7/16.

Arquivos:
- antes: `antes/` (origin/main 6c9c8f87);
- depois: `v8/` (branch depois do rebase em origin/main 2c1f1d23);
- tentativas intermediárias: `v1`, `v3` a `v6` e `v7-rebase`;
- curva de XP sem nível, de 1p a 6p: `curva/` (antes do rebase) e `curva-rebase/` (gerada com `--first-xp 999`).

## O que mudou

1. **O 1º nível custa conforme os heróis da partida** (progression.ts `FIRST_LEVEL_XP=[6,6,7,10,12,13]`, só no modo ninhos; aprovado pelo ORQ às 22:02Z).
   - Antes, a barra do time era de 5 XP para qualquer tamanho de time. Com 3 heróis ela enchia em 12–27 s; com 1 herói, não enchia antes de 4 min.
   - Os heróis são contados no 1º passo da partida (pessoas e bots, sem espectadores) e o número fica fixo: alguém cair ou sair não muda a barra.
   - Os níveis 2+ não mudaram.
   - Os valores saíram da curva `curva-rebase/`. Antes do rebase eram `[6,9,11,12,12,12]`. O bot-parceiro e o bots-resgatam deixaram o 3p e o 6p mais lentos para matar no começo, então a barra baixou.
2. **Visitas no minuto de Minerva** (sono.ts `VISIT_*`). Enquanto Minerva segura a horda, a partir de 60 s e a cada 15 s, 2 dos dorminhocos mais fracos em volta dos heróis armados acordam caçando e vêm até eles.
   - Só depois de 10 s sem nenhum abate do time, então quem já achou briga não recebe visita.
   - Herói desarmado não recebe visita.
   - Isso resgata o 1p, que antes ficava 4 min sem nada.
3. **Viaduto** (ai.ts). Um corpo de cerco acordado no tabuleiro do viaduto agora desce a rampa até a estrutura na rua (o carro). Antes ele só procurava estrutura a partir do andar 0 e ficava preso. Depois do rebase, o recruta do sono.ts que dormia no tabuleiro volta a ser recrutado: o ai.ts o faz descer.

## Bench ao vivo (bench-ci, 16 seeds, branch bf1bb016)

Run: https://github.com/Cabraiz/viagem/actions/runs/40785830256. Arquivo: `ritmo-morto-28-10/bench-ci.json`.

| modo | vitórias | meta | derrotas | main antes (bot-parceiro, depois) |
|---|---|---|---|---|
| 1p | **2/16** ✓ | 2–6 | todas pelo carro | 3/16 |
| 3p | **9/16** ✓ | 7–11 | time 4, carro 3 | 10/16 |
| 6p | **8/16** ✓ | 7–11 | time 7, tempo esgotado 1 | 10/16 |

Os três modos estão dentro da meta. O 1p ficou na borda de baixo. O conserto do bot do E6 (vgm/bot-nao-trava, ainda fora da main) arma o 1p em 16/16, e o E6 avisou que o 1p deve ficar um pouco mais forte com ele.

## O primeiro minuto no celular (gif-ci)

Run: https://github.com/Cabraiz/viagem/actions/runs/40785856604.
- Tela de celular, 60 s de partida, entrou em 8 s, o jogo rodou a 8 fps, 0 erros.
- Os inimigos chegam e a vida cai de 81 para 37 entre 49 e 81 s.
- Quadros: `ritmo-morto-28-10/gif/andando-celular/quadros.png` e `meio.png`. O `partida.gif` (17 MB) não foi para o git.

## Limites conhecidos

- Em algumas seeds de 6p (14, 15, 16) o time topa com um bando e faz 12 XP ou mais em 20–30 s. Isso só mudaria mexendo no XP por abate, que fica fora deste card.
- As seeds paradas continuam sem nível no 1p (6, 11) e no 3p (11) até o conserto do bot-nao-trava entrar na main. Com ele elas viram seeds armadas.
- O E7 (caixa-sempre-alcancavel, ainda fora da main) muda o sorteio das caixas iniciais na maioria das seeds. Quando ele e o bot-nao-trava entrarem, vale rodar de novo a auditoria (`levelup-audit.ts --players 1|3|6`) para conferir a janela.
