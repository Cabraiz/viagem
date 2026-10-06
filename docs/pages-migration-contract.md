# Migração do frontend para GitHub Pages

Pedido: publicar o repositório do jogo como público e transferir viagem.cyou para GitHub Pages.

Esperado: código público, build reproduzível por GitHub Actions, frontend servido pelo Pages com HTTPS em viagem.cyou e www; API Vercel, salas Cloudflare e Turso funcionando pelos endpoints existentes.

Proibido: publicar credenciais, arquivos .env reais, caches de autenticação, logs, capturas administrativas ou dados de jogadores; alterar API, banco, salas ou registros de e-mail; excluir o fallback Vercel antes da verificação.

Menor prova: repositório público e workflow verde; DNS apontando para Pages; HTTPS e arquivos compilados correspondentes ao build; navegador carregando a seleção, diagnóstico de API/banco e criação de sala no domínio transferido.

Limites: Pages não é ilimitado. Site publicado até 1 GB e limite flexível de tráfego de 100 GB/mês, conforme https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits .
