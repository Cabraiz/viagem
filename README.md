# viagem.cyou

Roguelite de sobrevivência cooperativo 2.5D para até seis jogadores, com 36 classes de humor cotidiano e foco em navegador mobile. A direção de gameplay é enfrentar hordas, evoluir builds e cooperar, inspirada em Vampire Survivors e no ciclo de coleta, melhorias e defesa de Stonewards.

Os [cards da meta](docs/cards.md) organizam a implementação e os critérios de aceite. Esse ciclo completo ainda está em desenvolvimento; o protótipo atual e suas limitações estão descritos abaixo.

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

O protótipo inclui movimentação, predição local, reconciliação, interpolação de aliados, reconexão e combate básico contra slimes. Cada sala comporta seis participantes e dura até 30 minutos. Os 36 personagens usam sprites com repouso, caminhada e ataque; os golpes são sinalizados pelo servidor também para os aliados. Os atlas são carregados conforme as classes entram na sala. O progresso da partida ainda não é persistido no banco; login e habilidades específicas continuam em desenvolvimento.

A arte dos sprites é uma primeira versão: há passos repetidos, variações de desenho e apenas uma direção frontal com espelhamento horizontal. O repouso usa uma pose fixa (quadro 0) porque os desenhos originais de idle variam de posição. Caminhada e ataque usam 5 e 6 quadros/s, metade das taxas anteriores; o ataque visual dura 1 segundo, sem alterar o cooldown do servidor. A integração técnica não significa aprovação visual final dos ciclos. Os retratos da seleção permanecem separados dos sprites do mapa.

## Câmera e vegetação

Os botões ↶ e ↷ no canto superior esquerdo giram a câmera em passos de 90°, com quatro perspectivas. O terreno elevado é reprojetado; posições, colisões e regras da sala permanecem em coordenadas do mundo. Toques, joystick, profundidade dos objetos e enquadramento acompanham a vista, inclusive ao girar o celular.

O catálogo contém 40 tipos de árvores, com 160 vistas no total. As árvores usam atlas transparentes com quatro vistas, em `public/art/trees/`. Apenas as espécies presentes na sala são carregadas. A distribuição visual depende do código da sala e é igual para os participantes; mantém os 12 pontos de vegetação existentes. Os desenhos variam em escala, cor, copa e tronco. São arte candidata: detalhes de galhos ainda podem variar entre ângulos. Personagens e construções continuam como imagens voltadas para a tela. Esta versão tem quatro perspectivas 2.5D; não oferece órbita 3D contínua.

Para importar lotes locais finalizados, execute `node scripts/import-trees.mjs CAMINHO_DOS_LOTES`. O importador valida tamanho, transparência, margens, base e distinção das quatro células, exporta WebP sem perda e atualiza o catálogo. Os originais ficam preservados fora do repositório.

## Terreno procedural

A ilha agora recebe uma semente aleatória por exploração solo ou por sala. No cooperativo, a sala guarda a semente no Durable Object e transmite versão e assinatura do terreno. Servidor, predição, colisões costeiras e seleção por toque usam o mesmo campo de alturas; a reconexão preserva a ilha. O número aparece nas configurações.

A adaptação reutiliza o hash, ruído e princípios de relevo de `Crônicas do Império` (`terrainModel.ts`, `reliefField.ts` e `relief.frag.glsl`), além dos materiais originais `soil-grass-albedo-v1.png` e `riverbed-albedo-v1.png`, convertidos para WebP de 512 px (255 KB combinados). A fonte original permanece intacta. O shader inclui iluminação das encostas, margens úmidas, fundo submerso, ondas, reflexos e espuma. Alturas são quantizadas igualmente no cliente e no servidor; encostas são limitadas para manter a seleção por toque sem ambiguidades.

O relevo é armazenado em textura de 129 × 129 amostras. A imagem do solo é recalculada apenas ao girar a câmera; a água anima a cerca de 6 quadros/s em uma textura de 256 × 192, independentemente dos personagens. WebGL é necessário. São aclives e declives em uma superfície 2.5D: ainda não há órbita contínua, cavernas, saltos, pontes sobrepostas nem penalidade de velocidade por inclinação. As trilhas, construções e pontos de vegetação continuam fixos dentro da costa segura; a geração varia costa, relevo e materiais.

Esta mudança usa protocolo de sala 3, com fases de partida no servidor. Frontend e Worker precisam ser publicados em conjunto; versões incompatíveis são recusadas. O Pages não publica o Worker automaticamente. O ciclo local tem lobby, prontidão, contagem de três segundos, combate, resultado e revanche; ainda usa três gosmas até a implementação das hordas e do chefe.

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
