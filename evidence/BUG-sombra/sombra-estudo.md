# Estudo da sombra por bicho (gerado por scripts/sombra-estudo.mjs)

Para cada folha de corpo de cada inimigo (sem as camadas elite/fantasia), em todas as células: **pé** = linha opaca mais
baixa (alfa > 20); **âncora** = anchor[1] × altura da célula (onde o jogo põe o ponto do chão e a sombra).
**Desvio** = âncora − pé, em px da célula: positivo = o pé fica ACIMA da âncora (o bicho flutua sobre a sombra).
Os voadores (animação `fly`) flutuam de propósito.

- Folhas medidas: 1133. Com |desvio| > 4 px: **55** (2 delas de voo).

| bicho | animação | célula | âncora | pé | desvio (px) | figura (px) |
|---|---|---|---|---|---|---|
| chefe | sleep | 384 | 338 | 296 | +42 | 159 |
| o-grande-credor | death | 384 | 338 | 365 | -27 | 235 |
| pombo-rei | hit | 256 | 225 | 249 | -24 | 196 |
| pombo-rei | death | 256 | 225 | 248 | -23 | 201 |
| gerente-regional | slam | 256 | 225 | 247 | -22 | 189 |
| rei-do-boteco | slam | 256 | 225 | 246 | -21 | 174 |
| pombo-rei | charge | 256 | 225 | 243 | -18 | 182 |
| balao-rancoroso | hit | 96 | 84 | 69 | +15 | 59 |
| bebado-do-karaoke | death | 160 | 141 | 153 | -12 | 99 |
| dono-do-boteco | death | 160 | 141 | 153 | -12 | 106 |
| paredao-ambulante | death | 160 | 141 | 153 | -12 | 95 |
| tio-do-isopor | death | 160 | 141 | 153 | -12 | 101 |
| betoneira-ambulante | death | 160 | 141 | 152 | -11 | 108 |
| cliente-do-gerente | death | 160 | 141 | 152 | -11 | 118 |
| gamer-rage-quit | crash | 160 | 141 | 152 | -11 | 99 |
| madrinha-velociraptor | charge | 160 | 141 | 152 | -11 | 94 |
| madrinha-velociraptor | crash | 160 | 141 | 152 | -11 | 94 |
| pombo-rei | slam | 256 | 225 | 236 | -11 | 194 |
| bebum-de-carrinho | crash | 160 | 141 | 151 | -10 | 117 |
| chefe-pizza | death | 160 | 141 | 151 | -10 | 85 |
| dj-de-casamento | death | 160 | 141 | 151 | -10 | 85 |
| tio-do-isopor | hit | 160 | 141 | 151 | -10 | 126 |
| ratazana-mafiosa | death | 160 | 141 | 150 | -9 | 68 |
| espetinho-suspeito | death | 128 | 113 | 121 | -8 | 73 |
| espetinho-suspeito | throw | 128 | 113 | 121 | -8 | 73 |
| estagiario-imortal | death | 128 | 113 | 121 | -8 | 74 |
| grauzeiro | crash | 160 | 141 | 149 | -8 | 80 |
| juiz-vendido | death | 128 | 113 | 121 | -8 | 98 |
| malabarista-do-sinal | hit | 128 | 113 | 121 | -8 | 93 |
| pombos | fly (voo) | 96 | 84 | 76 | +8 | 43 |
| pombos | hit | 96 | 84 | 76 | +8 | 49 |
| tiozinho-da-sinuca | death | 128 | 113 | 121 | -8 | 73 |
| vizinho-da-furadeira | death | 128 | 113 | 121 | -8 | 97 |
| bebum-de-carrinho | charge | 160 | 141 | 148 | -7 | 123 |
| hater-anonimo | death | 128 | 113 | 120 | -7 | 62 |
| malabarista-do-sinal | throw | 128 | 113 | 120 | -7 | 91 |
| moco-do-gas | crash | 160 | 141 | 148 | -7 | 107 |
| alambiqueiro | death | 128 | 113 | 119 | -6 | 72 |
| ambulante-guarda-chuva | death | 128 | 113 | 119 | -6 | 82 |
| carimbador | death | 128 | 113 | 119 | -6 | 42 |
| coach | death | 128 | 113 | 119 | -6 | 61 |
| drone-ansioso | fly (voo) | 96 | 84 | 78 | +6 | 58 |
| flanelinha-interdimensional | death | 160 | 141 | 147 | -6 | 54 |
| mico-da-dentadura | death | 128 | 113 | 107 | +6 | 70 |
| rodinho-do-sinal | hit | 128 | 113 | 119 | -6 | 94 |
| boitata-de-sacolinha | death | 384 | 338 | 333 | +5 | 157 |
| cafeteira-burnout | crash | 160 | 141 | 146 | -5 | 79 |
| coach | sleep | 128 | 113 | 118 | -5 | 91 |
| drone-ansioso | hit | 96 | 84 | 79 | +5 | 51 |
| espetinho-suspeito | sleep | 128 | 113 | 118 | -5 | 67 |
| fogueteiro | death | 128 | 113 | 118 | -5 | 83 |
| guru-cripto | death | 160 | 141 | 146 | -5 | 71 |
| marronzinho | death | 128 | 113 | 118 | -5 | 72 |
| o-grande-credor | slam | 384 | 338 | 343 | -5 | 199 |
| pombo-tres-cabecas | death | 96 | 84 | 89 | -5 | 48 |

