# Tremor por quadro — 1133 folhas, 12938 achados em 8174 quadros

Loops: 3151 achados (2333 quadros desalinhados, 11 de arte nova). Dano e ações: 9787 achados (5529 desalinhados, 301 de arte nova).

Mede o desenho dentro da célula, não a posição no mundo: o "andar no lugar" (76bffa9) não entra aqui.
Desalinhamento = o quadro, transladado/escalado até a âncora dos vizinhos (pé, centroide, altura), fica com IoU ≥ 0.8 × o IoU típico de dois quadros seguidos: o pipeline corrige com a correção da tabela (px da célula). Arte nova = mesmo alinhado destoa: precisa redesenhar o quadro.

## Inimigos — soma das gravidades nos loops (um quadro conta uma vez)

| inimigo | soma | desalinhados | arte nova |
|---|---|---|---|
| orelhao-zumbi | 122.8 | 27 | 0 |
| cobrador-fantasma | 96.4 | 29 | 0 |
| pombos | 90.0 | 19 | 1 |
| boitata-de-sacolinha | 85.6 | 27 | 0 |
| lagartixa-de-terno | 81.8 | 22 | 0 |
| glitter-senciente | 78.0 | 33 | 0 |
| skatista-de-47 | 77.6 | 18 | 5 |
| mico-da-dentadura | 77.5 | 32 | 0 |
| maratonista-eterno | 75.9 | 32 | 0 |
| frango-de-academia | 75.0 | 24 | 0 |
| engenheiro-obra-parada | 74.7 | 28 | 0 |
| sogra-tita | 73.4 | 34 | 0 |
| dj-do-fim-do-mundo | 70.5 | 32 | 0 |
| torcedor-fanatico | 70.3 | 17 | 0 |
| tia-do-pudim | 67.2 | 23 | 0 |
| sapo-cururu | 65.6 | 26 | 0 |
| corretor-de-imoveis | 62.7 | 21 | 0 |
| camelo-pirata | 61.4 | 20 | 0 |
| vendedor-de-caixao | 61.0 | 24 | 0 |
| tijolo-pai | 60.3 | 24 | 0 |
| pichador-ninja | 59.6 | 18 | 0 |
| anao-molotov | 57.6 | 21 | 0 |
| jacare-do-bueiro | 56.9 | 21 | 0 |
| personal-gritao | 56.4 | 22 | 0 |
| auditor-das-sombras | 56.2 | 17 | 0 |
| pamonheiro | 56.1 | 12 | 0 |
| pombo-rei | 55.8 | 24 | 0 |
| rodinho-do-sinal | 55.5 | 25 | 0 |
| caixa-eletronico | 55.0 | 15 | 0 |
| podcaster-de-garagem | 55.0 | 22 | 0 |
| influencer | 54.8 | 23 | 0 |
| ex-que-voltou | 54.3 | 14 | 0 |
| bandeirinha-existencial | 52.2 | 18 | 1 |
| zelador-hidraulico | 51.2 | 21 | 0 |
| noivo-em-fuga | 49.3 | 23 | 0 |
| betoneira-ambulante | 47.9 | 18 | 0 |
| quati-influencer | 47.2 | 23 | 0 |
| coach | 45.9 | 21 | 0 |
| alambiqueiro | 45.7 | 18 | 0 |
| urubu-fiscal | 45.6 | 17 | 0 |

