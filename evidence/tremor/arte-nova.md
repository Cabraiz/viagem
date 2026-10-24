# Quadros de arte nova — 312 (loops 11, ações 301)

Quadros que, mesmo transladados/escalados até os vizinhos, não casam com eles (scripts/medir-tremor.mjs, tipo arte-nova). O corretor (scripts/corrigir-tremor.mjs) não mexe neles.
Nos loops o desenho é outro de verdade (calibrado: skatista walk NE q3, sommelier idle W q4). Nas ações a pose muda de propósito na maioria (morte caindo, golpe): triar a olho antes de redesenhar.

Ações por animação: death 222, crash 21, lecture 17, summon 12, charge 7, shove 7, throw 6, slam 4, attack 3, wake 1, pose 1.

## Loops

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico |
|---|---|---|---|---|---|---|
| skatista-de-47 | walk | NE | 3 | cx, altura, escala, cy | 11.02 | 0.214 → 0.647 / 0.876 |
| pombos | fly | NW | 3 | cy | 5.93 | 0.441 → 0.507 / 0.645 |
| barata-voadora | fly | N | 4 | cy, escala | 5.18 | 0.463 → 0.524 / 0.769 |
| skatista-de-47 | walk | SE | 3 | cx | 4.58 | 0.56 → 0.612 / 0.83 |
| sommelier-de-ipa | idle | W | 4 | cx, pex | 4.56 | 0.473 → 0.734 / 0.94 |
| skatista-de-47 | walk | E | 7 | escala, cx | 3.68 | 0.621 → 0.715 / 0.912 |
| skatista-de-47 | walk | NW | 3 | cx, altura, escala | 3.62 | 0.557 → 0.647 / 0.894 |
| bandeirinha-existencial | idle | NW | 2 | cy | 2.13 | 0.681 → 0.709 / 0.899 |
| skatista-de-47 | walk | E | 3 | cy | 2.09 | 0.541 → 0.639 / 0.912 |
| manobrista | walk | NW | 7 | escala, cy | 1.96 | 0.606 → 0.616 / 0.843 |
| barata-voadora | fly | NE | 4 | escala | 1.68 | 0.525 → 0.573 / 0.753 |

