# Diagnóstico · BUG-20261023-ORQ-armas-sem-projetil (E1, 23/10)

Partida real local (origin/main 1fc505ea, Worker local, SwiftShader, 1280×720), inventário de teste com
escopeta/rojão/tijolo/traque/pistola/rifle. GIFs nesta pasta (`*-real.gif` velocidade real, `*-lento.gif` 4× mais lento).

| Arma | Projétil no sim? | Desenhado no cliente? | Voo visível? | FX boca / acerto | Falha? |
|---|---|---|---|---|---|
| Espalha-Chumbo (escopeta) | **não**: padrão `cone`, dano instantâneo (fireCone) | só o clarão `clarao-espingarda` repetido até 1,6 u | **não**: 3 baforadas laranja na boca, parece explosão | boca: sim (cone de clarões) | **sim** |
| Rojão de Réveillon | zona `zone` nasce **no alvo**, parada | peça `rojao` parada no alvo + `explosao-m` | **não**: explode no bicho no mesmo tique | acerto: explosão | **sim** |
| Tijolo Baiano | zona no alvo, parada | tijolo ×0,35 no alvo + `impacto-poeira` | **não** | acerto: poeira | **sim** |
| Traque de São João | 4 zonas em volta do alvo, paradas | traque ×0,4 + `fogos-estouro` | **não** | acerto: faíscas | **sim** |
| Cano Longo (rifle) | sim, `pierce`, 2,7 u/s | `bala-fuzil` 96×8 a ×0,5 = **48×4 px** | quase não: risco laranja de 4 px no chão nevado | boca: `clarao-fuzil` | **sim (visibilidade)** |
| Metralhadora de Feira | sim, `pierce`, 1,8 u/s | `bala-metralhadora` 96×8 a ×0,5 = 48×4 px | mesmo caso do rifle (não gravada) | boca: `clarao-metralhadora` | **sim (visibilidade)** |
| Trinta-e-Oitão (pistola) | sim, `pierce`, 1,7 u/s | `bala-revolver` ×5 (melee-alcance-2x) | sim | boca | não |
| Baladeira, Espeto, Sacolé, Tarô, Buscapé, Tampa, Bola Murcha | sim (pierce/homing/ricochete) | peça própria 64×64 → 32 px | sim (código; fatia A1/A2 com GIF) | — | não |
| Maçarico, Faca, Colher, Peixeira, Facão, Corneta, Mangueira, Olho, Uivo | não (cone/corpo a corpo/feixe) | chama/arco/onda | não se aplica (não atiram) | — | fora |
| Panela de Pressão / Carro de Som | mina no pé / torreta que atira ondas | peça + explosão / onda | ondas sim | — | não |

Causa: as armas de arremesso (`zone`) nascem no alvo e a escopeta é um `cone` instantâneo; o cliente só desenha o
clarão/explosão. Rifle e metralhadora têm bala, mas fina demais.

Correção proposta (etapa 2):
1. Arremesso (rojão, tijolo, traque): no sim a zona sai do herói e voa 8 tiques (0,4 s) até o ponto, sem acertar
   nada no caminho, e só lá começa a explosão (mesmo dano, área e duração; o acerto atrasa 0,4 s). O cliente desenha o
   objeto em arco (o rojão quase reto, apontando no caminho) e toca a explosão quando ele cai. Mexe no sim → --worker.
2. Escopeta: dano continua instantâneo; o cliente desenha 7 chumbinhos em leque saindo da boca até o alcance do cone
   (4 u) em ~0,19 s, e um clarão só na boca (sem a fileira de clarões que parecia explosão).
3. Rifle ×4 e metralhadora ×3 no desenho da bala (como a pistola ×5), sem mexer na área de acerto.
