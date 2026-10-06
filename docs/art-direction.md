# Direção visual · viagem

## Contrato confirmado
Jogo cooperativo para até seis pessoas online em tempo real; uma personagem controlada por pessoa; grupo enfrenta inimigos. Referências: três screenshots Trickster fornecidos pelo usuário em 05/10/2026. Cenário com percepção de volume e campo de visão como no projeto Crônicas do Império.

## Tradução para implementação
- Projeção isométrica fixa com terreno que guarda altura/relevo e sprites 2D posicionados no mundo. É uma apresentação 2.5D; não exige câmera livre ou modelos 3D completos para alcançar o visual pedido.
- O checkout de referência usa Phaser, projeção isométrica e reliefField. Ele foi apenas lido, não modificado.
- Heróis com cabeças expressivas, proporções compactas, contorno discreto e armas/acessórios reconhecíveis. Não transformar a referência em bonecos low-poly ou ilustração grande que esconda o mapa.
- Cenário tropical claro: areia quente, vegetação verde, água turquesa e construções pintadas com perspectiva consistente. Sombras de contato simples, sem excesso de iluminação em tempo real.
- Seis jogadores diferenciados por silhueta, cor de acento, ícone de papel e indicador de aliado; legibilidade não depende só da cor.
- Impactos curtos, números de dano discretos e áreas de perigo com borda clara. Prioridade visual: ameaça, personagem local, aliados, cenário.
- HUD mobile primeiro: controles afastados do centro, botões com área de toque confortável e suporte a safe areas. Landscape é a composição inicial proposta; não é uma restrição confirmada pelo usuário.
- Criação de personagem: retrato anime grande, janela lilás, nome/cor, papel e radar de atributos inspirados na organização da segunda referência. A primeira versão tem 36 classes de humor cotidiano; atributos e habilidades estão definidos como propostas no catálogo. A miniatura atual reutiliza o retrato e será substituída por um sprite real no card de animação.

## Proposta de primeira cena
Uma clareira tropical junto a ruínas e água rasa, onde seis aventureiros enfrentam pequenos monstros e um guardião. É um recorte para validar combate/arte/networking, sem pressupor mundo aberto, crafting, monetização ou MMO.

## Desempenho como parte do design
Usar atlases, animação de sprites, cenário por blocos, culling e atualização incremental do campo de visão. Carregar o lobby antes dos assets da fase, limitar partículas e resolução interna. Um conceito bonito não comprova desempenho: o card de publicação exige medição do jogo real.

## Separação de entregas
Conceito visual é imagem de referência. Assets são personagens/cenário/UI separados e testados. Build é aplicação funcional. Nenhuma dessas entregas prova automaticamente as outras.