## Loops, desalinhamento (corrigível) — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|
| torcedor-fanatico | walk | NW | 5 | cx, cy, altura | 10.79 | 0.31 → 0.862 / 0.784 | -31.6, 0, 1.023 |
| cobrador-fantasma | idle | NE | 2 | pex | 10.25 | 0.792 → 0.878 / 0.62 | -1.5, 0, 1 |
| orelhao-zumbi | walk | W | 6 | cx | 10.18 | 0.314 → 0.752 / 0.86 | -31.8, 0, 1 |
| pombo-tres-cabecas | fly | E | 4 | altura | 9.77 | 0.716 → 0.745 / 0.866 | 0.9, 1, 1 |
| orelhao-zumbi | walk | NE | 1 | cx | 9.68 | 0.351 → 0.854 / 0.843 | 30, 1, 1 |
| caixa-eletronico | walk | SE | 2 | cx | 9.56 | 0.436 → 0.891 / 0.875 | 29.3, 0, 1 |
| ciclista-de-lycra | idle | S | 3 | pex, cx | 9.4 | 0.364 → 0.96 / 0.722 | -21.4, 0, 1 |
| ciclista-de-lycra | idle | N | 0 | pex, cx | 9.4 | 0.327 → 0.964 / 0.934 | 18.1, 0, 1 |
| pombos | fly | S | 5 | altura | 9.35 | 0.631 → 0.852 / 0.514 | -0.3, 0, 0.955 |
| glitter-senciente | walk | NE | 5 | cy, altura | 9.25 | 0.571 → 0.738 / 0.827 | 2.6, 0, 1.077 |
| orelhao-zumbi | idle | NW | 4 | cx | 9.23 | 0.319 → 0.857 / 0.812 | -23.9, 0, 1 |
| pombos | fly | N | 5 | altura, cy | 9.09 | 0.568 → 0.76 / 0.572 | 0.8, 0, 1 |
| orelhao-zumbi | walk | E | 5 | cx | 9.08 | 0.384 → 0.786 / 0.684 | 27.8, 0, 1 |
| sogra-tita | phase2-idle | SE | 3 | pex, altura | 9.04 | 0.858 → 0.91 / 0.923 | -2.8, 0, 1.034 |
| juiz-vendido | walk | W | 3 | cx | 8.96 | 0.285 → 0.772 / 0.829 | 20.3, 0, 1.02 |
| mico-da-dentadura | walk | E | 0 | cx | 8.89 | 0.281 → 0.804 / 0.711 | 16.3, 1, 1 |
| torcedor-fanatico | walk | S | 6 | cx | 8.74 | 0.449 → 0.851 / 0.899 | 25.4, 0, 1 |
| torcedor-fanatico | walk | S | 4 | cx | 8.54 | 0.464 → 0.83 / 0.899 | 27.2, 0, 1 |
| pombos | fly | SE | 5 | altura, cy | 8.52 | 0.587 → 0.858 / 0.488 | -1.8, 0, 0.982 |
| orelhao-zumbi | idle | W | 4 | cx, pex | 8.41 | 0.329 → 0.735 / 0.876 | -28.2, 0, 1 |
| urubu-fiscal | fly | N | 5 | cy, altura | 8.35 | 0.539 → 0.867 / 0.655 | -0.9, 0, 1 |
| cofre-mimico | walk | N | 6 | cx | 8.12 | 0.453 → 0.919 / 0.932 | 20.5, 0, 1 |
| personal-gritao | walk | N | 2 | cx | 8.08 | 0.384 → 0.734 / 0.847 | 20.9, 0, 1 |
| caixa-eletronico | idle | NW | 3 | pex, cx | 8 | 0.622 → 0.944 / 0.97 | 16.6, 0, 1 |
| pamonheiro | walk | E | 2 | cx | 7.94 | 0.301 → 0.889 / 0.637 | -18.3, 0, 1 |
| cobrador-fantasma | walk | SW | 0 | cy, altura | 7.89 | 0.555 → 0.77 / 0.787 | 3.8, 0, 0.941 |
| pamonheiro | idle | S | 0 | pex, cx | 7.88 | 0.444 → 0.967 / 0.98 | 15.3, 0, 1 |
| lagartixa-de-terno | walk | SE | 0 | cx | 7.87 | 0.376 → 0.772 / 0.658 | -14.1, 0, 1.011 |
| torcedor-fanatico | walk | SE | 5 | cx | 7.85 | 0.484 → 0.851 / 0.86 | -22.9, 0, 1.021 |
| pombos | fly | SW | 5 | altura, cy | 7.78 | 0.703 → 0.861 / 0.518 | 1.5, 0, 0.983 |
| ambulante-guarda-chuva | sleep | 0 | 2 | altura | 7.74 | 0.881 → 0.89 / 0.904 | 0.2, -1, 1 |
| corretor-de-imoveis | walk | S | 5 | cx | 7.74 | 0.423 → 0.864 / 0.92 | 23.2, 0, 1 |
| ex-que-voltou | fly | SE | 4 | cy, pe, altura | 7.74 | 0.583 → 0.847 / 0.905 | -1, -6, 1.066 |
| jacare-do-bueiro | idle | SE | 3 | pex, altura, cy | 7.7 | 0.827 → 0.956 / 0.821 | 0.8, 0, 1.024 |
| barata-voadora | fly | E | 2 | altura | 7.61 | 0.701 → 0.857 / 0.706 | -0.9, 0, 0.977 |
| ciclista-de-lycra | idle | NW | 3 | pex, cx | 7.4 | 0.442 → 0.957 / 0.912 | -14.6, 0, 1 |
| orelhao-zumbi | walk | NW | 4 | cx | 7.36 | 0.481 → 0.817 / 0.73 | 10.3, 0, 1 |
| influencer | walk | E | 0 | cx | 7.32 | 0.265 → 0.781 / 0.687 | 21.4, 0, 1 |
| sogra-do-chinelo | walk | W | 1 | cx, cy, altura | 7.32 | 0.284 → 0.837 / 0.81 | 10.7, 0, 1 |
| rei-do-camarote | idle | W | 2 | pex | 7.3 | 0.946 → 0.952 / 0.956 | -0.2, 0, 1 |

