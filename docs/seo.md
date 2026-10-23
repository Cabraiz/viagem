# SEO do viagem.cyou

Card: NEW-20261023-ORQ-seo-natural. O head do `index.html` está em inglês, para quem chega do mundo todo. O texto do jogo é pt-BR, então `<html lang="pt-BR">` continua e não há `hreflang` (não existem páginas /pt nem /es).

## Tom

Diz o que o jogo é e como se joga, como alguém contando a um amigo. Sem superlativo, comparação com outra marca, lista de palavras-chave, emoji, caixa alta, ponto de exclamação ou texto de vendedor. Só o que é verdade no jogo: até seis pessoas por sala (`MAX_PLAYERS`), os três personagens liberados (`PERSONAGENS_LIBERADOS`). `tests/tools/seo-head.test.ts` confere isso.

## Textos

| | Título | Descrição |
| --- | --- | --- |
| en (no head) | viagem: co-op survival in the browser | A free browser game for up to six players. You survive waves of creatures in a city as a gambler, a tired office worker or a hungry cat. |
| pt-BR | viagem: sobrevivência cooperativa no navegador | Jogo grátis no navegador para até seis pessoas. Vocês aguentam ondas de bichos numa cidade, jogando de viciado em bet, CLT ou gato com fome. |
| es | viagem: supervivencia cooperativa en el navegador | Juego gratis en el navegador para hasta seis personas. Aguantan oleadas de criaturas en una ciudad jugando de apostador, oficinista o gato con hambre. |

As versões pt-BR e es ficam prontas aqui para quando o jogo tiver tradução e fizer sentido ter /pt e /es com `hreflang`. Antes disso, uma página com o head em espanhol e o jogo em português seria página fina.

## Arquivos

- `index.html`: título, descrição, canonical, Open Graph, Twitter card e JSON-LD `VideoGame` (sem nota nem avaliação).
- `public/og.jpg`: 1200x630, o estádio do menu com os três personagens, sem texto.
- `public/robots.txt` e `public/sitemap.xml`: vão para a raiz do Pages pelo `dist/`. O `public/ads.txt` do card de anúncios convive com eles.
