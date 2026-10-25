# Chefão do fim da 1ª onda: candidatos (etapa 1)

Todos já têm a folha completa de chefe (384 px, 8 direções: idle, walk, slam, charge, summon, hit, death, sleep/wake,
phase2-idle) e estão no roster como `role:'chefe'` (src/rules/enemy-roster.ts), mas hoje nenhum aparece no jogo
(a rotação exclui o papel chefe; o chefe final do ETA do chaveiro é o Síndico Supremo, `kind:'chefe'`).
Nada de arte nova: o tamanho já é de chefe (ROLE_HEIGHT chefe = 3 alturas de herói), sem precisar de escala ×2.

- `candidatos-no-jogo.png`: cada um no sandbox da horda (`?sandbox=horda&elenco=1&n=0&aliado=1&arte=chefe:<id>`), ao lado do herói.
- `slam.gif` / `walk.gif`: o golpe (slam, já é um golpe de área bom para telegrafar) e o andar, de frente,
  na ordem A, B, C, D e o Síndico (o chefe final, só para comparar).

| | Chefão | Por que sim | Por que não |
|---|---|---|---|
| A | O Grande Credor | P0, já tem falas e frases de morte; silhueta laranja de boletos lê bem no gramado | parece um golem genérico de longe |
| B | DJ do Fim do Mundo | P0, falas prontas; caixas de som nos ombros, muito reconhecível | escuro: some um pouco nas ruas e à noite |
| **C** | **Mapinguari do Shopping** (recomendado) | folclore (o tom da "mula sem cabeça" que o usuário citou); a boca na barriga e as sacolas vermelhas leem de longe e no celular; bem diferente do Síndico (humano) | P1, sem falas: escrevo 4 falas e 3 frases de morte (texto, não arte) |
| D | Boitatá de Sacolinha | folclore, azul brilhante destaca | de frente vira um monte escuro, pouco legível como bicho |

Fora: a mula-sem-cabeça (public/art/mascote) só tem a folha de corrida (sem golpe nem morte) e é mascote, do nosso lado.

Nome e subtítulo propostos:
- C: **MAPINGUARI DO SHOPPING** / "Tem uma boca na barriga e cartão sem limite."
- A: **O GRANDE CREDOR** / "Feito de todos os boletos que você esqueceu."
- B: **DJ DO FIM DO MUNDO** / "O drop dele derruba prédio."

## Quando (proposta)
No **fim da saída da 1ª onda**: quando o último corpo da onda 1 sai (o drip da onda 0 acaba), o chefão nasce na
entrada por onde a onda veio, a ≥ 12 u do Uno e de todo jogador, e vem cercar o carro como a onda.
Por quê: o horário é certo (≈ 150–180 s do início + o drip) e sempre acontece; "onda limpa" depende de matar os
retardatários e com 1 jogador pode demorar ou nunca fechar. Com o intervalo de explorar do E5 (abre com calma no
Uno e chefão morto), a ordem fica clara: onda 1 → chefão → explorar 120 s → onda 2.
Gancho: o E5 expõe `NestsOptions.onWave` (combinado na caixa); eu não mexo em sendWave/step/nextWave.
