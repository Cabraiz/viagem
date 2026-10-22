# Estudo: por que os inimigos parecem flutuar ou ter "pixel ruim" (comparação com o Myth)

Card: NEW-20261022-ORQ-estudo-inimigos-flutuando · branch `vgm/estudo-flutuando` (só flags de debug, nada muda sem `?estudo=`).
Cena: sandbox cidade, `foto=sombra&limpo=1`, 6 inimigos na neve, PC 1280x720 DPR 1 (zoom padrão, herói com 87 px). Folha: `folha-estudo.png`.

## Resposta curta

1. **"Flutuando" vem da sombra de contato, não do contorno.** No Myth a sombra é a coisa mais escura da cena; no nosso jogo, sobre a neve, ela é mais clara que o boneco.
   - Myth: sombra (luma ~52) < grama (65) < boneco (78).
   - Nosso: boneco (66–103) < sombra (~170) < neve (216).

   Nas duas cenas a sombra escurece o chão no mesmo tanto (×0,77–0,81). Só que, sobre a neve branca, isso dá um lilás claro que fica em volta do pé em vez de segurá-lo. A elipse de contato atual é Breu 38 % de borda dura (×0,67–0,76 no chão) e não fica mais escura que a silhueta.
   - **V2** (contato pequeno, escuro e macio sob a sola, além da silhueta) assenta o pé na hora.
   - **V2b** (só a silhueta, sem contato, que é a direção da sombra-silhueta do E4) piora: o pé fica sem âncora.

   Geometria: a sombra encosta na sola em todos (`sombra_tocando_sola: true`). Não há vão.
2. **O "pixel ruim" vem da cópia lite esticada.** Os inimigos usam a folha lite (célula 78 px, vinda de 128 px). Ela foi dimensionada para um herói de 56 px CSS (celular, zoom máximo). Altura do herói medida:

   | Tela | Zoom | Herói |
   |---|---|---|
   | 390x844 | padrão | 47 px |
   | 1280x720 | padrão | 87 px |
   | 1280x720 | PC | 70 px |
   | 1920x1080 | PC | 105 px |

   No PC a lite é ampliada ~1,6× (até ~1,9× em full HD), com filtro linear, e por isso fica borrada. **V4** (folha cheia) fica nítida. Custo: a folha cheia pesa ~4× (6 inimigos: 4,4 MB lite → 18,4 MB).
3. **O sombreamento no próprio boneco ajuda, mas não é a causa.** A nossa arte já tem pés/cabeça = 0,60 (mediana dos 6; 0,67 no elenco de 151), e o Myth fica entre 0,51 e 0,68. O contraste interno também é parecido (CV 0,52 × 0,55).
   - **V6b2** (software offline) dá volume: pés/cabeça 0,43–0,47, lado escuro/claro 0,71.
   - **V6a** (tint por canto, sem custo) escurece a caixa toda de baixo para cima e fica turvo.
4. **Contorno: não é ele.** Inimigo não tem contorno branco: o anel branco/Breu é só o adesivo "você" do herói. O aro umber assado na arte quase não aparece (luma da borda 69 × miolo 75). O traçado preto (**V1**, Breu 2 px) deixa o boneco com cara de adesivo e o descola ainda mais.
5. **Luz/cor (V3) e tamanho: efeito pequeno.** Boneco/chão = 0,31–0,48 (Myth: 1,2), porque os bonecos são escuros sobre neve branca. Um tint multiplicativo não muda isso, e o V3 quase não aparece. Tamanho: 12–13 % da altura da tela, contra ~16 % no Myth. Não é a causa.

## Ranking da causa

| # | Causa | Variante que corrige | Evidência |
|---|---|---|---|
| 1 | Sombra de contato clara e de borda dura sobre a neve (mais clara que o boneco) | V2 | ordem tonal acima; V2 × V2b |
| 2 | Lite 78 px esticada 1,6–1,9× no PC | V4 (ou lite nova para PC) | altura do herói por tela; V4 |
| 3 | Pouco volume próprio (lado da luz) | V6b2 | pés/cabeça 0,60 → 0,45; escuro/claro 0,93 → 0,71 |
| 4 | Contorno | nenhuma (V1 piora) | borda 69 × miolo 75 |
| 5 | Cor ambiente | V3 (quase nulo) | — |

## Recomendação (V5a)

Sombra de contato escura, pequena e macia, mais a silhueta (V2), mais a folha nítida no PC (V4), mais a pseudo-sombra por software força 2 (V6b2).
- A V5b (V5a + ambiente) quase não difere da V5a.
- A pseudo-sombra roda offline, sem custo no jogo: `node scripts/pseudo-sombra.mjs --forca 2 --todos` (~16 s por 6 inimigos, ~7 min para o elenco todo).
- Para a nitidez sem pesar 4×, a saída é uma lite de PC dimensionada para o herói de ~105 px, a lite atual mantida no celular. Precisa medir o peso antes.

## Variantes (`?estudo=`)

| Variante | Flag |
|---|---|
| V1 | `aro=breu` |
| V2 | `contato` |
| V2b | `semcontato` |
| V3 | `amb` |
| V4 | `cheia` |
| V6a1–3 | `ps=a1..a3` |
| V6b1–3 | `folha=pseudo-b1..b3` |
| V5a | `cheia,folha=pseudo-b2-cheia,contato` |

Para isolar a sombra: `sil=0`. As folhas processadas ficam em `public/art/estudo/` (geradas pelo script e não versionadas).
Medidas: `medidas-*.json` (`scripts/estudo-flutuando/medir.py`, `medir-folhas.py`).
