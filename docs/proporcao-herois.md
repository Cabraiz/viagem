# Proporção da cabeça dos heróis

Card NEW-20261024-ORQ-maromba-cabeca-proporcao. Em 24/10 o usuário disse que a cabeça do maromba estava "desproporcional em quase tudo". O `proporcao.mjs` só comparava cada animação com o parado do próprio herói. Por isso o maromba ficava coerente consigo mesmo, mas a cabeça dele era pequena demais perto dos outros.

## As duas regras

1. **A mesma cabeça em todas as ações.** Toda folha (andar, corrida, ataque, empurrar, dano) desenha a cabeça do tamanho da cabeça do parado, com ±4 % de folga. A medida é o molde da cabeça do parado encaixado em cada quadro. Ferramentas: `scripts/proporcao.mjs` e `tests/tools/proporcao.test.ts`.
2. **A razão de cada herói, e a faixa dos humanos.** Esta regra vale para o parado visto de frente (S, SE e N), pela mediana dos quadros (no parado que respira, de 16 quadros, só o quadro 0: os outros esticam o tronco e abrem os ombros, e a cabeça pareceria menor):
   - **cab/alt** é a altura da cabeça, do topo até o último trecho estreito do pescoço, dividida pela altura da figura;
   - **cab/ombro** é a largura da cabeça dividida pela dos ombros.

   Cada herói declara os seus valores em `HEROES`, no `scripts/proporcao-herois.mjs`, e a folha nova tem que ficar a até **±3 %** deles. Num herói humano, a cab/alt tem que cair na faixa **0,36–0,45**. O teste é o `tests/tools/proporcao-herois.test.ts`: ele reprova o herói M16 novo (com `idle16-*`) que não declarou os seus valores, e também o que fugiu dos valores declarados.

O perfil (W/NW) não entra na medida, porque de lado o queixo não estreita e a medida bate no teto de 45 %. O gato tem cabeça de gato e não tem pescoço, então segue a regra dele (`animal`) e fica fora da faixa humana.

## Valores (parado de frente, 24/10)

| herói | cab/alt | cab/ombro | observação |
|---|---|---|---|
| viciado-em-bet | 0,38 | 0,85 | |
| clt-cansado | 0,41 | 0,81 | idle8 (R06) |
| maromba | 0,38 | 0,73 | Chad +25 % (dose do usuário, 24/10): a cabeça escalada em todas as folhas M16; antes 0,31/0,57 |
| vendedor-praia | 0,45 | 1,11 | M16 do card vendedor-aposentado (24/10), no teto da faixa humana |
| aposentado | 0,34 | 0,86 | mesmo card, declarado como medido: idoso de cabeça pequena, abaixo da faixa humana (`small`) |
| gato-nada-pra-comer | 0,28 | 0,61 | `animal` |

Os heróis R06 que só têm `idle8` (coach, pedreiro…) aparecem com `node scripts/proporcao-herois.mjs --todos`, mas o teste não os cobra: vários ficam em 0,28–0,33 e só vão ser corrigidos quando ganharem folha M16.

## Herói novo ou folha regerada

1. Meça o parado: `node scripts/proporcao-herois.mjs --ids <classe>`.
2. Se o herói for humano e a cab/alt sair da faixa 0,36–0,45, corrija o parado antes de gerar as outras ações, porque todas elas herdam a cabeça dele.
3. Declare os valores em `HEROES`. Fugir da faixa de propósito (como a cabeça de Chad do maromba) exige a marca `chad` e o motivo no comentário.

## Cabeça maior sem regerar as ações (maromba, 24/10)

`evidence/NEW-20261024-ORQ-maromba-cabeca-proporcao/enxerto/enxertar.py` (no viagem-board) escala a cabeça de cada quadro de cada folha M16 por máscara: a máscara é a cabeça do parado (marcada à mão por direção: tudo acima do maxilar mais o polígono dele), deslocada até o cabelo do quadro; a escala é em volta do pescoço; a toalha e a regata dentro da máscara ficam no corpo; o braço erguido ao lado da cabeça volta por cima. A boca do ataque e a careta do dano são as do próprio quadro. Reimporte com `node scripts/import-movimento16.mjs --input <entrada> --ids <classe> --body-height <altura do corpo em px nativos>`: sem `--body-height` a altura de referência passa a contar a cabeça nova, e o jogo (que desenha 96/height) encolhe o herói inteiro.
