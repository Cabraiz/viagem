# Playtest de primeira vez (UX)

Roteiro para testar o jogo com **3 a 5 pessoas que nunca jogaram**, cada uma no próprio celular, **sem explicação**. O objetivo é medir o que o novato faz sozinho no primeiro minuto e se a turma quer jogar de novo. Cada celular grava as próprias métricas e entrega um arquivo JSON no fim da run. Ninguém precisa instalar nada.

## O que é medido (e o que não é)

As métricas só ligam com `?dev=1` no endereço. Sem isso o jogo não carrega nem o código delas.

- Tudo fica no celular: não há servidor de métricas nem envio automático. O arquivo só sai do aparelho quando alguém toca em **Métricas** no resultado.
- O arquivo não guarda nome, apelido, id de jogador nem posição no mapa. Guarda o código da sala, para juntar os celulares do mesmo grupo, e o tamanho da tela.
- Por run, o arquivo registra:
  - tempo até o 1º arrasto no joystick e até o herói andar;
  - segundos parado nos primeiros 60 s;
  - quedas no round 1 e no total;
  - caídos resgatados e perdidos;
  - ofertas escolhidas e resolvidas pelo padrão, em combate e no intervalo;
  - tempo de escolha e toques em "Depois";
  - tempo até o 1º chip "+N" e até o 1º toque nele;
  - dicas do treinador: vistas, aprendidas e o tempo de cada uma;
  - "Me salva" enviados e recebidos;
  - momentos de risada que aconteceram (kill-cam, eventos, momento vergonhoso);
  - revanche apertada e revanche iniciada;
  - comandos do dono da sala (expulsar, pôr bot, tirar bot).
- Emotes: o leque de emotes ainda não está na sala (só no sandbox). O campo existe e vem como "não disponível".

## Métricas-alvo

| Métrica | Alvo | Como o relatório conta |
|---|---|---|
| 1º movimento | ≤ 3 s | 1º arrasto no joystick desde o começo do combate, na 1ª run de cada celular novato. Passa se 4 de 5 novatos (80%) cumprirem. |
| Round 1 sem queda | 4 de 5 novatos | O novato não caiu no round 1 da 1ª run. |
| Ofertas no padrão | < 20% | Ofertas que sumiram pelo prazo sem o jogador tocar, sobre todas as resolvidas, em todas as runs. Também mostra combate e intervalo separados. |
| Revanche | ≥ 60% dos grupos | Grupo (sala) em que alguma run chegou ao resultado e a revanche começou. |
| 1º chip | ≤ 30 s | O 1º chip "+N" (oferta de nível) apareceu em até 30 s na 1ª run. Passa com 80% dos novatos. |

"Novato" é o celular cujo treinador não sabia nenhuma dica quando a sessão começou. Use um navegador que nunca abriu o jogo, ou uma aba anônima.

## Antes do dia

1. **Endereço.** O jogo precisa estar publicado: as salas só aceitam o site oficial ou o PC local (D-024 deixou o deploy parado). Com o deploy feito, o link é `https://viagem.cyou/?dev=1`.
2. **Sem deploy, só em laboratório.** Dá para jogar com 1 ou 2 celulares Android ligados por USB ao PC:
   - suba o servidor de salas (`wrangler dev … --var ALLOW_LOCAL:true`) e o vite na porta 4187;
   - troque o `endpoint` de `public/multiplayer.json` pelo endereço local, **sem comitar**;
   - em cada celular, rode `adb reverse tcp:4187 tcp:4187` e o mesmo para a porta das salas;
   - abra `http://127.0.0.1:4187/?dev=1` no Chrome do celular.
   Celular de amigo sem cabo não entra assim.
3. **Celulares limpos.** Para valer como novato, cada pessoa abre o link numa aba anônima ou num navegador onde nunca jogou.
4. **Folha do observador.** Imprima ou copie a tabela da seção "Risadas" (uma por pessoa).
5. Bateria acima de 50% e brilho alto. Som ligado se der.

## No dia

**O que dizer:** só "Abre esse link e joga com a gente". **Não explique** controles, chip, resgate nem coleta. Se perguntarem, responda "faz o que achar" e anote a pergunta.

1. Quem organiza abre `…/?dev=1`, escolhe um personagem, toca em **Jogar com amigos** e em **Criar sala**.
2. Na sala de espera, toque em **Chamar a turma**. Com as métricas ligadas, o convite já leva `&dev=1`: quem abre por ele também grava. Confira se o link mandado tem `dev=1`.
3. Cada pessoa abre o convite, escolhe personagem e apelido, entra e toca em **Pronto**.
4. Se faltar gente, o dono pode pôr bots (fica registrado nos comandos de dono). Para o alvo "novato" valem só as pessoas.
5. Joguem uma run inteira. **Não ajude.** Anote na folha cada risada e cada travada ("não sei o que fazer").
6. No resultado, **antes de tocar em Revanche ou Sair**, cada pessoa toca em **Métricas** (o botão tracejado ao lado do tempo e do round):
   - Android: abre a folha de compartilhar. Mande o arquivo pelo WhatsApp ou e-mail para quem organiza. Sem a folha, o arquivo vai para Downloads;
   - iPhone: abre a folha de compartilhar. Use "Salvar em Arquivos" ou mande direto.
7. Agora a turma decide sozinha se aperta **Revanche**. Não sugira. É isso que a métrica de revanche mede.
8. Se jogarem outra run, toquem em **Métricas** de novo no resultado seguinte: o arquivo novo traz as duas runs (use só o mais novo de cada celular).

Se alguém sair no meio, o arquivo ainda pode ser pego pelo console do navegador (`__uxMetrics.download()`), mas no celular isso é difícil. Por isso: Métricas antes de sair.

## Depois

Junte os arquivos (o mais novo de cada celular) numa pasta e rode:

```
node scripts/ux-report.mjs pasta-com-os-json/
```

Sai uma tabela com os alvos (ok / falhou / sem dado) e outra com o que não tem alvo: tempo parado, tempo de escolha, "Depois", resgates, dicas, comandos de dono e momentos de risada. Cole as duas no card do playtest com a folha do observador.

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

O relatório lista quantas vezes cada momento aconteceu (`killcam`, `happening:boletos`, `shame`…), para comparar com as risadas da folha.