## Apoio por bicho (a elipse de contato)

| bicho | laço | pé (fração) | apoio (fração da largura) | apoio dormindo | figura (fração da altura) |
|---|---|---|---|---|---|
| agiota | walk | 0.898 | 0.195 | 0.398 | 0.766 |
| alambiqueiro | walk | 0.898 | 0.234 | 0.375 | 0.555 |
| ambulante-guarda-chuva | walk | 0.898 | 0.32 | 0.398 | 0.68 |
| anao-molotov | walk | 0.902 | 0.223 | 0.536 | 0.705 |
| animador-necromante | walk | 0.898 | 0.164 | 0.352 | 0.695 |
| auditor-das-sombras | walk | 0.898 | 0.32 | 0.547 | 0.68 |
| balao-rancoroso | fly | 0.844 | 0.073 | 0.094 | 0.75 |
| bandeirinha-existencial | walk | 0.898 | 0.32 | 0.391 | 0.805 |
| barata-voadora | fly | 0.875 | 0.198 | 0.313 | 0.49 |
| bate-estaca | walk | 0.887 | 0.492 | 0.523 | 0.762 |
| bebado | walk | 0.898 | 0.188 | 0.586 | 0.758 |
| bebado-do-karaoke | walk | 0.894 | 0.244 | 0.506 | 0.706 |
| bebedouro-da-fofoca | walk | 0.898 | 0.375 | 0.375 | 0.758 |
| bebum-de-carrinho | idle | 0.894 | 0.313 | 0.35 | 0.788 |
| betoneira-ambulante | walk | 0.894 | 0.438 | 0.556 | 0.788 |
| boitata-de-sacolinha | walk | 0.885 | 0.56 | 0.576 | 0.669 |
| boleto-vivo | walk | 0.906 | 0.313 | 0.328 | 0.688 |
| bolo-vivo | walk | 0.894 | 0.369 | 0.506 | 0.775 |
| boneco-gigante | walk | 0.894 | 0.225 | 0.319 | 0.775 |
| bot-de-curtida | walk | 0.906 | 0.344 | 0.391 | 0.719 |
| buraco-de-rua | walk | 0.898 | 0.555 | 0.586 | 0.617 |
| cachorro-de-madame | walk | 0.906 | 0.375 | 0.406 | 0.719 |
| cadeira-giratoria | idle | 0.894 | 0.394 | 0.394 | 0.681 |
| cafeteira-burnout | idle | 0.894 | 0.319 | 0.325 | 0.731 |
| caixa-eletronico | walk | 0.894 | 0.506 | 0.506 | 0.725 |
| camelo-pirata | walk | 0.898 | 0.234 | 0.242 | 0.555 |
| capivara-blindada | walk | 0.894 | 0.3 | 0.4 | 0.681 |
| caramujo-financiado | walk | 0.894 | 0.575 | 0.538 | 0.7 |
| carimbador | walk | 0.898 | 0.203 | 0.273 | 0.797 |
| carrinho-da-vo | idle | 0.894 | 0.431 | 0.525 | 0.694 |
| chefe | walk | 0.885 | 0.344 | 0.378 | 0.792 |
| chefe-pizza | walk | 0.894 | 0.15 | 0.45 | 0.594 |
| ciclista-de-lycra | idle | 0.894 | 0.356 | 0.138 | 0.694 |
| cliente-do-gerente | walk | 0.894 | 0.275 | 0.206 | 0.656 |
| coach | walk | 0.898 | 0.188 | 0.352 | 0.789 |
| cobrador-do-busao | walk | 0.898 | 0.352 | 0.359 | 0.75 |
| cobrador-fantasma | walk | 0.898 | 0.32 | 0.359 | 0.703 |
| coco-que-vende-gente | walk | 0.898 | 0.508 | 0.609 | 0.75 |
| coelho-falsificado | walk | 0.898 | 0.281 | 0.477 | 0.734 |
| cofre-mimico | walk | 0.898 | 0.484 | 0.609 | 0.781 |
| contador-de-almas | walk | 0.898 | 0.195 | 0.313 | 0.742 |
| corretor-de-imoveis | walk | 0.894 | 0.263 | 0.331 | 0.688 |
| cosplayer | walk | 0.894 | 0.325 | 0.338 | 0.688 |
| crossfiteiro-do-pneu | walk | 0.894 | 0.531 | 0.55 | 0.781 |
| cunhado-sabe-tudo | walk | 0.894 | 0.181 | 0.438 | 0.7 |
| cupim-mansao | walk | 0.894 | 0.556 | 0.656 | 0.788 |
| dancinha-viral | walk | 0.894 | 0.175 | 0.425 | 0.688 |
| despachante | walk | 0.894 | 0.356 | 0.444 | 0.75 |
| dj-de-casamento | walk | 0.894 | 0.194 | 0.388 | 0.681 |
| dj-do-fim-do-mundo | walk | 0.885 | 0.24 | 0.536 | 0.747 |
| domino-humano | walk | 0.906 | 0.156 | 0.141 | 0.609 |
| dono-do-boteco | walk | 0.894 | 0.263 | 0.381 | 0.713 |
| drone-ansioso | fly | 0.76 | 0.292 | 0.615 | 0.604 |
| engenheiro-obra-parada | walk | 0.894 | 0.275 | 0.494 | 0.781 |
| entregador-matrioska | idle | 0.888 | 0.344 | 0.363 | 0.656 |
| espetinho-suspeito | walk | 0.898 | 0.406 | 0.547 | 0.563 |
| estagiario-imortal | walk | 0.898 | 0.133 | 0.289 | 0.547 |
| ex-que-voltou | fly | 0.813 | 0.26 | 0.25 | 0.677 |
| executivo-de-patinete | idle | 0.894 | 0.138 | 0.119 | 0.681 |
| fa-de-novela | walk | 0.894 | 0.219 | 0.381 | 0.694 |
| filosofo-de-balcao | walk | 0.894 | 0.188 | 0.35 | 0.694 |
| fiscal-da-garagem | walk | 0.898 | 0.148 | 0.375 | 0.578 |
| flanelinha-interdimensional | walk | 0.894 | 0.306 | 0.356 | 0.656 |
| fogueteiro | walk | 0.898 | 0.336 | 0.477 | 0.789 |
| forrozeiro-centrifugo | walk | 0.894 | 0.163 | 0.419 | 0.644 |
| frango-de-academia | walk | 0.898 | 0.195 | 0.492 | 0.727 |
| furry-de-convencao | walk | 0.898 | 0.195 | 0.547 | 0.617 |
| gamer-rage-quit | idle | 0.894 | 0.325 | 0.356 | 0.669 |
| garcom-equilibrista | walk | 0.898 | 0.109 | 0.25 | 0.594 |
| geladeira-do-feijao | walk | 0.898 | 0.32 | 0.375 | 0.758 |
| gerente-regional | walk | 0.887 | 0.277 | 0.578 | 0.781 |
| gerente-vampiro | walk | 0.898 | 0.273 | 0.469 | 0.766 |
| glitter-senciente | walk | 0.898 | 0.18 | 0.5 | 0.727 |
| grampeador-carente | walk | 0.906 | 0.203 | 0.422 | 0.578 |
| grauzeiro | idle | 0.894 | 0.163 | 0.106 | 0.669 |
| guru-cripto | walk | 0.894 | 0.2 | 0.475 | 0.694 |
| guru-do-linkedin | walk | 0.894 | 0.15 | 0.25 | 0.694 |
| hater-anonimo | walk | 0.898 | 0.164 | 0.391 | 0.586 |
| homem-galao | walk | 0.894 | 0.363 | 0.375 | 0.731 |
| homem-placa-do-fim | walk | 0.894 | 0.225 | 0.463 | 0.775 |
| homem-surdo | walk | 0.898 | 0.266 | 0.43 | 0.641 |
| homem-wifi | walk | 0.898 | 0.188 | 0.516 | 0.773 |
| impressora-possuida | walk | 0.898 | 0.242 | 0.547 | 0.594 |
| influencer | walk | 0.894 | 0.213 | 0.444 | 0.731 |
| jacare-do-bueiro | walk | 0.894 | 0.444 | 0.55 | 0.713 |
| juiz-vendido | walk | 0.898 | 0.172 | 0.602 | 0.797 |
| lagartixa-de-terno | walk | 0.898 | 0.305 | 0.406 | 0.75 |
| leao-da-receita | walk | 0.894 | 0.325 | 0.619 | 0.819 |
| leiloeiro | walk | 0.894 | 0.175 | 0.556 | 0.706 |
| madrinha-velociraptor | idle | 0.894 | 0.238 | 0.425 | 0.656 |
| malabarista-do-sinal | walk | 0.898 | 0.227 | 0.414 | 0.695 |
| manobrista | walk | 0.894 | 0.188 | 0.488 | 0.788 |
| mapinguari-do-shopping | walk | 0.885 | 0.341 | 0.594 | 0.609 |
| maratonista-eterno | walk | 0.898 | 0.156 | 0.32 | 0.766 |
| marimbondo-sindical | walk | 0.894 | 0.231 | 0.394 | 0.644 |
| marronzinho | walk | 0.898 | 0.188 | 0.398 | 0.586 |
| mico-da-dentadura | walk | 0.898 | 0.203 | 0.492 | 0.469 |
| moco-do-gas | idle | 0.894 | 0.306 | 0.369 | 0.75 |
| motoboy | idle | 0.894 | 0.181 | 0.338 | 0.681 |
| noel-derretendo | walk | 0.894 | 0.2 | 0.494 | 0.763 |
| noiva-da-quadrilha | walk | 0.898 | 0.203 | 0.352 | 0.727 |
| noivo-em-fuga | walk | 0.898 | 0.289 | 0.508 | 0.625 |
| o-grande-credor | walk | 0.885 | 0.336 | 0.563 | 0.63 |
| orelhao-zumbi | walk | 0.894 | 0.469 | 0.5 | 0.731 |
| palhaco-de-aniversario | walk | 0.894 | 0.319 | 0.4 | 0.688 |
| pamonheiro | walk | 0.898 | 0.141 | 0.313 | 0.602 |
| paredao-ambulante | walk | 0.894 | 0.163 | 0.406 | 0.719 |
| peladeiro-de-vidro | walk | 0.898 | 0.398 | 0.453 | 0.781 |
| personal-gritao | walk | 0.891 | 0.172 | 0.492 | 0.609 |
| perueiro | idle | 0.894 | 0.313 | 0.325 | 0.663 |
| pichador-ninja | walk | 0.898 | 0.18 | 0.539 | 0.734 |
| podcaster-de-garagem | walk | 0.898 | 0.164 | 0.336 | 0.758 |
| pombo-rei | walk | 0.887 | 0.387 | 0.34 | 0.773 |
| pombo-tres-cabecas | fly | 0.802 | 0.271 | 0.302 | 0.573 |
| pombos | fly | 0.781 | 0.219 | 0.115 | 0.448 |
| poste-gambiarra | walk | 0.898 | 0.281 | 0.305 | 0.617 |
| primo-do-violao | walk | 0.894 | 0.188 | 0.213 | 0.581 |
| promotor-infinito | walk | 0.891 | 0.195 | 0.344 | 0.742 |
| quadrilheiro | walk | 0.894 | 0.338 | 0.494 | 0.713 |
| quati-influencer | walk | 0.898 | 0.266 | 0.289 | 0.547 |
| rapa-da-prefeitura | walk | 0.894 | 0.2 | 0.469 | 0.694 |
| ratazana-mafiosa | walk | 0.894 | 0.363 | 0.475 | 0.675 |
| rato-de-boteco | walk | 0.906 | 0.094 | 0.125 | 0.438 |
| rei-do-boteco | walk | 0.887 | 0.402 | 0.5 | 0.695 |
| rei-do-camarote | walk | 0.894 | 0.538 | 0.619 | 0.694 |
| ressaca-ambulante | walk | 0.898 | 0.25 | 0.586 | 0.773 |
| reuniao-que-podia-ser-email | walk | 0.894 | 0.238 | 0.4 | 0.713 |
| revendedora-de-catalogo | walk | 0.898 | 0.172 | 0.242 | 0.781 |
| rh-sorridente | walk | 0.898 | 0.148 | 0.156 | 0.719 |
| robo-de-atendimento | walk | 0.898 | 0.156 | 0.289 | 0.578 |
| rodinho-do-sinal | walk | 0.898 | 0.195 | 0.508 | 0.734 |
| rolo-lava-rapido | walk | 0.898 | 0.195 | 0.313 | 0.648 |
| sapo-cururu | walk | 0.898 | 0.422 | 0.625 | 0.469 |
| seguranca-de-shopping | walk | 0.894 | 0.213 | 0.594 | 0.769 |
| servidor-fossilizado | walk | 0.894 | 0.419 | 0.481 | 0.675 |
| skatista-de-47 | walk | 0.898 | 0.391 | 0.477 | 0.742 |
| sogra-do-chinelo | walk | 0.898 | 0.188 | 0.266 | 0.578 |
| sogra-tita | walk | 0.885 | 0.224 | 0.409 | 0.711 |
| sommelier-de-ipa | walk | 0.894 | 0.175 | 0.525 | 0.669 |
| subsindico | walk | 0.898 | 0.141 | 0.352 | 0.578 |
| taxista-reclamao | walk | 0.894 | 0.175 | 0.431 | 0.688 |
| telemarketing | walk | 0.898 | 0.125 | 0.234 | 0.578 |
| tia-do-pudim | walk | 0.887 | 0.289 | 0.543 | 0.805 |
| tia-do-zap | walk | 0.898 | 0.195 | 0.359 | 0.797 |
| tijolo-pai | walk | 0.898 | 0.188 | 0.383 | 0.586 |
| tio-do-isopor | walk | 0.894 | 0.35 | 0.581 | 0.788 |
| tio-pave | walk | 0.894 | 0.188 | 0.231 | 0.631 |
| tiozinho-da-sinuca | walk | 0.898 | 0.266 | 0.305 | 0.625 |
| torcedor-fanatico | walk | 0.894 | 0.269 | 0.406 | 0.663 |
| trenzinho-da-festa | walk | 0.906 | 0.25 | 0.313 | 0.734 |
| trio-eletrico | walk | 0.887 | 0.473 | 0.473 | 0.773 |
| unboxer | walk | 0.894 | 0.238 | 0.256 | 0.7 |
| urubu-fiscal | fly | 0.854 | 0.156 | 0.521 | 0.583 |
| vendedor-de-bala | walk | 0.898 | 0.172 | 0.25 | 0.648 |
| vendedor-de-caixao | walk | 0.898 | 0.172 | 0.484 | 0.758 |
| vendedor-de-piramide | walk | 0.894 | 0.175 | 0.488 | 0.681 |
| vizinho-da-furadeira | walk | 0.898 | 0.336 | 0.57 | 0.727 |
| vo-tricoteira | walk | 0.888 | 0.281 | 0.388 | 0.638 |
| zelador-hidraulico | walk | 0.891 | 0.266 | 0.422 | 0.758 |
