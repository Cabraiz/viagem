# Tremor por quadro — 1133 folhas, 10114 achados em 6805 quadros

Loops: 1892 achados (1534 quadros desalinhados, 0 de arte nova, 5 poses aceitas). Dano e ações: 8222 achados (4970 desalinhados, 0 de arte nova, 296 poses aceitas).

Mede o desenho dentro da célula, não a posição no mundo: o "andar no lugar" (76bffa9) não entra aqui.
Desalinhamento = o quadro, transladado/escalado até a âncora dos vizinhos (pé, centroide, altura), fica com IoU ≥ 0.8 × o IoU típico de dois quadros seguidos: o pipeline corrige com a correção da tabela (px da célula). Arte nova = mesmo alinhado destoa: precisa redesenhar o quadro.

## Inimigos — soma das gravidades nos loops (um quadro conta uma vez)

| inimigo | soma | desalinhados | arte nova |
|---|---|---|---|
| pombos | 75.2 | 16 | 0 |
| orelhao-zumbi | 57.2 | 18 | 0 |
| cobrador-fantasma | 56.7 | 16 | 0 |
| boitata-de-sacolinha | 53.3 | 25 | 0 |
| glitter-senciente | 43.9 | 20 | 0 |
| sogra-tita | 41.9 | 22 | 0 |
| alambiqueiro | 41.8 | 17 | 0 |
| sapo-cururu | 41.0 | 20 | 0 |
| frango-de-academia | 40.7 | 19 | 0 |
| vendedor-de-caixao | 40.2 | 17 | 0 |
| lagartixa-de-terno | 40.1 | 16 | 0 |
| noivo-em-fuga | 40.0 | 19 | 0 |
| mapinguari-do-shopping | 38.5 | 19 | 0 |
| anao-molotov | 37.3 | 16 | 0 |
| peladeiro-de-vidro | 37.2 | 20 | 0 |
| dj-do-fim-do-mundo | 35.4 | 20 | 0 |
| despachante | 35.0 | 15 | 0 |
| mico-da-dentadura | 34.5 | 20 | 0 |
| camelo-pirata | 34.2 | 14 | 0 |
| urubu-fiscal | 33.6 | 11 | 0 |
| rapa-da-prefeitura | 33.0 | 17 | 0 |
| buraco-de-rua | 32.3 | 14 | 0 |
| skatista-de-47 | 30.8 | 16 | 0 |
| rodinho-do-sinal | 30.8 | 17 | 0 |
| dancinha-viral | 30.5 | 13 | 0 |
| quati-influencer | 30.4 | 15 | 0 |
| furry-de-convencao | 30.4 | 13 | 0 |
| auditor-das-sombras | 29.9 | 12 | 0 |
| gerente-regional | 29.8 | 15 | 0 |
| coelho-falsificado | 29.5 | 15 | 0 |
| engenheiro-obra-parada | 29.3 | 16 | 0 |
| betoneira-ambulante | 29.2 | 12 | 0 |
| jacare-do-bueiro | 29.1 | 15 | 0 |
| zelador-hidraulico | 29.0 | 12 | 0 |
| contador-de-almas | 28.1 | 15 | 0 |
| bandeirinha-existencial | 28.1 | 12 | 0 |
| rei-do-camarote | 27.8 | 11 | 0 |
| caixa-eletronico | 27.4 | 11 | 0 |
| ressaca-ambulante | 27.3 | 15 | 0 |
| pombo-rei | 26.4 | 15 | 0 |

