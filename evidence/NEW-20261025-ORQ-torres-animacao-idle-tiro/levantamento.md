# Passo 1 · Levantamento das animações das torres B/C

Lido de origin/main: manifest `torres`, `render/towers/towers.ts`. Prancha: `levantamento.png` (base pronta + idle + fire,
direção 2, quadro a quadro). Scripts de medida: `medir.mjs` e `jitter.mjs` (rodam sobre as folhas extraídas e o manifest).

## O que existe

Cada torre B/C tem a base (4 vistas × obra-1, obra-2, obra-3, pronta, danificada, ruína) e, por cima, no ponto `mount`, a
"arma com tripulação" em 8 direções, com as folhas `idle` (4 quadros a 4 fps), `fire` (4 a 12 quadros a 12 fps) e
`reload`. O Gustavão não tem arte de torre: o desenho é procedural, sobre os trilhos.

O cliente usa só o quadro 0 do idle (`placeWeapon`, `setFrame(weaponFrame(t.dir,0,frames))`). O `fire` e o `reload` nunca
são carregados (`towerLoads` só lê base e idle, e o art-lite só faz cópia lite dessas duas). O tiro hoje é tudo
procedural: clarão assado (`addFlash`), recuo (`RECOIL_MS`, só na arma procedural), projétil e explosão.

## Supervisão das folhas existentes (8 direções; tabela do card)

| Torre | idle | fire | O que se vê | Veredito |
|---|---|---|---|---|
| B2 Rojão | 4 q, silhueta estável (IoU 0,90) | 6 q, os rojões saem e voltam | sem clarão | usar + clarão/fumaça em código |
| B3 Morteiro | 4 q, ok | 8 q, tripulação carrega e dispara | **ilhas** (pontinhos soltos no topo dos quadros 1 a 3); a base anda até 9 px | limpar as ilhas (corte por componente) |
| B4 Lança-Foguetes | 4 q, ok | 10 q, a tripulação se mexe e o lançador fica fixo | a base anda até 20 px, por causa da tripulação | usar + clarão/fumaça |
| B5 Obuseiro | 4 q, a tripulação anda até 15 px | 10 q, recuo do cano bom | sem clarão | usar + clarão/fumaça |
| C2 Holofote | 4 q, ok | 4 q, quase igual | o facho é o `cone-holofote` em código | usar; "atirando" = facho travado |
| C3 Arame e Sirene | 4 q, ok | 6 q, giram a manivela da sirene | sem problemas | usar |
| C4 Antiaérea | 4 q, ok | 8 q, **quase parado** (IoU 0,95) | sem recuo nem clarão | usar + recuo e clarão em código (4 canos) |
| C5 Radar | 4 q, ok | 12 q, a antena gira | é varredura, não tiro | usar; depende da regra nova (abaixo) |

Tremor entre quadros: cerca de 1 px de arte na maioria das folhas, até 3 px nas que têm a tripulação andando. No jogo
isso dá 0,25 a 0,5 px de tela (arte a 0,5 e lite a 0,5): não aparece. Nenhuma das folhas tem clarão ou fumaça desenhados.

## Plano (econômico: código primeiro, Codex só no que falhar)

1. **Cliente:** idle em loop (4 fps, com fase defasada por torre) e, a cada rajada da sim (`fire()`, no tique do tiro),
   a folha `fire` do quadro 0 ao último, a 12 fps, voltando ao idle. Clarão e fumaça da arte de efeitos que já existe
   (`clarao-artilharia`, `clarao-metralhadora`, `fumaca-disparo`) na boca do cano, por calibre. Recuo leve (2 a 3 px)
   na Antiaérea e nas que não recuam na folha.
2. **Lite do fire:** `art-lite` passa a gerar `fire` a 0,5, como o idle (ex.: Antiaérea 2048² → 1024²). Carregado com a
   base, sem custo na abertura (fila tardia).
3. **Corrigir de quebra:** o `Texture key already in use` (corrida entre `needTowerArt` e a fila do loader).
4. **Codex:** só para o que não fizer sentido no jogo. Hoje, só as ilhas do Morteiro, que saem por recorte, sem Codex.
5. **Provas:** roteiro "torres" no `gravar-partida.mjs` (sandbox `torres=lista&tipos=X` com a torre atirando) → GIF no CI,
   celular e PC.

## C5 Radar (precisa do ok do ORQ antes de mexer na regra)

Hoje não atira (+30 % de alcance às vizinhas). Proposta: mantém o bônus e ganha um **pulso de choque** coerente com a
antena, de controle como o resto do ramo C: um **pulso em área** de 1,6 u no grupo mais denso, chão e ar, 18 de dano e
lentidão de 1 s, a cada 1,5 s, alcance 8. Isso dá ~12 de dano por segundo a cada inimigo do grupo. A C4 dá 160/s, só
no ar. A folha `fire` de 12 quadros
(antena girando) vira o "carregar e soltar o pulso", com um anel azul no alvo. Mudança de regra = sim + teste + bench de
torres.
