# Cadastro rápido de pacientes na Agenda

A recepção pode pesquisar um paciente existente ou escolher **+ Agendar novo paciente: Nome**. A criação exige somente o nome do paciente e os dados usuais do agendamento: profissional, tipo de consulta, data e horário. Nenhum paciente é gravado durante a pesquisa ou ao fechar um rascunho sem salvar.

## Um único cadastro

- A função `schedule_new_patient(jsonb)` cria paciente e agendamento na mesma transação. Uma falha no agendamento também reverte o paciente e a auditoria daquela tentativa.
- O paciente rápido nasce com `registration_pending = true`; a Agenda mostra **Cadastro pendente**.
- **Completar cadastro** abre o formulário do paciente existente. Salvar define `registration_pending = false`, preservando `patient_id` e todos os vínculos.
- Telefone, CPF, nascimento e observações são opcionais. Nenhum campo isolado determina a pendência.
- O formulário normal cria pacientes completos, mesmo sem telefone. Homônimos são permitidos, sem fusão automática por nome.

## Modelo e segurança

A migration `20261123000100_quick_patient_scheduling.sql` torna o telefone nullable, adiciona o indicador com `NOT NULL DEFAULT false` e estende a view `appointment_overview`. Pacientes anteriores são considerados completos; não há atualização em massa, troca de IDs ou tabela paralela.

A operação atômica usa `SECURITY INVOKER`, `search_path` vazio, checagem de administrador ativo e as políticas RLS existentes. Autoria, versionamento, integridade dos vínculos e auditoria continuam usando os triggers existentes. Cancelamento e exclusão protegida permanecem disponíveis. O cadastro rápido não registra pagamentos ou movimentações financeiras.

Em um ambiente próprio e isolado, a migration deve ser aplicada antes de disponibilizar o frontend que depende da nova coluna da view. Esta documentação e os testes não executam migrations em um serviço remoto.

## Testes

Testes de componentes, API e PostgreSQL local descartável cobrem os estados explícitos, pacientes anteriores, dados opcionais, homônimos, autorização e rollback. Os fluxos de navegador verificam busca, criação, conclusão sem trocar o paciente, cancelamento, exclusão segura, atendimento e ausência de movimentação financeira em desktop e celular. Todos os exemplos são sintéticos; nenhuma configuração ou dado da clínica é necessário.
