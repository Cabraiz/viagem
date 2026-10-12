# Setores e donos

Proposta aprovada em `design/arquitetura-setores.md` (quadro). Cada setor tem uma porta pública (`index.ts`): de fora do
setor, importe só dela. `tests/arquitetura.test.ts` (`npm run test:arch`) falha se uma seta proibida aparecer ou se um
import entre setores pular a porta. Card que cruza setores vira sub-cards por setor, começando pelo contrato; mudança no
contrato só com decisão registrada.

| Setor | Pasta | O que tem | Pode importar | Testes | Executor de referência |
| --- | --- | --- | --- | --- | --- |
| contrato | `src/contract/` | tipos do estado (`types.ts`), modelo do cliente (`view.ts`), RNG determinístico, constantes de tela e área de interesse (`offscreen.ts`), a run no fio (`run.ts`: `RunState`, `ShameMoment`) | nada | `npm run test:contract` | a definir pelo Orquestrador |
| regras | `src/rules/` | regras puras do cliente e do servidor: classes, stats, passivas, kits, ofertas, orçamento, ondas, Stonewards, SOS, raio de resgate, geometria de telegraph, nome curto | contrato | `npm run test:rules` | a definir pelo Orquestrador |
| mapas | `src/maps/` | terreno infinito e ilha (`terrain/`), colisão e caminhos (`world.ts`), catálogo de árvores, trilha de input e predição de movimento (`prediction.ts`) | contrato | `npm run test:maps` | a definir pelo Orquestrador |
| simulação | `src/sim/` | núcleo (`core.ts`, `context.ts`, `assemble.ts`) e sistemas do servidor: diretor, IA, armas, progressão, resgate, chefe, zueira, Stonewards, cérebro dos bots, ciclo da run | contrato, regras, mapas | `npm run test:sim` | a definir pelo Orquestrador |
| protocolo | `src/protocol/` | protocolo 4 (frames binários), mensagens da sala e formato do protocolo 3 (`room.ts`), sha256 | contrato | `npm run test:protocol` | a definir pelo Orquestrador |
| cliente | `src/client/` (+ `src/main.ts`) | cena Phaser, render, HUD, fun, áudio, UI, lobby, exploração, sprites, terreno desenhado, rede do navegador, sandboxes | contrato, regras, mapas, protocolo | `npm run test:client` | a definir pelo Orquestrador |
| salas | `multiplayer/` | Worker, Durable Object (`room.ts`), `Simulation` da sala (`simulation.ts`), bots da sala | contrato, regras, mapas, simulação, protocolo | `npm run test:rooms` | a definir pelo Orquestrador |
| api | `backend/` | Vercel + Turso (resultados) | contrato | `npm run test:api` | a definir pelo Orquestrador |
| ferramentas | `scripts/` | importadores de arte, bots de protocolo, benches, lint de design | qualquer um (só desenvolvimento) | `npm run test:tools` | a definir pelo Orquestrador |

Testes ficam em `tests/<setor>/` (`contract`, `rules`, `maps`, `sim`, `protocol`, `client`, `rooms`, `api`, `tools`).
O executor roda o do seu setor e `npm run test:arch`; a suíte inteira (`npm test`, `tests/**/*.test.ts`) só na integração.
