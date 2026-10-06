# viagem.cyou

RPG cooperativo 2.5D para até seis jogadores, com 36 classes de humor cotidiano e foco em navegador mobile.

## Jogar

https://viagem.cyou

Escolha uma classe, confirme o personagem e use **Jogar com amigos → Criar sala**. Compartilhe o código com até cinco amigos.

## Arquitetura

| Responsabilidade | Serviço |
| --- | --- |
| Frontend estático Vite, TypeScript e Phaser | GitHub Pages |
| API HTTP | Vercel, projeto viagem-api |
| Salas autoritativas e WebSocket | Cloudflare Workers + Durable Objects |
| Dados persistentes | Turso |

O protótipo inclui movimentação, predição local, reconciliação, interpolação de aliados, reconexão e combate básico contra slimes. Cada sala comporta seis participantes e dura até 30 minutos. O progresso da partida ainda não é persistido no banco; login, habilidades específicas e sprites animados continuam em desenvolvimento.

## Desenvolvimento

Use Node 24 e os lockfiles:

```sh
npm ci --include=optional
npm ci --prefix backend
npm run check
npm test
npm run build
npm run preview
```

A prévia usa http://127.0.0.1:4187. `npm run dev` inicia o Vite. A API e as salas são serviços separados.

## Publicação

O workflow `.github/workflows/pages.yml` valida os tipos, executa os testes, compila o frontend e publica `dist` no Pages em pushes para `main` ou execução manual. O domínio customizado é `viagem.cyou`, configurado também em Settings → Pages. Detalhes em [docs/github-pages.md](docs/github-pages.md).

O workflow não publica a API nem as salas. Não precisa de credenciais Turso, Vercel ou Cloudflare. Arquivos `.env`, tokens, logs, evidências administrativas e originais locais de arte ficam fora do repositório. Os retratos WebP necessários para o jogo estão em `public/art/portraits/`; regenerá-los exige os originais locais não incluídos.

## Limites do protótipo

Os serviços gratuitos têm cotas. GitHub Pages permite site de até 1 GB e possui limite flexível de tráfego de 100 GB/mês. O multiplayer usa estado transitório em memória e não substitui um sistema de contas. A validação em navegadores e clientes de protocolo não comprova desempenho em seis celulares físicos.