## Loops, desalinhamento (corrigível) — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|
| orelhao-zumbi | idle | NW | 4 | pex | 12.7 | 0.781 → 0.847 / 0.889 | 4.4, 0, 1 |
| cobrador-fantasma | idle | NE | 2 | pex | 10.25 | 0.792 → 0.878 / 0.62 | -1.5, 0, 1 |
| orelhao-zumbi | idle | SE | 4 | pex | 9.8 | 0.737 → 0.81 / 0.836 | -0.2, 1, 0.976 |
| pombo-tres-cabecas | fly | E | 4 | altura | 9.77 | 0.716 → 0.745 / 0.866 | 0.9, 1, 1 |
| pombos | fly | N | 5 | altura, cy | 9.09 | 0.568 → 0.76 / 0.572 | 0.8, 0, 1 |
| cobrador-fantasma | idle | N | 1 | pex | 8.63 | 0.774 → 0.888 / 0.792 | -2.3, 0, 0.989 |
| pombos | fly | SE | 5 | altura, cy | 8.52 | 0.587 → 0.858 / 0.488 | -1.8, 0, 0.982 |
| pombos | fly | SW | 5 | altura, cy, escala | 7.78 | 0.684 → 0.861 / 0.544 | 1.5, 0, 0.983 |
| ambulante-guarda-chuva | sleep | 0 | 2 | altura | 7.74 | 0.881 → 0.89 / 0.904 | 0.2, -1, 1 |
| urubu-fiscal | fly | NE | 4 | cy | 7.49 | 0.489 → 0.666 / 0.645 | 0.1, 0, 1 |
| rei-do-camarote | idle | W | 2 | pex | 7.3 | 0.946 → 0.952 / 0.956 | -0.2, 0, 1 |
| urubu-fiscal | sleep | 0 | 2 | altura, cy, escala | 7.22 | 0.854 → 0.886 / 0.944 | 0.7, 0, 1 |
| leao-da-receita | idle | E | 3 | pex | 7.1 | 0.92 → 0.923 / 0.927 | -0.7, 0, 1 |
| pombos | fly | S | 5 | altura | 6.91 | 0.627 → 0.84 / 0.514 | 0.3, 0, 1 |
| espetinho-suspeito | idle | SE | 4 | pex | 6.75 | 0.973 → 0.981 / 0.963 | -0.2, 0, 1 |
| despachante | idle | NE | 5 | pex | 6.6 | 0.845 → 0.9 / 0.818 | -2.6, 0, 1 |
| ratazana-mafiosa | idle | N | 4 | pex, cy | 6.5 | 0.824 → 0.883 / 0.952 | -0.2, 0, 1 |
| zelador-hidraulico | idle | SE | 4 | pex | 6.5 | 0.949 → 0.959 / 0.944 | 0.4, 0, 1 |
| caixa-eletronico | idle | NE | 5 | pex | 6.4 | 0.954 → 0.958 / 0.986 | 0.9, 0, 1 |
| orelhao-zumbi | idle | SW | 4 | pex | 6.4 | 0.71 → 0.745 / 0.877 | -1.9, 0, 1 |
| barata-voadora | fly | E | 2 | altura | 6.16 | 0.699 → 0.829 / 0.706 | -1, 0, 1 |
| pombo-tres-cabecas | fly | S | 0 | altura | 6.16 | 0.642 → 0.813 / 0.675 | 1.3, 0, 0.983 |
| peladeiro-de-vidro | idle | NW | 5 | pex | 6.13 | 0.942 → 0.954 / 0.919 | -0.1, 1, 1 |
| betoneira-ambulante | idle | NE | 1 | pex, cy | 6.1 | 0.792 → 0.887 / 0.81 | 4, 0, 1 |
| pombos | fly | NW | 5 | altura | 6.06 | 0.562 → 0.699 / 0.57 | 0.5, 0, 1 |
| dj-do-fim-do-mundo | phase2-idle | S | 2 | pex | 6.04 | 0.803 → 0.906 / 0.919 | -13.2, 0, 1 |
| barata-voadora | fly | SE | 2 | altura | 6.03 | 0.676 → 0.767 / 0.565 | -0.1, 0, 1 |
| noivo-em-fuga | idle | SE | 2 | pex, altura | 6 | 0.862 → 0.884 / 0.861 | -0.5, 0, 0.981 |
| furry-de-convencao | sleep | 0 | 2 | altura, cy | 5.95 | 0.802 → 0.84 / 0.936 | -0.9, -1, 1 |
| pombos | fly | NW | 3 | cy | 5.93 | 0.448 → 0.501 / 0.594 | -0.5, 0, 1.038 |
| mapinguari-do-shopping | phase2-idle | NW | 3 | pex | 5.75 | 0.933 → 0.942 / 0.908 | 0.6, 0, 1 |
| bebedouro-da-fofoca | idle | W | 3 | pex | 5.63 | 0.84 → 0.895 / 0.926 | -2.9, 1, 1 |
| coco-que-vende-gente | sleep | 0 | 5 | altura | 5.62 | 0.854 → 0.872 / 0.869 | 0.1, 0, 1 |
| bebum-de-carrinho | idle | SE | 1 | pex | 5.5 | 0.914 → 0.923 / 0.916 | -0.2, 0, 1 |
| coelho-falsificado | idle | SE | 1 | pex | 5.5 | 0.861 → 0.888 / 0.896 | -1.1, 0, 1.016 |
| dancinha-viral | idle | NW | 3 | pex | 5.5 | 0.771 → 0.849 / 0.925 | 1.8, 1, 1 |
| anao-molotov | idle | NW | 2 | pex, altura | 5.43 | 0.896 → 0.95 / 0.864 | -0.4, 0, 0.982 |
| guru-cripto | idle | SW | 0 | pex | 5.4 | 0.94 → 0.953 / 0.984 | -1.4, 1, 1 |
| bandeirinha-existencial | idle | SE | 2 | pex, cy, escala | 5.38 | 0.685 → 0.759 / 0.893 | 0.6, 0, 1 |
| executivo-de-patinete | idle | W | 2 | altura, cy, escala | 5.35 | 0.661 → 0.774 / 0.925 | -0.4, 0, 1.2 |

