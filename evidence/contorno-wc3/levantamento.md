# Contorno WC3 — etapa 1: levantamento (23/10)

## Como a barricada aparece hoje
Sem realce nenhum. Arte importada (stonewards.ts drawBarricade / muralha.ts) + barra de vida quando avariada; o
procedural (sacos) tem só o contorno Breu fino (D-022). Nada claro, nada pulsando. Prints: `antes/obra-livre`,
`antes/muralha-tralha`, `antes/zoom-barricada-obra`. Então o "igual na barricada" do usuário é o padrão a CRIAR
(contorno claro e brilhante pulsando, estilo WC3) e pôr na barricada e no resto.

## O que o jogador usa ou pega (alvo do realce)
| Coisa | Como usa | Onde desenha |
|---|---|---|
| Barricada da cidade (bocas da praça) | conserta na forja | render/stonewards.ts drawBarricade |
| Barricada livre / muralha de tralha / muro | constrói, conserta | render/fortify.ts, render/muralha.ts |
| Carro (Uno) | Puxar na corda | render/chaveiro/ (uno-art, renderer) |
| Baús/caixas por raridade | abre | render/layers.ts pickups kind 'chest' + arsenal-fx.ts |
| Armas e itens no chão | pega | render/layers.ts pickups (já têm anel Breu via city-outline.ts) |
| Torres e obra (defesas) | constrói, melhora | render/towers/towers.ts |
| Veículos (patinete, carrinho, crossfiteiro) | monta | render/you.ts / textures.ts |
| Bancos | saca | render/bancos/renderer.ts |
| Nós de coleta (pedra, coco) | coleta | render/stonewards.ts drawNode |
| Bala (tiro do jogador) | — (só destaque na neve) | render/layers.ts projectiles / arsenal-fx.ts |

## Plano da etapa 2
Um módulo (render/usable-glow.ts): contorno claro (Papel/Cartolina quente) 2–3 px de tela + halo, pulsando ~1 Hz
(fixo com movimento reduzido), feito na carga com outline.ts/bandsRgba (custo zero por quadro: só alpha do pulso numa
cópia), ligado nos sprites acima e na bala. Medir FPS no celular antes/depois.