## Loops, arte nova — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|
| skatista-de-47 | walk | NE | 3 | cx, altura, escala, cy | 11.02 | 0.214 → 0.647 / 0.876 | -28, 0, 1.165 |
| pombos | fly | NW | 3 | cy | 5.93 | 0.441 → 0.507 / 0.645 | -0.3, 0, 1.077 |
| barata-voadora | fly | N | 4 | cy, escala | 5.18 | 0.463 → 0.524 / 0.769 | 0.5, 0, 1.049 |
| skatista-de-47 | walk | SE | 3 | cx | 4.58 | 0.56 → 0.612 / 0.83 | 11, 0, 1 |
| sommelier-de-ipa | idle | W | 4 | cx, pex | 4.56 | 0.473 → 0.734 / 0.94 | -13.6, 0, 0.981 |
| skatista-de-47 | walk | E | 7 | escala, cx | 3.68 | 0.621 → 0.715 / 0.912 | -4.9, 0, 0.968 |
| skatista-de-47 | walk | NW | 3 | cx, altura, escala | 3.62 | 0.557 → 0.647 / 0.894 | 9.5, 0, 1.047 |
| bandeirinha-existencial | idle | NW | 2 | cy | 2.13 | 0.681 → 0.709 / 0.899 | 3.3, 1, 1 |
| skatista-de-47 | walk | E | 3 | cy | 2.09 | 0.541 → 0.639 / 0.912 | 0.2, 0, 1.023 |
| manobrista | walk | NW | 7 | escala, cy | 1.96 | 0.606 → 0.616 / 0.843 | -3.3, 0, 1 |
| barata-voadora | fly | NE | 4 | escala | 1.68 | 0.525 → 0.573 / 0.753 | -0.1, 0, 1.043 |