## Loops, arte nova — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|

## Dano e ações, desalinhamento — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|
| tia-do-pudim | hit | SE | 1 | cy, pe, escala | 14.09 | 0.326 → 0.899 / 0.326 | -1.3, -41.5, 1 |
| coach | death | W | 6 | altura | 13.6 | 0.64 → 0.766 / 0.585 | -1.9, -2, 1 |
| buraco-de-rua | hit | W | 1 | altura, cy, escala | 12.45 | 0.693 → 0.734 / 0.693 | 2.1, 0, 1 |
| taxista-reclamao | hit | SE | 1 | cy, pe, cx, escala | 12.15 | 0.469 → 0.722 / 0.469 | 7.5, 19, 1 |
| buraco-de-rua | hit | SW | 1 | altura, cy, escala | 11.93 | 0.688 → 0.724 / 0.688 | 0.5, 0, 1 |
| buraco-de-rua | death | N | 1 | altura, cy, escala | 11.86 | 0.573 → 0.697 / 0.864 | -0.3, 0, 0.788 |
| buraco-de-rua | death | NE | 1 | altura, cy, escala | 11.27 | 0.597 → 0.696 / 0.832 | -1.1, 0, 0.889 |
| caramujo-financiado | hit | NW | 1 | altura, cy, escala | 11.11 | 0.707 → 0.775 / 0.707 | 1.6, 0, 1 |
| buraco-de-rua | hit | NE | 1 | altura, cy | 10.26 | 0.654 → 0.692 / 0.654 | -0.3, 0, 1 |
| coach | death | NW | 6 | altura | 10.26 | 0.714 → 0.764 / 0.6 | -3, -0.5, 1 |
| buraco-de-rua | hit | NW | 1 | altura, cy | 9.9 | 0.703 → 0.772 / 0.703 | -1, 0, 1 |
| servidor-fossilizado | death | NE | 8 | altura | 9.54 | 0.81 → 0.817 / 0.805 | 1.2, 0, 1 |
| caramujo-financiado | hit | W | 1 | altura, cy, escala, cx | 9.43 | 0.596 → 0.733 / 0.596 | -3.4, 0, 1.143 |
| mico-da-dentadura | hit | SW | 1 | altura, cy, escala, pe, cx | 9.42 | 0.535 → 0.661 / 0.535 | -3.2, -4, 0.812 |
| reuniao-que-podia-ser-email | hit | NE | 1 | altura, cy, escala | 9.37 | 0.611 → 0.738 / 0.611 | 0.6, 0, 1 |
| buraco-de-rua | hit | E | 1 | altura, cy | 9.09 | 0.71 → 0.731 / 0.71 | -0.4, 0, 1 |
| vendedor-de-caixao | hit | NW | 1 | altura, pe, escala, cy | 9.09 | 0.7 → 0.719 / 0.7 | -0.4, 8, 1.177 |
| mico-da-dentadura | hit | S | 1 | altura, cy, escala | 8.96 | 0.555 → 0.681 / 0.555 | -1.7, 0, 0.914 |
| tio-pave | death | SW | 6 | altura, cy | 8.83 | 0.668 → 0.748 / 0.698 | 0.2, 0, 1 |
| pombo-rei | hit | S | 1 | altura, cy, escala | 8.67 | 0.719 → 0.788 / 0.719 | -2.5, 0, 1 |
| vendedor-de-bala | death | S | 8 | altura, cy | 8.66 | 0.556 → 0.655 / 0.736 | 4.3, -1, 1 |
| buraco-de-rua | hit | S | 1 | altura, cy | 8.33 | 0.658 → 0.724 / 0.658 | -1.2, 0, 1 |
| ratazana-mafiosa | hit | E | 1 | altura, cy, cx, escala | 8.33 | 0.501 → 0.695 / 0.501 | -12.7, 0, 1.18 |
| torcedor-fanatico | hit | N | 1 | altura, cy, escala | 8.24 | 0.593 → 0.609 / 0.593 | -0.6, 0.5, 1 |
| mico-da-dentadura | hit | SE | 1 | altura, cy, escala | 8.23 | 0.516 → 0.637 / 0.516 | -1.2, 0, 0.868 |
| ambulante-guarda-chuva | hit | N | 1 | altura, cy, escala | 8.12 | 0.626 → 0.783 / 0.626 | -0.4, 0, 1.279 |
| ambulante-guarda-chuva | hit | E | 1 | altura, cy, escala | 8.12 | 0.595 → 0.738 / 0.595 | -1.2, 0, 1.129 |
| pombo-rei | hit | SW | 1 | altura, cy, escala | 8 | 0.807 → 0.852 / 0.807 | 2.6, 0, 1 |
| bate-estaca | hit | SW | 1 | cy, altura | 7.92 | 0.562 → 0.747 / 0.562 | -2, 0, 1 |
| buraco-de-rua | hit | N | 1 | altura, cy | 7.89 | 0.69 → 0.729 / 0.69 | 0.6, 0, 1 |
| homem-wifi | hit | S | 1 | altura, cy, escala, cx | 7.88 | 0.56 → 0.636 / 0.56 | 7.8, 0, 1 |
| servidor-fossilizado | death | W | 8 | altura | 7.88 | 0.821 → 0.887 / 0.775 | 0.4, 0, 1.113 |
| motoboy | crash | NW | 3 | altura, cy, cx | 7.79 | 0.451 → 0.719 / 0.738 | -6.3, 0, 0.932 |
| vendedor-de-caixao | hit | NE | 1 | altura, cy, escala | 7.77 | 0.638 → 0.726 / 0.638 | -0.1, -0.5, 1 |
| coco-que-vende-gente | death | E | 7 | cy, escala | 7.75 | 0.293 → 0.718 / 0.816 | 0.3, -11, 1 |
| pombo-rei | hit | E | 1 | altura, cy, escala | 7.56 | 0.702 → 0.725 / 0.702 | -0.2, 0, 1 |
| homem-wifi | hit | SE | 1 | cx, altura, cy, escala | 7.52 | 0.306 → 0.695 / 0.306 | 18.8, 0, 1 |
| ambulante-guarda-chuva | hit | NW | 1 | altura, cy, escala | 7.5 | 0.604 → 0.688 / 0.604 | 0.1, 0.5, 1.151 |
| coco-que-vende-gente | death | NW | 4 | pe | 7.5 | 0.659 → 0.89 / 0.692 | 0.2, 22.5, 0.947 |
| lagartixa-de-terno | death | NW | 6 | altura, cy | 7.44 | 0.613 → 0.799 / 0.708 | -0.6, 0, 1 |

