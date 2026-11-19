# Desenvolvimento, testes e deploy

## Configuração

Instale as dependências com o lockfile. Sem variáveis de ambiente, `pnpm dev` disponibiliza a prévia visual. Para persistência, configure somente um projeto próprio e isolado, com as duas variáveis públicas de `.env.example`. Os valores do exemplo são placeholders e precisam ser substituídos; não são credenciais funcionais. `.env.local` é ignorado pelo Git.

Antes de preparar seu backend, revise as migrations e os requisitos em [arquitetura](architecture.md). Authentication e perfis administrativos precisam ser configurados explicitamente pelo responsável do ambiente; não há usuário padrão nem senha no código.

## Validação local

`pnpm test --pool=vmThreads --maxWorkers=1 --testTimeout=15000` executa testes unitários, de componentes e de funções SQL no PGlite local. O catálogo usado nos testes é gerado sinteticamente, sem arquivo privado. O PGlite não substitui a validação da extensão Cron num PostgreSQL/Supabase próprio.

`pnpm test:browser:portfolio` executa três etapas: fluxos de negócio com configuração pública sintética e backend interceptado; prévia visual sem Supabase configurado; build sintético e verificações HTTPS do bundle. Não defina `PLAYWRIGHT_BASE_URL` para um ambiente real. Use `PLAYWRIGHT_CHANNEL=chrome` para um Chrome já instalado ou instale os navegadores Playwright adequados ao seu computador. Os resultados e screenshots ficam em `test-results`, ignorado pelo Git.

`pnpm test:production-guards` verifica restrições de variáveis e bundle. `pnpm audit:production` audita o build configurado, sem conectar ao Supabase, e grava um relatório local ignorado. `pnpm test:backup` e `pnpm test:retention` requerem Windows/PowerShell 7.4 ou superior e usam somente material sintético temporário.

## Cloudflare Pages

Configure o comando `pnpm build`, saída `dist` e as duas variáveis públicas no ambiente de build do **seu** frontend. Os arquivos `_redirects` e `_headers` são copiados pelo Vite. O primeiro contém o fallback SPA; o segundo define cabeçalhos de segurança.

No Supabase Auth do seu projeto, configure o Site URL HTTPS correspondente e autorize as rotas `/definir-senha` e `/recuperar-senha` dessa origem. Os fluxos de convite/recuperação usam a origem da aplicação, sem domínio de produção fixado no código. Valide login, logout e recuperação no seu ambiente antes de disponibilizá-lo.

Este repositório não contém configuração de vinculação remota, automação de publicação ou segredos do ambiente da clínica. Um push nesta cópia não deve ser conectado ao pipeline de produção da clínica.
