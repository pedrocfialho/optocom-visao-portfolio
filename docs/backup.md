# Backup e recuperação — referência técnica

Os scripts desta cópia demonstram a arquitetura de backup; não estão configurados para a clínica e não foram ativados nesta preparação. A configuração e as ferramentas locais usam o namespace `.optocom-portfolio`, separado de instalações existentes. Nenhuma senha, certificado, PFX ou cópia de banco faz parte do repositório.

## Rotina

`Initialize-Backup.ps1` exige explicitamente a referência do seu projeto, host do Session Pooler, diretório das ferramentas PostgreSQL e destino externo da chave de recuperação. A combinação referência/usuário/host é validada. As senhas são solicitadas com entrada oculta; a credencial do banco fica protegida por DPAPI no contexto do usuário Windows. O certificado fica no repositório do usuário Windows, com chave privada protegida; o PFX exportado deve ser guardado offline, com sua senha separada. Ele não precisa permanecer conectado para o backup diário.

`Backup-Database.ps1` usa `pg_dump` em formato custom, captura os schemas previstos e a estrutura auxiliar de recuperação, impede gravações no banco e exige TLS com validação completa. Um manifesto assinado identifica o projeto de origem e os hashes dos componentes. O pacote é assinado e criptografado antes de ser armazenado em `backups/database` e num destino sincronizado separado informado na configuração. Arquivos brutos temporários ficam num diretório com ACL restrita e são removidos ao final.

A verificação exige assinatura, hashes e projeto esperado; `Verify-Backup.ps1` valida a cópia sem restaurar. A retenção preserva os últimos 30 dias, o mais recente de cada mês nos últimos 12 meses e sempre o mais recente global. `Preview-BackupRetention.ps1` mostra primeiro as decisões, sem exclusões. Logs operacionais contêm somente data/hora, resultado e nome de arquivo.

`Install-BackupTask.ps1` registra uma tarefa própria às 03:00, com execução quando disponível e no próximo logon. O contexto interativo exige que o usuário Windows esteja conectado para acessar DPAPI e o certificado. Um computador desligado ou sem sessão não gera backup naquele momento; a execução é recuperada quando o contexto necessário fica disponível. Copiar para uma pasta OneDrive não prova sincronização na nuvem: essa condição deve ser verificada no cliente/serviço.

## Recuperação

1. Preserve as cópias originais e tenha o PFX e sua senha offline disponíveis. Em outro computador, importe a chave apenas no contexto Windows autorizado. Não coloque o material no repositório.
2. Instale clientes PostgreSQL compatíveis e confirme a versão exigida. Verifique o arquivo criptografado com o certificado esperado e a referência de origem. Uma assinatura válida não substitui a revisão de procedência.
3. Execute `Restore-Database.ps1` **sem `-Execute`**, informando `-SourceProjectRef`, `-BackupPath`, `-CertificateThumbprint` e `-PostgresBin`. Use `-ExportRestoreList` para exportar o catálogo de objetos para revisão num local privado. Esta etapa apenas inspeciona o pacote.
4. Prepare outro projeto Supabase vazio. Nunca restaure sobre a origem. Revise a lista de objetos: schemas/roles gerenciados pelo Supabase precisam ser compatibilizados com o destino, e objetos conflitantes não devem ser recriados cegamente. O arquivo `roles.sql` serve de referência; não deve ser aplicado automaticamente. Objetos de extensões, Cron, Storage e permissões exigem avaliação específica.
5. Somente após essa revisão, um responsável autorizado pode usar `-Execute`, a lista revisada e os parâmetros do **novo** destino. A ferramenta recusa referência igual à origem e exige confirmação explícita, senha oculta e destino PostgreSQL vazio compatível. A carga usa uma transação, sem `--clean`; a restauração é uma operação de manutenção privilegiada, nunca parte do frontend.
6. Antes de usar o destino, valide autenticação, perfis/RLS, grants, triggers, auditoria, contagens e integridade referencial. Reconfigure URLs, jobs e armazenamento no novo ambiente quando necessário. Um dump lógico não contém os arquivos binários de buckets Storage nem toda a configuração externa de Auth/hosting.

Teste a recuperação periodicamente em um ambiente descartável próprio. Os testes locais de criptografia/retencão não garantem, por si, uma restauração completa no Supabase. Nenhuma restauração foi executada para preparar este portfólio.
