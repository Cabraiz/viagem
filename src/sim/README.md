# Simulação da run de hordas

Setor **simulação** (`src/sim/`, ARQ-setores; mapa completo em `OWNERS.md`): núcleo e sistemas do servidor. Importa só
contrato, regras e mapas, e de fora do setor sempre pelas portas (`../contract/index.ts`, `../rules/index.ts`,
`../maps/index.ts`). Quem usa a simulação de fora (as salas, `multiplayer/`) importa de `src/sim/index.ts`.
`npm run test:sim` roda os testes do setor; `npm run test:arch` confere as setas.

Contrato compartilhado pelos cards VGM-030 em diante:

- `src/contract/types.ts`: estado autoritativo, `Point`, `PlayerInput`, eventos (`SimEvent`, `StampedEvent`) e ordem dos sistemas. Só o card de integração (VGM-030) altera este arquivo; outros cards pedem mudanças ao orquestrador.
- `src/contract/view.ts`: modelo que o cliente recebe. Renderização e HUD usam somente estes tipos.
- `src/contract/rng.ts`: RNG determinístico. Cada sistema usa `ctx.rng.fork('<id>')` ou recebe seu stream na criação, nunca `Math.random`.
- `src/contract/run.ts`: a run como a sala conta aos celulares (`RunState`, `ShameMoment`).
- `context.ts` (aqui): `SimContext` e `SimSystem`, o lado do servidor (guarda o terreno vivo, por isso não é contrato).

Moram fora daqui: regras puras usadas também pelo cliente em `src/rules/` (stats, passivas, kits, ofertas, orçamento,
ondas, Stonewards, raio de resgate, geometria de telegraph); a `Simulation` da sala, que fala o protocolo, em
`multiplayer/simulation.ts`; o ciclo da run (`run.ts`, `RunLifecycle`) fica aqui.

Regras:

1. O servidor decide dano, XP, drops, ofertas e resgates. O cliente envia apenas movimento, alvo preferido, escolha de oferta e comandos de sala.
2. Sistemas são funções puras sobre `SimContext`, testáveis sem Room nem WebSocket. Dano passa exclusivamente por `ctx.damageEnemy` e `ctx.damagePlayer`.
3. Mesma seed + mesmos comandos = mesmo estado. Nada de `Date.now`, `Math.random` ou iteração dependente de ordem de inserção não determinística.
4. Ticks a 20 Hz (`SIM_HZ`). Durações em ticks; use `ticks(segundos)`.
5. TypeScript apenas com sintaxe apagável (sem enum, namespace ou parameter properties), porque `npm test` usa `--experimental-strip-types`. Imports com extensão `.ts`.
6. Textos visíveis em pt-BR; identificadores e comentários em inglês.
7. A ilha mede cerca de 20 × 20 unidades e a câmera segue o jogador (D-019, `docs/camera-follow-contract.md`); na ilha o aviso de spawn pode ficar fora da tela. Inimigos chegam pela costa e pelo mar raso, com aviso, nunca sobre jogadores. No mundo infinito (D-019) eles nascem num anel logo fora da tela de cada jogador ativo, nunca numa tela legal (`offscreen.ts`); bicho largado longe é reaproveitado perto de alguém, sem contar como morto.