## Dano e ações, desalinhamento — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|
| bate-estaca | hit | SW | 1 | pe, cy, altura | 15.33 | 0.53 → 0.747 / 0.53 | -2, 46, 1 |
| taxista-reclamao | hit | SE | 1 | cy, pe, altura, cx, escala | 15.26 | 0.43 → 0.706 / 0.43 | 7, 19, 0.948 |
| tia-do-pudim | hit | SE | 1 | cy, pe, escala | 14.09 | 0.326 → 0.899 / 0.326 | -1.3, -41.5, 1 |
| coach | death | W | 6 | altura | 13.6 | 0.64 → 0.766 / 0.577 | -1.9, -2, 1 |
| auditor-das-sombras | hit | E | 1 | cy, pe, cx, altura, escala | 13.2 | 0.324 → 0.699 / 0.324 | 12.2, -10.5, 1 |
| buraco-de-rua | hit | W | 1 | altura, cy, escala | 12.45 | 0.693 → 0.734 / 0.693 | 2.1, 0, 1 |
| buraco-de-rua | hit | SW | 1 | altura, cy, escala | 11.93 | 0.688 → 0.724 / 0.688 | 0.5, 0, 1 |
| buraco-de-rua | death | N | 1 | altura, cy, escala | 11.86 | 0.573 → 0.697 / 0.864 | -0.3, 0, 0.788 |
| buraco-de-rua | death | NE | 1 | altura, cy, escala | 11.27 | 0.597 → 0.696 / 0.831 | -1.1, 0, 0.889 |
| caramujo-financiado | hit | NW | 1 | altura, cy, escala | 11.11 | 0.707 → 0.775 / 0.707 | 1.6, 0, 1 |
| jacare-do-bueiro | hit | SE | 1 | cy, pe, altura, escala, cx | 10.62 | 0.558 → 0.832 / 0.558 | -3.6, 16.5, 0.885 |
| buraco-de-rua | hit | NE | 1 | altura, cy, cx | 10.26 | 0.655 → 0.693 / 0.655 | 2.7, 0, 1 |
| coach | death | NW | 6 | altura | 10.26 | 0.714 → 0.764 / 0.6 | -3, -0.5, 1 |
| buraco-de-rua | hit | NW | 1 | altura, cy | 9.9 | 0.703 → 0.772 / 0.703 | -1, 0, 1 |
| servidor-fossilizado | death | NE | 8 | altura | 9.54 | 0.81 → 0.817 / 0.805 | 1.2, 0, 1 |
| vendedor-de-caixao | death | SE | 8 | cy, pe | 9.44 | 0.138 → 0.835 / 0.67 | -2.2, 26.5, 0.963 |
| caramujo-financiado | hit | W | 1 | altura, cy, escala, cx | 9.43 | 0.596 → 0.733 / 0.596 | -3.4, 0, 1.143 |
| mico-da-dentadura | hit | SW | 1 | altura, cy, escala, pe, cx | 9.42 | 0.535 → 0.661 / 0.535 | -3.2, -4, 0.812 |
| reuniao-que-podia-ser-email | hit | NE | 1 | altura, cy, escala | 9.37 | 0.611 → 0.738 / 0.611 | 0.6, 0, 1 |
| buraco-de-rua | hit | E | 1 | altura, cy | 9.09 | 0.71 → 0.731 / 0.71 | -0.4, 0, 1 |
| vendedor-de-caixao | hit | NW | 1 | altura, pe, escala, cy | 9.09 | 0.7 → 0.719 / 0.7 | -0.4, 8, 1.177 |
| pombos | wake | 0 | 1 | cy, pe, altura, escala | 9.01 | 0.085 → 0.564 / 0.594 | 1.4, 16, 0.828 |
| mico-da-dentadura | hit | S | 1 | altura, cy, escala, pe | 8.96 | 0.575 → 0.682 / 0.575 | -1.7, -3, 0.914 |
| tio-pave | death | SW | 6 | altura, cy | 8.83 | 0.703 → 0.748 / 0.698 | -4.3, 0, 1 |
| quati-influencer | hit | NE | 1 | cy, pe, altura | 8.74 | 0.521 → 0.698 / 0.521 | 0.9, 8.5, 0.941 |
| pombo-rei | hit | S | 1 | altura, cy, escala | 8.67 | 0.728 → 0.795 / 0.728 | -2.5, 1, 1 |
| vendedor-de-bala | death | S | 8 | altura, cy | 8.66 | 0.556 → 0.655 / 0.736 | 4.3, -1, 1 |
| buraco-de-rua | hit | S | 1 | altura, cy | 8.33 | 0.658 → 0.724 / 0.658 | -1.2, 0, 1 |
| marimbondo-sindical | wake | 0 | 1 | cy, altura, pe, escala | 8.33 | 0.365 → 0.674 / 0.805 | -0.3, 13, 0.885 |
| ratazana-mafiosa | hit | E | 1 | altura, cy, cx, escala | 8.33 | 0.501 → 0.695 / 0.501 | -12.7, 0, 1.18 |
| torcedor-fanatico | hit | N | 1 | altura, cy, escala | 8.24 | 0.593 → 0.609 / 0.593 | -0.6, 0.5, 1 |
| mico-da-dentadura | hit | SE | 1 | altura, pe, escala, cy | 8.23 | 0.554 → 0.635 / 0.554 | -1.2, -5, 0.868 |
| ambulante-guarda-chuva | hit | N | 1 | altura, cy, escala | 8.12 | 0.626 → 0.783 / 0.626 | -0.4, 0, 1.279 |
| ambulante-guarda-chuva | hit | E | 1 | altura, cy, escala | 8.12 | 0.595 → 0.738 / 0.595 | -1.2, 0, 1.129 |
| ambulante-guarda-chuva | hit | SE | 1 | altura, cy, escala, cx | 8.04 | 0.527 → 0.784 / 0.527 | 5.1, 0, 1.162 |
| ambulante-guarda-chuva | hit | S | 1 | altura, cy, escala | 8.02 | 0.675 → 0.778 / 0.675 | 0.1, 0, 1.153 |
| pombo-rei | hit | SW | 1 | altura, cy, escala | 8 | 0.807 → 0.852 / 0.807 | 2.6, 0, 1 |
| vendedor-de-caixao | hit | SE | 1 | altura, cy, escala | 7.97 | 0.671 → 0.762 / 0.671 | 0.3, 0, 1.157 |
| buraco-de-rua | hit | N | 1 | altura, cy | 7.89 | 0.69 → 0.729 / 0.69 | 0.6, 0, 1 |
| homem-wifi | hit | S | 1 | altura, cy, escala, cx | 7.88 | 0.56 → 0.636 / 0.56 | 7.8, 0, 1 |

