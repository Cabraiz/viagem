# Anúncios: Google H5 Games Ads (AdSense)

O jogo usa só a **Ad Placement API** do Google (H5 Games Ads, dentro do AdSense): `adsbygoogle.js` + `adConfig`/`adBreak`.
Nenhuma outra rede, nada de pop-under, redirecionamento ou script de terceiro.

O código já está pronto e **desligado**. Para ligar de verdade, quem faz os passos 1 a 5 é você (a IA não cria conta nem
entra no painel do AdSense). Depois é só mandar o ID `ca-pub-…` ao Orquestrador.

## O que o jogo faz hoje

| | |
|---|---|
| Onde aparece | Só um **intersticial** ao sair da tela de resultado (JOGAR DE NOVO ou MENU). Nunca durante a partida. |
| Frequência | No máximo 1 a cada 3 min (`minGapMs` em `src/client/ads/config.ts`; também vai como `data-ad-frequency-hint`). O Google pode mostrar menos. |
| Recompensado | **Não tem.** As recompensas que existem (Grana, itens, XP) mudam a partida de todos no multijogador; pagar com anúncio seria vantagem comprada. |
| Áudio | Pausa no `beforeAd` e volta no `afterAd`. |
| Falha ou adblock | O jogo segue normal: se o anúncio não vier em 1,5 s, o fluxo continua sozinho. |
| Peso no 1º acesso | Nenhum: o script carrega async, depois do `load`, de tempo ocioso e mais 3 s (`ADS_BOOT_DELAY_MS`). Desligado = zero chamada. |
| Testar | `https://viagem.cyou/?anuncios=teste` liga o modo teste em qualquer build. Sem `ca-pub` o Google não serve anúncio de teste, então você só vê o jogo seguir depois de 1,5 s; com o `ca-pub` aparece o anúncio de teste do Google. |

Prints do modo teste (PC, celular em pé e deitado, adblock): `evidence/NEW-20261023-ORQ-anuncios-h5-games/`.

## Passo a passo (você)

### 1. Conta AdSense
1. Entre em <https://adsense.google.com> com a sua conta Google e crie a conta AdSense (dados de pagamento e endereço
   são seus; o Google manda um PIN pelo correio quando o saldo passa de US$ 10).
2. Em **Contas → Informações da conta** copie o **ID de publisher**: `ca-pub-` seguido de 16 dígitos. Ele não é segredo
   (vai no HTML da página), pode mandar pelo chat.

### 2. Cadastrar o domínio viagem.cyou
1. No AdSense: **Sites → Novo site → `viagem.cyou`**.
2. O Google pede para provar que o site é seu. Escolha a opção **ads.txt**: mande o `ca-pub` e a gente publica
   `public/ads.txt`, que o build copia para a raiz (vira `https://viagem.cyou/ads.txt`, como já acontece com o `CNAME`).
   A linha é esta, com o seu número:
   ```
   google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
   ```
3. Peça a revisão do site. Leva de alguns dias a algumas semanas. Enquanto não aprova, o modo teste continua ligado.

### 3. Pedir o H5 Games Ads
A Ad Placement API é liberada por pedido. Com o site aprovado, procure "H5 Games Ads" na ajuda do AdSense e preencha o
formulário de interesse para `viagem.cyou` (tipo: jogo HTML5 no navegador, intersticial entre partidas). Sem essa
liberação o `adBreak` não serve anúncio de verdade, e o jogo só segue em frente.

### 4. Bloquear apostas e categorias sensíveis
Um jogo com a classe **"Viciado em Bet"** não pode exibir anúncio de casa de aposta. Em **Proteção da marca → Controles
de bloqueio → Todos os sites → Gerenciar categorias de anúncios**:
- **Categorias confidenciais / restritas**: bloquear **Jogos de azar e apostas**, **Bebidas alcoólicas**, **Namoro**,
  **Conteúdo sexual sugestivo**, **Religião**, **Política**, **Loteria**, **Cassino**, **Apostas esportivas** (os
  nomes variam um pouco conforme o idioma do painel; bloqueie tudo o que for aposta).
- **Categorias gerais**: bloquear o que mais lembrar dinheiro fácil (empréstimo, "ganhe dinheiro", criptomoeda).
- Deixe o público como **todas as idades** (o jogo é cartoon e jogado por adolescentes).

### 5. Consentimento (LGPD e GDPR)
- **Europa, Reino Unido e Suíça**: o Google exige uma CMP certificada. A mais simples é a do próprio AdSense:
  **Privacidade e mensagens → Mensagem do GDPR / Regulamentações europeias → Criar**, para `viagem.cyou`. Ela aparece
  sozinha pelo `adsbygoogle.js`, sem código nosso. Recomendado: mostrar também a opção "Não consentir".
- **Estados dos EUA**: crie também a mensagem de **Regulamentações dos estados dos EUA** no mesmo lugar.
- **Brasil (LGPD)**: o AdSense não obriga banner, mas a LGPD pede transparência. O site precisa de uma **Política de
  Privacidade** dizendo que usa cookies do Google para anúncios, com link para
  <https://policies.google.com/technologies/partner-sites>. **O site ainda não tem essa página**: ela entra junto com a
  etapa 4 (um `privacidade.html` no rodapé do menu), e o AdSense costuma recusar o site sem ela.

### 6. Mandar para a gente
Mande ao Orquestrador: o `ca-pub-…` e a confirmação de que o site foi aprovado e o H5 Games Ads liberado.

## Onde colar o ca-pub (etapa 4, a gente faz)

`src/client/ads/config.ts`:
```ts
export const ADS_CONFIG:Readonly<AdsConfig>=Object.freeze({
  enabled:true,                      // era false
  client:'ca-pub-0000000000000000',  // o seu ID
  test:false,                        // só depois do site aprovado; antes, deixe true
  minGapMs:180_000,
});
```
Mais `public/ads.txt` (a linha do passo 2) e a página de privacidade. Sem o `ca-pub` válido os anúncios nunca carregam,
mesmo com `enabled:true`. Em dev (`npm run dev`) e nos testes ficam sempre desligados.

Para desligar de novo a qualquer momento: `enabled:false` e publicar.

## Risco do tema "Viciado em Bet"

- A política do AdSense não aceita **conteúdo que promova** jogo de azar com dinheiro. O jogo não tem aposta: a classe é
  uma sátira, a habilidade usa "energia fictícia" e não existe compra, prêmio em dinheiro nem link para casa de aposta.
  Isso deve passar, mas o revisor pode marcar pelo nome. Se o AdSense recusar citando jogo de azar, responda explicando
  que é um personagem de RPG cômico e mostre a descrição da classe; não mude o jogo antes de ver a recusa.
- O risco maior é o **anúncio** de aposta aparecer ao lado do personagem. Por isso o passo 4 é obrigatório antes de
  tirar o modo teste.
- Nunca clique nos próprios anúncios nem peça a amigos que cliquem: o AdSense fecha a conta por tráfego inválido. Para
  ver o anúncio, use `?anuncios=teste` (anúncio de teste, sem dinheiro).
