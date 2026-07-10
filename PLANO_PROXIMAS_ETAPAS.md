# Próximas etapas — Briland Catálogo

Atualizado em 10/07/2026.

## Concluído localmente

- Correção crítica de perfil controlado pelo cliente.
- Grants mínimos para RPCs administrativas.
- Limites de payload e rotina de retenção da telemetria.
- Variáveis de ambiente obrigatórias, sem fallback fixo no código.
- Cabeçalhos de segurança do painel.
- Editor de aparência com cores, fonte, cards, ilha, logo e informações visíveis.
- Prévia ao vivo em moldura de iPhone.
- Rascunho, publicação explícita, versão publicada e restauração do publicado.
- Aplicação dinâmica da configuração publicada no app.
- Substituição do pacote `xlsx` vulnerável por `exceljs`.

## Concluído no Supabase remoto

- Migrações `202607035_enforce_server_side_product_roles.sql` e `202607036_harden_telemetry.sql` aplicadas.
- Schema remoto auditado, com RLS habilitada nas tabelas de negócio.

## Próxima prioridade — antes do deploy

1. Testar todos os perfis e tentativas de acesso horizontal/vertical.
2. Validar importação CSV/XLSX, upload, edição e publicação de aparência com conta master.
3. Configurar as variáveis `NEXT_PUBLIC_*` na Vercel.
4. Fazer commit e push das alterações revisadas.
5. Publicar o painel e realizar smoke test no domínio final.
6. Rotacionar a senha do banco usada durante esta manutenção.

## Evolução do editor visual

- Persistir histórico de múltiplas versões e permitir restauração de qualquer versão.
- Propagar fonte, cor de texto e tokens para todas as telas do app.
- Adicionar validação automática de contraste WCAG.
- Permitir configurar ordem e formato de mais campos dos cards.
- Reutilizar componentes reais do catálogo na prévia, reduzindo diferenças entre simulação e app.

## Fundação do painel

- Dividir `page.tsx` em componentes por domínio.
- Formalizar tokens de layout e estados de componentes.
- Registrar testes de acessibilidade, responsividade e desempenho com catálogo grande.

## Critérios de aceite

- Nenhuma regressão de permissões por perfil.
- Nenhuma vulnerabilidade alta conhecida no fluxo de upload/importação.
- Layout válido em celulares pequenos e grandes.
- Mudanças visuais somente após publicação explícita.
- Erros de persistência nunca podem ser apresentados como sucesso.