## Dano e ações, arte nova — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|
| buraco-de-rua | death | NW | 1 | altura, cy, escala | 10.53 | 0.581 → 0.679 / 0.87 | 1.3, 0, 0.886 |
| buraco-de-rua | death | E | 1 | altura, cy, escala | 10.29 | 0.542 → 0.65 / 0.851 | -1.5, 0, 0.752 |
| buraco-de-rua | death | W | 1 | altura, cy, escala | 8.97 | 0.537 → 0.603 / 0.868 | 1.9, 0, 0.87 |
| buraco-de-rua | death | SE | 1 | altura, cy, escala | 8.48 | 0.58 → 0.658 / 0.829 | -0.8, 0, 0.777 |
| auditor-das-sombras | death | NE | 7 | pe, cy, cx | 7 | 0.124 → 0.268 / 0.834 | -5.6, -21, 1 |
| coco-que-vende-gente | death | W | 8 | altura, pe, cy, cx | 6.98 | 0.382 → 0.35 / 0.829 | 9.6, -19.5, 0.7 |
| mapinguari-do-shopping | slam | S | 4 | altura, cy, escala | 6.63 | 0.433 → 0.516 / 0.762 | 4.1, 0, 0.731 |
| malabarista-do-sinal | death | E | 8 | altura, cy, cx | 6.41 | 0.389 → 0.369 / 0.609 | -9, 0, 1 |
| peladeiro-de-vidro | death | S | 5 | altura, cy | 6.27 | 0.372 → 0.487 / 0.64 | 3.4, 2, 0.922 |
| revendedora-de-catalogo | throw | NE | 4 | altura, cy, escala | 6.2 | 0.423 → 0.541 / 0.906 | 1.5, 0, 0.858 |
| mapinguari-do-shopping | slam | NW | 4 | cy, altura, escala | 6.17 | 0.449 → 0.493 / 0.79 | -1.6, 0, 0.88 |
| coco-que-vende-gente | death | E | 8 | altura, pe | 6.15 | 0.377 → 0.336 / 0.816 | -4, -11.5, 0.879 |
| urubu-fiscal | wake | 0 | 2 | cy, pe, escala | 5.9 | 0.413 → 0.655 / 0.882 | -1.3, 8, 1 |
| coco-que-vende-gente | death | NW | 7 | altura, cy, escala | 5.79 | 0.421 → 0.393 / 0.711 | -4.6, -13.5, 0.7 |
| auditor-das-sombras | death | W | 7 | cy | 5.76 | 0.086 → 0.266 / 0.806 | -1.5, -14.5, 1.2 |
| motoboy | crash | E | 3 | altura, cy | 5.69 | 0.425 → 0.584 / 0.788 | 2.7, 0, 0.97 |
| hater-anonimo | death | S | 8 | altura | 5.67 | 0.265 → 0.443 / 0.757 | -1, -1, 1 |
| rodinho-do-sinal | death | E | 8 | escala, cy | 5.67 | 0.354 → 0.472 / 0.629 | -0.1, 0, 1 |
| bandeirinha-existencial | death | W | 6 | cy, altura, cx | 5.56 | 0.17 → 0.506 / 0.637 | -13.1, -3.5, 0.912 |
| fogueteiro | death | E | 6 | cy, cx | 5.51 | 0.134 → 0.362 / 0.672 | -6.4, 8, 1.25 |
| auditor-das-sombras | death | S | 7 | cy, pe | 5.46 | 0.085 → 0.336 / 0.747 | -3.2, -11.5, 1.4 |
| boitata-de-sacolinha | charge | NW | 3 | pe, altura, cy | 5.44 | 0.432 → 0.506 / 0.678 | -9.3, 49, 1.326 |
| fogueteiro | death | W | 6 | cy | 5.28 | 0.149 → 0.312 / 0.66 | -4.7, 3.5, 1.13 |
| rodinho-do-sinal | death | NE | 8 | escala, cy | 5.28 | 0.337 → 0.473 / 0.758 | -0.9, 0, 1 |
| homem-surdo | lecture | E | 6 | altura, cy, escala | 5.26 | 0.404 → 0.452 / 0.83 | -2.1, 0, 1 |
| cupim-mansao | shove | SE | 4 | cy, altura | 5.24 | 0.528 → 0.661 / 0.863 | -0.9, 0, 1.125 |
| fogueteiro | death | N | 6 | cy | 5.23 | 0.195 → 0.397 / 0.822 | -1.2, 12, 1.4 |
| boitata-de-sacolinha | charge | E | 3 | altura | 5.22 | 0.504 → 0.57 / 0.734 | -7.4, 14.5, 1.198 |
| buraco-de-rua | death | SW | 1 | altura, cy, escala | 5.21 | 0.629 → 0.655 / 0.84 | 1.1, 0, 1 |
| glitter-senciente | death | NE | 8 | cx, pe | 5.19 | 0.159 → 0.188 / 0.705 | 26, -12, 1.155 |
| fogueteiro | death | SW | 6 | escala, cy | 5.18 | 0.145 → 0.309 / 0.667 | -5.1, 6, 1.171 |
| chefe-pizza | death | SE | 7 | altura, cx | 5.12 | 0.531 → 0.642 / 0.823 | 10.4, -2, 0.85 |
| homem-surdo | lecture | NW | 6 | altura, cy, escala | 5.1 | 0.47 → 0.529 / 0.851 | -1.9, 0, 1 |
| mapinguari-do-shopping | slam | SW | 4 | altura, cy, cx | 5.03 | 0.419 → 0.57 / 0.751 | -20.5, 0, 0.787 |
| glitter-senciente | death | SE | 8 | cx, pe | 5.01 | 0.204 → 0.2 / 0.757 | 25.1, -12, 1 |
| perueiro | crash | E | 5 | altura, cy | 5 | 0.469 → 0.584 / 0.847 | -2.6, 0, 0.924 |
| glitter-senciente | death | E | 8 | cx, pe, cy | 4.98 | 0.189 → 0.16 / 0.689 | 24.9, -10, 1.4 |
| boitata-de-sacolinha | charge | SE | 3 | altura, cy, escala, pe | 4.95 | 0.485 → 0.61 / 0.774 | 7.9, -9.5, 1.196 |
| auditor-das-sombras | death | SE | 7 | cy | 4.93 | 0.101 → 0.31 / 0.842 | 2.4, -12, 1.4 |
| o-grande-credor | death | S | 7 | escala | 4.9 | 0.402 → 0.462 / 0.706 | 13.8, -0.5, 1.075 |
