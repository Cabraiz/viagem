# Playtest de primeira vez (UX)

**Precisa do jogo publicado. No fim, mande os arquivos no zap para quem roda o relatório.**

O roteiro serve para testar o jogo com **3 a 5 pessoas que nunca jogaram**, cada uma no próprio celular, **sem explicação**. Ele mede o que o novato faz sozinho no primeiro minuto e se a turma quer jogar de novo. Cada celular grava as próprias métricas e, no fim, entrega um arquivo.

**Uma pessoa não joga: fica com a folha** (seção "Risadas", no fim) e anota o que vê.

## O que é medido (e o que não é)

As métricas só ligam com `?dev=1` no endereço. Sem isso o jogo nem carrega o código delas.

- **Tudo fica no celular.** Não há servidor de métricas nem envio automático. O arquivo só sai do aparelho quando alguém toca em **Métricas**.
- **Nada pessoal.** O arquivo não guarda nome, apelido, id de jogador, código da sala nem posição no mapa. Para juntar os celulares do mesmo grupo, o convite leva um rótulo sorteado (`g=…`). O arquivo também guarda o tamanho da tela.
- **O que entra no arquivo:**
  - tempo até o 1º arrasto no joystick e até o herói andar, contados desde a primeira tela em que dá para andar (o combate);
  - se a pessoa já tentou arrastar o joystick na sala de espera;
  - segundos parado nos primeiros 60 s;
  - quedas no round 1;
  - caídos resgatados e perdidos;
  - ofertas escolhidas e resolvidas pelo padrão, separadas pela fase em que chegaram;
  - tempo de escolha e toques em "Depois";
  - tempo até o 1º chip "+N" e até o 1º toque nele;
  - dicas do treinador: vistas, aprendidas e o tempo de cada uma;
  - "Me salva" enviados e recebidos;
  - momentos de risada que aconteceram;
  - revanche apertada e revanche iniciada;
  - comandos do dono que a sala confirmou.
- **Só conta o que a sala recebeu.** Toque que não saiu do celular (sem rede) fica marcado como "não enviado".
- **Emotes:** o leque ainda não está na sala. O campo existe e vem como "não disponível".

## Metas

| Métrica | Meta | Como conta |
|---|---|---|
| 1º movimento ≤ 3 s | **80%** dos novatos (3 de 3, 3 de 4, 4 de 5) | 1º arrasto no joystick desde a 1ª tela em que dá para andar, na 1ª run de cada celular novato |
| Round 1 sem queda | **80%** dos novatos (3 de 3, 3 de 4, 4 de 5) | O novato não caiu no round 1 da 1ª run |
| Ofertas no padrão | **menos de 20%** das ofertas | Ofertas que sumiram pelo prazo sem toque, sobre todas as resolvidas |
| Revanche | **60%** dos grupos (1 de 1, 2 de 3, 3 de 5) | Grupo em que a revanche começou depois de um resultado |
| 1º chip ≤ 30 s | **80%** dos novatos (3 de 3, 3 de 4, 4 de 5) | O 1º chip "+N" apareceu em até 30 s na 1ª run |

"Novato" é o celular cujo treinador não sabia nenhuma dica no começo. Use um navegador que nunca abriu o jogo, ou uma aba anônima.

## Antes do dia

1. O link é `https://viagem.cyou/?dev=1`. Sem o jogo publicado, veja o apêndice (só para dev).
2. **Celulares limpos:** cada pessoa abre o link numa aba anônima ou num navegador onde nunca jogou.
3. **Folha do observador:** imprima ou copie a tabela da seção "Risadas", uma por pessoa.
4. Bateria acima de 50% e brilho alto. Som ligado se der.

## No dia

**O que dizer:** só "Abre esse link e joga com a gente". **Não explique** controles, chip, resgate nem coleta. Se perguntarem, responda "faz o que achar". O observador anota a pergunta.

1. Quem organiza abre `https://viagem.cyou/?dev=1`, escolhe um personagem, toca em **Jogar com amigos** e em **Criar sala**.
2. Na sala de espera, toque em **Medir a turma** (fica aceso). Só assim o convite leva as métricas para os outros celulares. Vale até fechar a aba.
3. Toque em **Chamar a turma** e mande o convite no grupo. Confira se o link tem `dev=1` e `g=`.
4. Cada pessoa abre o convite, escolhe personagem e apelido, entra e toca em **Tô pronto!**.
5. Se faltar gente, o dono pode pôr bots (fica nos comandos de dono). Para as metas de novato, contam só as pessoas.
6. Joguem. **Não ajude.** O observador anota cada risada e cada travada ("não sei o que fazer").
7. A turma decide sozinha se aperta **Revanche**. Não sugira: é isso que a meta de revanche mede.
8. **Só quando a turma parar de jogar, no último resultado,** cada pessoa toca em **Métricas** (o botão tracejado ao lado do tempo e do round). Também dá para tocar depois de **Sair**: o botão **Métricas** fica no canto da tela inicial enquanto a aba estiver aberta.
   - Android: abre a folha de compartilhar; mande no zap. Sem a folha, o arquivo vai para Downloads.
   - iPhone: abre a folha de compartilhar; mande no zap ou use "Salvar em Arquivos".
   - Fechar a folha sem mandar não estraga nada: toque de novo.

O arquivo traz todas as runs da sala. Mande só o último de cada celular.

## Depois

Quem roda o relatório junta os arquivos (o último de cada celular) numa pasta e roda:

```
node scripts/ux-report.mjs pasta-com-os-json/
```

Saem duas tabelas:
- **Metas:** cada meta com ok / falhou / sem dado. Arquivo incompleto vira "sem dado", nunca aprovação.
- **Sem meta:** tempo parado, tempo de escolha, "Depois", resgates, dicas, comandos de dono e momentos de risada.

Cole as duas no card do playtest junto com a folha do observador.

## Risadas (folha do observador)

Uma linha por momento. Marque o que viu, não o que achou.

| Momento | Riu (✓) | Comentou | Ficou confuso | Nota |
|---|---|---|---|---|
| 1º minuto (dica de andar, gotinhas) | | | | |
| 1º chip "+N" e a carta | | | | |
| Evento: chuva de boletos / promoção / apagão | | | | |
| Kill-cam do último bicho | | | | |
| Alguém caiu / "Me salva" / resgate | | | | |
| Corneta e forja no intervalo | | | | |
| Resultado: momento mais vergonhoso e prêmios | | | | |
| Revanche (quem puxou?) | | | | |

O relatório lista quantas vezes cada momento aconteceu (`killcam`, `happening:boletos`, `shame`…), para comparar com a folha.

---

## Apêndice (dev): sem o jogo publicado

As salas só aceitam o site oficial ou o PC local (`127.0.0.1`), e o deploy está parado (D-024). Para 1 ou 2 celulares Android ligados por USB ao PC:

1. `node node_modules/wrangler/bin/wrangler.js dev --config multiplayer/wrangler.jsonc --ip 127.0.0.1 --port 8787 --var ALLOW_LOCAL:true`
2. `npx vite --host 127.0.0.1 --port 4187 --strictPort`
3. Troque o `endpoint` de `public/multiplayer.json` por `http://127.0.0.1:8787`, **sem comitar**.
4. Em cada celular: `adb reverse tcp:4187 tcp:4187` e `adb reverse tcp:8787 tcp:8787`.
5. Abra `http://127.0.0.1:4187/?dev=1` no Chrome do celular.

Celular de amigo sem cabo não entra assim.

Pelo console do navegador: `__uxMetrics.data()`, `__uxMetrics.json()` e `__uxMetrics.download()`.
