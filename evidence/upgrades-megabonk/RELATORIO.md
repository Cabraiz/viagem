# Upgrades estilo Megabonk · prova (card NEW-20261022-ORQ-upgrades-megabonk, E6, 22/10/2026)

## 1. Megabonk × nosso jogo

No Megabonk há dois tipos de upgrade: o da **arma** (sobe só aquela arma: dano, nº de projéteis, tamanho, empurrão…; a raridade multiplica: incomum ×1,2, rara ×1,4, épica ×1,6, lendária ×2) e os **tomos** (um atributo cada, valem para todas as armas, sem equipar). No nosso combate manual só a arma da mão atira e as armas trocam pela caixa, então os upgrades viraram **tomos**: valem para a arma que estiver na mão e não se perdem ao trocar. A raridade da arma continua vindo da caixa.

| Megabonk | Nosso (nome no jogo) | Por nível |
|---|---|---|
| Quantity (nº de projéteis) | **Bombinha de São João** (era o "pente") | +1 projétil (nv 1-4); cada extra mira outro bicho; torres +1 alvo |
| Damage | Óculos Juliet | +10% dano |
| Projectile Speed | **Estilingue do Moleque** (novo) | +40% velocidade do tiro (até ×3) |
| Size | Megafone do Carro do Ovo | +10% área |
| Cooldown | Café Coado na Meia | ataca 8% mais rápido |
| Aura (arma) | **Defumador da Tia** (novo, sem equipar) | aura: 8 → 32 de dano/s, raio 1,3 → 2,5 m |
| HP | Marmita da Vó | +20 de vida |
| Regen | **Arruda atrás da Orelha** (novo) | +0,5 de vida/s |
| Armor | **Tampa de Panela** (novo, nv 1-3) | -1 de dano por golpe tomado |
| Agility | Tênis de Feira | +10% velocidade |
| Luck | Boné do Pai | +10% sorte |
| XP | Cartão Fidelidade | +8% XP |
| Attraction (ímã) | — | fora: a D-054 tirou o ímã |
| Duration, Knockback, Crit, Evasion, Thorns… | — | não entraram (sem efeito que se veja no nosso combate) |
| — | Silenciador de Garagem | -25% de barulho (acorda menos ninho) |

Torres: atiram com os tomos de quem construiu (dano × Óculos, cadência × Café, área × Megafone, +1 alvo por Bombinha).

## 2. Tiro dos heróis

3x mais lento que antes (escolha do usuário depois dos GIFs de 4x e 5x), vivendo 3x mais: mesmo alcance. Pistola 5 → 1,67 u/s, rifle 8 → 2,67 u/s. Os tiros dos inimigos não mudaram. GIFs: `tiro-hoje-4x-5x-pistola.gif`, `tiro-hoje-4x-5x-rifle.gif`, `niveis-projeteis-aura.gif`.

## 3. Vida dos inimigos no começo

Só no modo ninhos (o jogo no ar: grupos dos ninhos e os dormentes do mapa, que usam a linha 3): `rules/waves.ts` campo `hpNinhos` das linhas 1-5 = 1,3 / 1,4 / 1,5 / 1,55 / 1,6 (o hpScale era .35 / .8 / 1,1 / 1,35 / 1,55; linha 6 em diante igual). O modo antigo em rodadas (ilha, infinito, ondas da cidade) fica com o tutorial como estava. Quantidade de inimigos igual.

Bench `scripts/bench-ttk.ts` (cidade, chaveiro, combate manual, ninhos, bots da sala), main × branch:

**1p** (12 seeds, golpes por abate · abates no minuto · nível do time)

| min | antes golpes | depois golpes | antes abates | depois abates | antes nível | depois nível |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 1.47 | 1.8 | 1.4 | 1.1 | 1 |
| 2 | 1 | 1.53 | 1.7 | 1.4 | 1.3 | 1.2 |
| 3 | 1 | 1.11 | 2.5 | 2.3 | 1.6 | 1.6 |
| 4 | 1.06 | 1.29 | 2.7 | 2.6 | 1.9 | 1.8 |
| 5 | 1.26 | 1.65 | 5.1 | 5 | 2.3 | 2.3 |
| 6 | 2.01 | 2.28 | 5.9 | 6.6 | 3 | 3 |
| 7 | 2.18 | 1.95 | 4.3 | 5.3 | 3.2 | 3.3 |
| 8 | 2.22 | 2.66 | 5 | 4.7 | 3.5 | 3.8 |
| 9 | 2.56 | 2.62 | 3.4 | 3.3 | 3.7 | 3.8 |
| 10 | 2.56 | 3.18 | 1.5 | 3.8 | 3.8 | 4.2 |

**4p** (12 seeds, golpes por abate · abates no minuto · nível do time)

| min | antes golpes | depois golpes | antes abates | depois abates | antes nível | depois nível |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1.74 | 1.9 | 11.8 | 11.3 | 2.3 | 2.2 |
| 2 | 1.63 | 1.87 | 5.9 | 7.1 | 2.5 | 2.8 |
| 3 | 1.17 | 1.82 | 26.4 | 24.5 | 3.8 | 3.8 |
| 4 | 1.19 | 2 | 22.4 | 24.7 | 4.5 | 4.8 |
| 5 | 1.69 | 2.32 | 37.7 | 31.1 | 6 | 5.8 |
| 6 | 2.16 | 2.6 | 25.3 | 24.7 | 6.9 | 6.6 |
| 7 | 2.32 | 2.81 | 35.9 | 26.9 | 7.8 | 7.6 |
| 8 | 2.62 | 2.94 | 25.5 | 23.8 | 8.7 | 8.1 |
| 9 | 3.15 | 3.46 | 35.7 | 27.9 | 9.6 | 8.8 |
| 10 | 3.35 | 4.36 | 36.8 | 21.5 | 10.6 | 9.4 |

Resultado em 10 min, antes: 1p defeat (carro): 1, 1p defeat: 6, 1p timeout: 5, 4p defeat: 1, 4p timeout: 8, 4p victory: 3

Resultado em 10 min, depois: 1p defeat (carro): 3, 1p defeat: 3, 1p timeout: 6, 4p defeat (carro): 2, 4p timeout: 6, 4p victory: 4
## 4. DPS por arma (verde) por upgrade

Dano por segundo com todos os tiros acertando (os projéteis extras vão em outros bichos, então é o DPS na multidão; a faca com 2 "projéteis" golpeia também para trás).

| arma (verde) | sem upgrade | Bombinha 1 | Bombinha 2 | Óculos 3 | Café 3 | Bombinha 2 + Óculos 3 + Café 3 |
|---|---:|---:|---:|---:|---:|---:|
| Faca de Pão | 48 | 96 | 144 | 62 | 60 | 234 |
| Trinta-e-Oitão do Vô | 50 | 100 | 150 | 65 | 67 | 260 |
| Espalha-Chumbo | 51 | 102 | 153 | 66 | 66 | 257 |
| Metralhadora de Feira | 60 | 120 | 180 | 78 | 60 | 234 |
| Cano Longo | 65 | 131 | 196 | 85 | 85 | 330 |
| Maçarico do Tio | 50 | 100 | 150 | 65 | 50 | 195 |
| Rojão de Réveillon | 57 | 114 | 171 | 74 | 74 | 290 |

Defumador (aura, sem equipar): nv 1: 8 dano/s em 1.3 m · nv 2: 14 dano/s em 1.6 m · nv 3: 20 dano/s em 1.9 m · nv 4: 26 dano/s em 2.2 m · nv 5: 32 dano/s em 2.5 m