## Ações e dano

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico |
|---|---|---|---|---|---|---|
| buraco-de-rua | death | NW | 1 | altura, cy, escala | 10.53 | 0.581 → 0.679 / 0.87 |
| buraco-de-rua | death | E | 1 | altura, cy, escala | 10.29 | 0.542 → 0.65 / 0.851 |
| buraco-de-rua | death | W | 1 | altura, cy, escala | 8.97 | 0.537 → 0.603 / 0.868 |
| buraco-de-rua | death | SE | 1 | altura, cy, escala | 8.48 | 0.58 → 0.658 / 0.829 |
| auditor-das-sombras | death | NE | 7 | pe, cy, cx | 7 | 0.124 → 0.268 / 0.834 |
| coco-que-vende-gente | death | W | 8 | altura, pe, cy, cx | 6.98 | 0.382 → 0.35 / 0.829 |
| mapinguari-do-shopping | slam | S | 4 | altura, cy, escala | 6.63 | 0.433 → 0.516 / 0.762 |
| malabarista-do-sinal | death | E | 8 | altura, cy, cx | 6.41 | 0.389 → 0.369 / 0.609 |
| peladeiro-de-vidro | death | S | 5 | altura, cy | 6.27 | 0.372 → 0.487 / 0.64 |
| revendedora-de-catalogo | throw | NE | 4 | altura, cy, escala | 6.2 | 0.423 → 0.541 / 0.906 |
| mapinguari-do-shopping | slam | NW | 4 | cy, altura, escala | 6.17 | 0.449 → 0.493 / 0.79 |
| coco-que-vende-gente | death | E | 8 | altura, pe | 6.15 | 0.377 → 0.336 / 0.816 |
| urubu-fiscal | wake | 0 | 2 | cy, pe, escala | 5.9 | 0.413 → 0.655 / 0.882 |
| coco-que-vende-gente | death | NW | 7 | altura, cy, escala | 5.79 | 0.421 → 0.393 / 0.711 |
| auditor-das-sombras | death | W | 7 | cy | 5.76 | 0.086 → 0.266 / 0.806 |
| motoboy | crash | E | 3 | altura, cy | 5.69 | 0.425 → 0.584 / 0.788 |
| hater-anonimo | death | S | 8 | altura | 5.67 | 0.265 → 0.443 / 0.757 |
| rodinho-do-sinal | death | E | 8 | escala, cy | 5.67 | 0.354 → 0.472 / 0.629 |
| bandeirinha-existencial | death | W | 6 | cy, altura, cx | 5.56 | 0.17 → 0.506 / 0.637 |
| fogueteiro | death | E | 6 | cy, cx | 5.51 | 0.134 → 0.362 / 0.672 |
| auditor-das-sombras | death | S | 7 | cy, pe | 5.46 | 0.085 → 0.336 / 0.747 |
| boitata-de-sacolinha | charge | NW | 3 | pe, altura, cy | 5.44 | 0.432 → 0.506 / 0.678 |
| fogueteiro | death | W | 6 | cy | 5.28 | 0.149 → 0.312 / 0.66 |
| rodinho-do-sinal | death | NE | 8 | escala, cy | 5.28 | 0.337 → 0.473 / 0.758 |
| homem-surdo | lecture | E | 6 | altura, cy, escala | 5.26 | 0.404 → 0.452 / 0.83 |
| cupim-mansao | shove | SE | 4 | cy, altura | 5.24 | 0.528 → 0.661 / 0.863 |
| fogueteiro | death | N | 6 | cy | 5.23 | 0.195 → 0.397 / 0.822 |
| boitata-de-sacolinha | charge | E | 3 | altura | 5.22 | 0.504 → 0.57 / 0.734 |
| buraco-de-rua | death | SW | 1 | altura, cy, escala | 5.21 | 0.629 → 0.655 / 0.84 |
| glitter-senciente | death | NE | 8 | cx, pe | 5.19 | 0.159 → 0.188 / 0.705 |
| fogueteiro | death | SW | 6 | escala, cy | 5.18 | 0.145 → 0.309 / 0.667 |
| chefe-pizza | death | SE | 7 | altura, cx | 5.12 | 0.531 → 0.642 / 0.823 |
| homem-surdo | lecture | NW | 6 | altura, cy, escala | 5.1 | 0.47 → 0.529 / 0.851 |
| mapinguari-do-shopping | slam | SW | 4 | altura, cy, cx | 5.03 | 0.419 → 0.57 / 0.751 |
| glitter-senciente | death | SE | 8 | cx, pe | 5.01 | 0.204 → 0.2 / 0.757 |
| perueiro | crash | E | 5 | altura, cy | 5 | 0.469 → 0.584 / 0.847 |
| glitter-senciente | death | E | 8 | cx, pe, cy | 4.98 | 0.189 → 0.16 / 0.689 |
| boitata-de-sacolinha | charge | SE | 3 | altura, cy, escala, pe | 4.95 | 0.485 → 0.61 / 0.774 |
| auditor-das-sombras | death | SE | 7 | cy | 4.93 | 0.101 → 0.31 / 0.842 |
| o-grande-credor | death | S | 7 | escala | 4.9 | 0.402 → 0.462 / 0.706 |
| glitter-senciente | death | W | 8 | cx, pe | 4.87 | 0.185 → 0.175 / 0.713 |
| rodinho-do-sinal | attack | S | 3 | cx | 4.84 | 0.26 → 0.407 / 0.694 |
| auditor-das-sombras | death | S | 6 | altura | 4.81 | 0.269 → 0.462 / 0.747 |
| glitter-senciente | death | N | 8 | cx, pe | 4.78 | 0.196 → 0.183 / 0.702 |
| auditor-das-sombras | death | E | 7 | cy | 4.77 | 0.092 → 0.261 / 0.792 |
| auditor-das-sombras | death | N | 7 | cy | 4.71 | 0.056 → 0.257 / 0.804 |
| perueiro | crash | N | 5 | altura, cy | 4.7 | 0.42 → 0.528 / 0.793 |
| glitter-senciente | death | NW | 8 | cx, pe | 4.68 | 0.167 → 0.326 / 0.735 |
| tia-do-zap | death | NW | 8 | pe, cy | 4.67 | 0.113 → 0.144 / 0.859 |
| homem-surdo | lecture | SW | 6 | altura, cy, escala | 4.64 | 0.516 → 0.556 / 0.78 |
| rodinho-do-sinal | death | SE | 8 | escala, cy | 4.61 | 0.346 → 0.54 / 0.761 |
| fogueteiro | death | NE | 6 | cy | 4.52 | 0.171 → 0.346 / 0.663 |
| chefe-pizza | death | N | 7 | altura, cx | 4.51 | 0.498 → 0.645 / 0.852 |
| motoboy | crash | S | 2 | altura, escala, cy | 4.49 | 0.532 → 0.654 / 0.841 |
| hater-anonimo | death | SE | 8 | altura, cy | 4.44 | 0.294 → 0.536 / 0.738 |
| buraco-de-rua | death | S | 1 | cy, altura, escala | 4.37 | 0.646 → 0.669 / 0.856 |
| homem-surdo | lecture | W | 6 | altura, escala, cy | 4.37 | 0.451 → 0.475 / 0.81 |
| glitter-senciente | death | S | 8 | cx, pe | 4.36 | 0.157 → 0.182 / 0.599 |
| glitter-senciente | death | SW | 8 | cx, pe | 4.36 | 0.194 → 0.202 / 0.684 |
| o-grande-credor | death | SW | 7 | escala | 4.34 | 0.419 → 0.468 / 0.66 |
| marimbondo-sindical | death | NE | 4 | altura, cy | 4.32 | 0.402 → 0.554 / 0.756 |
| tiozinho-da-sinuca | death | NE | 7 | cy, pe, altura, cx | 4.31 | 0.346 → 0.53 / 0.67 |
| homem-surdo | lecture | SE | 6 | altura, cy, escala | 4.27 | 0.513 → 0.538 / 0.81 |
| auditor-das-sombras | death | SW | 7 | cy | 4.23 | 0.11 → 0.345 / 0.817 |
| cafeteira-burnout | crash | NE | 5 | altura, cy | 4.22 | 0.587 → 0.637 / 0.839 |
| rodinho-do-sinal | death | S | 8 | escala, cy | 4.22 | 0.315 → 0.48 / 0.794 |
| fogueteiro | death | SE | 6 | cy | 4.19 | 0.18 → 0.399 / 0.584 |
| tia-do-zap | death | E | 8 | pe, cy | 4.17 | 0.073 → 0.262 / 0.833 |
| zelador-hidraulico | death | NE | 8 | escala | 4.17 | 0.426 → 0.605 / 0.844 |
| homem-surdo | lecture | NE | 6 | altura, cy, escala | 4.12 | 0.523 → 0.555 / 0.903 |
| mapinguari-do-shopping | summon | S | 3 | cy, altura | 4.12 | 0.472 → 0.521 / 0.771 |
| malabarista-do-sinal | death | S | 7 | cy | 4.1 | 0.257 → 0.33 / 0.55 |
| dono-do-boteco | death | E | 6 | escala | 4.07 | 0.365 → 0.468 / 0.757 |
| fogueteiro | death | S | 6 | pe, altura | 4 | 0.174 → 0.35 / 0.642 |
| rodinho-do-sinal | death | W | 8 | escala, cy | 4 | 0.357 → 0.52 / 0.682 |
| rodinho-do-sinal | death | SW | 8 | escala, cy, altura | 3.99 | 0.358 → 0.592 / 0.762 |
| tia-do-zap | death | N | 6 | escala | 3.97 | 0.275 → 0.371 / 0.844 |
| auditor-das-sombras | death | E | 6 | altura | 3.93 | 0.236 → 0.417 / 0.792 |
| malabarista-do-sinal | death | N | 8 | altura, escala | 3.9 | 0.247 → 0.306 / 0.643 |
| carrinho-da-vo | charge | W | 3 | altura, cy | 3.86 | 0.748 → 0.604 / 0.818 |
| marimbondo-sindical | death | SE | 4 | altura, cy, cx | 3.84 | 0.369 → 0.539 / 0.715 |
| tia-do-zap | death | W | 6 | pe, escala, altura | 3.83 | 0.258 → 0.337 / 0.787 |
| tia-do-zap | death | NE | 8 | pe | 3.83 | 0.089 → 0.255 / 0.872 |
| malabarista-do-sinal | death | NE | 8 | altura, escala, cx | 3.77 | 0.252 → 0.315 / 0.666 |
| chefe-pizza | death | SW | 5 | escala, altura, cy, pe | 3.75 | 0.402 → 0.572 / 0.842 |
| homem-surdo | lecture | S | 6 | altura, cy, escala | 3.75 | 0.514 → 0.556 / 0.804 |
| animador-necromante | lecture | S | 6 | altura, cy | 3.66 | 0.561 → 0.614 / 0.772 |
| malabarista-do-sinal | death | NW | 8 | altura, escala | 3.66 | 0.211 → 0.274 / 0.618 |
| mapinguari-do-shopping | summon | NW | 3 | cy, altura | 3.66 | 0.535 → 0.588 / 0.853 |
| perueiro | crash | NE | 5 | cy, altura | 3.65 | 0.507 → 0.633 / 0.844 |
| auditor-das-sombras | death | NW | 7 | cy | 3.64 | 0.105 → 0.318 / 0.832 |
| rodinho-do-sinal | attack | W | 3 | cx, altura | 3.64 | 0.195 → 0.341 / 0.629 |
| auditor-das-sombras | death | W | 6 | altura | 3.63 | 0.342 → 0.485 / 0.806 |
| malabarista-do-sinal | death | W | 7 | cy | 3.62 | 0.299 → 0.397 / 0.51 |
| tia-do-zap | death | SE | 6 | escala, cy | 3.62 | 0.274 → 0.356 / 0.86 |
| malabarista-do-sinal | death | SW | 8 | altura, escala | 3.61 | 0.261 → 0.305 / 0.597 |
| perueiro | crash | W | 5 | altura, cy | 3.6 | 0.386 → 0.503 / 0.814 |
| malabarista-do-sinal | death | W | 8 | altura, escala | 3.58 | 0.233 → 0.264 / 0.51 |
| malabarista-do-sinal | death | NW | 7 | cy | 3.57 | 0.29 → 0.375 / 0.618 |
| o-grande-credor | death | S | 13 | pe, cx | 3.56 | 0.143 → 0.365 / 0.706 |
| malabarista-do-sinal | death | N | 7 | cy | 3.55 | 0.283 → 0.316 / 0.643 |
| rodinho-do-sinal | attack | SW | 3 | cx | 3.54 | 0.257 → 0.347 / 0.717 |
| pombo-rei | death | W | 8 | altura | 3.53 | 0.369 → 0.478 / 0.609 |
| podcaster-de-garagem | death | E | 5 | pe, cx, cy | 3.5 | 0.429 → 0.551 / 0.886 |
| hater-anonimo | death | NW | 8 | altura, cy, cx | 3.49 | 0.145 → 0.34 / 0.768 |
| perueiro | crash | SW | 5 | altura, cy | 3.49 | 0.522 → 0.632 / 0.829 |
| chefe-pizza | death | W | 5 | escala, altura, cy | 3.48 | 0.415 → 0.631 / 0.839 |
| tia-do-zap | death | S | 6 | escala, pe | 3.45 | 0.276 → 0.322 / 0.821 |
| marimbondo-sindical | death | NW | 4 | altura | 3.44 | 0.493 → 0.561 / 0.756 |
| o-grande-credor | death | SE | 12 | pe, altura | 3.44 | 0.236 → 0.448 / 0.668 |
| chefe-pizza | death | N | 6 | escala | 3.41 | 0.446 → 0.608 / 0.852 |
| malabarista-do-sinal | death | SW | 7 | cy | 3.4 | 0.3 → 0.309 / 0.597 |
| o-grande-credor | death | NW | 11 | pe, cy | 3.39 | 0.26 → 0.27 / 0.608 |
| tia-do-zap | death | NE | 6 | escala | 3.39 | 0.27 → 0.345 / 0.872 |
| chefe-pizza | death | E | 5 | escala, cx | 3.38 | 0.406 → 0.579 / 0.756 |
| rei-do-camarote | death | NE | 4 | cx, cy, altura | 3.36 | 0.366 → 0.55 / 0.717 |
| tia-do-zap | death | SE | 7 | pe, altura, cx | 3.33 | 0.146 → 0.294 / 0.86 |
| tia-do-zap | death | SE | 8 | pe | 3.33 | 0.227 → 0.425 / 0.86 |
| primo-do-violao | death | SE | 3 | escala | 3.31 | 0.433 → 0.531 / 0.774 |
| malabarista-do-sinal | death | S | 8 | altura, escala, cx | 3.3 | 0.218 → 0.283 / 0.55 |
| fogueteiro | death | NW | 6 | cy | 3.26 | 0.16 → 0.302 / 0.696 |
| rei-do-camarote | death | SE | 3 | cx, escala | 3.25 | 0.405 → 0.578 / 0.795 |
| perueiro | crash | NW | 5 | cy, altura | 3.22 | 0.431 → 0.591 / 0.846 |
| zelador-hidraulico | death | S | 8 | cy, escala | 3.22 | 0.445 → 0.618 / 0.795 |
| auditor-das-sombras | death | SW | 6 | altura | 3.19 | 0.324 → 0.466 / 0.817 |
| glitter-senciente | death | S | 7 | cy | 3.16 | 0.299 → 0.425 / 0.599 |
| tia-do-zap | death | NW | 6 | escala | 3.16 | 0.285 → 0.385 / 0.859 |
| marimbondo-sindical | death | N | 4 | altura | 3.15 | 0.411 → 0.535 / 0.722 |
| animador-necromante | lecture | SE | 6 | altura, cy, escala | 3.14 | 0.615 → 0.627 / 0.871 |
| chefe-pizza | death | NW | 5 | escala, altura, cy | 3.09 | 0.489 → 0.681 / 0.865 |
| auditor-das-sombras | death | NW | 6 | altura | 3.04 | 0.307 → 0.449 / 0.832 |
| hater-anonimo | death | NE | 8 | altura | 3.02 | 0.224 → 0.474 / 0.721 |
| homem-surdo | death | SE | 6 | escala | 3.01 | 0.071 → 0.32 / 0.493 |
| o-grande-credor | death | W | 10 | pe, cy | 3 | 0.388 → 0.451 / 0.603 |
| promotor-infinito | lecture | SE | 8 | cx | 3 | 0.467 → 0.729 / 0.911 |
| tia-do-zap | death | SW | 6 | escala | 3 | 0.335 → 0.354 / 0.781 |
| tia-do-zap | death | SW | 8 | pe, cx | 3 | 0.176 → 0.294 / 0.781 |
| animador-necromante | lecture | NE | 6 | altura, cy | 2.97 | 0.591 → 0.614 / 0.812 |
| o-grande-credor | death | S | 14 | cy | 2.96 | 0.163 → 0.367 / 0.706 |
| tia-do-zap | death | NE | 7 | altura | 2.92 | 0.168 → 0.271 / 0.872 |
| malabarista-do-sinal | death | NE | 7 | cy | 2.89 | 0.319 → 0.366 / 0.666 |
| tia-do-zap | death | E | 6 | escala | 2.88 | 0.24 → 0.342 / 0.833 |
| glitter-senciente | death | SW | 7 | cy | 2.86 | 0.364 → 0.438 / 0.684 |
| homem-surdo | lecture | N | 6 | escala, altura, cy | 2.84 | 0.511 → 0.554 / 0.833 |
| animador-necromante | lecture | NW | 6 | altura, cy | 2.78 | 0.575 → 0.593 / 0.808 |
| homem-surdo | death | SW | 6 | escala | 2.77 | 0.092 → 0.205 / 0.526 |
| rei-do-camarote | death | SE | 4 | cy, altura | 2.76 | 0.409 → 0.548 / 0.795 |
| dono-do-boteco | death | W | 6 | escala, cy, pe | 2.74 | 0.421 → 0.529 / 0.716 |
| glitter-senciente | death | SE | 7 | cy | 2.74 | 0.39 → 0.456 / 0.757 |
| tia-do-zap | throw | SW | 6 | altura, cy, escala | 2.74 | 0.514 → 0.601 / 0.787 |
| gamer-rage-quit | crash | N | 6 | cy, altura | 2.73 | 0.423 → 0.518 / 0.695 |
| glitter-senciente | death | N | 7 | cy | 2.72 | 0.386 → 0.392 / 0.702 |
| o-grande-credor | death | NE | 14 | pe, altura | 2.72 | 0.132 → 0.403 / 0.578 |
| tia-do-zap | death | E | 7 | altura | 2.7 | 0.151 → 0.293 / 0.833 |
| o-grande-credor | charge | E | 5 | cy, escala | 2.69 | 0.498 → 0.591 / 0.752 |
| primo-do-violao | death | N | 2 | altura, escala, cy | 2.69 | 0.54 → 0.621 / 0.821 |
| zelador-hidraulico | death | E | 8 | cy | 2.68 | 0.397 → 0.545 / 0.786 |
| espetinho-suspeito | death | SE | 7 | escala, cy | 2.67 | 0.558 → 0.612 / 0.781 |
| zelador-hidraulico | death | SW | 8 | cy | 2.67 | 0.448 → 0.636 / 0.804 |
| dono-do-boteco | death | SW | 6 | escala, cy | 2.66 | 0.436 → 0.524 / 0.724 |
| homem-surdo | death | NE | 6 | escala | 2.66 | 0.126 → 0.292 / 0.468 |
| perueiro | crash | SE | 5 | altura, cy, cx | 2.66 | 0.531 → 0.654 / 0.848 |
| executivo-de-patinete | crash | NE | 4 | cx | 2.63 | 0.282 → 0.487 / 0.756 |
| marimbondo-sindical | death | E | 4 | altura, cy, cx | 2.63 | 0.378 → 0.54 / 0.706 |
| homem-surdo | death | S | 6 | escala | 2.62 | 0.06 → 0.27 / 0.578 |
| glitter-senciente | death | NW | 7 | cy | 2.61 | 0.387 → 0.363 / 0.735 |
| boneco-gigante | shove | NE | 3 | cy | 2.6 | 0.589 → 0.618 / 0.84 |
| influencer | death | N | 8 | cy, escala, altura | 2.6 | 0.547 → 0.674 / 0.857 |
| homem-surdo | death | NW | 6 | escala | 2.58 | 0.12 → 0.194 / 0.372 |
| auditor-das-sombras | death | NE | 6 | altura | 2.55 | 0.319 → 0.461 / 0.834 |
| pombo-rei | death | SE | 6 | altura | 2.54 | 0.36 → 0.445 / 0.585 |
| guru-do-linkedin | death | NE | 7 | cy, pe | 2.52 | 0.417 → 0.673 / 0.883 |
| tia-do-zap | death | NW | 7 | altura | 2.48 | 0.199 → 0.296 / 0.859 |
| gamer-rage-quit | crash | SW | 6 | altura, cy | 2.47 | 0.448 → 0.508 / 0.637 |
| dono-do-boteco | death | S | 6 | escala | 2.45 | 0.485 → 0.534 / 0.748 |
| camelo-pirata | death | W | 4 | cx, escala | 2.43 | 0.367 → 0.556 / 0.71 |
| marimbondo-sindical | death | W | 4 | altura, cx | 2.42 | 0.431 → 0.598 / 0.771 |
| auditor-das-sombras | death | N | 6 | altura | 2.41 | 0.239 → 0.405 / 0.804 |
| dono-do-boteco | death | NE | 6 | escala | 2.4 | 0.398 → 0.513 / 0.702 |
| glitter-senciente | death | W | 7 | cy | 2.38 | 0.393 → 0.523 / 0.713 |
| homem-surdo | death | N | 6 | escala | 2.38 | 0.096 → 0.183 / 0.531 |
| guru-do-linkedin | death | SW | 7 | cy | 2.37 | 0.398 → 0.616 / 0.823 |
| caramujo-financiado | death | N | 6 | cy, escala | 2.36 | 0.492 → 0.571 / 0.758 |
| dono-do-boteco | death | NW | 6 | escala, altura, cy | 2.33 | 0.416 → 0.527 / 0.717 |
| podcaster-de-garagem | death | NE | 4 | pe, altura | 2.33 | 0.616 → 0.696 / 0.897 |
| podcaster-de-garagem | death | NE | 5 | pe, cy | 2.33 | 0.419 → 0.68 / 0.897 |
| marimbondo-sindical | death | S | 4 | altura, cx | 2.31 | 0.406 → 0.559 / 0.742 |
| vizinho-da-furadeira | death | S | 8 | altura | 2.28 | 0.573 → 0.65 / 0.814 |
| rodinho-do-sinal | death | S | 7 | altura | 2.25 | 0.316 → 0.495 / 0.794 |
| glitter-senciente | death | NE | 7 | cy | 2.24 | 0.343 → 0.505 / 0.705 |
| zelador-hidraulico | death | W | 8 | cy | 2.23 | 0.434 → 0.581 / 0.742 |
| espetinho-suspeito | death | NE | 7 | escala | 2.22 | 0.563 → 0.63 / 0.79 |
| o-grande-credor | death | S | 11 | altura | 2.22 | 0.387 → 0.501 / 0.706 |
| pombo-rei | charge | NE | 4 | cx, altura | 2.22 | 0.632 → 0.694 / 0.9 |
| hater-anonimo | death | N | 8 | altura | 2.21 | 0.243 → 0.601 / 0.777 |
| homem-surdo | death | E | 6 | pe | 2.17 | 0.044 → 0.292 / 0.416 |
| animador-necromante | lecture | N | 6 | altura, cy, cx | 2.15 | 0.496 → 0.611 / 0.814 |
| executivo-de-patinete | crash | NW | 5 | escala, altura | 2.15 | 0.379 → 0.577 / 0.752 |
| primo-do-violao | death | SW | 2 | cy, escala | 2.15 | 0.485 → 0.574 / 0.83 |
| o-grande-credor | death | SW | 13 | cy, pe, cx | 2.14 | 0.195 → 0.327 / 0.66 |
| podcaster-de-garagem | death | W | 5 | cy | 2.14 | 0.412 → 0.544 / 0.893 |
| promotor-infinito | death | N | 6 | altura, escala | 2.13 | 0.275 → 0.37 / 0.706 |
| zelador-hidraulico | death | NW | 7 | cy, altura | 2.13 | 0.476 → 0.629 / 0.819 |
| gamer-rage-quit | crash | E | 6 | cy, altura | 2.12 | 0.462 → 0.563 / 0.707 |
| ratazana-mafiosa | shove | SW | 4 | escala, cx | 2.12 | 0.482 → 0.606 / 0.866 |
| animador-necromante | lecture | SW | 6 | altura, cy | 2.11 | 0.546 → 0.622 / 0.839 |
| cobrador-do-busao | death | W | 2 | escala | 2.1 | 0.392 → 0.487 / 0.617 |
| o-grande-credor | death | W | 13 | cy | 2.1 | 0.154 → 0.45 / 0.603 |
| tia-do-zap | death | SW | 7 | altura | 2.06 | 0.248 → 0.354 / 0.781 |
| guru-do-linkedin | death | NW | 8 | escala | 2.05 | 0.218 → 0.491 / 0.82 |
| animador-necromante | lecture | W | 6 | altura, cy, escala | 2.04 | 0.61 → 0.625 / 0.847 |
| balao-rancoroso | death | E | 4 | cy | 2.04 | 0.323 → 0.415 / 0.539 |
| crossfiteiro-do-pneu | death | E | 5 | altura, escala, cy | 2.03 | 0.661 → 0.714 / 0.915 |
| zelador-hidraulico | death | E | 7 | altura | 2.02 | 0.397 → 0.561 / 0.786 |
| zelador-hidraulico | death | N | 8 | escala, cx | 2.01 | 0.4 → 0.597 / 0.843 |
| o-grande-credor | death | SW | 10 | pe, cy | 2 | 0.353 → 0.523 / 0.66 |
| promotor-infinito | death | NW | 6 | cy, escala, altura | 1.99 | 0.279 → 0.472 / 0.643 |
| guru-do-linkedin | death | N | 8 | escala, pe | 1.98 | 0.248 → 0.467 / 0.914 |
| promotor-infinito | death | E | 6 | escala, altura | 1.98 | 0.252 → 0.438 / 0.641 |
| zelador-hidraulico | death | NW | 8 | escala | 1.97 | 0.464 → 0.625 / 0.819 |
| espetinho-suspeito | death | SW | 7 | escala | 1.91 | 0.506 → 0.606 / 0.764 |
| espetinho-suspeito | death | W | 7 | escala | 1.91 | 0.561 → 0.63 / 0.801 |
| gamer-rage-quit | crash | NW | 6 | cy | 1.9 | 0.41 → 0.496 / 0.657 |
| vendedor-de-piramide | summon | SW | 3 | cx | 1.89 | 0.572 → 0.606 / 0.826 |
| vendedor-de-piramide | summon | NW | 3 | cx | 1.89 | 0.602 → 0.58 / 0.837 |
| cosplayer | pose | E | 4 | escala | 1.88 | 0.574 → 0.625 / 0.787 |
| pombo-rei | death | S | 7 | escala | 1.86 | 0.379 → 0.511 / 0.64 |
| rh-sorridente | death | S | 6 | escala, cy | 1.86 | 0.529 → 0.65 / 0.835 |
| vendedor-de-piramide | summon | S | 3 | cx | 1.85 | 0.621 → 0.604 / 0.839 |
| cafeteira-burnout | crash | N | 7 | altura | 1.83 | 0.559 → 0.601 / 0.824 |
| o-grande-credor | death | W | 14 | pe | 1.83 | 0.088 → 0.46 / 0.603 |
| o-grande-credor | death | NW | 13 | pe, cy, cx | 1.83 | 0.136 → 0.423 / 0.608 |
| primo-do-violao | death | NW | 2 | altura | 1.81 | 0.581 → 0.666 / 0.846 |
| homem-wifi | death | N | 4 | altura, cy | 1.76 | 0.556 → 0.682 / 0.884 |
| bebedouro-da-fofoca | death | N | 6 | altura | 1.74 | 0.605 → 0.674 / 0.88 |
| cafeteira-burnout | crash | N | 6 | cx | 1.74 | 0.532 → 0.606 / 0.824 |
| revendedora-de-catalogo | throw | W | 5 | escala | 1.73 | 0.667 → 0.69 / 0.881 |
| podcaster-de-garagem | death | SW | 5 | cy | 1.71 | 0.402 → 0.544 / 0.879 |
| poste-gambiarra | death | SW | 7 | altura | 1.71 | 0.633 → 0.67 / 0.889 |
| guru-do-linkedin | death | SE | 7 | cy | 1.69 | 0.415 → 0.67 / 0.869 |
| guru-do-linkedin | death | NE | 8 | escala | 1.68 | 0.222 → 0.489 / 0.883 |
| guru-do-linkedin | death | SE | 8 | escala | 1.67 | 0.296 → 0.497 / 0.869 |
| tia-do-zap | death | N | 8 | pe | 1.67 | 0.131 → 0.272 / 0.844 |
| guru-do-linkedin | death | E | 8 | escala | 1.66 | 0.273 → 0.507 / 0.85 |
| balao-rancoroso | death | SW | 4 | cy | 1.65 | 0.361 → 0.411 / 0.543 |
| o-grande-credor | death | S | 10 | escala, pe | 1.63 | 0.397 → 0.501 / 0.706 |
| balao-rancoroso | death | S | 4 | cy | 1.62 | 0.31 → 0.426 / 0.537 |
| camelo-pirata | death | E | 4 | cx | 1.62 | 0.441 → 0.584 / 0.744 |
| promotor-infinito | death | W | 6 | escala, pe | 1.61 | 0.253 → 0.49 / 0.622 |
| homem-wifi | death | NW | 5 | cy, escala | 1.59 | 0.512 → 0.594 / 0.791 |
| boneco-gigante | shove | N | 3 | cy, escala | 1.58 | 0.674 → 0.69 / 0.894 |
| unboxer | summon | NW | 7 | cy | 1.58 | 0.664 → 0.731 / 0.934 |
| podcaster-de-garagem | death | NW | 5 | cy | 1.57 | 0.401 → 0.654 / 0.864 |
| balao-rancoroso | death | SE | 4 | cy | 1.56 | 0.319 → 0.369 / 0.57 |
| unboxer | summon | SE | 7 | cx, cy | 1.55 | 0.606 → 0.698 / 0.931 |
| tijolo-pai | throw | S | 5 | cx, escala | 1.53 | 0.53 → 0.596 / 0.77 |
| sogra-tita | slam | W | 5 | cx | 1.52 | 0.409 → 0.518 / 0.653 |
| podcaster-de-garagem | death | N | 5 | cy | 1.51 | 0.401 → 0.566 / 0.922 |
| fa-de-novela | shove | W | 4 | escala | 1.5 | 0.667 → 0.691 / 0.886 |
| tia-do-zap | death | S | 8 | pe | 1.5 | 0.103 → 0.252 / 0.821 |
| vendedor-de-piramide | summon | SE | 3 | cx | 1.49 | 0.665 → 0.682 / 0.867 |
| poste-gambiarra | death | W | 6 | altura, escala | 1.48 | 0.549 → 0.619 / 0.829 |
| vendedor-de-piramide | summon | W | 3 | cx | 1.48 | 0.513 → 0.567 / 0.797 |
| gamer-rage-quit | crash | SE | 7 | pe | 1.47 | 0.419 → 0.487 / 0.687 |
| pombo-rei | death | W | 9 | cy | 1.46 | 0.385 → 0.443 / 0.609 |
| perueiro | crash | SE | 4 | escala | 1.45 | 0.586 → 0.669 / 0.848 |
| boneco-gigante | shove | NW | 3 | escala | 1.43 | 0.666 → 0.693 / 0.894 |
| tia-do-zap | throw | W | 6 | cy | 1.43 | 0.575 → 0.608 / 0.783 |
| pombo-rei | death | NW | 7 | escala | 1.42 | 0.371 → 0.451 / 0.618 |
| telemarketing | death | SE | 6 | cx | 1.38 | 0.487 → 0.729 / 0.916 |
| bebedouro-da-fofoca | death | NE | 6 | altura, escala | 1.37 | 0.562 → 0.609 / 0.906 |
| guru-do-linkedin | death | W | 8 | escala | 1.36 | 0.224 → 0.431 / 0.822 |
| fogueteiro | death | SW | 7 | cx | 1.35 | 0.041 → 0.173 / 0.667 |
| ressaca-ambulante | death | E | 2 | cy, escala | 1.35 | 0.614 → 0.665 / 0.863 |
| balao-rancoroso | death | W | 4 | cy | 1.34 | 0.357 → 0.442 / 0.555 |
| fogueteiro | death | NE | 7 | cx | 1.33 | 0.12 → 0.206 / 0.663 |
| homem-wifi | death | NE | 4 | cy, altura | 1.32 | 0.52 → 0.594 / 0.867 |
| trenzinho-da-festa | death | W | 3 | cx | 1.32 | 0.503 → 0.517 / 0.704 |
| alambiqueiro | death | W | 7 | escala | 1.27 | 0.356 → 0.516 / 0.68 |
| unboxer | summon | N | 7 | escala | 1.27 | 0.703 → 0.761 / 0.957 |
| gerente-regional | charge | NW | 5 | escala, cx | 1.24 | 0.618 → 0.65 / 0.841 |
| tia-do-zap | death | N | 7 | altura | 1.24 | 0.184 → 0.275 / 0.844 |
| poste-gambiarra | death | SW | 6 | escala | 1.22 | 0.583 → 0.652 / 0.889 |
| homem-placa-do-fim | shove | E | 4 | escala | 1.2 | 0.712 → 0.737 / 0.925 |
| geladeira-do-feijao | throw | S | 4 | cy | 1.18 | 0.626 → 0.656 / 0.823 |
| vizinho-da-furadeira | death | NW | 8 | cx | 1.18 | 0.566 → 0.679 / 0.879 |
| podcaster-de-garagem | death | S | 5 | cy | 1.17 | 0.4 → 0.596 / 0.854 |
| bandeirinha-existencial | lecture | SW | 6 | cx | 1.16 | 0.516 → 0.536 / 0.8 |
| reuniao-que-podia-ser-email | summon | W | 6 | escala, cx | 1.12 | 0.675 → 0.735 / 0.932 |
| dono-do-boteco | death | N | 6 | cx | 1.1 | 0.388 → 0.518 / 0.796 |
| balao-rancoroso | death | NE | 4 | cy | 1.09 | 0.313 → 0.406 / 0.573 |
| podcaster-de-garagem | death | SE | 5 | cx | 1.08 | 0.44 → 0.604 / 0.901 |
| dono-do-boteco | death | N | 7 | pe | 1.07 | 0.317 → 0.484 / 0.796 |
| fogueteiro | death | E | 8 | cx | 1.07 | 0.101 → 0.237 / 0.672 |
| mapinguari-do-shopping | summon | N | 7 | altura | 1.06 | 0.68 → 0.702 / 0.886 |
| motoboy | crash | S | 3 | cx | 1.05 | 0.572 → 0.661 / 0.841 |
| fogueteiro | death | E | 7 | altura | 1.04 | 0.079 → 0.235 / 0.672 |
| balao-rancoroso | death | N | 4 | cy | 1.02 | 0.325 → 0.41 / 0.558 |
| primo-do-violao | death | SW | 1 | altura | 1.02 | 0.568 → 0.639 / 0.83 |
| o-grande-credor | death | E | 11 | escala | 1.01 | 0.277 → 0.325 / 0.541 |
| telemarketing | death | SW | 6 | pe | 1 | 0.478 → 0.632 / 0.816 |
