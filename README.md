# OPTOCOM Visão

Sistema de gestão que desenvolvi para uma clínica de optometria da minha família, a partir de uma necessidade real de substituir controles manuais por uma aplicação única.

Esta é uma versão preparada para portfólio. Ela apresenta o código e a arquitetura do sistema, com exemplos sintéticos e sem dados ou configurações do ambiente da clínica.

## Problema

Agenda, cadastro de pacientes e financeiro eram controles separados. Isso exigia conferir as mesmas informações em lugares diferentes e dificultava acompanhar o atendimento, os pagamentos e os valores previstos para os próximos dias.

## Solução

Construí uma aplicação web que conecta o agendamento ao atendimento e ao financeiro. Os computadores da clínica acessam a mesma aplicação pelo navegador, com login individual e dados compartilhados. As telas foram organizadas para apoiar a rotina de recepção e administração.

## Funcionalidades

- Cadastro e histórico administrativo de pacientes; profissionais, tipos de consulta e exames.
- Agenda diária, edição, cancelamento e exclusão protegida de agendamentos sem histórico.
- Atendimentos com exames, retorno gratuito, descontos e cálculo dos valores.
- Pagamentos divididos e parciais, taxas de cartão e liquidação automática de parcelas elegíveis.
- Entradas, saídas, contas a pagar e receber, fornecedores, recorrências e empréstimos.
- Fechamento diário e relatórios por período.
- Acesso administrativo individual, auditoria e proteção de registros com vínculos históricos.
- Scripts de backup lógico criptografado, verificação de integridade, retenção e recuperação.

## Tecnologias

React, TypeScript, Vite, React Router e Lucide no frontend; Supabase Auth e PostgreSQL no backend; Cloudflare Pages para o frontend; Git/GitHub para versionamento. Os testes usam Vitest, Testing Library, Playwright e PGlite. Os scripts de backup usam PowerShell e ferramentas PostgreSQL.

## Arquitetura e segurança

O frontend é separado do banco. Supabase Auth identifica cada usuário; as políticas de Row Level Security (RLS) e as funções PostgreSQL verificam a autorização de administradores ativos. A proteção do banco não depende apenas de esconder ações na interface.

As migrations documentam o modelo de dados, as regras de integridade, funções, triggers, auditoria e automações. Operações financeiras preservam os valores históricos e usam controles de concorrência. Catálogos compartilhados têm cache em memória com invalidação; as telas são carregadas sob demanda.

Somente a URL pública e a chave publishable de um projeto próprio devem ser fornecidas ao frontend. Senhas de banco, tokens administrativos e chaves privilegiadas não pertencem ao bundle. Os exemplos deste repositório não dão acesso ao ambiente da clínica.

O diretório `scripts/backup` demonstra backup lógico com criptografia e assinatura, duas cópias e retenção diária/mensal. A chave de recuperação pode ficar offline; a rotina diária usa o certificado protegido no Windows. A configuração da versão de portfólio é isolada. Veja [backup e recuperação](docs/backup.md).

## Organização

```text
src/
  app/             # Rotas e estrutura da aplicação
  components/      # Componentes compartilhados
  features/        # Autenticação, operações e financeiro
  lib/             # Cliente Supabase, tipos e utilitários
supabase/migrations/ # Modelagem e regras do banco
e2e/               # Fluxos com backend local sintético
e2e-production/    # Bundle servido e requisições interceptadas
scripts/           # Verificações e ferramentas administrativas
docs/              # Documentação técnica genérica
```

## Executar localmente

Use as versões de Node e pnpm indicadas em `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Sem variáveis Supabase, a aplicação oferece a prévia visual, sem acesso ao banco. O arquivo `prototipo_optocom_visao_v3.html` também pode ser aberto diretamente; é um protótipo estático com dados explicitamente fictícios, não uma demonstração do banco real.

Para usar as funcionalidades com persistência, configure **seu próprio ambiente isolado**. Copie `.env.example` para `.env.local` e substitua os placeholders pela URL e chave publishable do seu projeto. O modelo depende das migrations e de um administrador autorizado; não há cadastro público nem credenciais de demonstração. Consulte [desenvolvimento](docs/development.md) e [arquitetura](docs/architecture.md) antes de configurar um backend.

## Testes

A suíte automatizada verifica regras de negócio, autorização, concorrência, cache e formulários. Os testes de navegador cobrem desktop e celular com dados sintéticos; as verificações do build interceptam as chamadas externas. Nenhum teste precisa acessar a produção.

```sh
pnpm test --pool=vmThreads --maxWorkers=1 --testTimeout=15000
pnpm test:browser:portfolio
pnpm test:production-guards
pnpm test:backup
pnpm test:retention
```

O comando de navegador executa os fluxos de negócio, a prévia sem configuração e os testes do bundle, gerando o build com configuração sintética temporária. As ferramentas PostgreSQL e certificados usados nos testes de backup são substituídos por processos e material efêmeros; esses testes não registram tarefas nem executam restauração de banco.

## Deploy

O frontend gera `dist` com `pnpm build` e pode ser servido no Cloudflare Pages. O fallback de SPA permite abrir diretamente as rotas. Um ambiente próprio precisa configurar as variáveis públicas no build e suas URLs HTTPS no Supabase Auth. A aplicação de produção e sua rotina de backup são administradas separadamente desta cópia. Veja [desenvolvimento e deploy](docs/development.md).

## Desenvolvimento com IA

Usei ferramentas de IA como apoio no desenvolvimento, debugging, revisão e melhoria do projeto. As decisões de negócio vieram das necessidades reais da clínica, com implementação incremental e validação dos fluxos por testes e uso manual. Esta versão mantém os testes e as regras para permitir a avaliação técnica do trabalho.

## Demonstração

[Aplicação em produção](https://optocom-visao.pages.dev).

O acesso é autenticado e restrito à equipe. Não são fornecidas credenciais públicas de demonstração. Para avaliar a interface sem acessar dados reais, use a prévia local ou o protótipo sintético. Não foram incluídas screenshots do ambiente da clínica.

## Direitos

Source code made public for portfolio and educational review. All rights reserved.

A disponibilização do código para consulta não concede licença de reutilização, distribuição ou uso comercial.
