# Arquitetura

Esta documentação descreve o modelo técnico, sem inventário operacional do ambiente real.

O navegador executa React/TypeScript e chama Supabase Auth, PostgREST e RPCs. O estado de autorização valida sessão e perfil administrativo ativo; uma revalidação bem-sucedida preserva as telas montadas. Falhas de autorização bloqueiam o acesso. Catálogos usam cache em memória, deduplicação e invalidação após alterações; buscas de pacientes têm debounce e proteção contra respostas antigas.

O banco PostgreSQL concentra integridade, RLS, auditoria e regras financeiras. O total de um atendimento soma a consulta após desconto e os exames. Pagamentos e parcelas guardam snapshots das condições aplicadas. Alterações concorrentes usam versões/bloqueios. Exclusões de cadastros e agendamentos passam por funções que verificam vínculos e histórico; registros protegidos devem ser inativados ou cancelados.

As seis migrations em `supabase/migrations` apresentam fundação, operações, financeiro, remoções seguras de catálogos, liquidação de cartões e remoção segura de agendamentos. Elas foram mantidas sem alterações nesta cópia. Não incluem registros da clínica. Configurações iniciais genéricas são parte da modelagem, não dados de pacientes.

Para experimentar o backend, use um projeto descartável próprio. Inspecione previamente todas as migrations e o dry-run; a automação de cartão requer a extensão `pg_cron` e registra uma função SQL periódica. Não execute contra um projeto existente sem planejamento. O histórico de migrations é administrado pelo Supabase CLI; esta preparação não executou nenhum comando remoto.

A criação de usuários e perfis é administrativa, fora do bundle. `scripts/provision-admins.mjs` é uma ferramenta opcional de servidor para um ambiente próprio; exige variáveis administrativas explícitas. Não executá-la com credenciais de produção. Nenhuma chave privilegiada deve usar o prefixo `VITE_`.