## Dano e ações, arte nova — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|

## Poses aceitas (scripts/tremor-aceitos.json) — 40 piores

| inimigo | animação | direção | quadro | medidas | gravidade | IoU cru → alinhado / típico | correção (dx, dy, escala) |
|---|---|---|---|---|---|---|---|
| buraco-de-rua | death | NW | 1 | altura, cy, escala | 10.53 | 0.581 → 0.679 / 0.87 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| buraco-de-rua | death | E | 1 | altura, cy, escala | 10.29 | 0.542 → 0.65 / 0.851 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| buraco-de-rua | death | W | 1 | altura, cy, escala | 8.97 | 0.537 → 0.603 / 0.868 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| buraco-de-rua | death | SE | 1 | altura, cy, escala | 8.48 | 0.58 → 0.658 / 0.829 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| coco-que-vende-gente | death | SW | 8 | cy, cx | 7.64 | 0.296 → 0.61 / 0.811 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| auditor-das-sombras | death | NE | 7 | pe, cy, cx | 7 | 0.124 → 0.268 / 0.834 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| coco-que-vende-gente | death | W | 8 | altura, pe, cy, cx | 6.98 | 0.382 → 0.35 / 0.829 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| bandeirinha-existencial | death | W | 6 | cy, altura, cx | 6.73 | 0.164 → 0.509 / 0.637 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| mapinguari-do-shopping | slam | S | 4 | altura, cy, escala | 6.63 | 0.433 → 0.516 / 0.762 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| malabarista-do-sinal | death | E | 8 | altura, cy, cx | 6.34 | 0.389 → 0.369 / 0.609 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| peladeiro-de-vidro | death | S | 5 | altura, cy | 6.27 | 0.372 → 0.487 / 0.64 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| mapinguari-do-shopping | slam | NW | 4 | cy, altura, escala | 6.17 | 0.449 → 0.493 / 0.79 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| coco-que-vende-gente | death | E | 8 | altura, pe | 6.15 | 0.377 → 0.336 / 0.816 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| urubu-fiscal | wake | 0 | 2 | cy, pe, escala | 5.9 | 0.413 → 0.655 / 0.882 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| coco-que-vende-gente | death | NW | 7 | altura, cy, escala | 5.79 | 0.421 → 0.393 / 0.711 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| auditor-das-sombras | death | W | 7 | cy | 5.76 | 0.086 → 0.266 / 0.806 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| motoboy | crash | E | 3 | altura, cy, escala | 5.69 | 0.425 → 0.584 / 0.777 | motoboy crash: queda da moto de propósito, aceito pelo usuário 24/10 |
| hater-anonimo | death | S | 8 | altura | 5.67 | 0.265 → 0.443 / 0.757 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| rodinho-do-sinal | death | E | 8 | escala, cy | 5.67 | 0.354 → 0.472 / 0.629 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| fogueteiro | death | E | 6 | cy, cx | 5.51 | 0.134 → 0.362 / 0.672 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| auditor-das-sombras | death | S | 7 | cy, pe | 5.46 | 0.085 → 0.336 / 0.776 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| boitata-de-sacolinha | charge | NW | 3 | pe, altura, cy | 5.44 | 0.432 → 0.506 / 0.678 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| coco-que-vende-gente | death | SW | 1 | altura | 5.37 | 0.731 → 0.605 / 0.811 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| barata-voadora | fly | N | 4 | cy, escala | 5.31 | 0.465 → 0.528 / 0.769 | asa embaixo no voo (corpo no lugar: cebola-voo.png) |
| fogueteiro | death | W | 6 | cy | 5.28 | 0.149 → 0.312 / 0.66 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| rodinho-do-sinal | death | NE | 8 | escala, cy | 5.28 | 0.337 → 0.473 / 0.758 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| cupim-mansao | shove | SE | 4 | cy, altura | 5.24 | 0.528 → 0.661 / 0.863 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| boitata-de-sacolinha | charge | E | 3 | altura | 5.22 | 0.504 → 0.57 / 0.734 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| buraco-de-rua | death | SW | 1 | altura, cy, escala | 5.21 | 0.629 → 0.655 / 0.84 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| glitter-senciente | death | NE | 8 | cx, pe | 5.19 | 0.159 → 0.188 / 0.705 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| fogueteiro | death | SW | 6 | escala, cy | 5.18 | 0.145 → 0.309 / 0.667 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| mapinguari-do-shopping | slam | SW | 4 | altura, cy, cx | 5.03 | 0.419 → 0.57 / 0.751 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| glitter-senciente | death | SE | 8 | cx, pe | 5.01 | 0.204 → 0.2 / 0.757 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| perueiro | crash | E | 5 | altura, cy | 5 | 0.469 → 0.584 / 0.847 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| glitter-senciente | death | E | 8 | cx, pe, cy | 4.98 | 0.189 → 0.16 / 0.689 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| boitata-de-sacolinha | charge | SE | 3 | altura, cy, escala, pe | 4.95 | 0.485 → 0.61 / 0.774 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| auditor-das-sombras | death | SE | 7 | cy | 4.93 | 0.101 → 0.31 / 0.842 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| o-grande-credor | death | S | 7 | escala | 4.9 | 0.402 → 0.462 / 0.706 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| glitter-senciente | death | W | 8 | cx, pe | 4.87 | 0.185 → 0.175 / 0.713 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
| rodinho-do-sinal | attack | S | 3 | cx | 4.84 | 0.26 → 0.407 / 0.694 | pose de propósito na ação (queda, golpe, desmanche); triagem a olho nas tiras, E8 24/10 |
