# GitHub Pages

Repositório público: https://github.com/Cabraiz/viagem

Publicação: GitHub Actions (`pages.yml`), branch `main`, artefato `dist`. A API Vercel, o Turso e as salas Cloudflare têm ciclos de publicação separados.

Domínio configurado no Pages antes da troca de DNS: `viagem.cyou`.

DNS esperado na Namecheap:

- A `@` → `185.199.108.153`
- A `@` → `185.199.109.153`
- A `@` → `185.199.110.153`
- A `@` → `185.199.111.153`
- CNAME `www` → `cabraiz.github.io`

Preservar MX/TXT e registros não relacionados ao site. O Pages emite o certificado; habilitar Enforce HTTPS quando disponível. A emissão e a propagação de DNS podem levar até 24 horas.

A aplicação usa caminhos absolutos de assets e foi configurada para o domínio customizado na raiz. A URL `cabraiz.github.io/viagem/` redireciona ao domínio customizado depois da configuração.

Credenciais não participam do build do frontend. As variáveis Turso pertencem apenas ao ambiente da API Vercel. O arquivo `public/multiplayer.json` contém uma URL pública de serviço, não uma credencial.

A versão anterior na Vercel é mantida como fallback durante a migração; não excluir projetos ou bancos para realizar essa troca.

Documentação oficial:
- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
