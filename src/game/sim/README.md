# Simulação da run de hordas

Contrato compartilhado pelos cards VGM-030 em diante.

- `types.ts`: estado autoritativo, `SimContext`, `SimSystem`, eventos e ordem dos sistemas. Só o card de integração (VGM-030) altera este arquivo; outros cards pedem mudanças ao orquestrador.
- `view.ts`: modelo que o cliente recebe. Renderização e HUD usam somente estes tipos.
- `rng.ts`: RNG determinístico. Cada sistema usa `ctx.rng.fork('<id>')` ou recebe seu stream na criação, nunca `Math.random`.

Regras:

1. O servidor decide dano, XP, drops, ofertas e resgates. O cliente envia apenas movimento, alvo preferido, escolha de oferta e comandos de sala.
2. Sistemas são funções puras sobre `SimContext`, testáveis sem Room nem WebSocket. Dano passa exclusivamente por `ctx.damageEnemy` e `ctx.damagePlayer`.
3. Mesma seed + mesmos comandos = mesmo estado. Nada de `Date.now`, `Math.random` ou iteração dependente de ordem de inserção não determinística.
4. Ticks a 20 Hz (`SIM_HZ`). Durações em ticks; use `ticks(segundos)`.
5. TypeScript apenas com sintaxe apagável (sem enum, namespace ou parameter properties), porque `npm test` usa `--experimental-strip-types`. Imports com extensão `.ts`.
6. Textos visíveis em pt-BR; identificadores e comentários em inglês.
7. A ilha mede cerca de 20 × 20 unidades e a câmera mostra a ilha inteira. Inimigos chegam pela costa e pelo mar raso, com aviso, nunca sobre jogadores.
